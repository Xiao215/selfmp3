import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'
import type {
  Playlist,
  ApplyMetadata,
  BulkEditSongs,
  CloudServer,
  Library,
  Settings,
  ScanResult,
  PlaylistSongs,
  CreateTag,
  SetArtistNames,
} from '@selfmp3/shared'
import { toSqliteTime } from '@selfmp3/shared'
import type { CloudImportRequest, ImportRequestView } from '@selfmp3/replica'
import type { Api } from '../api/api.js'
import { beforeAddingTo, clientApi, serverOf } from '../runtime.js'
import { queryKeys } from './keys.js'
import {
  hasLivePlaylists,
  tagsMoveLivePlaylists,
  withPlaylist,
  withSong,
  withTag,
} from './patchLibrary.js'

/**
 * Writes to the library and to what only its server keeps, handled by
 * TanStack Query (queries.ts holds the reads).
 *
 * Each mutation says what it reached: it puts its answer into what is held
 * (patchLibrary.ts) or asks again for what it may have changed, so no
 * component works that out for itself.
 */

/**
 * The edits that can wait for the library: made while this device cannot
 * reach it, kept on the device and sent when it can (the app's
 * `waitingEdits.ts`), even across a reload. A browser that goes offline holds
 * every edit back until it is online again, and held only in memory they were
 * lost to a reload without a word.
 *
 * Each is named by its key and sent by the same function from either side:
 * the hook that made it, or the defaults a kept edit is sent with after a
 * reload (`resumableEdits`), which knows nothing of the screen it came from.
 * They are the taps: a tag, a heart, a song onto or off a playlist, a new
 * order. Each says only what it changes, so sending it late cannot undo what
 * another device did meanwhile.
 */
export const editKeys = {
  songTags: ['edit', 'song-tags'],
  loved: ['edit', 'loved'],
  bulkTag: ['edit', 'bulk-tag'],
  bulkLoved: ['edit', 'bulk-loved'],
  rest: ['edit', 'rest'],
  addToPlaylist: ['edit', 'add-to-playlist'],
  removeFromPlaylist: ['edit', 'remove-from-playlist'],
  reorderPlaylist: ['edit', 'reorder-playlist'],
} as const

const editFns = {
  songTags: ({ songId, add, remove }: { songId: number; add: number[]; remove: number[] }) =>
    clientApi().changeSongTags(songId, { add, remove }),
  loved: ({ id, loved }: { id: number; loved: boolean }) => clientApi().setLoved(id, loved),
  bulkTag: (input: { songIds: number[]; tagId: number; action: 'add' | 'remove' }) =>
    clientApi().bulkTag(input),
  bulkLoved: (input: { songIds: number[]; loved: boolean }) => clientApi().bulkLoved(input),
  rest: ({ songIds, until }: { songIds: number[]; until: string | null }) =>
    clientApi().bulkEditSongs({
      edits: songIds.map(songId => ({ songId, patch: { restUntil: until } })),
    }),
  addToPlaylist: async ({ playlistId, songIds }: { playlistId: number; songIds: number[] }) => {
    // A removal still waiting on its Undo goes first: added back inside the
    // Undo's time, a song was added to a playlist that still had it, and
    // then taken out of it when the time ran out.
    await beforeAddingTo(playlistId)
    return clientApi().addToPlaylist(playlistId, { songIds })
  },
  removeFromPlaylist: ({
    playlistId,
    songIds,
    keep,
  }: {
    playlistId: number
    songIds: number[]
    /** Undoing an add: the playlist stays even with none left. */
    keep?: boolean
  }) => clientApi().removeManyFromPlaylist(playlistId, songIds, keep),
  reorderPlaylist: ({ playlistId, songIds }: { playlistId: number; songIds: number[] }) =>
    clientApi().reorderPlaylist(playlistId, songIds),
} satisfies Record<keyof typeof editKeys, (variables: never) => Promise<unknown>>

/**
 * Teach a query client how to send each kind of edit by its key alone, for an
 * edit kept from before a reload. Only the sending: what a hook does with the
 * answer belongs to its screen, and the app asks for the library again once
 * the kept edits have gone.
 */
export function resumableEdits(client: QueryClient): void {
  for (const name of Object.keys(editKeys) as (keyof typeof editKeys)[]) {
    client.setMutationDefaults([...editKeys[name]], {
      mutationFn: editFns[name] as (variables: unknown) => Promise<unknown>,
    })
  }
}

/** Whether a mutation is a kind of edit that can wait (`editKeys`). */
export function isResumableEdit(mutationKey: readonly unknown[] | undefined): boolean {
  return mutationKey?.[0] === 'edit'
}

/**
 * A mutation that invalidates the library on success — and every playlist's
 * members with it, unless told the edit cannot reach them.
 *
 * Almost every write in this app changes the library snapshot in some way, so
 * this wrapper removes a lot of repetitive `onSuccess` boilerplate — and, more
 * usefully, removes the chance of forgetting one.
 *
 * The members go too because these edits answer without the thing they
 * changed, so their reach cannot be read off the answer: a deleted song leaves
 * every list it was on, live or not; a bulk tag or a heart may move songs into
 * or out of a live playlist, which the server works out from its rules on every
 * read. The library is asked for whole here anyway; the lists on screen beside
 * it are a small addition, and without it they kept the old members until
 * their stale time ran out while the sidebar's counts had already moved.
 *
 * `members: false` is for the edits that cannot reach a list — a tag made or
 * renamed, a playlist deleted, whose own list would only 404 if asked again.
 * `failure` is what to say when it fails, for the app to show (`meta.failure`);
 * left out for an edit whose screen shows its own error, so nothing is said twice.
 *
 * A mutation of no argument names `TArgs` as `void` (`useScanLibrary`), so
 * `scan.mutate()` means what it reads as rather than wanting a meaningless one.
 */
function useLibraryMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  {
    failure,
    members = true,
    key,
  }: { failure?: string; members?: boolean; key?: readonly unknown[] } = {},
): UseMutationResult<TResult, Error, TArgs> {
  const client = useQueryClient()
  return useMutation({
    ...(key === undefined ? {} : { mutationKey: [...key] }),
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.library })
      if (members) void client.invalidateQueries({ queryKey: queryKeys.playlists })
    },
    ...(failure === undefined ? {} : { meta: { failure } }),
  })
}

/**
 * Put an edit's answer into the library held, instead of asking for all of it
 * again (patchLibrary.ts). The library is still asked for when there is none
 * held, when the answer cannot be put in, or when `refetchToo` says the edit
 * reaches further than the answer shows.
 *
 * The time the library was last answered is kept: a patched saved copy is no
 * fresher an answer than it was.
 */
function putInLibrary(
  client: QueryClient,
  patch: (library: Library) => Library | null,
  refetchToo: (library: Library) => boolean = () => false,
): void {
  const current = client.getQueryData<Library>(queryKeys.library)
  const next = current ? patch(current) : null
  if (next) {
    client.setQueryData(queryKeys.library, next, {
      updatedAt: client.getQueryState(queryKeys.library)?.dataUpdatedAt,
    })
  }
  // A fetch already under way may have been answered before this edit landed,
  // and would put the old library back over the patch: it is asked again.
  if (!current || !next || libraryFetching(client) || refetchToo(current)) {
    void client.invalidateQueries({ queryKey: queryKeys.library })
  }
}

/**
 * A playlist's answer put into the library held, as of now: what it holds is
 * kept on the device once per library answer (the app's useKeepAlongside), and
 * a playlist whose songs changed is a new answer as far as that goes.
 */
function putPlaylist(client: QueryClient, playlist: Playlist): void {
  putInLibrary(client, library => withPlaylist(library, playlist, new Date().toISOString()))
}

/** Whether the library is being asked for right now — an optimistic edit cancels that, and owes it. */
const libraryFetching = (client: QueryClient): boolean =>
  client.isFetching({ queryKey: queryKeys.library }) > 0

/**
 * Ask for every playlist's members again, when a song edit may have moved it
 * into or out of a live one.
 *
 * The server works a live playlist out from its rules on every read, and a
 * rule can follow any field of a song — a tag, the heart, the artist, its BPM
 * — so the answer to a song edit says nothing about which lists it changed.
 * The library's counts follow on a refetch; the member lists held (an open
 * playlist page, the cover mosaics' ids) do not, and kept the old members
 * until their stale time ran out. With no library held there is no telling
 * whether any playlist is live, and asking is cheaper than a stale list.
 */
function refetchLivePlaylists(client: QueryClient): void {
  const library = client.getQueryData<Library>(queryKeys.library)
  if (!library || hasLivePlaylists(library)) {
    void client.invalidateQueries({ queryKey: queryKeys.playlists })
  }
}

export const useCreateTag = () =>
  useLibraryMutation((tag: CreateTag) => clientApi().createTag(tag), { members: false })

/**
 * Delete a tag, gone from the library held at once: the editor closes as it
 * asks, and the tile it was opened from stayed on the page until the refetch
 * came back, which read as a delete that had not worked. Put back if it fails.
 */
export function useDeleteTag() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => clientApi().deleteTag(id),
    meta: { failure: 'Couldn’t delete the tag' },
    onMutate: async id => {
      await client.cancelQueries({ queryKey: queryKeys.library })
      const previous = client.getQueryData<Library>(queryKeys.library)
      if (previous) {
        client.setQueryData<Library>(queryKeys.library, {
          ...previous,
          tags: previous.tags.filter(tag => tag.id !== id),
          songs: previous.songs.map(song =>
            song.tagIds.includes(id)
              ? { ...song, tagIds: song.tagIds.filter(tagId => tagId !== id) }
              : song,
          ),
        })
      }
      return { previous }
    },
    onError: (_error, _id, context) => {
      if (context?.previous) client.setQueryData(queryKeys.library, context.previous)
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.library })
      void client.invalidateQueries({ queryKey: queryKeys.playlists })
    },
  })
}

export const useRenameTag = () =>
  useLibraryMutation(
    ({ id, name }: { id: number; name: string }) => clientApi().renameTag(id, name),
    { members: false },
  )

export const useSetArtistNames = () =>
  useLibraryMutation((input: SetArtistNames) => clientApi().setArtistNames(input), {
    members: false,
    failure: 'Couldn’t save the names',
  })

/**
 * Recolour a tag, applied optimistically — a swatch that waits a round trip
 * before the chips change feels like it did not take.
 */
export function useSetTagHue() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, hue }: { id: number; hue: number }) => clientApi().setTagHue(id, hue),
    meta: { failure: 'Couldn’t recolour the tag' },
    onMutate: async ({ id, hue }) => {
      const refetching = libraryFetching(client)
      await client.cancelQueries({ queryKey: queryKeys.library })
      const previous = client.getQueryData<Library>(queryKeys.library)
      if (previous) {
        client.setQueryData<Library>(queryKeys.library, {
          ...previous,
          tags: previous.tags.map(tag => (tag.id === id ? { ...tag, hue } : tag)),
        })
      }
      return { previous, refetching }
    },
    onSuccess: (tag, _variables, context) => {
      // A colour reaches nothing else, so the answer is the whole change.
      putInLibrary(
        client,
        library => withTag(library, tag),
        () => context.refetching,
      )
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) client.setQueryData(queryKeys.library, context.previous)
      void client.invalidateQueries({ queryKey: queryKeys.library })
    },
  })
}

/**
 * Put tags on a song and take them off. Each tick sends only what it changes,
 * never the whole set: a whole set worked out from a picker left open, or from
 * an edit made offline and sent on reconnecting, took off every tag another
 * device had put on meanwhile. The requests still run one at a time, in the
 * order they were made, so each answer is the song as of every tick before it.
 */
export function useChangeSongTags() {
  const client = useQueryClient()
  return useMutation({
    mutationKey: [...editKeys.songTags],
    mutationFn: editFns.songTags,
    scope: { id: 'song-tags' },
    meta: { failure: 'Couldn’t change the song’s tags' },
    onSuccess: song => {
      // Only a live playlist following a tag the song gained or lost can hold
      // other songs now. Asking for the library again whenever any live
      // playlist existed re-read and redrew all of it after every tick.
      const held = client.getQueryData<Library>(queryKeys.library)
      const playlistsMoved = !held || tagsMoveLivePlaylists(held, song)
      putInLibrary(
        client,
        library => withSong(library, song),
        () => playlistsMoved,
      )
      if (playlistsMoved) void client.invalidateQueries({ queryKey: queryKeys.playlists })
    },
    // A request that timed out may still have landed: the chips ask what is true.
    onError: () => {
      void client.invalidateQueries({ queryKey: queryKeys.library })
    },
  })
}

export const useBulkTag = () =>
  useLibraryMutation(editFns.bulkTag, {
    failure: 'Couldn’t tag those songs',
    key: editKeys.bulkTag,
  })

export function usePatchSong() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<Api['patchSong']>[1] }) =>
      clientApi().patchSong(id, patch),
    onSuccess: song => {
      putInLibrary(client, library => withSong(library, song), hasLivePlaylists)
      refetchLivePlaylists(client)
    },
  })
}

/**
 * The multi-select delete.
 *
 * One request rather than one per song: the server removes the rows in a
 * single transaction and bumps the library version once, so the list settles
 * in one refetch instead of flickering N times.
 */
export const useBulkDeleteSongs = () =>
  useLibraryMutation((input: { songIds: number[] }) => clientApi().bulkDeleteSongs(input))

/**
 * Copies of one song folded into the one kept: their tags, love, playlist
 * places and plays go to it, and then they are out of the library.
 */
export const useMergeSongs = () =>
  useLibraryMutation((input: { keep: number; songIds: number[] }) => clientApi().mergeSongs(input))

/** Many songs' own edits at once: Tidy up's approved changes. */
export const useBulkEditSongs = () =>
  useLibraryMutation((input: BulkEditSongs) => clientApi().bulkEditSongs(input), {
    failure: 'Couldn’t save the changes',
  })

export const useBulkLoved = () =>
  useLibraryMutation(editFns.bulkLoved, {
    failure: 'Couldn’t change the likes',
    key: editKeys.bulkLoved,
  })

export const useScanLibrary = (api: Api | null) =>
  useLibraryMutation<void, ScanResult>(() => serverOf(api).scan(), {
    failure: 'Couldn’t scan the library',
  })

export function useUpdatePlaylist() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<Api['updatePlaylist']>[1] }) =>
      clientApi().updatePlaylist(id, patch),
    // In the order made: a rule or a name goes whole, and two answered out of
    // order would leave the first.
    scope: { id: 'playlist-update' },
    meta: { failure: 'Couldn’t save the playlist' },
    onSuccess: (playlist, { id }) => {
      putPlaylist(client, playlist)
      // New rules are new members.
      void client.invalidateQueries({ queryKey: queryKeys.playlistSongs(id) })
    },
  })
}

/**
 * Make a playlist, with its first songs when it has any, and have the library
 * name it.
 *
 * The one way a playlist is made: Save in Up next, an answer, a selection, a
 * copy, the new-playlist sheet. Each made it in two calls and refreshed the
 * library by hand, and one forgot. What to say when it fails is the caller's
 * — each says it in its own words, where it was asked — so this carries none.
 *
 * `refresh` is how the library is asked again: in the background, as most
 * callers want so their next page opens at once; awaited, for one that needs
 * the new playlist in the library before it goes on; or not at all, for one
 * that makes several and refreshes once after.
 */
export function useCreatePlaylist() {
  const client = useQueryClient()
  return useMutation({
    // Never paused for the network. Every caller waits for the new playlist's
    // id, and a create is not an edit that can wait (`resumableEdits`): paused,
    // it spun with no word while offline, was held only in memory, and went on
    // when the network came back, after its sheet was cancelled (R3-M5). A
    // cloud library makes it in the device's copy at once; a server out of
    // reach fails it, and the caller says so.
    networkMode: 'always',
    mutationFn: async ({
      input,
      songIds = [],
    }: {
      input: Parameters<Api['createPlaylist']>[0]
      songIds?: readonly number[]
      refresh?: 'background' | 'wait' | 'none'
    }) => {
      // With its songs in the same request: in two, a tab closed between them
      // left an empty playlist, and a retry after a failed second made it twice.
      return clientApi().createPlaylist(
        input.kind === 'manual' && songIds.length > 0 ? { ...input, songIds: [...songIds] } : input,
      )
    },
    onSuccess: (_created, { refresh = 'background' }) => {
      if (refresh === 'none') return undefined
      const asked = client.invalidateQueries({ queryKey: queryKeys.library })
      return refresh === 'wait' ? asked : undefined
    },
  })
}

export const useDeletePlaylist = () =>
  useLibraryMutation((id: number) => clientApi().deletePlaylist(id), {
    failure: 'Couldn’t delete the playlist',
    members: false,
  })

/**
 * Stop a playlist following its tags.
 *
 * The songs move from being an answer to a question into being the playlist's
 * own, so the list has to be refetched as well as the library: the ids are the
 * same ones, but they now come from a different place and can be reordered and
 * removed.
 */
export function useStopFollowing() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => clientApi().stopFollowing(id),
    meta: { failure: 'Couldn’t stop filling from those tags' },
    onSuccess: (playlist, id) => {
      putPlaylist(client, playlist)
      void client.invalidateQueries({ queryKey: queryKeys.playlistSongs(id) })
    },
  })
}

/**
 * Love / unlove, applied optimistically.
 *
 * A heart that waits for a round trip before filling in feels broken, so the
 * cache is updated immediately and rolled back if the request fails.
 */
export function useToggleLoved() {
  const client = useQueryClient()

  return useMutation({
    mutationKey: [...editKeys.loved],
    mutationFn: editFns.loved,
    meta: { failure: 'Couldn’t change the like' },

    onMutate: async ({ id, loved }) => {
      const refetching = libraryFetching(client)
      await client.cancelQueries({ queryKey: queryKeys.library })
      const previous = client.getQueryData<Library>(queryKeys.library)

      if (previous) {
        client.setQueryData<Library>(queryKeys.library, {
          ...previous,
          // Liked lists newest first, so the guess carries the time too.
          songs: previous.songs.map(song =>
            song.id === id
              ? { ...song, loved, lovedAt: loved ? toSqliteTime(Date.now()) : null }
              : song,
          ),
        })
      }

      return { previous, refetching }
    },

    onSuccess: (song, _variables, context) => {
      // The server's song, over the guess. A live playlist of loved songs is
      // the one thing it cannot show, and asks for the library — and the
      // members — when there is one.
      putInLibrary(
        client,
        library => withSong(library, song),
        library => context.refetching || hasLivePlaylists(library),
      )
      refetchLivePlaylists(client)
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) client.setQueryData(queryKeys.library, context.previous)
      void client.invalidateQueries({ queryKey: queryKeys.library })
    },
  })
}

/**
 * Rest songs until a time, or wake them with null (shared rest.ts), shown at
 * once: the row's moon is there before the answer, and gone again if it fails.
 */
export function useRestSongs() {
  const client = useQueryClient()
  return useMutation({
    mutationKey: [...editKeys.rest],
    mutationFn: editFns.rest,
    meta: { failure: 'Couldn’t save the change' },

    onMutate: async ({ songIds, until }) => {
      await client.cancelQueries({ queryKey: queryKeys.library })
      const previous = client.getQueryData<Library>(queryKeys.library)
      if (previous) {
        const ids = new Set(songIds)
        client.setQueryData<Library>(queryKeys.library, {
          ...previous,
          songs: previous.songs.map(song =>
            ids.has(song.id) ? { ...song, restUntil: until } : song,
          ),
        })
      }
      return { previous }
    },

    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.library }),

    onError: (_error, _variables, context) => {
      if (context?.previous) client.setQueryData(queryKeys.library, context.previous)
      void client.invalidateQueries({ queryKey: queryKeys.library })
    },
  })
}

/**
 * Change the library's settings, shown at once.
 *
 * Optimistic, and one at a time in the order they were made. A switch that
 * waited for the server did not move under the finger, and each tap worked out
 * its value from the last answer: two quick taps both sent "off". A note
 * removed while the last removal was still saving came back the same way. Now
 * each change is applied to what is held as it is made, so the next one starts
 * from it; the server's answer is taken only when it is the last one waiting,
 * so an earlier answer does not put a switch back for a moment; and a failure
 * puts back what was held before it and asks again.
 */
export function useUpdateSettings(api: Api | null, baseUrl: string | null) {
  const client = useQueryClient()
  const key = queryKeys.settings(baseUrl)
  return useMutation({
    mutationKey: ['settings', 'update', baseUrl],
    mutationFn: (patch: Parameters<Api['updateSettings']>[0]) =>
      serverOf(api).updateSettings(patch),
    scope: { id: `settings:${baseUrl ?? ''}` },
    meta: { failure: 'Couldn’t save the setting' },
    onMutate: async patch => {
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<Settings>(key)
      if (previous) client.setQueryData<Settings>(key, { ...previous, ...patch })
      return { previous }
    },
    onSuccess: settings => {
      const waiting = client.isMutating({ mutationKey: ['settings', 'update', baseUrl] })
      if (waiting <= 1) client.setQueryData(key, settings)
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) client.setQueryData(key, context.previous)
      void client.invalidateQueries({ queryKey: key })
    },
  })
}

export function useAddToPlaylist() {
  const client = useQueryClient()
  return useMutation({
    mutationKey: [...editKeys.addToPlaylist],
    mutationFn: editFns.addToPlaylist,
    meta: { failure: 'Couldn’t add to the playlist' },
    onSuccess: (playlist, { playlistId }) => {
      // The answer is the playlist with its new count and length; its members
      // are a question of their own.
      putPlaylist(client, playlist)
      void client.invalidateQueries({ queryKey: queryKeys.playlistSongs(playlistId) })
    },
  })
}

/**
 * Put a playlist's songs in a new order, and show them in it at once.
 *
 * The whole order goes to the server, not a move instruction — that is what
 * the route, the sync log and the bucket all speak, and it is what makes a
 * reorder made offline merge sanely later (docs/SYNC.md: the latest order
 * wins). The cached list is changed first: a row that snapped back to where
 * it was until a refetch happened to come round makes a move that worked look
 * like one that failed. If the request fails the old order comes back and the
 * list is asked for again, so what is on screen is never a guess that stuck.
 *
 * Both ways of moving a row go through this: the grip a mouse drags at desktop
 * width, and a held finger on a phone.
 */
export function useReorderPlaylist() {
  const client = useQueryClient()
  return useMutation({
    mutationKey: [...editKeys.reorderPlaylist],
    mutationFn: editFns.reorderPlaylist,
    // The whole order each time, so the newest has to land last.
    scope: { id: 'playlist-order' },
    meta: { failure: 'Couldn’t save the new order' },

    onMutate: async ({ playlistId, songIds }) => {
      const key = queryKeys.playlistSongs(playlistId)
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<PlaylistSongs>(key)
      client.setQueryData<PlaylistSongs>(key, { ...(previous ?? {}), playlistId, songIds })
      return { previous }
    },

    onError: (_error, { playlistId }, context) => {
      const key = queryKeys.playlistSongs(playlistId)
      if (context?.previous) client.setQueryData(key, context.previous)
      void client.invalidateQueries({ queryKey: key })
    },
  })
}

/** Remove a whole selection from one manual playlist. Never touches the songs. */
export function useRemoveManyFromPlaylist() {
  const client = useQueryClient()
  return useMutation({
    mutationKey: [...editKeys.removeFromPlaylist],
    mutationFn: editFns.removeFromPlaylist,
    meta: { failure: 'Couldn’t remove the songs from the playlist' },
    onSuccess: ({ playlist }, { playlistId }) => {
      if (playlist) putPlaylist(client, playlist)
      else void client.invalidateQueries({ queryKey: queryKeys.library })
      void client.invalidateQueries({ queryKey: queryKeys.playlistSongs(playlistId) })
    },
  })
}

export const useApplyMetadata = () =>
  useLibraryMutation(({ id, input }: { id: number; input: ApplyMetadata }) =>
    clientApi().applyMetadata(id, input),
  )

/**
 * Ask the server for a link through the bucket, rather than waiting to be near it.
 *
 * The one import path that assumes nothing about where this device is. The
 * server drains these whenever it is next awake (`cloudImports.process()` on
 * the server), so a link added from a train is downloaded at home that evening
 * and arrives here with the sync after it.
 *
 * Invalidates the list, not the library: nothing has been imported yet — a row
 * has been added to the queue that `useCloudImports` draws.
 */
export function useRequestCloudImport(): UseMutationResult<
  ImportRequestView,
  Error,
  CloudImportRequest
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: CloudImportRequest) => clientApi().requestCloudImport(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.cloudImports })
    },
  })
}

/**
 * Have the shared computer work for this account. What it answers is where
 * the account's library there listens, which every screen that needs a server
 * then finds at once, before any snapshot names it.
 */
export function useJoinSharedServer(): UseMutationResult<CloudServer | null, Error, void> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => (await clientApi().joinSharedServer()).server,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.cloudServer })
      void client.invalidateQueries({ queryKey: queryKeys.serverGrants })
    },
  })
}

/** Take a server's way into the bucket back; it lets the library go at its next look. */
export function useRemoveServerGrant(): UseMutationResult<unknown, Error, string> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => clientApi().removeServerGrant(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.serverGrants })
      // The server removed is passed over from now, though the snapshot still names it.
      void client.invalidateQueries({ queryKey: queryKeys.cloudServer })
    },
  })
}

import { useEffect } from 'react'
import {
  hashKey,
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import type {
  Playlist,
  ApplyMetadata,
  BulkEditSongs,
  FixCoversStatus,
  Health,
  AnalysisStatus,
  CloudServer,
  CloudStatus,
  DeviceList,
  DoormanGrants,
  Library,
  Settings,
  Stats,
  StatsRange,
  Wrapped,
  WrappedRange,
  ForgottenGems,
  ImportQueue,
  PlayHistory,
  ScanResult,
  SimilarSongs,
  ToolStatus,
  LyricsResponse,
  Motion,
  PlaylistSongs,
  SyncManifest,
  CreateTag,
  SetArtistNames,
} from '@selfmp3/shared'
import { API_ERROR, toSqliteTime } from '@selfmp3/shared'
import { ApiError } from '../api/error.js'
import type { Api } from '../api/api.js'
import {
  beforeAddingTo,
  clientApi,
  librarySnapshot,
  lyricsSnapshot,
  motionSnapshot,
  playlistSnapshot,
  runLater,
} from '../runtime.js'
import { decodeMotion, type MotionCurve } from '../motion/motion.js'
import { useClientState } from './context.js'
import { createLibrarySnapshotWrites, type LibrarySnapshotWrites } from './librarySnapshotWrites.js'
import {
  hasLivePlaylists,
  tagsMoveLivePlaylists,
  withPlaylist,
  withSong,
  withTag,
} from './patchLibrary.js'
import { STALE } from './stale.js'
import {
  isPendingRequest,
  type CloudImportRequest,
  type ImportRequestList,
  type ImportRequestView,
} from '@selfmp3/replica'

/**
 * Server state, handled by TanStack Query.
 *
 * The rule this file follows: a component never holds a copy of server data in
 * `useState`. It reads from a query and writes through a mutation, and the
 * cache invalidation lives here rather than being sprinkled across components.
 * That is what keeps two open tabs — or a phone and a laptop — consistent.
 *
 * Keys carry no server address: the cache is cleared when the address changes
 * (`queryClient.clear()`), and every query is gated on having an address at
 * all, which is `ClientState.ready`. The exceptions are what is asked of a
 * library's server directly rather than of whatever answers this device
 * (`devicesThrough`, `settings` and the rest), which carry its address.
 */

/**
 * Every playlist's members live under this prefix, so an edit that may have
 * reached any of them (`refetchLivePlaylists`) can ask for all of them again
 * without knowing which.
 */
const playlistsKey = ['playlist'] as const

export const queryKeys = {
  cloudImports: ['cloud-imports'] as const,
  cloudServer: ['cloud-server'] as const,
  serverGrants: ['cloud-grants'] as const,
  library: ['library'] as const,
  /**
   * What only a library's server keeps — its settings, its analysis pass, its
   * cover-fixing pass — asked of that server directly (`useServerApi` in the
   * app), and so kept by its address. A device's cache is cleared when its own
   * address changes, but a cloud library reaching one server and then another
   * (a refused one passed over, a shared library joined, a new name) keeps the
   * same cache, and one server's answer would stand in for the next's.
   */
  settings: (baseUrl: string | null) => ['settings', baseUrl] as const,
  importQueue: ['import', 'queue'] as const,
  importHistory: ['import', 'history'] as const,
  importTools: ['import', 'tools'] as const,
  /** Everything counted: what a played song invalidates, in one go. */
  statsRoot: ['stats'] as const,
  stats: (range: StatsRange) => ['stats', range] as const,
  wrapped: (range: WrappedRange) => ['stats', 'wrapped', range] as const,
  /*
   * Its own namespace, deliberately not under `library`.
   *
   * Invalidation matches by prefix, so nesting it there had every library
   * mutation — a tag, a love, an edit — refetch the gems, and the server
   * re-ranks them with a little randomness on every request. The row reshuffled
   * under the pointer as you tagged, which is the one thing `staleTime:
   * Infinity` on it is there to prevent. A different handful each time you open
   * the library; the same handful while you are looking at it.
   */
  gems: (limit: number) => ['gems', limit] as const,
  history: ['stats', 'history'] as const,
  playlists: playlistsKey,
  playlistSongs: (id: number) => [...playlistsKey, id, 'songs'] as const,
  /** Where a members hook with no playlist to ask about sits, asking nothing. */
  noPlaylist: [...playlistsKey, 'none'] as const,
  /** The phone's, for the two it asks for that a browser instead reads from `library`. */
  manifest: ['manifest'] as const,
  lyrics: (id: number) => ['lyrics', id] as const,
  motion: (id: number) => ['motion', id] as const,
  health: ['health'] as const,
  metadataLookup: (songId: number) => ['metadata', 'lookup', songId] as const,
  /** By the server's address, as `settings` is. */
  fixCovers: (baseUrl: string | null) => ['metadata', 'fix-covers', baseUrl] as const,
  lyricsSearch: (query: string) => ['lyrics', 'search', query] as const,
  /** The limit is in the key: a different count is a different answer. */
  similar: (id: number | null, limit: number) => ['similar', id ?? 'none', limit] as const,
  /** By the server's address, as `settings` is. */
  analysis: (baseUrl: string | null) => ['analysis', baseUrl] as const,
  devices: ['devices'] as const,
  /**
   * The device list as a server reached directly from a cloud library tells
   * it: presence and Settings › Devices ask the same server the same question
   * and share the answer.
   */
  devicesThrough: (baseUrl: string | null) => ['devices', 'through', baseUrl] as const,
  cloud: ['cloud'] as const,
  /** The stored doorman session's account, read on the device itself. */
  cloudSession: ['cloud-session'] as const,
  /** A library's uids: `which` is this device's copy or the server being asked. */
  cloudUids: (which: 'device' | 'via-server', baseUrl?: string) =>
    ['cloud-uids', which, baseUrl] as const,
}

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
  addToPlaylist: async ({ playlistId, songIds }: { playlistId: number; songIds: number[] }) => {
    // A removal still waiting on its Undo goes first: added back inside the
    // Undo's time, a song was added to a playlist that still had it, and
    // then taken out of it when the time ran out.
    await beforeAddingTo(playlistId)
    return clientApi().addToPlaylist(playlistId, { songIds })
  },
  removeFromPlaylist: ({ playlistId, songIds }: { playlistId: number; songIds: number[] }) =>
    clientApi().removeManyFromPlaylist(playlistId, songIds),
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
 * Listening for the cloud library changing behind an answer, once per query
 * client however many screens hold the library.
 */
const cloudListeners = new WeakMap<QueryClient, { holders: number; stop: () => void }>()

/**
 * The cloud library answers from this device's copy first and looks at the
 * bucket afterwards (`@selfmp3/replica`'s loadCloudLibrary). When that look finds
 * something, everything read from the copy is asked for again — from the copy,
 * so no request leaves the device.
 */
function useCloudLibraryChanges(client: QueryClient): void {
  useEffect(() => {
    let entry = cloudListeners.get(client)
    if (!entry) {
      const stop = clientApi().onCloudLibraryChanged(() => {
        void client.invalidateQueries({ queryKey: queryKeys.library })
        void client.invalidateQueries({ queryKey: queryKeys.playlists })
        void client.invalidateQueries({ queryKey: queryKeys.manifest })
        void client.invalidateQueries({ queryKey: queryKeys.cloudImports })
      })
      entry = { holders: 0, stop }
      cloudListeners.set(client, entry)
    }
    const held = entry
    held.holders++
    return () => {
      held.holders--
      if (held.holders === 0) {
        held.stop()
        cloudListeners.delete(client)
      }
    }
  }, [client])
}

const snapshotWrites = new WeakMap<QueryClient, LibrarySnapshotWrites>()

/**
 * The offline library's writer for one query client (librarySnapshotWrites.ts).
 *
 * One per client, because what it holds back belongs to the library that
 * client holds: when the client lets the library go — `clear()` on a switch of
 * server, a sign-in or a sign-out — the answer waiting for its turn is the
 * wrong library to save, so it is dropped and the next answer is saved at once.
 */
function snapshotWritesFor(client: QueryClient): LibrarySnapshotWrites {
  let writes = snapshotWrites.get(client)
  if (!writes) {
    const created = createLibrarySnapshotWrites(
      library => {
        // Fire-and-forget: a failed mirror write must not fail anything.
        void librarySnapshot()?.write(library)
      },
      { later: runLater() },
    )
    const libraryHash = hashKey(queryKeys.library)
    client.getQueryCache().subscribe(event => {
      if (event.type === 'removed' && event.query.queryHash === libraryHash) created.forget()
    })
    snapshotWrites.set(client, created)
    writes = created
  }
  return writes
}

/**
 * The library, with an offline fallback.
 *
 * When the request fails because the server is asleep, the last snapshot saved
 * on this device is returned instead — so the app opens and plays cached music
 * rather than showing an error screen. Answers are saved as that snapshot at
 * once when the library's version moved, and otherwise at most every few
 * minutes (`snapshotWritesFor`).
 */
export function useLibrary(): UseQueryResult<Library, Error> {
  const { ready } = useClientState()
  const client = useQueryClient()
  useCloudLibraryChanges(client)

  return useQuery({
    queryKey: queryKeys.library,
    enabled: ready,
    queryFn: async (): Promise<Library> => {
      const api = clientApi()
      // Let go of meanwhile — `clear()` on a switch of server, a sign-in or a
      // sign-out — whatever this asking finds is the last library's, and is
      // neither saved nor put in the cache.
      const cache = client.getQueryCache()
      const asking = cache.find({ queryKey: queryKeys.library, exact: true })
      const letGo = (): boolean =>
        cache.find({ queryKey: queryKeys.library, exact: true }) !== asking
      // The cloud library is its own saved copy, kept on the device already and
      // answered from it first: saving the answer again is the whole library
      // written twice, and reading the old copy first is slower than the answer.
      const fromCloud = api.answersFromCloud()
      let answered = false
      /** The saved copy, read once: shown while the server is asked, and kept if it fails. */
      let saved: Promise<Library | null> | undefined
      if (!fromCloud && client.getQueryData(queryKeys.library) === undefined) {
        // Opening the app: a server can take seconds to answer, or never (asleep,
        // fifteen seconds), and the saved copy is on this device. It is shown
        // meanwhile — dated 0, so it counts as stale and says it is not an
        // answer — and replaced by the answer, or kept beside the error, below.
        saved = librarySnapshot()
          ?.read()
          .catch(() => null)
        void saved?.then(copy => {
          if (
            copy &&
            !answered &&
            !letGo() &&
            client.getQueryData(queryKeys.library) === undefined
          ) {
            client.setQueryData(queryKeys.library, copy, { updatedAt: 0 })
          }
        })
      }
      try {
        const library = await api.library()
        answered = true
        if (!fromCloud && !letGo()) snapshotWritesFor(client).offer(library)
        return library
      } catch (error) {
        answered = true
        // Any failure, not just an unreachable server. A music library is not a
        // dashboard: you open it to play something, and a library a few hours
        // stale is still your library where an error screen is nothing. The
        // only thing the stale copy hides is a song added since the last fetch,
        // and one song missing beats all of them missing.
        //
        // The copy is put in the cache and the error is still thrown, so a
        // screen gets both: `data` to draw, and `isError` to say the server is
        // not there. Returning the copy as the answer would hide the failure — a
        // phone saying "13 songs" beside covers that will not load and
        // playlists that come back empty, with nothing on it to say why.
        //
        // Only a server's: the saved copy is a server's library, never the
        // bucket's, and nothing to read when the cache already has one.
        if (!fromCloud && !letGo() && !client.getQueryData(queryKeys.library)) {
          const cached = await (saved ??
            librarySnapshot()
              ?.read()
              .catch(() => null))
          if (cached && !letGo() && !client.getQueryData(queryKeys.library)) {
            client.setQueryData(queryKeys.library, cached)
          }
        }
        throw error
      }
    },
    staleTime: STALE.halfMinute,
    // Asked again on coming back to the app, once it is that old. Off for the
    // app as a whole; the library is what a return is for.
    refetchOnWindowFocus: true,
    // Keep showing the old library while a refetch runs, so the list does not
    // flash empty every time the app regains focus.
    placeholderData: previous => previous,
    // Offline, or the bucket's daily allowance used up: asking again at once
    // gets the same answer, and the screen should say why without the wait.
    retry: (failureCount, error) =>
      error instanceof ApiError && (error.isOffline || error.isBucketCapped)
        ? false
        : failureCount < 2,
  })
}

/**
 * Whether whatever answers this device is there: the server, or the doorman in
 * front of a cloud library. Asked once and not again, so it waits for `ready`
 * like every query here — asked before the connection was read, it failed
 * with "no server" and kept saying so for a cloud library that loaded fine.
 */
export function useHealth(): UseQueryResult<Health, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.health,
    enabled: ready,
    queryFn: () => clientApi().health(),
    retry: false,
    staleTime: STALE.minute,
  })
}

/**
 * What a hook handed the server to ask is given while the server is away: such
 * a hook is not enabled then, so this answers only a stray refetch or a press
 * that raced the server leaving.
 */
function serverOf(api: Api | null): Api {
  if (!api) throw new ApiError(0, 'Your library’s computer isn’t answering.', API_ERROR.offline)
  return api
}

/**
 * The library's settings, which only its server keeps and acts on
 * (`SettingsSchema`). `api` is that server — reached directly from a cloud
 * library (`useServerApi` in the app) — or null while it is away, and
 * `baseUrl` its address, which the answer is kept by (`queryKeys.settings`).
 */
export function useSettings(
  api: Api | null,
  baseUrl: string | null,
): UseQueryResult<Settings, Error> {
  return useQuery({
    queryKey: queryKeys.settings(baseUrl),
    enabled: api !== null,
    queryFn: () => serverOf(api).settings(),
    staleTime: STALE.fiveMinutes,
  })
}

/**
 * `enabled` is here for the same reason as the import queue's: a cloud library
 * whose server is within reach asks that server directly instead (the Stats
 * page's `statsSource.ts`), and this one would only fetch a 501 to throw away.
 */
export function useStats(range: StatsRange, enabled = true): UseQueryResult<Stats, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.stats(range),
    queryFn: () => clientApi().stats(range),
    enabled: ready && enabled,
    staleTime: STALE.minute,
  })
}

export function useWrapped(range: WrappedRange, enabled = true): UseQueryResult<Wrapped, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.wrapped(range),
    queryFn: () => clientApi().wrapped(range),
    enabled: ready && enabled,
    staleTime: STALE.minute,
  })
}

/** How many forgotten gems a shelf shows, unless it asks for more. */
const GEMS_LIMIT = 12

/** How many neighbours a song's page shows, unless it asks otherwise. */
const SIMILAR_LIMIT = 12

/**
 * Forgotten gems.
 *
 * `staleTime: Infinity` on purpose: the server shuffles the ranking on every
 * request, so a background refetch would silently rearrange the row under the
 * user's finger. It reloads when the page is opened again, which is the only
 * time a different set is welcome.
 */
export function useGems(limit = GEMS_LIMIT): UseQueryResult<ForgottenGems, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.gems(limit),
    enabled: ready,
    queryFn: () => clientApi().gems(limit),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

/** Plays the listening history reads, from this device's server or one reached directly. */
export const HISTORY_PLAYS = 200

export function useHistory(enabled = true): UseQueryResult<PlayHistory, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.history,
    queryFn: () => clientApi().history(HISTORY_PLAYS),
    enabled: ready && enabled,
    staleTime: STALE.minute,
  })
}

/**
 * The import queue, polled only while something is actually happening.
 *
 * Polling a finished queue every second forever would keep the phone's radio
 * awake for nothing, so the interval switches off once the queue is idle.
 */
export function useImportQueue(enabled: boolean): UseQueryResult<ImportQueue, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.importQueue,
    queryFn: () => clientApi().importQueue(),
    enabled: ready && enabled,
    refetchInterval: query => {
      const data = query.state.data
      if (!data) return false
      return data.active > 0 || data.queued > 0 ? 1_000 : false
    },
  })
}

/** How many finished imports "Show all" reads: the server's most. */
export const HISTORY_LIMIT = 500

/**
 * The queue's whole history, for "Show all": read once when asked for, never
 * polled. The polled queue carries only the newest few finished jobs, since
 * a big day's history a second at a time was most of what the poll moved.
 */
export function useImportHistory(enabled: boolean): UseQueryResult<ImportQueue, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.importHistory,
    queryFn: () => clientApi().importQueue(HISTORY_LIMIT),
    enabled: ready && enabled,
    staleTime: STALE.halfMinute,
  })
}

export function useImportTools(enabled = true): UseQueryResult<ToolStatus, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.importTools,
    queryFn: () => clientApi().importTools(),
    enabled: ready && enabled,
    staleTime: STALE.minute,
    retry: false,
  })
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

/**
 * Ask the server for a playlist's members, and keep the answer. When it does
 * not answer, the kept copy goes into the cache and the error is still thrown,
 * as `useLibrary` does: the screen draws the copy and knows it is one.
 */
async function fetchPlaylistSongs(client: QueryClient, playlistId: number): Promise<PlaylistSongs> {
  try {
    const songs = await clientApi().playlistSongs(playlistId)
    void playlistSnapshot()?.write(songs)
    return songs
  } catch (error) {
    const key = queryKeys.playlistSongs(playlistId)
    const cached = (await playlistSnapshot()?.read(playlistId)) ?? null
    if (cached && !client.getQueryData(key)) client.setQueryData(key, cached)
    throw error
  }
}

/**
 * A playlist's members, as one query whoever asks: the cover mosaics, an Ask
 * answer's list and the playlist's own page read the same cache entry.
 * `staleTime` is the asker's: see the two below.
 */
function usePlaylistMembers(
  playlistId: number | null,
  staleTime: number,
): UseQueryResult<PlaylistSongs, Error> {
  const { ready } = useClientState()
  const client = useQueryClient()
  return useQuery({
    queryKey: playlistId === null ? queryKeys.noPlaylist : queryKeys.playlistSongs(playlistId),
    enabled: ready && playlistId !== null,
    staleTime,
    queryFn: () => fetchPlaylistSongs(client, playlistId ?? 0),
  })
}

/**
 * The members for a cover mosaic, which there is one of per playlist tile and
 * per tag row — so a short stale time meant every tile refetching on every
 * visit to the tab. Freshness does not depend on this number: an edit to one
 * playlist invalidates its own list, and one that may reach any list — a song
 * edit with a live playlist present, a delete, a scan — invalidates the
 * `queryKeys.playlists` prefix (`refetchLivePlaylists`, `useLibraryMutation`).
 */
export const usePlaylistSongIds = (
  playlistId: number | null,
): UseQueryResult<PlaylistSongs, Error> => usePlaylistMembers(playlistId, STALE.fiveMinutes)

// --- metadata polish --------------------------------------------------------

/**
 * Candidates for one song. Cached client-side too; the server caches for a day.
 *
 * `enabled` for the same reason as `useStats`': a cloud library within reach of
 * its server asks that server directly instead (`metadataSource.ts`).
 */
export function useMetadataLookup(songId: number, enabled = true) {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.metadataLookup(songId),
    queryFn: () => clientApi().lookupMetadata(songId),
    enabled: ready && enabled,
    staleTime: STALE.tenMinutes,
    retry: false,
  })
}

export const useApplyMetadata = () =>
  useLibraryMutation(({ id, input }: { id: number; input: ApplyMetadata }) =>
    clientApi().applyMetadata(id, input),
  )

/** The cover-art pass, polled only while it runs (same idea as the import queue). */
export function useFixCoversStatus(
  api: Api | null,
  baseUrl: string | null,
): UseQueryResult<FixCoversStatus, Error> {
  return useQuery({
    queryKey: queryKeys.fixCovers(baseUrl),
    enabled: api !== null,
    queryFn: () => serverOf(api).fixCoversStatus(),
    refetchInterval: query => (query.state.data?.status === 'running' ? 1_000 : false),
  })
}

export function useFixCovers(api: Api | null, baseUrl: string | null) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (action: 'start' | 'cancel') =>
      action === 'start' ? serverOf(api).fixCoversStart() : serverOf(api).fixCoversCancel(),
    meta: { failure: 'Couldn’t reach the cover fixing' },
    onSuccess: status => {
      client.setQueryData(queryKeys.fixCovers(baseUrl), status)
      void client.invalidateQueries({ queryKey: queryKeys.library })
      // A rule can ask for art (`hasArt`), so found covers are new members.
      refetchLivePlaylists(client)
    },
  })
}

/**
 * Nearest neighbours of a song. Cheap on the server, so cached only briefly.
 *
 * The last song's answer is kept while the next one's is being fetched, and
 * says so through `isPlaceholderData`. Not to draw — the phone's shelf shows
 * nothing rather than another song's neighbours — but so that a page laid out
 * around "this song has neighbours" does not spend the moment between two
 * songs laid out around "it has none" and rearrange itself when the answer
 * lands.
 */
export function useSimilar(
  songId: number | null,
  limit = SIMILAR_LIMIT,
): UseQueryResult<SimilarSongs, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.similar(songId, limit),
    queryFn: () => clientApi().similar(songId ?? 0, limit),
    enabled: ready && songId !== null,
    staleTime: STALE.minute,
    placeholderData: keepPreviousData,
  })
}

/**
 * Background analysis progress, polled only while it is running — and the
 * library is refetched once it stops, so the new BPM and key badges appear,
 * with the members of any live playlist whose rules follow those.
 */
export function useAnalysisStatus(
  api: Api | null,
  baseUrl: string | null,
): UseQueryResult<AnalysisStatus, Error> {
  const client = useQueryClient()
  return useQuery({
    queryKey: queryKeys.analysis(baseUrl),
    queryFn: async () => {
      const status = await serverOf(api).analysisStatus()
      const previous = client.getQueryData<AnalysisStatus>(queryKeys.analysis(baseUrl))
      if (previous?.running && !status.running) {
        void client.invalidateQueries({ queryKey: queryKeys.library })
        refetchLivePlaylists(client)
      }
      return status
    },
    enabled: api !== null,
    refetchInterval: query => (query.state.data?.running ? 1_500 : false),
  })
}

export function useStartAnalysis(api: Api | null, baseUrl: string | null) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (force: boolean) => serverOf(api).analyze(force),
    onSuccess: status => {
      client.setQueryData(queryKeys.analysis(baseUrl), status)
    },
  })
}

// --- devices ----------------------------------------------------------------

/**
 * Other devices and what they are playing. The event stream keeps this fresh
 * by writing into the same cache entry; the interval is only the fallback for
 * when the stream is down, and it stops entirely in a hidden tab.
 */
export function useDevices(streamConnected: boolean): UseQueryResult<DeviceList, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.devices,
    enabled: ready,
    queryFn: () => clientApi().devices(),
    staleTime: STALE.tenSeconds,
    refetchInterval: streamConnected ? false : 15_000,
    refetchIntervalInBackground: false,
    retry: false,
  })
}

/**
 * This server's connection to the cloud bucket. Polled quickly while a pass is
 * uploading, so the progress bar moves, and slowly otherwise, so a pass the
 * server starts by itself after an import still shows up.
 */
export function useCloudStatus(enabled = true): UseQueryResult<CloudStatus, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.cloud,
    queryFn: () => clientApi().cloudStatus(),
    enabled: ready && enabled,
    // Quickly while something is moving — an upload, or Google finishing a
    // sign-in in another tab — and slowly otherwise.
    refetchInterval: query =>
      query.state.data?.state === 'syncing' || query.state.data?.signingIn ? 1_000 : 10_000,
    refetchIntervalInBackground: false,
  })
}

/**
 * A cloud library's imports: links asked of the server through the bucket. Looked at
 * again every half minute while one is still waiting or downloading.
 */
export function useCloudImports(): UseQueryResult<ImportRequestList, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.cloudImports,
    enabled: ready,
    queryFn: () => clientApi().cloudImports(),
    refetchInterval: query => (query.state.data?.imports.some(isPendingRequest) ? 30_000 : false),
  })
}

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

// --- the shared computer (docs/features/shared-server.md) ---------------------

/** The servers this account has let into its bucket. */
export function useServerGrants(enabled = true): UseQueryResult<DoormanGrants, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.serverGrants,
    enabled: ready && enabled,
    staleTime: STALE.minute,
    queryFn: () => clientApi().serverGrants(),
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

// --- downloads, a playlist's page, and what a playing song brings ------------

/** The manifest: what this device should keep for automatic downloads, and at what size. */
export function useManifest(): UseQueryResult<SyncManifest, Error> {
  const { ready } = useClientState()

  return useQuery({
    queryKey: queryKeys.manifest,
    enabled: ready,
    staleTime: STALE.minute,
    queryFn: (): Promise<SyncManifest> => clientApi().manifest(),
  })
}

/** A playlist's songs in playlist order, for its own page, which is asked again sooner. */
export const usePlaylistSongs = (playlistId: number | null): UseQueryResult<PlaylistSongs, Error> =>
  usePlaylistMembers(playlistId, STALE.halfMinute)

/** Lyrics for a song, which do not change unless someone edits them. */
export function useLyrics(songId: number | null): UseQueryResult<LyricsResponse, Error> {
  const { ready } = useClientState()
  const client = useQueryClient()

  return useQuery({
    queryKey: queryKeys.lyrics(songId ?? 0),
    enabled: ready && songId !== null,
    staleTime: STALE.fiveMinutes,
    // A song with no lyrics is a 404 and will stay one; retrying is three more
    // requests for the same answer.
    retry: false,
    queryFn: async (): Promise<LyricsResponse> => {
      if (songId === null) throw new Error('no song')
      try {
        const lyrics = await clientApi().lyrics(songId)
        void lyricsSnapshot()?.write(songId, lyrics)
        return lyrics
      } catch (error) {
        // Only when the question went unanswered: a 404 means the words are
        // gone, and a kept copy would be a stale answer to a fresh question.
        if (error instanceof ApiError && error.isUnanswered) {
          const key = queryKeys.lyrics(songId)
          const cached = (await lyricsSnapshot()?.read(songId)) ?? null
          if (cached && !client.getQueryData(key)) client.setQueryData(key, cached)
        }
        throw error
      }
    },
  })
}

/**
 * A song's motion curve, decoded, for the visuals to sample every frame; null
 * until there is one (not analysed yet, or never fetched and offline).
 *
 * The curve only changes when the song is analysed again, so it is fresh for
 * an hour and a 404 is not asked again three times. `select` is a module
 * function, so React Query decodes each answer once and hands every render the
 * same bytes. The raw answer is what is kept offline, as the server sent it.
 */
export function useMotion(songId: number | null): MotionCurve | null {
  const { ready } = useClientState()
  const client = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.motion(songId ?? 0),
    enabled: ready && songId !== null,
    staleTime: STALE.hour,
    // A song not analysed yet is a 404 until it is, and a device offline is
    // answered from its copy below; only a server stumbling is worth another go.
    retry: (failures, error) =>
      failures < 1 &&
      error instanceof ApiError &&
      error.status >= 500 &&
      error.code !== API_ERROR.contractMismatch,
    select: decodeMotion,
    queryFn: async (): Promise<Motion> => {
      if (songId === null) throw new Error('no song')
      try {
        const motion = await clientApi().motion(songId)
        void motionSnapshot()?.write(songId, motion)
        return motion
      } catch (error) {
        // As for lyrics: only when the question went unanswered.
        if (error instanceof ApiError && error.isUnanswered) {
          const key = queryKeys.motion(songId)
          const cached = (await motionSnapshot()?.read(songId)) ?? null
          if (cached && !client.getQueryData(key)) client.setQueryData(key, cached)
        }
        throw error
      }
    },
  })

  return songId === null ? null : (query.data ?? null)
}

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import type {
  ApplyMetadata,
  FixCoversStatus,
  AnalysisStatus,
  CloudConnect,
  CloudStatus,
  DeviceList,
  Library,
  Settings,
  Stats,
  StatsRange,
  Wrapped,
  WrappedRange,
  ForgottenGems,
  ImportQueue,
  SimilarSongs,
  ToolStatus,
  MigrateMatchJob,
  LyricsResponse,
  PlaylistSongs,
  SyncManifest,
} from '@selfmp3/shared'
import { ApiError } from '../api/error.js'
import type { Api } from '../api/api.js'
import { clientApi, librarySnapshot, lyricsSnapshot, playlistSnapshot } from '../runtime.js'
import { useClientState } from './context.js'
import type { CloudImportRequest, ImportRequestList } from '@selfmp3/cloud'

/**
 * Server state, handled by TanStack Query.
 *
 * The rule this file follows: a component never holds a copy of server data in
 * `useState`. It reads from a query and writes through a mutation, and the
 * cache invalidation lives here rather than being sprinkled across components.
 * That is what keeps two open tabs — or a phone and a laptop — consistent.
 *
 * Moved from `apps/web/src/lib/queries.ts`, with `apps/mobile`'s four
 * phone-only hooks folded in at the end. The bodies are unchanged: `api.`
 * became `clientApi().` and the two offline-mirror calls became the
 * `LibrarySnapshotStore` port, and that is the whole diff. Everything else that
 * differed between the two apps turned out to be the platform, not the query —
 * the phone keyed every cache entry by the Mac's address, which is now a
 * `queryClient.clear()` when the address changes, and gated every query on
 * having an address at all, which is `ClientState.ready`.
 */

export const queryKeys = {
  cloudImports: ['cloud-imports'] as const,
  library: ['library'] as const,
  settings: ['settings'] as const,
  importQueue: ['import', 'queue'] as const,
  importTools: ['import', 'tools'] as const,
  migrateJob: (id: string) => ['migrate', id] as const,
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
  playlistSongs: (id: number) => ['playlist', id, 'songs'] as const,
  /** The phone's, for the two it asks for that the web app reads from `library`. */
  manifest: ['manifest'] as const,
  lyrics: (id: number) => ['lyrics', id] as const,
  health: ['health'] as const,
  metadataLookup: (songId: number) => ['metadata', 'lookup', songId] as const,
  fixCovers: ['metadata', 'fix-covers'] as const,
  lyricsSearch: (query: string) => ['lyrics', 'search', query] as const,
  similar: (id: number) => ['similar', id] as const,
  analysis: ['analysis'] as const,
  devices: ['devices'] as const,
  cloud: ['cloud'] as const,
}

/**
 * The library, with an offline fallback.
 *
 * When the request fails because the Mac is asleep, the last snapshot written
 * to IndexedDB is returned instead — so the app opens and plays cached music
 * rather than showing an error screen.
 */
export function useLibrary(): UseQueryResult<Library, Error> {
  const { ready } = useClientState()
  const client = useQueryClient()

  return useQuery({
    queryKey: queryKeys.library,
    enabled: ready,
    queryFn: async (): Promise<Library> => {
      try {
        const library = await clientApi().library()
        // Fire-and-forget: a failed mirror write must not fail the query.
        void librarySnapshot()?.write(library)
        return library
      } catch (error) {
        // Any failure, not just an unreachable server. A music library is not a
        // dashboard: you open it to play something, and a library a few hours
        // stale is still your library where an error screen is nothing. The
        // only thing the stale copy hides is a song added since the last fetch,
        // and one song missing beats all of them missing.
        //
        // The copy is put in the cache and the error is still thrown, so a
        // screen gets both: `data` to draw, and `isError` to say the server is
        // not there. Returning the copy as the answer hid the failure — the
        // phone said "13 songs" beside covers that would not load and playlists
        // that came back empty, and nothing on it could say why.
        const cached = (await librarySnapshot()?.read()) ?? null
        if (cached && !client.getQueryData(queryKeys.library)) {
          client.setQueryData(queryKeys.library, cached)
        }
        throw error
      }
    },
    staleTime: 30_000,
    // Keep showing the old library while a refetch runs, so the list does not
    // flash empty every time the app regains focus.
    placeholderData: previous => previous,
    retry: (failureCount, error) =>
      error instanceof ApiError && error.isOffline ? false : failureCount < 2,
  })
}

export function useSettings(): UseQueryResult<Settings, Error> {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => clientApi().settings(),
    staleTime: 5 * 60_000,
  })
}

export function useStats(range: StatsRange): UseQueryResult<Stats, Error> {
  return useQuery({
    queryKey: queryKeys.stats(range),
    queryFn: () => clientApi().stats(range),
    staleTime: 60_000,
  })
}

export function useWrapped(range: WrappedRange): UseQueryResult<Wrapped, Error> {
  return useQuery({
    queryKey: queryKeys.wrapped(range),
    queryFn: () => clientApi().wrapped(range),
    staleTime: 60_000,
  })
}

/**
 * Forgotten gems.
 *
 * `staleTime: Infinity` on purpose: the server shuffles the ranking on every
 * request, so a background refetch would silently rearrange the row under the
 * user's finger. It reloads when the page is opened again, which is the only
 * time a different set is welcome.
 */
export function useGems(limit = 12): UseQueryResult<ForgottenGems, Error> {
  return useQuery({
    queryKey: queryKeys.gems(limit),
    queryFn: () => clientApi().gems(limit),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export function useHistory() {
  return useQuery({
    queryKey: queryKeys.history,
    queryFn: () => clientApi().history(200),
    staleTime: 60_000,
  })
}

/**
 * The import queue, polled only while something is actually happening.
 *
 * Polling a finished queue every second forever would keep the phone's radio
 * awake for nothing, so the interval switches off once the queue is idle.
 */
export function useImportQueue(enabled: boolean): UseQueryResult<ImportQueue, Error> {
  return useQuery({
    queryKey: queryKeys.importQueue,
    queryFn: () => clientApi().importQueue(),
    enabled,
    refetchInterval: query => {
      const data = query.state.data
      if (!data) return false
      return data.active > 0 || data.queued > 0 ? 1_000 : false
    },
  })
}

export function useImportTools(): UseQueryResult<ToolStatus, Error> {
  return useQuery({
    queryKey: queryKeys.importTools,
    queryFn: () => clientApi().importTools(),
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * A mutation that invalidates the library on success.
 *
 * Almost every write in this app changes the library snapshot in some way, so
 * this wrapper removes a lot of repetitive `onSuccess` boilerplate — and, more
 * usefully, removes the chance of forgetting one.
 */
function useLibraryMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
): UseMutationResult<TResult, Error, TArgs> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.library })
    },
  })
}

/**
 * The same wrapper for mutations that take no argument.
 *
 * `useLibraryMutation(() => clientApi().scan())` cannot infer `TArgs` from a
 * zero-parameter function, so it lands on `unknown` and callers are forced to
 * pass a meaningless argument to `mutate()`. Pinning `TArgs` to `void` here
 * makes `scan.mutate()` mean what it reads as.
 */
function useVoidLibraryMutation<TResult>(
  fn: () => Promise<TResult>,
): UseMutationResult<TResult, Error, void> {
  const client = useQueryClient()
  return useMutation<TResult, Error, void>({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.library })
    },
  })
}

export const useCreateTag = () => useLibraryMutation((name: string) => clientApi().createTag(name))

export const useDeleteTag = () => useLibraryMutation((id: number) => clientApi().deleteTag(id))

export const useRenameTag = () =>
  useLibraryMutation(({ id, name }: { id: number; name: string }) =>
    clientApi().renameTag(id, name),
  )

/**
 * Recolour a tag, applied optimistically — a swatch that waits a round trip
 * before the chips change feels like it did not take.
 */
export function useSetTagHue() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, hue }: { id: number; hue: number }) => clientApi().setTagHue(id, hue),
    onMutate: async ({ id, hue }) => {
      await client.cancelQueries({ queryKey: queryKeys.library })
      const previous = client.getQueryData<Library>(queryKeys.library)
      if (previous) {
        client.setQueryData<Library>(queryKeys.library, {
          ...previous,
          tags: previous.tags.map(tag => (tag.id === id ? { ...tag, hue } : tag)),
        })
      }
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) client.setQueryData(queryKeys.library, context.previous)
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.library })
    },
  })
}

export const useSetSongTags = () =>
  useLibraryMutation(({ songId, tagIds }: { songId: number; tagIds: number[] }) =>
    clientApi().setSongTags(songId, tagIds),
  )

export const useBulkTag = () =>
  useLibraryMutation((input: { songIds: number[]; tagId: number; action: 'add' | 'remove' }) =>
    clientApi().bulkTag(input),
  )

export const usePatchSong = () =>
  useLibraryMutation(({ id, patch }: { id: number; patch: Parameters<Api['patchSong']>[1] }) =>
    clientApi().patchSong(id, patch),
  )

export const useDeleteSong = () =>
  useLibraryMutation(({ id, deleteFile }: { id: number; deleteFile: boolean }) =>
    clientApi().deleteSong(id, deleteFile),
  )

/**
 * The multi-select delete.
 *
 * One request rather than one per song: the server removes the rows in a
 * single transaction and bumps the library version once, so the list settles
 * in one refetch instead of flickering N times.
 */
export const useBulkDeleteSongs = () =>
  useLibraryMutation((input: { songIds: number[]; deleteFile: boolean }) =>
    clientApi().bulkDeleteSongs(input),
  )

export const useBulkLoved = () =>
  useLibraryMutation((input: { songIds: number[]; loved: boolean }) => clientApi().bulkLoved(input))

export const useScanLibrary = () => useVoidLibraryMutation(() => clientApi().scan())

export const useCreatePlaylist = () =>
  useLibraryMutation((input: Parameters<Api['createPlaylist']>[0]) =>
    clientApi().createPlaylist(input),
  )

export const useUpdatePlaylist = () =>
  useLibraryMutation(({ id, patch }: { id: number; patch: Parameters<Api['updatePlaylist']>[1] }) =>
    clientApi().updatePlaylist(id, patch),
  )

export const useDeletePlaylist = () =>
  useLibraryMutation((id: number) => clientApi().deletePlaylist(id))

/**
 * Love / unlove, applied optimistically.
 *
 * A heart that waits for a round trip before filling in feels broken, so the
 * cache is updated immediately and rolled back if the request fails.
 */
export function useToggleLoved() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: ({ id, loved }: { id: number; loved: boolean }) => clientApi().setLoved(id, loved),

    onMutate: async ({ id, loved }) => {
      await client.cancelQueries({ queryKey: queryKeys.library })
      const previous = client.getQueryData<Library>(queryKeys.library)

      if (previous) {
        client.setQueryData<Library>(queryKeys.library, {
          ...previous,
          songs: previous.songs.map(song => (song.id === id ? { ...song, loved } : song)),
        })
      }

      return { previous }
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) client.setQueryData(queryKeys.library, context.previous)
    },

    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.library })
    },
  })
}

export function useUpdateSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: Parameters<Api['updateSettings']>[0]) => clientApi().updateSettings(patch),
    onSuccess: settings => {
      client.setQueryData(queryKeys.settings, settings)
    },
  })
}

export function useAddToPlaylist() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ playlistId, songIds }: { playlistId: number; songIds: number[] }) =>
      clientApi().addToPlaylist(playlistId, { songIds }),
    onSuccess: (_result, { playlistId }) => {
      void client.invalidateQueries({ queryKey: queryKeys.library })
      void client.invalidateQueries({ queryKey: queryKeys.playlistSongs(playlistId) })
    },
  })
}

export function useRemoveFromPlaylist() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ playlistId, songId }: { playlistId: number; songId: number }) =>
      clientApi().removeFromPlaylist(playlistId, songId),
    onSuccess: (_result, { playlistId }) => {
      void client.invalidateQueries({ queryKey: queryKeys.library })
      void client.invalidateQueries({ queryKey: queryKeys.playlistSongs(playlistId) })
    },
  })
}

/** Remove a whole selection from one manual playlist. Never touches the songs. */
export function useRemoveManyFromPlaylist() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ playlistId, songIds }: { playlistId: number; songIds: number[] }) =>
      clientApi().removeManyFromPlaylist(playlistId, songIds),
    onSuccess: (_result, { playlistId }) => {
      void client.invalidateQueries({ queryKey: queryKeys.library })
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

export function usePlaylistSongIds(playlistId: number | null) {
  const client = useQueryClient()
  return useQuery({
    queryKey: playlistId === null ? ['playlist', 'none'] : queryKeys.playlistSongs(playlistId),
    queryFn: async () => {
      if (playlistId === null) return { playlistId: 0, songIds: [] as number[] }
      return fetchPlaylistSongs(client, playlistId)
    },
    enabled: playlistId !== null,
    staleTime: 15_000,
  })
}

/** A playlist-migration match job, polled while it is still searching. */
export function useMigrateJob(id: string | null): UseQueryResult<MigrateMatchJob, Error> {
  return useQuery({
    queryKey: queryKeys.migrateJob(id ?? ''),
    queryFn: () => clientApi().migrateJob(id ?? ''),
    enabled: id !== null,
    refetchInterval: query => (query.state.data?.status === 'running' ? 1_000 : false),
  })
}
// --- metadata polish --------------------------------------------------------

/** Candidates for one song. Cached client-side too; the server caches for a day. */
export function useMetadataLookup(songId: number) {
  return useQuery({
    queryKey: queryKeys.metadataLookup(songId),
    queryFn: () => clientApi().lookupMetadata(songId),
    staleTime: 10 * 60_000,
    retry: false,
  })
}

export const useApplyMetadata = () =>
  useLibraryMutation(({ id, input }: { id: number; input: ApplyMetadata }) =>
    clientApi().applyMetadata(id, input),
  )

/** The cover-art pass, polled only while it runs (same idea as the import queue). */
export function useFixCoversStatus(): UseQueryResult<FixCoversStatus, Error> {
  return useQuery({
    queryKey: queryKeys.fixCovers,
    queryFn: () => clientApi().fixCoversStatus(),
    refetchInterval: query => (query.state.data?.status === 'running' ? 1_000 : false),
  })
}

export function useFixCovers() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (action: 'start' | 'cancel') =>
      action === 'start' ? clientApi().fixCoversStart() : clientApi().fixCoversCancel(),
    onSuccess: status => {
      client.setQueryData(queryKeys.fixCovers, status)
      void client.invalidateQueries({ queryKey: queryKeys.library })
    },
  })
}

/** Nearest neighbours of a song. Cheap on the server, so cached only briefly. */
export function useSimilar(songId: number | null, limit = 12): UseQueryResult<SimilarSongs, Error> {
  return useQuery({
    queryKey: songId === null ? ['similar', 'none'] : queryKeys.similar(songId),
    queryFn: () => clientApi().similar(songId ?? 0, limit),
    enabled: songId !== null,
    staleTime: 60_000,
  })
}

/**
 * Background analysis progress, polled only while it is running — and the
 * library is refetched once it stops, so the new BPM and key badges appear.
 */
export function useAnalysisStatus(enabled: boolean): UseQueryResult<AnalysisStatus, Error> {
  const client = useQueryClient()
  return useQuery({
    queryKey: queryKeys.analysis,
    queryFn: async () => {
      const status = await clientApi().analysisStatus()
      const previous = client.getQueryData<AnalysisStatus>(queryKeys.analysis)
      if (previous?.running && !status.running) {
        void client.invalidateQueries({ queryKey: queryKeys.library })
      }
      return status
    },
    enabled,
    refetchInterval: query => (query.state.data?.running ? 1_500 : false),
  })
}

export function useStartAnalysis() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (force: boolean) => clientApi().analyze(force),
    onSuccess: status => {
      client.setQueryData(queryKeys.analysis, status)
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
  return useQuery({
    queryKey: queryKeys.devices,
    queryFn: () => clientApi().devices(),
    staleTime: 10_000,
    refetchInterval: streamConnected ? false : 15_000,
    refetchIntervalInBackground: false,
    retry: false,
  })
}

/**
 * This Mac's connection to the cloud bucket. Polled quickly while a pass is
 * uploading, so the progress bar moves, and slowly otherwise, so a pass the
 * server starts by itself after an import still shows up.
 */
export function useCloudStatus(): UseQueryResult<CloudStatus, Error> {
  return useQuery({
    queryKey: queryKeys.cloud,
    queryFn: () => clientApi().cloudStatus(),
    // Quickly while something is moving — an upload, or Google finishing a
    // sign-in in another tab — and slowly otherwise.
    refetchInterval: query =>
      query.state.data?.state === 'syncing' || query.state.data?.signingIn ? 1_000 : 10_000,
    refetchIntervalInBackground: false,
  })
}

/**
 * Connect, sign in, publish now, or disconnect — each answers with the new
 * status, so the panel moves on without waiting for the next poll.
 */
export function useCloudActions() {
  const client = useQueryClient()
  const onSuccess = (status: CloudStatus): void => {
    client.setQueryData(queryKeys.cloud, status)
  }
  return {
    connect: useMutation({
      mutationFn: (input: CloudConnect) => clientApi().cloudConnect(input),
      onSuccess,
    }),
    sync: useMutation({ mutationFn: () => clientApi().cloudSync(), onSuccess }),
    disconnect: useMutation({ mutationFn: () => clientApi().cloudDisconnect(), onSuccess }),
    signIn: useMutation({
      mutationFn: (attempt: string) => clientApi().cloudSignIn(attempt),
      onSuccess,
    }),
    cancelSignIn: useMutation({ mutationFn: () => clientApi().cloudCancelSignIn(), onSuccess }),
    enterCode: useMutation({
      mutationFn: (code: string) => clientApi().cloudSignInCode(code),
      onSuccess,
    }),
    connectStorage: useMutation({
      mutationFn: (input: CloudConnect) => clientApi().cloudConnectStorage(input),
      onSuccess,
    }),
  }
}

/**
 * The web app's imports: links asked of the Mac through the bucket. Looked at
 * again every half minute while one is still waiting or downloading.
 */
export function useCloudImports(): UseQueryResult<ImportRequestList, Error> {
  return useQuery({
    queryKey: queryKeys.cloudImports,
    queryFn: () => clientApi().cloudImports(),
    refetchInterval: query =>
      query.state.data?.imports.some(item => item.state === 'waiting' || item.state === 'working')
        ? 30_000
        : false,
  })
}

export function useCloudImportActions() {
  const queryClient = useQueryClient()
  const onSuccess = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.cloudImports })
  }
  return {
    request: useMutation({
      mutationFn: (input: CloudImportRequest) => clientApi().requestCloudImport(input),
      onSuccess,
    }),
    cancel: useMutation({
      mutationFn: (uid: string) => clientApi().cancelCloudImport(uid),
      onSuccess,
    }),
  }
}

// --- the phone's own ---------------------------------------------------------
//
// Four hooks apps/mobile had and apps/web did not, because the web app reads
// the same facts out of the library response it already holds. They are here
// rather than left behind so that the universal app has one queries file, which
// is the point of the package.

/**
 * The manifest: what the server thinks should be downloaded, and at what size.
 *
 * The phone syncs against it; the web app's offline panel works from the
 * library instead, so this had no web caller until now.
 */
export function useManifest(): UseQueryResult<SyncManifest, Error> {
  const { ready } = useClientState()

  return useQuery({
    queryKey: queryKeys.manifest,
    enabled: ready,
    staleTime: 60_000,
    queryFn: (): Promise<SyncManifest> => clientApi().manifest(),
  })
}

/** A playlist's songs in playlist order, with everything about each one. */
export function usePlaylistSongs(playlistId: number | null): UseQueryResult<PlaylistSongs, Error> {
  const { ready } = useClientState()
  const client = useQueryClient()

  return useQuery({
    queryKey: queryKeys.playlistSongs(playlistId ?? 0),
    enabled: ready && playlistId !== null,
    staleTime: 30_000,
    queryFn: (): Promise<PlaylistSongs> => {
      if (playlistId === null) throw new Error('no playlist')
      return fetchPlaylistSongs(client, playlistId)
    },
  })
}

/** Lyrics for a song, which do not change unless someone edits them. */
export function useLyrics(songId: number | null): UseQueryResult<LyricsResponse, Error> {
  const { ready } = useClientState()
  const client = useQueryClient()

  return useQuery({
    queryKey: queryKeys.lyrics(songId ?? 0),
    enabled: ready && songId !== null,
    staleTime: 5 * 60_000,
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
        // Only when the server could not be asked: a 404 means the words are
        // gone, and a kept copy would be a stale answer to a fresh question.
        if (error instanceof ApiError && error.isOffline) {
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
 * The Mac's settings, for the few the phone has to agree about.
 *
 * How much of a song counts as a play is one of them: it is one number deciding
 * one thing, and the two clients disagreeing means the same listening is
 * counted differently depending on which one was in your hand.
 *
 * The web app's `useSettings` is the same query; this is the phone's name for
 * it, kept so its call sites did not have to move.
 */
export const useServerSettings = useSettings

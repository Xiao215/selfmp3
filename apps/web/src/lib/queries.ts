import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import type {
  Library,
  Settings,
  Stats,
  StatsRange,
  ImportQueue,
  ToolStatus,
  MigrateMatchJob,
} from '@selfmp3/shared'
import { api, ApiError } from './api.js'
import { saveLibrarySnapshot, loadLibrarySnapshot } from '../offline/mirror.js'

/**
 * Server state, handled by TanStack Query.
 *
 * The rule this file follows: a component never holds a copy of server data in
 * `useState`. It reads from a query and writes through a mutation, and the
 * cache invalidation lives here rather than being sprinkled across components.
 * That is what keeps two open tabs — or a phone and a laptop — consistent.
 */

export const queryKeys = {
  library: ['library'] as const,
  settings: ['settings'] as const,
  importQueue: ['import', 'queue'] as const,
  importTools: ['import', 'tools'] as const,
  migrateJob: (id: string) => ['migrate', id] as const,
  stats: (range: StatsRange) => ['stats', range] as const,
  history: ['stats', 'history'] as const,
  playlistSongs: (id: number) => ['playlist', id, 'songs'] as const,
  health: ['health'] as const,
}

/**
 * The library, with an offline fallback.
 *
 * When the request fails because the Mac is asleep, the last snapshot written
 * to IndexedDB is returned instead — so the app opens and plays cached music
 * rather than showing an error screen.
 */
export function useLibrary(): UseQueryResult<Library, Error> {
  return useQuery({
    queryKey: queryKeys.library,
    queryFn: async (): Promise<Library> => {
      try {
        const library = await api.library()
        // Fire-and-forget: a failed mirror write must not fail the query.
        void saveLibrarySnapshot(library)
        return library
      } catch (error) {
        if (error instanceof ApiError && error.isOffline) {
          const cached = await loadLibrarySnapshot()
          if (cached) return cached
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
    queryFn: () => api.settings(),
    staleTime: 5 * 60_000,
  })
}

export function useStats(range: StatsRange): UseQueryResult<Stats, Error> {
  return useQuery({
    queryKey: queryKeys.stats(range),
    queryFn: () => api.stats(range),
    staleTime: 60_000,
  })
}

export function useHistory() {
  return useQuery({
    queryKey: queryKeys.history,
    queryFn: () => api.history(200),
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
    queryFn: () => api.importQueue(),
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
    queryFn: () => api.importTools(),
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
 * `useLibraryMutation(() => api.scan())` cannot infer `TArgs` from a
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

export const useCreateTag = () => useLibraryMutation((name: string) => api.createTag(name))

export const useDeleteTag = () => useLibraryMutation((id: number) => api.deleteTag(id))

export const useRenameTag = () =>
  useLibraryMutation(({ id, name }: { id: number; name: string }) => api.renameTag(id, name))

export const useSetSongTags = () =>
  useLibraryMutation(({ songId, tagIds }: { songId: number; tagIds: number[] }) =>
    api.setSongTags(songId, tagIds),
  )

export const useBulkTag = () =>
  useLibraryMutation((input: { songIds: number[]; tagId: number; action: 'add' | 'remove' }) =>
    api.bulkTag(input),
  )

export const usePatchSong = () =>
  useLibraryMutation(({ id, patch }: { id: number; patch: Parameters<typeof api.patchSong>[1] }) =>
    api.patchSong(id, patch),
  )

export const useDeleteSong = () =>
  useLibraryMutation(({ id, deleteFile }: { id: number; deleteFile: boolean }) =>
    api.deleteSong(id, deleteFile),
  )

export const useScanLibrary = () => useVoidLibraryMutation(() => api.scan())

export const useCreatePlaylist = () =>
  useLibraryMutation((input: Parameters<typeof api.createPlaylist>[0]) => api.createPlaylist(input))

export const useUpdatePlaylist = () =>
  useLibraryMutation(
    ({ id, patch }: { id: number; patch: Parameters<typeof api.updatePlaylist>[1] }) =>
      api.updatePlaylist(id, patch),
  )

export const useDeletePlaylist = () => useLibraryMutation((id: number) => api.deletePlaylist(id))

/**
 * Love / unlove, applied optimistically.
 *
 * A heart that waits for a round trip before filling in feels broken, so the
 * cache is updated immediately and rolled back if the request fails.
 */
export function useToggleLoved() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: ({ id, loved }: { id: number; loved: boolean }) => api.setLoved(id, loved),

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
    mutationFn: (patch: Parameters<typeof api.updateSettings>[0]) => api.updateSettings(patch),
    onSuccess: settings => {
      client.setQueryData(queryKeys.settings, settings)
    },
  })
}

export function useAddToPlaylist() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ playlistId, songIds }: { playlistId: number; songIds: number[] }) =>
      api.addToPlaylist(playlistId, { songIds }),
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
      api.removeFromPlaylist(playlistId, songId),
    onSuccess: (_result, { playlistId }) => {
      void client.invalidateQueries({ queryKey: queryKeys.library })
      void client.invalidateQueries({ queryKey: queryKeys.playlistSongs(playlistId) })
    },
  })
}

export function usePlaylistSongIds(playlistId: number | null) {
  return useQuery({
    queryKey: playlistId === null ? ['playlist', 'none'] : queryKeys.playlistSongs(playlistId),
    queryFn: async () => {
      if (playlistId === null) return { playlistId: 0, songIds: [] as number[] }
      return api.playlistSongs(playlistId)
    },
    enabled: playlistId !== null,
    staleTime: 15_000,
  })
}

/** A playlist-migration match job, polled while it is still searching. */
export function useMigrateJob(id: string | null): UseQueryResult<MigrateMatchJob, Error> {
  return useQuery({
    queryKey: queryKeys.migrateJob(id ?? ''),
    queryFn: () => api.migrateJob(id ?? ''),
    enabled: id !== null,
    refetchInterval: query => (query.state.data?.status === 'running' ? 1_000 : false),
  })
}

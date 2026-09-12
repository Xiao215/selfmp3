import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import type {
  Library,
  LyricsResponse,
  PlaylistSongs,
  Settings,
  Song,
  SyncManifest,
} from '@selfmp3/shared'
import { api } from './client'
import { readCachedLibrary, writeCachedLibrary } from '../offline/libraryCache'
import { useConnection } from '../server/ConnectionProvider'

/**
 * Query hooks, in the same spirit as the web app's `lib/queries.ts`.
 *
 * The library query is the interesting one: it falls back to the on-disk copy
 * when the server cannot be reached, so opening the app on a plane shows the
 * whole library rather than a spinner and an error.
 */

export const queryKeys = {
  library: (baseUrl: string) => ['library', baseUrl] as const,
  manifest: (baseUrl: string) => ['manifest', baseUrl] as const,
  playlistSongs: (baseUrl: string, id: number) => ['playlist-songs', baseUrl, id] as const,
  lyrics: (baseUrl: string, id: number) => ['lyrics', baseUrl, id] as const,
  settings: (baseUrl: string) => ['settings', baseUrl] as const,
}

/**
 * The Mac's settings, for the few the phone has to agree about.
 *
 * How much of a song counts as a play is one of them: it is one number
 * deciding one thing, and the two clients disagreeing means the same listening
 * is counted differently depending on which one was in your hand.
 */
export function useServerSettings(): UseQueryResult<Settings> {
  const { connection } = useConnection()

  return useQuery({
    queryKey: queryKeys.settings(connection?.baseUrl ?? ''),
    enabled: connection !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<Settings> => {
      if (!connection) throw new Error('no server configured')
      return api.settings()
    },
  })
}

export function useLibrary(): UseQueryResult<Library> {
  const { connection, status } = useConnection()

  return useQuery({
    queryKey: queryKeys.library(connection?.baseUrl ?? 'cloud'),
    enabled: status === 'ready',
    // The library changes when the Mac imports something, not by the second.
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<Library> => {
      try {
        const library = await api.library()
        writeCachedLibrary(library)
        return library
      } catch (error) {
        const cached = await readCachedLibrary()
        if (cached) return cached
        throw error
      }
    },
  })
}

export function useManifest(): UseQueryResult<SyncManifest> {
  const { connection, status } = useConnection()

  return useQuery({
    queryKey: queryKeys.manifest(connection?.baseUrl ?? 'cloud'),
    enabled: status === 'ready',
    staleTime: 60_000,
    queryFn: async (): Promise<SyncManifest> => {
      return api.manifest()
    },
  })
}

export function usePlaylistSongs(playlistId: number | null): UseQueryResult<PlaylistSongs> {
  const { connection, status } = useConnection()

  return useQuery({
    queryKey: queryKeys.playlistSongs(connection?.baseUrl ?? 'cloud', playlistId ?? 0),
    enabled: status === 'ready' && playlistId !== null,
    staleTime: 30_000,
    queryFn: async (): Promise<PlaylistSongs> => {
      if (playlistId === null) throw new Error('no playlist')
      return api.playlistSongs(playlistId)
    },
  })
}

export function useLyrics(songId: number | null): UseQueryResult<LyricsResponse> {
  const { connection, status } = useConnection()

  return useQuery({
    queryKey: queryKeys.lyrics(connection?.baseUrl ?? 'cloud', songId ?? 0),
    enabled: status === 'ready' && songId !== null,
    // Lyrics for a given song do not change unless someone edits them.
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<LyricsResponse> => {
      if (songId === null) throw new Error('no song')
      return api.lyrics(songId)
    },
  })
}

/**
 * Love a song, or stop: the web's `useToggleLoved`.
 *
 * The heart fills the moment it is tapped and the library on disk is patched
 * to match, so the row, the mini player and the song's own page all agree
 * without waiting on a Mac that may be asleep. If the server refuses, the
 * copy is rolled back to what it was.
 */
export function useToggleLoved(): UseMutationResult<
  Song,
  Error,
  { id: number; loved: boolean },
  { previous: Library | undefined }
> {
  const { connection } = useConnection()
  const queryClient = useQueryClient()
  const key = queryKeys.library(connection?.baseUrl ?? 'cloud')

  return useMutation({
    mutationFn: ({ id, loved }) => api.setLoved(id, loved),
    onMutate: async ({ id, loved }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Library>(key)
      if (previous) {
        const next = {
          ...previous,
          songs: previous.songs.map(song => (song.id === id ? { ...song, loved } : song)),
        }
        queryClient.setQueryData<Library>(key, next)
        writeCachedLibrary(next)
      }
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData<Library>(key, context.previous)
    },
  })
}

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { Library, LyricsResponse, PlaylistSongs, SyncManifest } from '@selfmp3/shared'
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
}

export function useLibrary(): UseQueryResult<Library> {
  const { connection } = useConnection()

  return useQuery({
    queryKey: queryKeys.library(connection?.baseUrl ?? ''),
    enabled: connection !== null,
    // The library changes when the Mac imports something, not by the second.
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<Library> => {
      if (!connection) throw new Error('no server configured')
      try {
        const library = await api.library(connection)
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
  const { connection } = useConnection()

  return useQuery({
    queryKey: queryKeys.manifest(connection?.baseUrl ?? ''),
    enabled: connection !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<SyncManifest> => {
      if (!connection) throw new Error('no server configured')
      return api.manifest(connection)
    },
  })
}

export function usePlaylistSongs(playlistId: number | null): UseQueryResult<PlaylistSongs> {
  const { connection } = useConnection()

  return useQuery({
    queryKey: queryKeys.playlistSongs(connection?.baseUrl ?? '', playlistId ?? 0),
    enabled: connection !== null && playlistId !== null,
    staleTime: 30_000,
    queryFn: async (): Promise<PlaylistSongs> => {
      if (!connection || playlistId === null) throw new Error('no playlist')
      return api.playlistSongs(connection, playlistId)
    },
  })
}

export function useLyrics(songId: number | null): UseQueryResult<LyricsResponse> {
  const { connection } = useConnection()

  return useQuery({
    queryKey: queryKeys.lyrics(connection?.baseUrl ?? '', songId ?? 0),
    enabled: connection !== null && songId !== null,
    // Lyrics for a given song do not change unless someone edits them.
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<LyricsResponse> => {
      if (!connection || songId === null) throw new Error('no song')
      return api.lyrics(connection, songId)
    },
  })
}

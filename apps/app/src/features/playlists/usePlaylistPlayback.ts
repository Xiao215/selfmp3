import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Library } from '@selfmp3/shared'
import { clientApi, queryKeys } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'

interface PlaylistPlayback {
  /** From the top, in order: the playlist's Play. */
  play: (playlistId: number, songIds: readonly number[]) => void
  /** From a row, keeping whatever shuffle mode is on. */
  playFrom: (playlistId: number, songIds: readonly number[], index: number) => void
  shuffle: (playlistId: number, songIds: readonly number[]) => void
  /** For a tile or the sidebar, which have not loaded the songs: ask, then play. */
  playById: (playlistId: number, how?: 'play' | 'shuffle') => void
}

/**
 * Starting a playlist, and noting that it was started.
 *
 * The note is what the playlists page's "Recently played" order reads. This
 * device's copy of the library changes at once, so the page is in the new
 * order when you go back to it; the server is told on the side, and a server
 * that does not keep it (a cloud library) is simply not asked twice.
 */
export function usePlaylistPlayback(): PlaylistPlayback {
  const player = usePlayer()
  const client = useQueryClient()

  const markPlayed = useCallback(
    (playlistId: number): void => {
      const now = new Date().toISOString()
      client.setQueryData<Library>(queryKeys.library, library =>
        library
          ? {
              ...library,
              playlists: library.playlists.map(playlist =>
                playlist.id === playlistId ? { ...playlist, lastPlayedAt: now } : playlist,
              ),
            }
          : library,
      )
      void clientApi()
        .markPlaylistPlayed(playlistId)
        .catch(() => undefined)
    },
    [client],
  )

  const play = useCallback(
    (playlistId: number, songIds: readonly number[]): void => {
      if (songIds.length === 0) return
      player.playFrom(songIds, 0, false)
      markPlayed(playlistId)
    },
    [player, markPlayed],
  )

  const playFrom = useCallback(
    (playlistId: number, songIds: readonly number[], index: number): void => {
      if (songIds.length === 0) return
      player.playFrom(songIds, index)
      markPlayed(playlistId)
    },
    [player, markPlayed],
  )

  const shuffle = useCallback(
    (playlistId: number, songIds: readonly number[]): void => {
      if (songIds.length === 0) return
      player.playShuffled(songIds)
      markPlayed(playlistId)
    },
    [player, markPlayed],
  )

  const playById = useCallback(
    (playlistId: number, how: 'play' | 'shuffle' = 'play'): void => {
      // The list may already be cached from its page or its cover.
      const cached = client.getQueryData<{ songIds: number[] }>(queryKeys.playlistSongs(playlistId))
      const run = (songIds: readonly number[]): void =>
        how === 'shuffle' ? shuffle(playlistId, songIds) : play(playlistId, songIds)
      if (cached) {
        run(cached.songIds)
        return
      }
      void clientApi()
        .playlistSongs(playlistId)
        .then(({ songIds }) => run(songIds))
        .catch(() => undefined)
    },
    [client, play, shuffle],
  )

  return useMemo(() => ({ play, playFrom, shuffle, playById }), [play, playFrom, shuffle, playById])
}

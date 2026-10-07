import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Library } from '@selfmp3/shared'
import { clientApi, queryKeys } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import type { ListSource } from '../lists/lists.model'

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
  /*
   * The player, read when a playlist starts rather than closed over. The
   * player's object is new on every play and pause, and these callbacks are
   * what the playlists grid hands every memoised tile: closed over, a pause
   * redrew every tile and the four covers in each.
   */
  const playerRef = useRef(player)
  useEffect(() => {
    playerRef.current = player
  }, [player])

  // Up next wears the playlist's name: read from this device's library, where
  // every playlist already is.
  const sourceFor = useCallback(
    (playlistId: number): ListSource | null => {
      const playlist = client
        .getQueryData<Library>(queryKeys.library)
        ?.playlists.find(each => each.id === playlistId)
      return playlist ? { kind: 'playlist', playlistId, name: playlist.name } : null
    },
    [client],
  )

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
      playerRef.current.playFrom(songIds, 0, { shuffle: false, source: sourceFor(playlistId) })
      markPlayed(playlistId)
    },
    [markPlayed, sourceFor],
  )

  const playFrom = useCallback(
    (playlistId: number, songIds: readonly number[], index: number): void => {
      if (songIds.length === 0) return
      playerRef.current.playFrom(songIds, index, { source: sourceFor(playlistId) })
      markPlayed(playlistId)
    },
    [markPlayed, sourceFor],
  )

  const shuffle = useCallback(
    (playlistId: number, songIds: readonly number[]): void => {
      if (songIds.length === 0) return
      playerRef.current.playShuffled(songIds, sourceFor(playlistId))
      markPlayed(playlistId)
    },
    [markPlayed, sourceFor],
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

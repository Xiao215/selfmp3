import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { AppState } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import type { Song } from '@selfmp3/shared'
import { queryKeys, secondsToCount } from '@selfmp3/client'

import { flushListens, recordListen } from '../offline/listenOutbox'

/**
 * Counting a play, and sending the ones this device kept.
 *
 * A play is counted from how much of the song was actually heard, written down
 * on this device first, and sent when the server can be reached — so a song
 * played on a plane still counts. The tracking itself lives in the provider's
 * ref, because the engine's own callbacks write to it as the song runs; this
 * hook owns what to do with it when the song stops.
 *
 * Lifted out of `PlayerProvider`, whose seams were banner comments.
 */
interface PlayTracking {
  songId: number | null
  listenedSeconds: number
  counted: boolean
}

interface PlayReporting {
  /**
   * What has been heard of the song playing. The engine's own callbacks write
   * to it as the song runs — a new song, a second gone by, a seek — which is
   * why it is a ref and why it is handed out rather than passed in: the hook
   * owns counting a play, so it owns what a play is counted from.
   */
  readonly tracking: RefObject<PlayTracking>
  /** Count what was heard, if enough of it was. `completed` is a song that ran out. */
  readonly flushPlay: (completed: boolean) => void
}

export function usePlayReporting({
  songs,
  keepPlayed,
  connection,
}: {
  /** The library, for the song's length: how much counts as a play. */
  readonly songs: RefObject<Map<number, Song>>
  /** A song listened to is one worth keeping here, where songs stream. */
  readonly keepPlayed: (songId: number) => void
  /** Only to send again when the server this device talks to changes. */
  readonly connection: unknown
}): PlayReporting {
  const queryClient = useQueryClient()
  const tracking = useRef<PlayTracking>({ songId: null, listenedSeconds: 0, counted: false })

  const flushPlay = useCallback(
    (completed: boolean) => {
      const held = tracking.current
      const songId = held.songId
      if (songId === null || held.counted) return

      const song = songs.current.get(songId)
      const needed = secondsToCount(song?.duration ?? 0)
      if (!completed && held.listenedSeconds < needed) return

      held.counted = true
      // Kept on the phone first: with the server asleep it goes when the server wakes.
      recordListen(songId, Math.round(held.listenedSeconds * 1000), completed)
      keepPlayed(songId)
    },
    [keepPlayed, songs, tracking],
  )

  useEffect(() => {
    const flush = (): void => {
      void flushListens().then(sent => {
        // Only what a play changes. Invalidating everything refetched every
        // query on the page — lyrics, playlists, settings — for a play count.
        if (sent > 0) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.library })
          // Stats are the other thing a counted play changes.
          void queryClient.invalidateQueries({ queryKey: queryKeys.statsRoot })
        }
      })
    }
    flush()
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') flush()
    })
    return () => subscription.remove()
  }, [connection, queryClient])

  return useMemo(() => ({ tracking, flushPlay }), [flushPlay])
}

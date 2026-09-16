import { useEffect, useRef } from 'react'

import type { PlayerApi } from './PlayerProvider'
import { positionJumped, type ProgressStore, type ReportedPosition } from './progress.model'
import { mediaSession } from '../ports/mediaSession'

/** What the seek buttons on a keyboard or a headset move by, in seconds. */
const SEEK_STEP = 10

/**
 * Tell the operating system what is playing.
 *
 * Nothing on a phone: the native engine fills iOS's now-playing card from the
 * metadata the player already hands it, and two writers would fight over one
 * card. On the web this is `navigator.mediaSession`, which is the media keys,
 * the Now Playing card in Control Center, and — through the shell — the Dock
 * menu and the power-save blocker.
 *
 * The actions are set once and read through a ref. They are functions the
 * player rebuilds when its queue changes, and handing Chromium a new set of
 * handlers several times a song made the card flicker its buttons.
 */
export function useNowPlaying(
  player: PlayerApi,
  progress: ProgressStore,
  artwork: string | null,
): void {
  const latest = useRef(player)
  useEffect(() => {
    latest.current = player
  })

  useEffect(() => {
    if (!mediaSession.available) return
    mediaSession.setActions({
      play: () => {
        if (!latest.current.isPlaying) latest.current.toggle()
      },
      pause: () => {
        if (latest.current.isPlaying) latest.current.toggle()
      },
      next: () => latest.current.next(),
      previous: () => latest.current.previous(),
      seekTo: seconds => latest.current.seekTo(seconds),
      seekBy: delta => latest.current.seekBy(delta || SEEK_STEP),
    })
    return () => mediaSession.setActions(null)
  }, [])

  const { current, isPlaying, rate } = player

  useEffect(() => {
    mediaSession.setNowPlaying(
      current === null
        ? null
        : {
            title: current.title,
            artist: current.artist,
            album: current.album,
            artwork,
            duration: current.duration,
          },
    )
  }, [current, artwork])

  useEffect(() => {
    mediaSession.setPlaying(isPlaying)
  }, [isPlaying])

  /*
   * The position, only when the card's own clock would be wrong.
   *
   * Chromium runs the card's clock from the last position and rate it was
   * given, so a tick that agrees with that clock tells it nothing — and every
   * tick is a validation and, in the installed app, a round trip through the
   * OS. Told instead when play, pause, the rate or the song change (this
   * effect running again), when the length becomes known, and when the
   * position jumps further than the time that passed explains — a seek, a loop
   * going back to A.
   */
  const songId = current?.id ?? null
  const songDuration = current?.duration ?? 0
  useEffect(() => {
    if (!mediaSession.available) return undefined
    let last: ReportedPosition | null = null
    let lastDuration = -1
    const report = (): void => {
      const { position, duration } = progress.get()
      lastDuration = duration
      mediaSession.setPosition(position, duration > 0 ? duration : songDuration, rate)
      last = { position, at: Date.now(), playing: isPlaying, rate }
    }
    report()
    return progress.subscribe(() => {
      const { position, duration } = progress.get()
      if (
        last === null ||
        duration !== lastDuration ||
        positionJumped(last, position, Date.now())
      ) {
        report()
      }
    })
  }, [progress, isPlaying, rate, songId, songDuration])
}

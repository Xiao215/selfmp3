import { useEffect, useRef } from 'react'

import type { PlayerApi, PlayerProgress } from './PlayerProvider'
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
  progress: PlayerProgress,
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
  const { position, duration } = progress

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

  useEffect(() => {
    mediaSession.setPosition(position, duration, rate)
  }, [position, duration, rate])
}

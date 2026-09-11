import { useEffect, useRef } from 'react'
import { usePlayer } from '../../player/PlayerProvider.js'
import { useTransport } from '../../devices/useTransport.js'

/**
 * The song position, readable once per animation frame.
 *
 * Playing here, it comes straight off the audio element. Controlling another
 * device, only its reported position is known, a few times a second — so the
 * gaps are filled by running the clock forward from the last report, which is
 * what keeps a lyric filling smoothly instead of in steps.
 */
export function useSongClock(): { read: () => number; playing: boolean } {
  const player = usePlayer()
  const transport = useTransport()
  const remote = transport.remote !== null
  const report = useRef({
    time: transport.currentTime,
    at: performance.now(),
    playing: transport.playing,
  })

  useEffect(() => {
    report.current = {
      time: transport.currentTime,
      at: performance.now(),
      playing: transport.playing,
    }
  }, [transport.currentTime, transport.playing])

  const read = remote
    ? (): number => {
        const { time, at, playing } = report.current
        return playing ? time + (performance.now() - at) / 1000 : time
      }
    : player.playhead

  return { read, playing: transport.playing }
}

/** Reduce Motion, followed live. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

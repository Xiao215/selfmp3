import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { PlaybackEngine } from '@selfmp3/client'

/**
 * Stopping the music after a while, or at the end of the song playing.
 *
 * A clock's worth is a timer here; "end of this song" is a flag the engine
 * wiring reads when a song ends, which is why `atSongEnd` leaves as a ref as
 * well as a value. The ref is the one thing that crosses back: the wiring runs
 * inside the engine's own callback, where a value captured at render would be
 * the one from whenever that callback was made.
 *
 * Lifted out of `PlayerProvider`, which held it among a dozen other concerns.
 */
export interface SleepTimer {
  /** When playback stops, or null when nothing is set. */
  readonly endsAt: number | null
  /** Whether it waits for the song playing to end rather than a clock. */
  readonly atSongEnd: boolean
  /** The same flag for the engine's own callbacks, and cleared by them. */
  readonly atSongEndRef: MutableRefObject<boolean>
  readonly set: (choice: number | 'song-end' | null) => void
  /** Used up by a song ending: the wiring says so, and the value follows. */
  readonly songEnded: () => void
}

export function useSleepTimer(engine: PlaybackEngine): SleepTimer {
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [atSongEnd, setAtSongEnd] = useState(false)
  const atSongEndRef = useRef(false)

  const set = useCallback((choice: number | 'song-end' | null) => {
    const songEnd = choice === 'song-end'
    atSongEndRef.current = songEnd
    setAtSongEnd(songEnd)
    setEndsAt(typeof choice === 'number' ? Date.now() + choice * 60_000 : null)
  }, [])

  const songEnded = useCallback(() => {
    atSongEndRef.current = false
    setAtSongEnd(false)
  }, [])

  useEffect(() => {
    if (endsAt === null) return undefined
    let fade: ReturnType<typeof setInterval> | undefined
    const timer = setInterval(() => {
      if (Date.now() < endsAt) return
      clearInterval(timer)
      // Fade out over four seconds rather than cutting off, which is much
      // gentler if you are actually falling asleep to it.
      const startVolume = engine.state.volume
      const steps = 40
      let step = 0
      fade = setInterval(() => {
        step++
        engine.setVolume(startVolume * (1 - step / steps))
        if (step >= steps) {
          clearInterval(fade)
          engine.pause()
          engine.setVolume(startVolume)
        }
      }, 100)
    }, 1_000)
    return () => {
      clearInterval(timer)
      if (fade !== undefined) clearInterval(fade)
    }
  }, [endsAt, engine])

  /*
   * Held, for the reason `usePracticeControls` gives: `PlayerApi` is built
   * from this, so a new object render would be a new api and every screen
   * reading the player would redraw with it.
   */
  return useMemo(
    () => ({ endsAt, atSongEnd, atSongEndRef, set, songEnded }),
    [endsAt, atSongEnd, set, songEnded],
  )
}

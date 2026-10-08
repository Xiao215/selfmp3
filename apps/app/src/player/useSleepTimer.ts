import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
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
interface SleepTimer {
  /** When playback stops, or null when nothing is set. */
  readonly endsAt: number | null
  /** Whether it waits for the song playing to end rather than a clock. */
  readonly atSongEnd: boolean
  /** The same flag for the engine's own callbacks, and cleared by them. */
  readonly atSongEndRef: RefObject<boolean>
  readonly set: (choice: number | 'song-end' | null) => void
  /** Used up by a song ending: the wiring says so, and the value follows. */
  readonly songEnded: () => void
}

/** How long the music takes to fade out when the timer runs out. */
const FADE_MS = 4_000
/** How many steps down it fades in. */
const FADE_STEPS = 40
/** The longest one wait for the timer runs before it looks at the clock again. */
const LONGEST_WAIT_MS = 60_000

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
    let wait: ReturnType<typeof setTimeout> | undefined
    let fade: ReturnType<typeof setInterval> | undefined
    // Woken when the time is up rather than every second to ask whether it is:
    // a minute at most at a time, so a long wait never rests on one timer the
    // platform may have let drift, and the stop lands within a beat of when it
    // was set for.
    const sleepWhenDue = (): void => {
      const left = endsAt - Date.now()
      if (left > 0) {
        wait = setTimeout(sleepWhenDue, Math.min(left, LONGEST_WAIT_MS))
        return
      }
      // Fade out rather than cutting off, which is much gentler if you are
      // actually falling asleep to it.
      const startVolume = engine.state.volume
      let step = 0
      fade = setInterval(() => {
        step++
        engine.setVolume(startVolume * (1 - step / FADE_STEPS))
        if (step >= FADE_STEPS) {
          clearInterval(fade)
          engine.pause()
          engine.setVolume(startVolume)
        }
      }, FADE_MS / FADE_STEPS)
    }
    sleepWhenDue()
    return () => {
      if (wait !== undefined) clearTimeout(wait)
      if (fade !== undefined) clearInterval(fade)
    }
  }, [endsAt, engine])

  /*
   * Held, for the reason `useVolumeControls` gives: `PlayerApi` is built
   * from this, so a new object render would be a new api and every screen
   * reading the player would redraw with it.
   */
  return useMemo(
    () => ({ endsAt, atSongEnd, atSongEndRef, set, songEnded }),
    [endsAt, atSongEnd, set, songEnded],
  )
}

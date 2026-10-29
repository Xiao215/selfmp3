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
/** Closer than this to the level the fade last set, the level is the fade's still. */
const LEVEL_TOLERANCE = 0.001
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
    /** The fade under way, the level it started from, and the last it set. */
    let fade:
      | { readonly timer: ReturnType<typeof setInterval>; readonly from: number; set: number }
      | undefined
    /**
     * Someone moved the level since the fade last set it: theirs wins. Put
     * back where the fade began, the bar drew full while the level saved was
     * theirs, and the next launch opened at it.
     */
    const touched = (): boolean =>
      fade !== undefined && Math.abs(engine.state.volume - fade.set) > LEVEL_TOLERANCE
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
      // Muted, there is nothing to fade — and moving the level unmutes.
      if (engine.state.muted) {
        engine.pause()
        setEndsAt(null)
        return
      }
      // Fade out rather than cutting off, which is much gentler if you are
      // actually falling asleep to it.
      const from = engine.state.volume
      let step = 0
      const timer = setInterval(() => {
        // The level moved by hand mid-fade: the timer is called off, and the
        // music plays on at the level chosen.
        if (touched()) {
          clearInterval(timer)
          fade = undefined
          setEndsAt(null)
          return
        }
        step++
        const level = from * (1 - step / FADE_STEPS)
        engine.setVolume(level)
        if (fade) fade.set = engine.state.volume
        if (step < FADE_STEPS) return
        clearInterval(timer)
        fade = undefined
        engine.pause()
        engine.setVolume(from)
        // Used up: nothing is set any more, and the bar stops counting down.
        setEndsAt(null)
      }, FADE_MS / FADE_STEPS)
      fade = { timer, from, set: from }
    }
    sleepWhenDue()
    return () => {
      if (wait !== undefined) clearTimeout(wait)
      if (fade === undefined) return
      // Called off part-way through the fade: the level goes back to where it
      // was, rather than staying wherever the fade had got to.
      clearInterval(fade.timer)
      if (!touched()) engine.setVolume(fade.from)
    }
  }, [endsAt, engine])

  /*
   * Held, for the reason `useVolumeControls` gives: `PlayerApi` is built
   * from this, so a new object each render would be a new api and every screen
   * reading the player would redraw with it.
   */
  return useMemo(
    () => ({ endsAt, atSongEnd, atSongEndRef, set, songEnded }),
    [endsAt, atSongEnd, set, songEnded],
  )
}

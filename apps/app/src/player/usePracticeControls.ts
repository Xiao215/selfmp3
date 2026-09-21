import { useCallback, useEffect, useMemo, useState } from 'react'
import { tapLoop, type PlaybackEngine } from '@selfmp3/client'

import { prefs } from '../ports/prefs'

/**
 * Practice, and the two sound settings that are kept the same way.
 *
 * Everything here is a line or two over the engine, plus the preference this
 * device remembers it by. It came out of `PlayerProvider`, which was one
 * eight-hundred-line function with its seams written in as banner comments;
 * this is the first of them, and the one with no ties to the rest — the engine
 * and `prefs` are all it touches.
 */

const VOLUME_KEY = 'volume'
const PITCH_LOCK_KEY = 'pitchlock'
const COUNT_IN_KEY = 'countin'

interface PracticeControls {
  readonly countIn: boolean
  readonly setVolume: (volume: number) => void
  readonly toggleMute: () => void
  readonly setRate: (rate: number) => void
  readonly tapLoopPoint: (which: 'A' | 'B') => void
  readonly clearLoop: () => void
  readonly setPreservesPitch: (on: boolean) => void
  readonly setCountIn: (on: boolean) => void
}

export function usePracticeControls(engine: PlaybackEngine): PracticeControls {
  const [countIn, setCountInState] = useState(() => prefs.get(COUNT_IN_KEY) === '1')

  const setVolume = useCallback(
    (volume: number) => {
      engine.setVolume(volume)
      prefs.set(VOLUME_KEY, String(volume))
    },
    [engine],
  )
  const toggleMute = useCallback(() => engine.setMuted(!engine.state.muted), [engine])
  const setRate = useCallback((rate: number) => engine.setRate(rate), [engine])

  const tapLoopPoint = useCallback(
    (which: 'A' | 'B') => {
      const { a, b } = tapLoop(which, engine.state.currentTime, {
        a: engine.state.loopA,
        b: engine.state.loopB,
      })
      engine.setLoop(a, b)
    },
    [engine],
  )
  const clearLoop = useCallback(() => engine.clearLoop(), [engine])
  const setPreservesPitch = useCallback(
    (on: boolean) => {
      engine.setPreservesPitch(on)
      prefs.set(PITCH_LOCK_KEY, on ? '1' : '0')
    },
    [engine],
  )
  const setCountIn = useCallback((on: boolean) => {
    setCountInState(on)
    prefs.set(COUNT_IN_KEY, on ? '1' : '0')
  }, [])

  // Pitch lock is on unless this device was told otherwise.
  useEffect(() => {
    if (prefs.get(PITCH_LOCK_KEY) === '0') engine.setPreservesPitch(false)
  }, [engine])

  /*
   * The saved volume, once. An unguarded `Number(null)` is 0, which would
   * start every fresh install silent with no hint why.
   */
  useEffect(() => {
    const raw = prefs.get(VOLUME_KEY)
    if (raw === null) return
    const stored = Number(raw)
    if (Number.isFinite(stored) && stored >= 0 && stored <= 1) engine.setVolume(stored)
  }, [engine])

  /*
   * Held: `PlayerApi` spreads this, so a new object here would be a new api on
   * every render of the provider — and every screen that reads the player
   * would redraw with it. A perf test says so out loud
   * (`LibraryScreen.perf.test.tsx`, "nothing else").
   */
  return useMemo(
    () => ({
      countIn,
      setVolume,
      toggleMute,
      setRate,
      tapLoopPoint,
      clearLoop,
      setPreservesPitch,
      setCountIn,
    }),
    [
      countIn,
      setVolume,
      toggleMute,
      setRate,
      tapLoopPoint,
      clearLoop,
      setPreservesPitch,
      setCountIn,
    ],
  )
}

import { useCallback, useEffect, useMemo } from 'react'
import { clamp01 } from '@selfmp3/shared'
import type { PlaybackEngine } from '@selfmp3/client'

import { prefs } from '../ports/prefs'

/**
 * The level and mute, and the preference this device remembers the level by.
 *
 * A line or two each over the engine. It came out of `PlayerProvider`, which
 * was one eight-hundred-line function with its seams written in as banner
 * comments; this is the one with no ties to the rest — the engine and `prefs`
 * are all it touches.
 */

const VOLUME_KEY = 'volume'

interface VolumeControls {
  readonly setVolume: (volume: number) => void
  /** Up or down from where the level is now, for a key or a menu item. */
  readonly stepVolume: (delta: number) => void
  readonly toggleMute: () => void
}

export function useVolumeControls(engine: PlaybackEngine): VolumeControls {
  const setVolume = useCallback(
    (volume: number) => {
      engine.setVolume(volume)
      prefs.set(VOLUME_KEY, String(volume))
    },
    [engine],
  )
  const stepVolume = useCallback(
    (delta: number) => setVolume(clamp01(engine.state.volume + delta)),
    [engine, setVolume],
  )
  const toggleMute = useCallback(() => engine.setMuted(!engine.state.muted), [engine])

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
   * Held: `PlayerApi` spreads these, so a new object here would be a new api
   * on every render of the provider — and every screen that reads the player
   * would redraw with it. A perf test says so out loud
   * (`LibraryScreen.perf.test.tsx`, "nothing else").
   */
  return useMemo(() => ({ setVolume, stepVolume, toggleMute }), [setVolume, stepVolume, toggleMute])
}

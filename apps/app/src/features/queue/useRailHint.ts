import { useCallback, useEffect, useState } from 'react'
import { prefs } from '../../ports/prefs'

/** Kept on this device once the hint has been shown: it is shown once, ever. */
const HINT_KEY = 'up-next-rail-hint'

/** How long the hint stays when nothing is done to dismiss it. */
const HINT_MS = 6000

/**
 * Up next's rail removes a song by dragging it out (chosen over a hover ✕,
 * Xiao 2026-09-18), which nothing on screen says. So the first time the rail
 * is open with a song after the playing one, a small hint says it once: until
 * anything is done in the rail, or for a few seconds, and never again on this
 * device. Remembered the moment it shows, so closing the rail or the app
 * while it is up still counts.
 */
export function useRailHint(ready: boolean): { shown: boolean; dismiss: () => void } {
  const [phase, setPhase] = useState<'waiting' | 'showing' | 'done'>(() =>
    prefs.get(HINT_KEY) === null ? 'waiting' : 'done',
  )
  // Adjusted during render, so the hint arrives with the rows it is about.
  if (ready && phase === 'waiting') setPhase('showing')

  useEffect(() => {
    if (phase !== 'showing') return undefined
    prefs.set(HINT_KEY, 'shown')
    const timer = setTimeout(() => setPhase('done'), HINT_MS)
    return () => clearTimeout(timer)
  }, [phase])

  const dismiss = useCallback(() => setPhase(now => (now === 'showing' ? 'done' : now)), [])
  return { shown: phase === 'showing', dismiss }
}

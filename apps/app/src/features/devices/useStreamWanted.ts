import { useEffect, useState } from 'react'

import { useTabHidden } from '../../ports/tabHidden'

/**
 * How long a hidden tab keeps its stream before letting it go.
 *
 * A browser opens at most six connections to one address over plain HTTP, and
 * each tab's stream holds one for as long as it is open: six tabs took every
 * one, and every other request from every tab — playing, Stats, an edit —
 * waited behind them without end. A hidden tab that is not playing has no use
 * for live news, so after this it closes its stream and opens it again when it
 * is looked at; the replay then brings it up to date. A tab that is playing
 * keeps it, to hear "pause" from another device taking over.
 */
const HIDDEN_STREAM_GRACE_MS = 30_000

/**
 * Whether this device should hold the event stream open now: always in the
 * apps, and in a browser while the tab is in view or playing (see above).
 */
export function useStreamWanted(playing: boolean): boolean {
  const hidden = useTabHidden()
  const needed = !hidden || playing
  // Whether the grace ran out while it was not needed.
  const [lapsed, setLapsed] = useState(false)
  if (needed && lapsed) setLapsed(false)

  useEffect(() => {
    if (needed) return undefined
    const timer = setTimeout(() => setLapsed(true), HIDDEN_STREAM_GRACE_MS)
    return () => clearTimeout(timer)
  }, [needed])

  return needed || !lapsed
}

import { useEffect, useState } from 'react'

import { useTabHidden } from '../../ports/tabHidden'

/**
 * How long a hidden tab keeps its stream before letting it go.
 *
 * A browser's tabs share one stream (`ports/events.web.ts`), and a hidden tab
 * that is not playing has no use for its news: after this it leaves, so the
 * stream is held by a tab someone is looking at and stops speaking for this
 * one, and it joins again when it is looked at and is told how things stand.
 * A tab that is playing stays, to hear "pause" from another device taking over.
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

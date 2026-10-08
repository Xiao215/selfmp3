import { useEffect } from 'react'
import { focusManager } from '@tanstack/react-query'
import { api } from '../api/client'

/**
 * How often a cloud library asks whether the bucket has something new, while
 * the app is in front. A server pushes its news down an event stream; the
 * bucket has none, so another device's edit reaches this one on the next look.
 * This is how often to ask, not how often to look: the replica decides whether
 * a look is due, and how much one costs (`@selfmp3/replica`'s FRESH_MS) —
 * asking the doorman's change counter is free, and listing the bucket is not.
 */
const ASK_EVERY_MS = 60_000

/**
 * Ask the cloud library its version now and then, which looks at the bucket
 * when a look is due; what a look finds reaches the screens through
 * `onCloudLibraryChanged`. A timer and not a query: nothing here is drawn, so
 * nothing should render for it — a query held by every screen that reads the
 * library re-rendered them as it went. Skipped while the app is in the
 * background, as TanStack Query's own intervals are, and for a server, whose
 * news comes by itself.
 *
 * The routes asked every few seconds — where the server is, which uid is
 * which song — used to be what kept looking, eighty seconds apart, two
 * listings a time. They answer from the device's copy now, and this is the
 * one thing that asks.
 */
export function useCloudLook(fromCloud: boolean): void {
  useEffect(() => {
    if (!fromCloud) return undefined
    const timer = setInterval(() => {
      if (!focusManager.isFocused()) return
      void api.libraryVersion().catch(() => undefined)
    }, ASK_EVERY_MS)
    return () => clearInterval(timer)
  }, [fromCloud])
}

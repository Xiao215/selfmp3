import { useSyncExternalStore } from 'react'
import { onlineManager } from '@tanstack/react-query'

/**
 * Whether this device says it has a network, as the queries hear it. Offline,
 * nothing is asked at all — queries and edits wait — so no error ever comes to
 * say so, and a screen that reads only errors kept saying all was well.
 *
 * The queries hear only a change: a page opened with no network at all starts
 * out "online" to them, and stays so until the network comes and goes. So a
 * browser's own word (`navigator.onLine`, which is false only when there is
 * truly no network) is heard too. Only here, for what the screen says: told
 * to the queries, every cloud library — this device's own copy — would wait
 * for a network it does not need.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    listener => {
      const stopHearing = onlineManager.subscribe(listener)
      const page = typeof window !== 'undefined' ? window : null
      page?.addEventListener?.('online', listener)
      page?.addEventListener?.('offline', listener)
      return () => {
        stopHearing()
        page?.removeEventListener?.('online', listener)
        page?.removeEventListener?.('offline', listener)
      }
    },
    () => onlineManager.isOnline() && !browserOffline(),
  )
}

/** A browser saying it has no network at all; never true on a phone, which has no `navigator.onLine`. */
function browserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

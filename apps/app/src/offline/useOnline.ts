import { useSyncExternalStore } from 'react'
import { onlineManager } from '@tanstack/react-query'

/**
 * Whether this device says it has a network, as the queries hear it. Offline,
 * nothing is asked at all — queries and edits wait — so no error ever comes to
 * say so, and a screen that reads only errors kept saying all was well.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    listener => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
  )
}

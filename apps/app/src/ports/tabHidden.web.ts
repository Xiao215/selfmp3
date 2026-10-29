import { useSyncExternalStore } from 'react'

function subscribe(listener: () => void): () => void {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}

/** Whether this tab is out of view: another tab in front, or the window minimised. */
export function useTabHidden(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.visibilityState === 'hidden',
    () => false,
  )
}

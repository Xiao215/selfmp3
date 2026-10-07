import { useSyncExternalStore } from 'react'
import { focusManager } from '@tanstack/react-query'

/**
 * Whether the app is in front, on either platform.
 *
 * TanStack Query already knows — the browser tells it, and `listenForAppFocus`
 * tells it on the phone — so this reads that rather than adding a second
 * listener that would have to be written twice.
 */
export function useAppFocused(): boolean {
  return useSyncExternalStore(subscribeFocus, isFocused, isFocused)
}

// Module-level, so the store's identity never changes and a subscription is
// made once. A wrapper rather than `focusManager.subscribe` itself: that one
// hands its listener the new state, and the store wants a plain notify.
const subscribeFocus = (listener: () => void): (() => void) =>
  focusManager.subscribe(() => listener())
const isFocused = (): boolean => focusManager.isFocused()

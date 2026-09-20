import { useSyncExternalStore } from 'react'

/**
 * How wide the app's own root view is, measured rather than asked for.
 *
 * `Dimensions` is the window, and on an iPad it has been seen not to change on
 * the first entry into Split View (facebook/react-native #28935): the app is
 * given half the screen and goes on laying out for the whole of it, so the
 * computer's sidebar and player bar are drawn into a phone's width. The root
 * view's own `onLayout` always reports the truth, and `useLayout` prefers it.
 *
 * Outside React: one number, read by every screen through `useLayout`, and a
 * context around the whole app would redraw it from the top on every change
 * anyway.
 */
let width: number | null = null
const listeners = new Set<() => void>()

export function setRootWidth(next: number): void {
  const rounded = Math.round(next)
  // Zero happens while a view is being laid out; it is not a width.
  if (rounded <= 0 || rounded === width) return
  width = rounded
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const read = (): number | null => width

export function useRootWidth(): number | null {
  return useSyncExternalStore(subscribe, read, read)
}

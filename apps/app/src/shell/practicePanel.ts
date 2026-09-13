import { useSyncExternalStore } from 'react'

/**
 * Whether the desktop's practice panel is open.
 *
 * The player bar's metronome opens it and the shell draws it beside the page,
 * so the choice lives here rather than in either. A phone opens the same panel
 * as a sheet from Now Playing, which keeps its own state.
 */

let open = false
const listeners = new Set<() => void>()

export function setPracticeOpen(next: boolean): void {
  if (next === open) return
  open = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePracticeOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => open,
  )
}

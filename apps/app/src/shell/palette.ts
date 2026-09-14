import { useSyncExternalStore } from 'react'

/**
 * Whether the command palette is open.
 *
 * Two things open it and neither draws it: the sidebar's Search row, and the
 * installed app's View › Search (⌘K), which arrives as a menu command. The
 * shell draws the palette, so the choice lives here rather than in any of the
 * three — the same arrangement as `practicePanel.ts`.
 */

let open = false
const listeners = new Set<() => void>()

export function setPaletteOpen(next: boolean): void {
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

export function usePaletteOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => open,
  )
}

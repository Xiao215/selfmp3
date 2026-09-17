import { useSyncExternalStore } from 'react'

/**
 * Whether the library's tag search is open.
 *
 * A module store rather than state, for the same reason the filter is one: the
 * rail's **All 214 tags…** is drawn by the shell and the search itself belongs
 * to the library screen, and those are in different trees. The sidebar asks;
 * the library answers by opening it.
 *
 * Only ever true while the library is on screen — the screen closes it when it
 * unmounts, so coming back to the library does not find a panel left open from
 * a press made three pages ago.
 */

let open = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function openTagSearch(): void {
  if (open) return
  open = true
  emit()
}

export function closeTagSearch(): void {
  if (!open) return
  open = false
  emit()
}

export function useTagSearchOpen(): boolean {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => open,
    () => open,
  )
}

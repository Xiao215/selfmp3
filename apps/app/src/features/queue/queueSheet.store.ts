import { useSyncExternalStore } from 'react'

/**
 * Whether Up next is open (docs/ui-mock `P25`, `C11`): the sheet over a
 * phone's page, the rail beside a computer's. Anything with a queue button —
 * the mini player, Now Playing's foot, the player bar — opens it through here,
 * so there is one Up next however it was reached. The rail stays open across
 * pages until it is closed.
 */

let open = false
const listeners = new Set<() => void>()

function set(next: boolean): void {
  if (open === next) return
  open = next
  for (const listener of listeners) listener()
}

export function openQueueSheet(): void {
  set(true)
}

export function closeQueueSheet(): void {
  set(false)
}

export function toggleQueueSheet(): void {
  set(!open)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = (): boolean => open

export function useQueueSheetOpen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

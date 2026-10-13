import { useSyncExternalStore } from 'react'

/**
 * What the share sheet is sharing (`ShareSheet`): one song, a tag or
 * playlist as it is now, or songs picked. Opened from a song's ⋯ menu, the
 * selection bar and a tag's or playlist's page; drawn once, by the shell.
 */
export interface ShareRequest {
  readonly songIds: readonly number[]
  /** The song's title, or the tag's or playlist's name. */
  readonly name: string
  readonly kind: 'song' | 'list'
}

let open: ShareRequest | null = null
const listeners = new Set<() => void>()

function set(next: ShareRequest | null): void {
  open = next
  for (const listener of listeners) listener()
}

export function openShareSheet(request: ShareRequest): void {
  set(request)
}

export function closeShareSheet(): void {
  set(null)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = (): ShareRequest | null => open

export function useShareRequest(): ShareRequest | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

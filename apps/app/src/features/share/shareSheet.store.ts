import { createValueStore } from '../../state/valueStore.model'
import { useValueStore } from '../../state/useValueStore'

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

const open = createValueStore<ShareRequest | null>(null)

export function openShareSheet(request: ShareRequest): void {
  open.set(request)
}

export function closeShareSheet(): void {
  open.set(null)
}

export function useShareRequest(): ShareRequest | null {
  return useValueStore(open)
}

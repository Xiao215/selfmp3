import { useSyncExternalStore } from 'react'
import {
  parseRecentTagIds,
  RECENT_TAGS_KEY,
  serialiseRecentTagIds,
  withTagUsed,
} from '@selfmp3/client'

import { prefs } from '../../ports/prefs'

/**
 * Which tags this device reached for last, kept across launches.
 *
 * One store for the whole app rather than state in a provider: the sidebar
 * shows it, the library head writes to it, and the two are in different trees.
 * It is also read during the first render of the sidebar, which is why the
 * `prefs` port is synchronous.
 *
 * The rules are in `@selfmp3/client`; this is the store around them.
 */

let ids: readonly number[] | null = null
const listeners = new Set<() => void>()

/** Read once, then kept — the same array until something is used. */
function snapshot(): readonly number[] {
  ids ??= parseRecentTagIds(prefs.get(RECENT_TAGS_KEY))
  return ids
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Remember that a tag was chosen. Called when one is turned *on* — turning one
 * off is not a sign of interest in it, and would put a tag you have just
 * dismissed at the front of the rail.
 */
export function noteTagUsed(tagId: number): void {
  const next = withTagUsed(snapshot(), tagId)
  ids = next
  prefs.set(RECENT_TAGS_KEY, serialiseRecentTagIds(next))
  for (const listener of listeners) listener()
}

export function useRecentTagIds(): readonly number[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

import { createValueStore } from '../state/valueStore.model'
import { useValueStore } from '../state/useValueStore'

/**
 * How tall a field docked at the foot of the page is (Ask's), so the toasts
 * rise above it rather than cover what is being typed. The page that docks it
 * says so while it is shown, and 0 when it goes; the toast row (`Shell`) reads
 * it. Outside React, as `pageChrome.ts` is, since neither is the other's parent.
 */
const foot = createValueStore(0)

export const setPageFoot = foot.set

/** The docked field's height, or 0 when the page has none. */
export function usePageFoot(): number {
  return useValueStore(foot)
}

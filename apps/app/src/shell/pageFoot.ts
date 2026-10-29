import { createValueStore } from '../state/valueStore.model'
import { useValueStore } from '../state/useValueStore'

/**
 * How tall a field docked at the foot of the page is (Ask's), or the controls
 * there (the phone's Now Playing), so the toasts rise above it rather than
 * cover what is being typed or pressed. The page that docks it
 * says so while it is shown, and 0 when it goes; the toast row (`Shell`) reads
 * it. Outside React, as `pageChrome.ts` is, since neither is the other's parent.
 */
const foot = createValueStore(0)

export const setPageFoot = foot.set

/** What is docked at the foot now, for a page that docks its own over another's to put back. */
export const pageFootNow = foot.get

/** The docked field's height, or 0 when the page has none. */
export function usePageFoot(): number {
  return useValueStore(foot)
}

import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'

import { createValueStore, type ValueStore } from '../state/valueStore.model'

/**
 * How wide the page column is at desktop width: the window less what stands
 * beside the page, as the shell works it out (`Shell`).
 *
 * The window is the wrong measure for a screen's own layout: the sidebar takes
 * 244 of it, Up next 288 while it is open, and the practice panel another 340.
 * A row that chose its columns from the window drew an album column into a
 * page too narrow for one. Worked out and not measured, so that a panel
 * sliding in changes it once, to where the slide ends, and not every frame.
 * Null on a phone.
 *
 * A store in the context rather than the number itself, so that what only
 * asks a question of the width — a row: is there room for the album column? —
 * renders again when the answer changes, not on every pixel of a window being
 * dragged (`useContentWidthValue`).
 */
export const ContentWidthContext = createContext<ValueStore<number | null>>(
  createValueStore<number | null>(null),
)

/** The page column's width, and a render for every change of it. */
export function useContentWidth(): number | null {
  const store = useContext(ContentWidthContext)
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/**
 * One fact about the page column's width, rendering again only when that fact
 * changes. `select` answers with a value that compares by `===`.
 */
export function useContentWidthValue<T>(select: (width: number | null) => T): T {
  const store = useContext(ContentWidthContext)
  const read = useCallback(() => select(store.get()), [store, select])
  return useSyncExternalStore(store.subscribe, read, read)
}

import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { createValueStore, type ValueStore } from '../state/valueStore.model'

/**
 * How wide the page column is at desktop width: the window less what stands
 * beside the page, as the shell works it out (`Shell`).
 *
 * The window is the wrong measure for a screen's own layout: the sidebar takes
 * 244 of it and Up next 288 while it is open, and a row that chose its columns
 * from the window would draw an album column into a page too narrow for one.
 * Worked out and not measured, so that a panel
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
  const read = (): T => select(store.get())
  return useSyncExternalStore(store.subscribe, read, read)
}

/**
 * A part of the page that holds itself to a narrower column (Search's 760):
 * the rows in it ask whether their album column fits of that column, not of the
 * page around it, or they draw columns for a page they are not in and cut
 * their own titles short.
 */
export function NarrowerContentWidth({
  max,
  children,
}: {
  max: number
  children: ReactNode
}): ReactNode {
  const page = useContext(ContentWidthContext)
  const [store] = useState(() => createValueStore(narrower(page.get(), max)))
  useLayoutEffect(() => {
    store.set(narrower(page.get(), max))
    return page.subscribe(() => store.set(narrower(page.get(), max)))
  }, [page, store, max])
  return <ContentWidthContext.Provider value={store}>{children}</ContentWidthContext.Provider>
}

function narrower(width: number | null, max: number): number | null {
  return width === null ? null : Math.min(width, max)
}

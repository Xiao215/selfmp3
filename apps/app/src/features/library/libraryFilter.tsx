import { createContext, useContext, useMemo, useState, useSyncExternalStore } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { LibraryFilter, TagFilter } from '@selfmp3/client'
import { createLibraryFilterStore, type LibraryFilterStore } from './libraryFilter.store'

/**
 * The library's filter, held above the library.
 *
 * At desktop width the tags are chosen from the sidebar, which is the shell's,
 * while the list they filter is the library screen's — two places that must
 * agree on one filter. Only React here: the model reads it, and the model may
 * not import anything that draws.
 *
 * The provider hands down a store, not the filter, so the context value never
 * changes and nothing renders just for being below it. Each hook below reads
 * as much of the filter as its caller shows (libraryFilter.store.ts).
 */
type SetFilter = Dispatch<SetStateAction<LibraryFilter>>
type FilterState = readonly [LibraryFilter, SetFilter]

const LibraryFilterContext = createContext<LibraryFilterStore | null>(null)

export function LibraryFilterProvider({ children }: { children: ReactNode }): ReactNode {
  const [store] = useState(() => createLibraryFilterStore())
  return <LibraryFilterContext.Provider value={store}>{children}</LibraryFilterContext.Provider>
}

/**
 * The shared store, or one of this component's own outside the provider, so a
 * screen rendered alone in a test still works.
 */
function useStore(): LibraryFilterStore {
  const shared = useContext(LibraryFilterContext)
  const [local] = useState(() => createLibraryFilterStore())
  return shared ?? local
}

/** The whole filter: the library list, which a query changes. */
export function useLibraryFilter(): FilterState {
  const store = useStore()
  const filter = useSyncExternalStore(store.subscribe, store.get, store.get)
  return [filter, store.set]
}

/**
 * Only the tag half, which is all the sidebar shows. The arrays are carried
 * over untouched when the query changes, so typing leaves both snapshots equal
 * and the sidebar is not rendered for it.
 */
export function useLibraryTagFilter(): readonly [TagFilter, SetFilter] {
  const store = useStore()
  const included = (): readonly number[] => store.get().includedTagIds
  const excluded = (): readonly number[] => store.get().excludedTagIds
  const includedTagIds = useSyncExternalStore(store.subscribe, included, included)
  const excludedTagIds = useSyncExternalStore(store.subscribe, excluded, excluded)
  const tags = useMemo(() => ({ includedTagIds, excludedTagIds }), [includedTagIds, excludedTagIds])
  return [tags, store.set]
}

/** Only the setter, for a caller that changes the filter without showing it: the palette. */
export function useSetLibraryFilter(): SetFilter {
  return useStore().set
}

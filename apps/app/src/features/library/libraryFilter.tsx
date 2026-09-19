import { createContext, useContext, useState, useSyncExternalStore } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { LibraryFilter } from '@selfmp3/client'
import { createLibraryFilterStore, type LibraryFilterStore } from './libraryFilter.store'

/**
 * The library's filter, held above the library.
 *
 * Library's own tag strip and sort, kept above the screen so they are still
 * there when you come back to it. Nothing else filters Library any more: a tag
 * opens its own page (docs/UI-MIGRATION.md, Phase 4). Only React here: the
 * model reads it, and the model may not import anything that draws.
 *
 * The provider hands down a store, not the filter, so the context value never
 * changes and nothing renders just for being below it (libraryFilter.store.ts).
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


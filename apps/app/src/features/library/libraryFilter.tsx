import { createContext, useContext, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { DEFAULT_FILTER, type LibraryFilter } from '@selfmp3/client'

/**
 * The library's filter, held above the library.
 *
 * At desktop width the tags are chosen from the sidebar, which is the shell's,
 * while the list they filter is the library screen's — two places that must
 * agree on one filter. The web app keeps its tag sets in `App` for the same
 * reason. Only React here: the model reads it, and the model may not import
 * anything that draws.
 */
type FilterState = readonly [LibraryFilter, Dispatch<SetStateAction<LibraryFilter>>]

const LibraryFilterContext = createContext<FilterState | null>(null)

export function LibraryFilterProvider({ children }: { children: ReactNode }): ReactNode {
  const state = useState<LibraryFilter>(DEFAULT_FILTER)
  return <LibraryFilterContext.Provider value={state}>{children}</LibraryFilterContext.Provider>
}

/**
 * The shared filter, or a filter of this component's own outside the
 * provider, so a screen rendered alone in a test still works.
 */
export function useLibraryFilter(): FilterState {
  const shared = useContext(LibraryFilterContext)
  const local = useState<LibraryFilter>(DEFAULT_FILTER)
  return shared ?? local
}

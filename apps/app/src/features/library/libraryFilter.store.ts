import type { Dispatch, SetStateAction } from 'react'
import { DEFAULT_FILTER, type LibraryFilter } from '@selfmp3/client'

/**
 * The library filter as a store rather than as React state in a provider.
 *
 * In state, every letter typed into the search was a new context value, and a
 * new context value renders every reader — the sidebar's whole tag list among
 * them, which shows nothing a query changes. A store lets each reader pick the
 * part it shows and render only when that part changes.
 */
export interface LibraryFilterStore {
  readonly get: () => LibraryFilter
  /** `useState`'s setter, updater functions and all, and as stable. */
  readonly set: Dispatch<SetStateAction<LibraryFilter>>
  readonly subscribe: (listener: () => void) => () => void
}

export function createLibraryFilterStore(initial: LibraryFilter = DEFAULT_FILTER): LibraryFilterStore {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set: action => {
      const next = typeof action === 'function' ? action(current) : action
      // `useState` bails out on the same value; so does this, or a no-op
      // (clearing tags that are not set) would still render every reader.
      if (Object.is(next, current)) return
      current = next
      for (const listener of listeners) listener()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

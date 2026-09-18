import { useState } from 'react'

/**
 * The array handed in, unless the one kept from the last render holds the
 * same items in the same order — then that one, so what is memoised on it
 * holds.
 *
 * For a list recomputed from the library on every edit: a like remakes
 * `songs`, so the filtered list, its ids, the queue's songs and the download
 * lists are all remade too, each a new array of the same objects, and every
 * context value and callback memoised on one of them changes with it. A
 * shallow compare is one pass over the ids; what it saves is a render of every
 * component that reads the player or the downloads for an edit that touched
 * neither.
 *
 * Kept in state rather than a ref, and adjusted while rendering, which is the
 * form React documents for remembering a previous render's value (and the one
 * the React Compiler accepts): the extra render it costs happens only when the
 * items really changed.
 */
export function useSameArray<T>(next: readonly T[]): readonly T[] {
  const [kept, setKept] = useState(next)
  if (kept === next || sameItems(kept, next)) return kept
  setKept(next)
  return next
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

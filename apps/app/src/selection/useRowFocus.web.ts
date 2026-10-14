import { useLayoutEffect } from 'react'

import type { useRowFocus as SameShape } from './useRowFocus'
import { listRowOf, lostFocus, nothingFocused, pressOf, rowsOf, songOf } from './listRows'

/**
 * A song row keeping the keyboard's place in its list as it scrolls away and
 * back.
 *
 * A list draws only the rows within a few screens of where it is scrolled. A
 * focused row scrolled past that is taken out of the page, and its focus goes
 * with it — to nothing, so the next arrow would scroll the page rather than
 * move along the list. So a row going while it has focus says so
 * (`lostFocus`), and comes back focused when it is drawn again, as long as
 * nothing else has taken focus in between.
 *
 * In a layout effect: its cleanup runs while the row is still in the page,
 * which is the last moment anything can tell it had focus.
 */
export const useRowFocus: typeof SameShape = (listKey, songId) => {
  useLayoutEffect(() => {
    if (listKey === undefined) return
    if (lostFocus.get(listKey) === songId && nothingFocused()) {
      lostFocus.delete(listKey)
      const row = rowsOf(listKey).find(each => songOf(each) === songId)
      const target = row ? pressOf(row) : null
      target?.focus({ preventScroll: true })
    }
    return () => {
      const row = listRowOf(document.activeElement, listKey)
      if (row && songOf(row) === songId) lostFocus.set(listKey, songId)
    }
  }, [listKey, songId])
}

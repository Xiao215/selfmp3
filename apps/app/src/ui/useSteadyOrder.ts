import { useMemo, useState } from 'react'

import { steadyOrder } from './steadyOrder.model'

/**
 * `next`, but with the items already drawn kept in their places while
 * `holding` (`steadyOrder.model.ts`): a list whose order follows what was
 * pressed last, or how many songs each tag has, held still under the pointer
 * pressing it. Let go, it is `next` as it stands. `key` is kept: a
 * module-level function.
 *
 * `visit` says which visit to the page this is: a new one takes `next` afresh
 * even while holding, so a list held for as long as you stay on a page (X6)
 * is in its own order the next time you come to it.
 */
export function useSteadyOrder<T, K>(
  next: readonly T[],
  key: (item: T) => K,
  holding: boolean,
  visit?: unknown,
): readonly T[] {
  const [held, setHeld] = useState<{ visit: unknown; shown: readonly T[] }>(() => ({
    visit,
    shown: next,
  }))
  const fresh = held.visit !== visit
  const shown = held.shown
  const order = useMemo(
    () => (holding && !fresh ? steadyOrder(shown, next, key) : next),
    [holding, fresh, shown, next, key],
  )
  // What was drawn is what the next order is kept against: set while
  // rendering, as React allows for state derived from the last render, and
  // only when it differs, so it settles at once.
  if (
    fresh ||
    order.length !== shown.length ||
    order.some((item, index) => item !== shown[index])
  ) {
    setHeld({ visit, shown: order })
  }
  return order
}

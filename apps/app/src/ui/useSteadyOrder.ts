import { useMemo, useState } from 'react'

import { steadyOrder } from './steadyOrder.model'

/**
 * `next`, but with the items already drawn kept in their places while
 * `holding` (`steadyOrder.model.ts`): a list whose order follows what was
 * pressed last, held still under the pointer pressing it. Let go, it is
 * `next` as it stands. `key` is kept: a module-level function.
 */
export function useSteadyOrder<T, K>(
  next: readonly T[],
  key: (item: T) => K,
  holding: boolean,
): readonly T[] {
  const [shown, setShown] = useState<readonly T[]>(next)
  const order = useMemo(
    () => (holding ? steadyOrder(shown, next, key) : next),
    [holding, shown, next, key],
  )
  // What was drawn is what the next order is kept against: set while
  // rendering, as React allows for state derived from the last render, and
  // only when it differs, so it settles at once.
  if (order.length !== shown.length || order.some((item, index) => item !== shown[index])) {
    setShown(order)
  }
  return order
}

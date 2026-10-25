import type { ReactNode } from 'react'

/**
 * A page kept in the stack under the one on top. On a phone it is left as it
 * is: a swipe back draws it before the stack says it is on top again.
 */
export function HiddenPage({ children }: { hidden: boolean; children: ReactNode }): ReactNode {
  return children
}

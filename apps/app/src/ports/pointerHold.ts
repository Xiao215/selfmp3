import type { RefObject } from 'react'
import type { View } from 'react-native'

export interface PointerHold {
  /** Off where there is nothing to move. */
  readonly enabled: boolean
  /** How long the pointer rests before the row lifts. */
  readonly holdMs: number
  readonly onStart: () => void
  readonly onMove: (dy: number) => void
  readonly onEnd: (dy: number) => void
}

/**
 * Holding a row with a *pointer*, in the browser's own terms.
 *
 * Nothing away from the web: a phone holds rows through gesture handler, and
 * has no pointer to capture (`HoldToReorder`).
 */
export function usePointerHold(_ref: RefObject<View | null>, _hold: PointerHold): void {}

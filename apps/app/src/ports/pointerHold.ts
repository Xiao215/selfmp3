import type { RefObject } from 'react'
import type { View } from 'react-native'

export interface PointerHold {
  /** Off where there is nothing to move. */
  readonly enabled: boolean
  /** How long the pointer rests before the row lifts. */
  readonly holdMs: number
  readonly onStart: (x: number) => void
  /** How far the pointer has travelled since the hold began. */
  readonly onMove: (dx: number, dy: number) => void
  readonly onEnd: (dx: number, dy: number) => void
  /**
   * The count has begun (the pointer went down), or it is over (it came up or
   * was taken away). What the row swells by while it waits (`useLiftScale`);
   * the hold winning is told by `onStart`, which the caller follows with a
   * `false` of its own.
   */
  readonly onHolding?: (holding: boolean) => void
}

/**
 * Holding a row with a *pointer*, in the browser's own terms.
 *
 * Nothing away from the web: a phone holds rows through gesture handler, and
 * has no pointer to capture (`HoldToReorder`).
 */
export function usePointerHold(_ref: RefObject<View | null>, _hold: PointerHold): void {}

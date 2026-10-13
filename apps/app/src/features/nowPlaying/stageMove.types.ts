import type { ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import type { PoseAt } from './stageMove.model'

/**
 * A piece of the page that follows the move between the stage and Focus, on
 * either twin (`StageMove.tsx`, `StageMove.web.tsx`). `Move` is the twin's own
 * handle on the move: an Animated value on an iPad, a subscription in a browser.
 */
export interface MovingProps<Move> {
  readonly move: Move
  /** Where this piece is at each point of the move, from its own laid-out place. */
  readonly pose: PoseAt
  readonly style?: StyleProp<ViewStyle>
  readonly pointerEvents?: 'none' | 'auto'
  readonly children?: ReactNode
}

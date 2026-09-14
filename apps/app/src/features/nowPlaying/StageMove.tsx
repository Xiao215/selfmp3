import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { MOVE_EASING, MOVE_MS, type PoseAt } from './stageMove.model'

/**
 * The move between the stage and Focus, on an iPad: Animated on the native
 * driver, so the frames never come back to JavaScript. The browser's is
 * `StageMove.web.tsx`, and `stageMove.model.ts` says why neither moves layout.
 */
export interface StageMove {
  readonly value: Animated.Value
  /** Where the move is headed: 0 the stage, 1 Focus. */
  readonly target: number
}

export function useStageMove(focus: boolean): StageMove {
  const target = focus ? 1 : 0
  const [value] = useState(() => new Animated.Value(target))
  useEffect(() => {
    Animated.timing(value, {
      toValue: target,
      duration: MOVE_MS,
      easing: Easing.bezier(...MOVE_EASING),
      useNativeDriver: true,
    }).start()
  }, [target, value])
  return useMemo(() => ({ value, target }), [value, target])
}

export interface MovingProps {
  readonly move: StageMove
  /** Where this piece is at each point of the move, from its own laid-out place. */
  readonly pose: PoseAt
  readonly style?: StyleProp<ViewStyle>
  readonly pointerEvents?: 'none' | 'auto'
  readonly children?: ReactNode
}

/** A view that follows the move with a transform, an opacity and its corners. */
export function Moving({ move, pose, style, pointerEvents, children }: MovingProps): ReactNode {
  const from = pose(0)
  const to = pose(1)
  // The interpolations are native nodes: built again only when an end moves —
  // a resize, or the lyrics column laid out for the other mode — not on every
  // render of the page.
  const animated = useMemo(() => {
    const between = (a: number, b: number): Animated.AnimatedInterpolation<number> =>
      move.value.interpolate({ inputRange: [0, 1], outputRange: [a, b] })
    const transform: (
      | { translateX: Animated.AnimatedInterpolation<number> }
      | { translateY: Animated.AnimatedInterpolation<number> }
      | { scale: Animated.AnimatedInterpolation<number> }
    )[] = []
    if (from.translateX !== undefined || to.translateX !== undefined) {
      transform.push({ translateX: between(from.translateX ?? 0, to.translateX ?? 0) })
    }
    if (from.translateY !== undefined || to.translateY !== undefined) {
      transform.push({ translateY: between(from.translateY ?? 0, to.translateY ?? 0) })
    }
    const scale = between(from.scale ?? 1, to.scale ?? 1)
    if (from.scale !== undefined || to.scale !== undefined) transform.push({ scale })
    const style: {
      transform?: typeof transform
      opacity?: Animated.AnimatedInterpolation<number>
      borderRadius?: Animated.AnimatedDivision<number>
    } = {}
    if (transform.length > 0) style.transform = transform
    if (from.opacity !== undefined || to.opacity !== undefined) {
      style.opacity = between(from.opacity ?? 1, to.opacity ?? 1)
    }
    // Seen corners go in a straight line; the laid-out ones are those over the scale.
    if (from.radius !== undefined && to.radius !== undefined) {
      style.borderRadius = Animated.divide(between(from.radius, to.radius), scale)
    }
    return style
    // The ends' numbers are the dependency, not the pose function, which is new each render.
  }, [
    move.value,
    from.translateX,
    from.translateY,
    from.scale,
    from.opacity,
    from.radius,
    to.translateX,
    to.translateY,
    to.scale,
    to.opacity,
    to.radius,
  ])

  return (
    <Animated.View pointerEvents={pointerEvents} style={[style, animated]}>
      {children}
    </Animated.View>
  )
}

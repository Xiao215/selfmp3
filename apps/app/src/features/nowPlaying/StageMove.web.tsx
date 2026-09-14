import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { Easing, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import {
  laidOutRadius,
  MOVE_EASING,
  MOVE_MS,
  moveKeyframes,
  type MovePose,
  type PoseAt,
} from './stageMove.model'

/*
 * The move between the stage and Focus, in a browser and the Mac app.
 *
 * Animated has no native driver on the web: it re-renders the view on every
 * frame, and every frame's new numbers become a new Unistyles class and a
 * rewrite of the whole stylesheet — even for a transform. So React draws only
 * where each piece ends up, once, and the browser's own animation carries it
 * there from where it was, on the compositor, with no renders in between.
 */

const ease = Easing.bezier(...MOVE_EASING)
const CSS_EASING = `cubic-bezier(${MOVE_EASING.join(', ')})`

type Listener = (from: number, to: number) => void

export interface StageMove {
  /** Where the move is headed: 0 the stage, 1 Focus. */
  readonly target: number
  readonly subscribe: (listener: Listener) => () => void
}

interface Run {
  readonly from: number
  readonly to: number
  readonly start: number
}

export function useStageMove(focus: boolean): StageMove {
  const target = focus ? 1 : 0
  const listeners = useRef(new Set<Listener>())
  // Settled wherever the page opened: no move until the mode changes.
  const run = useRef<Run>({ from: target, to: target, start: Number.NEGATIVE_INFINITY })

  // Before the browser paints the new mode's layout, or it would flash there
  // for a frame before the animations pull it back to where it was.
  useLayoutEffect(() => {
    const now = performance.now()
    const current = run.current
    const progress = ease(Math.min(1, (now - current.start) / MOVE_MS))
    // Turned round part-way: from wherever it has got to, the whole length,
    // as Animated.timing restarted from its current value.
    const at = current.from + (current.to - current.from) * progress
    if (at === target && current.to === target) return
    run.current = { from: at, to: target, start: now }
    for (const listener of listeners.current) listener(at, target)
  }, [target])

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  return useMemo(() => ({ target, subscribe }), [target, subscribe])
}

export interface MovingProps {
  readonly move: StageMove
  /** Where this piece is at each point of the move, from its own laid-out place. */
  readonly pose: PoseAt
  readonly style?: StyleProp<ViewStyle>
  readonly pointerEvents?: 'none' | 'auto'
  readonly children?: ReactNode
}

/** The subset of a DOM element this needs, since a React Native ref is typed as a view. */
interface Animatable {
  animate: (
    keyframes: ReturnType<typeof moveKeyframes>,
    options: { duration: number; easing: string },
  ) => { cancel: () => void }
}

/** A view drawn where the move ends, carried there by the browser from where it was. */
export function Moving({ move, pose, style, pointerEvents, children }: MovingProps): ReactNode {
  const ref = useRef<View>(null)
  // The pose for the layout just committed: a move that starts in this commit
  // reads it, and a child's layout effects run before its parent's.
  const latestPose = useRef(pose)
  useLayoutEffect(() => {
    latestPose.current = pose
  })
  const running = useRef<{ cancel: () => void } | null>(null)
  const { subscribe } = move

  useLayoutEffect(() => {
    const stop = subscribe((from, to) => {
      const node = ref.current as unknown as Partial<Animatable> | null
      if (typeof node?.animate !== 'function') return
      running.current?.cancel()
      running.current = node.animate(moveKeyframes(latestPose.current, from, to), {
        duration: MOVE_MS,
        easing: CSS_EASING,
      })
    })
    return () => {
      stop()
      running.current?.cancel()
    }
  }, [subscribe])

  return (
    <View ref={ref} pointerEvents={pointerEvents} style={[style, poseStyle(pose(move.target))]}>
      {children}
    </View>
  )
}

/**
 * The pose a piece rests in, as a style. A still transform is left out, so a
 * piece at rest makes no layer of its own.
 */
function poseStyle(pose: MovePose): ViewStyle {
  const style: ViewStyle = {}
  const moved =
    (pose.translateX ?? 0) !== 0 || (pose.translateY ?? 0) !== 0 || (pose.scale ?? 1) !== 1
  if (moved) {
    style.transform = [
      { translateX: pose.translateX ?? 0 },
      { translateY: pose.translateY ?? 0 },
      { scale: pose.scale ?? 1 },
    ]
  }
  if (pose.opacity !== undefined) style.opacity = pose.opacity
  const radius = laidOutRadius(pose)
  if (radius !== undefined) style.borderRadius = radius
  return style
}

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { Easing, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import {
  laidOutRadius,
  MOVE_EASING,
  moveKeyframes,
  type MovePose,
  type PoseAt,
} from './stageMove.model'
import { MOVE_MS } from '../../ui/motion.model'
import { motionMs } from '../../ui/motion'

/*
 * The move between the stage and Focus, in a browser and the desktop app.
 *
 * Animated has no native driver on the web: it re-renders the view on every
 * frame, and every frame's new numbers become a new Unistyles class and a
 * rewrite of the whole stylesheet — even for a transform. So React draws only
 * where each piece ends up, once, and the browser's own animation carries it
 * there from where it was, on the compositor, with no renders in between.
 */

const ease = Easing.bezier(...MOVE_EASING)
const CSS_EASING = `cubic-bezier(${MOVE_EASING.join(', ')})`

type Listener = (from: number, to: number, ms: number) => void

export interface StageMove {
  /** Where the move is headed: 0 the stage, 1 Focus. */
  readonly target: number
  readonly subscribe: (listener: Listener) => () => void
}

interface Run {
  readonly from: number
  readonly to: number
  readonly start: number
  /** How long this run was given, so a run cut short is read at the right point of its curve. */
  readonly ms: number
}

export function useStageMove(focus: boolean): StageMove {
  const target = focus ? 1 : 0
  const listeners = useRef(new Set<Listener>())
  // Settled wherever the page opened: no move until the mode changes.
  const run = useRef<Run>({ from: target, to: target, start: Number.NEGATIVE_INFINITY, ms: 0 })

  // Before the browser paints the new mode's layout, or it would flash there
  // for a frame before the animations pull it back to where it was.
  useLayoutEffect(() => {
    const now = performance.now()
    const current = run.current
    /*
     * Where the move has got to, eased: `m` is not the share of the time gone
     * but the curve of it, so a turn half a second in leaves from the pose that
     * is on screen and no frame repeats it.
     *
     * And it is given only the time the rest of the way is worth. The whole
     * distance is 1 — the stage to Focus — so a run of `|to - at|` of it takes
     * that share of `MOVE_MS.stageMove`: a reversal a tenth of the way along is
     * a tenth-and-a-bit of the length, not another 520 ms of it. Without that
     * the cover left an eased midpoint at full speed, slowed into a new
     * ease-in, and read as two moves rather than one that changed its mind.
     */
    const progress = current.ms > 0 ? ease(Math.min(1, (now - current.start) / current.ms)) : 1
    const at = current.from + (current.to - current.from) * progress
    if (at === target && current.to === target) return
    const ms = motionMs(MOVE_MS.stageMove * Math.abs(target - at))
    run.current = { from: at, to: target, start: now, ms }
    for (const listener of listeners.current) listener(at, target, ms)
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
    const stop = subscribe((from, to, ms) => {
      const node = ref.current as unknown as Partial<Animatable> | null
      if (typeof node?.animate !== 'function') return
      running.current?.cancel()
      // No length at all — less motion asked for — is simply the end pose,
      // which React has already drawn: nothing to carry it there from.
      if (ms <= 0) return
      running.current = node.animate(moveKeyframes(latestPose.current, from, to), {
        duration: ms,
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

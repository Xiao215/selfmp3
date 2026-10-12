import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated'
import { motion } from '@selfmp3/client'
import { useMotionReduced } from '../motion'

interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * The lit item of a group sliding to the next one rather than jumping: the
 * phone's white tab pill (docs/ui-mock `M2`, 4), the sidebar's highlight
 * (`M3`, 5) and a segmented control's chosen pill.
 *
 * Every item reports where it laid out (`measure`); the highlight is one view
 * behind them all, drawn by the group, that moves from the box it was on to the
 * box it is on now. Until the lit item has laid out there is no highlight to
 * move, and `placed` is false so the item can draw its own fill for that frame.
 *
 * The highlight's box is Reanimated's alone (`Highlight`): React never commits
 * a position for it, so there is no second answer to where it is.
 *
 * Not animated `left` and `width` moved from JavaScript: on the new
 * architecture those writes go past React, and when the arriving page holds
 * the JavaScript thread through the slide, the next commit puts the pill back
 * where it started. Nor a native-driven transform from where JavaScript last
 * heard it was: a phone tells JavaScript where a native move has got to only
 * now and then, so a second tap while the first page is still building would
 * send the pill back to its old tab before it set off.
 */
export function useSlidingHighlight<K extends string>(
  active: K | null,
  style: StyleProp<ViewStyle>,
): {
  measure: (key: K) => (event: LayoutChangeEvent) => void
  placed: boolean
  highlight: ReactNode
} {
  const [boxes, setBoxes] = useState<Partial<Record<K, Box>>>({})
  const measure = useCallback(
    (key: K) => (event: LayoutChangeEvent) => {
      const { x, y, width, height } = event.nativeEvent.layout
      setBoxes(current => {
        const was = current[key]
        if (was && was.x === x && was.y === y && was.width === width && was.height === height) {
          return current
        }
        return { ...current, [key]: { x, y, width, height } }
      })
    },
    [],
  )

  // Where it is going. The same item laid out again (a resize) moves too.
  const target = active === null ? undefined : boxes[active]
  const placed = target !== undefined
  const highlight = target ? <Highlight to={target} style={style} /> : null

  return { measure, placed, highlight }
}

/** The one spring (`M1`), as Reanimated takes it. */
const SPRING = { stiffness: motion.spring.stiffness, damping: motion.spring.damping, mass: 1 }

/**
 * The highlight, from the first box it is placed at.
 *
 * Its place and size are shared values, moved on the UI thread. A new box
 * springs them from wherever they are at that moment, so a second tap during
 * a slide turns the pill rather than snapping it to the first tap's tab and
 * starting again, and the spring keeps its speed through the turn. Nothing
 * asks JavaScript where the highlight is; JavaScript only says where it goes.
 *
 * The size is a width and a height rather than a scale, so the pill's round
 * ends stay round on the way.
 */
function Highlight({ to, style }: { to: Box; style: StyleProp<ViewStyle> }): ReactNode {
  const reduced = useMotionReduced()
  const x = useSharedValue(to.x)
  const y = useSharedValue(to.y)
  const width = useSharedValue(to.width)
  const height = useSharedValue(to.height)
  // The box it was last sent to: a resize that changed nothing is not a move.
  const sent = useRef(to)
  // Before the paint, as everything else the new lit item changes is drawn.
  useLayoutEffect(() => {
    if (sameBox(sent.current, to)) return
    sent.current = to
    const go = (value: SharedValue<number>, end: number): void => {
      value.value = reduced ? end : withSpring(end, SPRING)
    }
    go(x, to.x)
    go(y, to.y)
    go(width, to.width)
    go(height, to.height)
  }, [to, reduced, x, y, width, height])
  const box = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
    width: width.value,
    height: height.value,
  }))
  return <Animated.View pointerEvents="none" style={[style, styles.highlight, box]} />
}

const styles = StyleSheet.create({
  // At the group's corner; the transform puts it on its item.
  highlight: { position: 'absolute', left: 0, top: 0 },
})

/** The same place and size: a resize that changed nothing is not a slide. */
function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

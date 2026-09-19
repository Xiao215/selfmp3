import { useCallback, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated } from 'react-native'
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native'
import { ease, timing } from '../motion'

interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * The lit item of a group sliding to the next one rather than jumping: the
 * phone's white tab pill (docs/ui-mock `M2`, 4) and the sidebar's highlight
 * (`M3`, 5).
 *
 * Every item reports where it laid out (`measure`); the highlight is one view
 * behind them all, drawn by the group, that moves from the box it was on to the
 * box it is on now. Until the lit item has laid out there is no highlight to
 * move, and `placed` is false so the item can draw its own fill for that frame.
 *
 * Position and size, which the native driver cannot move, so this runs on the
 * JavaScript side — a few numbers, for a fifth of a second, on a tap.
 */
export function useSlidingHighlight<K extends string>(
  active: K | null,
  duration: number,
  style: StyleProp<ViewStyle>,
): {
  measure: (key: K) => (event: LayoutChangeEvent) => void
  placed: boolean
  highlight: ReactNode
} {
  const [boxes, setBoxes] = useState<Partial<Record<K, Box>>>({})
  const [progress] = useState(() => new Animated.Value(1))
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

  // Where it is going and where it came from. A new lit item slides from the
  // last one's box; the same item laid out again (a resize) is simply moved.
  const target = active === null ? undefined : boxes[active]
  const [pair, setPair] = useState<{ key: K; from: Box; to: Box } | null>(null)
  if (active !== null && target && pair?.to !== target) {
    const sliding = pair !== null && pair.key !== active
    setPair({ key: active, from: sliding ? pair.to : target, to: target })
  }

  // Before the paint, so the frame the new pair is drawn in starts where the
  // highlight was rather than flashing where it is going.
  useLayoutEffect(() => {
    if (!pair) return
    if (pair.from === pair.to) {
      progress.setValue(1)
      return
    }
    progress.setValue(0)
    timing(progress, 1, duration, undefined, { easing: ease.out, native: false })
  }, [pair, progress, duration])

  const placed = active !== null && target !== undefined && pair !== null
  const between = (a: number, b: number): Animated.AnimatedInterpolation<number> =>
    progress.interpolate({ inputRange: [0, 1], outputRange: [a, b] })
  const highlight =
    placed && pair ? (
      <Animated.View
        pointerEvents="none"
        style={[
          style,
          {
            position: 'absolute',
            left: between(pair.from.x, pair.to.x),
            top: between(pair.from.y, pair.to.y),
            width: between(pair.from.width, pair.to.width),
            height: between(pair.from.height, pair.to.height),
          },
        ]}
      />
    ) : null

  return { measure, placed, highlight }
}

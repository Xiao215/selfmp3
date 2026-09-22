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
 * The highlight is laid out at the box it is going to — plain numbers, from
 * React — and only a transform carries it there from the box it left: a
 * translation for the distance and a scale for any difference in size, both
 * on the native driver. At rest the transform is the identity, so what is on
 * screen is exactly what React last committed, whatever happened in between.
 *
 * It used to be laid out with animated `left` and `width`, moved on the
 * JavaScript side. On the new architecture that meant the slide wrote the
 * view's position past React, and the position React had committed was
 * already the destination; when the page arriving beside the bar held the
 * JavaScript thread through the whole slide — Home's tags and covers on a
 * phone — the next React commit put the pill back where the slide had
 * started, and React, believing the pill was already at its destination,
 * never sent it again. A tab lit on Home under a pill sitting on Library
 * (Xiao's recording, 2026-09-22), and it stayed that way until something
 * else moved the pill. Nothing the highlight owns can now be out of date.
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
    if (!pair || pair.from === pair.to) {
      progress.setValue(1)
      return undefined
    }
    progress.setValue(0)
    const slide = timing(progress, 1, duration, undefined, { easing: ease.out })
    // Whatever ends this slide, it ends at rest: the highlight is a statement
    // about which item is lit, and "between" is not an answer.
    return () => {
      slide?.stop()
      progress.setValue(1)
    }
  }, [pair, progress, duration])

  const placed = active !== null && target !== undefined && pair !== null
  const highlight =
    placed && pair ? (
      <Animated.View
        pointerEvents="none"
        style={[
          style,
          {
            position: 'absolute',
            left: pair.to.x,
            top: pair.to.y,
            width: pair.to.width,
            height: pair.to.height,
            transform: slideTransform(pair.from, pair.to, progress),
          },
        ]}
      />
    ) : null

  return { measure, placed, highlight }
}

/**
 * The transform that shows a view laid out at `to` as if it were at `from`,
 * fading to none as `progress` reaches 1. A view scales about its centre, so
 * the translation is between the two centres and the scale the ratio of the
 * two sizes; applied in that order, the centre lands first and the size
 * follows around it.
 */
function slideTransform(
  from: Box,
  to: Box,
  progress: Animated.Value,
): NonNullable<Animated.WithAnimatedValue<ViewStyle>['transform']> {
  const between = (a: number, b: number): Animated.AnimatedInterpolation<number> =>
    progress.interpolate({ inputRange: [0, 1], outputRange: [a, b] })
  const dx = from.x + from.width / 2 - (to.x + to.width / 2)
  const dy = from.y + from.height / 2 - (to.y + to.height / 2)
  const sx = to.width > 0 ? from.width / to.width : 1
  const sy = to.height > 0 ? from.height / to.height : 1
  return [
    { translateX: between(dx, 0) },
    { translateY: between(dy, 0) },
    { scaleX: between(sx, 1) },
    { scaleY: between(sy, 1) },
  ]
}

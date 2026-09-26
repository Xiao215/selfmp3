import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated } from 'react-native'
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native'
import { spring } from '../motion'

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
 * The highlight is laid out at the box it is going to — plain numbers, from
 * React — and only a transform carries it there from the box it left: a
 * translation between the two centres and a scale for any difference in
 * size, applied in that order so the centre lands first and the size follows
 * around it, both on the native driver. At rest the transform is the
 * identity, so what is on screen is exactly what React last committed,
 * whatever happened in between.
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
  style: StyleProp<ViewStyle>,
): {
  measure: (key: K) => (event: LayoutChangeEvent) => void
  placed: boolean
  highlight: ReactNode
} {
  const [boxes, setBoxes] = useState<Partial<Record<K, Box>>>({})
  const [progress] = useState(() => new Animated.Value(1))
  // The slide, as nodes built once: how far the highlight is from its box
  // (`dx`, `dy`) and how much bigger or smaller it was (`sx`, `sy`, less one),
  // each fading to nothing as `progress` reaches 1. A new slide is four
  // numbers sent to them, not four nodes rebuilt for every render.
  const [slide] = useState(() => {
    const dx = new Animated.Value(0)
    const dy = new Animated.Value(0)
    const sx = new Animated.Value(0)
    const sy = new Animated.Value(0)
    const left = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })
    return {
      dx,
      dy,
      sx,
      sy,
      transform: [
        { translateX: Animated.multiply(left, dx) },
        { translateY: Animated.multiply(left, dy) },
        { scaleX: Animated.add(1, Animated.multiply(left, sx)) },
        { scaleY: Animated.add(1, Animated.multiply(left, sy)) },
      ],
    }
  })
  // Where the highlight was last sent, and how far along that slide it is,
  // read back from the value: a new slide begins from wherever this one was
  // cut off. Kept out of the render, which reads none of it.
  const last = useRef<{ from: Box; to: Box } | null>(null)
  const at = useRef(1)
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

  // Where it is going. A new lit item slides from wherever the highlight is
  // *now* — the last box it was sent to, less the part of that slide it has
  // not made yet — so a second tap during a slide turns the pill rather than
  // snapping it to the first tap's tab and starting again. The same item
  // laid out again (a resize) is simply moved.
  const target = active === null ? undefined : boxes[active]
  const [pair, setPair] = useState<{ key: K; to: Box } | null>(null)
  if (active !== null && target && pair?.to !== target) setPair({ key: active, to: target })

  // Before the paint, so the frame the new pair is drawn in starts where the
  // highlight was rather than flashing where it is going. The move is the one
  // spring (`M1`): a spring sent to a new end carries its speed with it, so a
  // slide interrupted by another tab keeps going rather than restarting.
  useLayoutEffect(() => {
    if (!pair) return undefined
    const was = last.current
    const sliding = was !== null && was.to !== pair.to && !sameBox(was.to, pair.to)
    const from = sliding ? boxBetween(was.from, was.to, at.current) : pair.to
    last.current = { from, to: pair.to }
    if (!sliding) {
      progress.setValue(1)
      at.current = 1
      return undefined
    }
    slide.dx.setValue(from.x + from.width / 2 - (pair.to.x + pair.to.width / 2))
    slide.dy.setValue(from.y + from.height / 2 - (pair.to.y + pair.to.height / 2))
    slide.sx.setValue(pair.to.width > 0 ? from.width / pair.to.width - 1 : 0)
    slide.sy.setValue(pair.to.height > 0 ? from.height / pair.to.height - 1 : 0)
    progress.setValue(0)
    at.current = 0
    const follow = progress.addListener(({ value }) => {
      at.current = value
    })
    const move = spring(progress, 1)
    return () => {
      progress.removeListener(follow)
      move?.stop()
    }
  }, [pair, progress, slide])

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
            transform: slide.transform,
          },
        ]}
      />
    ) : null

  return { measure, placed, highlight }
}

/** Where a highlight sliding from `from` to `to` is at `progress` of the way. */
function boxBetween(from: Box, to: Box, progress: number): Box {
  const p = Math.max(0, Math.min(1, progress))
  return {
    x: from.x + (to.x - from.x) * p,
    y: from.y + (to.y - from.y) * p,
    width: from.width + (to.width - from.width) * p,
    height: from.height + (to.height - from.height) * p,
  }
}

/** The same place and size: a resize that changed nothing is not a slide. */
function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

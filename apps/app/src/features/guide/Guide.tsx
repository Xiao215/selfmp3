import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the dark layer is the whole tip and any tap closes it: a pressed look would light the screen it darkens
import { Animated, Easing, Pressable, Text, View, useWindowDimensions } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { Path, Rect, Svg } from 'react-native-svg'
import { leading, motion, space, type } from '@selfmp3/client'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useLayout } from '../../shell/useLayout'
import { nativeDriver, useMotionReduced, usePresence } from '../../ui/motion'
import { Music } from '../../ui/components/Icons'
import { holeAround, layerPath, placeWords, type Box } from './guide.model'
import type { GuideHandle } from './useGuide'

/**
 * What the hand acts out.
 *
 * - `hold-move`: press, then carry the thing one `distance` down and back.
 * - `hold`: press and keep pressing.
 * - `tap`: a quick press.
 * - `swipe-left`: press and pull `distance` to the left, then let it go back.
 * - `swipe-up`: a flick `distance` up from the spot.
 * - `drag-to`: carry a song from `from` (points off the spotlight's centre)
 *   into the spotlight.
 *
 * With a mouse the hand is a pointer, and holding is just pressing.
 */
type GuideGesture = 'hold-move' | 'hold' | 'tap' | 'swipe-left' | 'swipe-up' | 'drag-to'

interface GuideStep {
  readonly gesture: GuideGesture
  readonly text: string
  readonly sub?: string
  readonly distance?: number
}

/** One round of a gesture; the round repeats until the layer is tapped. */
const ROUND_MS = 3400

/** Always dark, whatever the theme: the spotlight only reads against a dark room. */
const LAYER = 'rgba(5, 6, 10, 0.86)'
const INK = '#ffffff'
const INK_SOFT = 'rgba(255, 255, 255, 0.74)'

const HAND = 46
/** Where the fingertip sits in the hand, so the tip and not the corner lands on the spot. */
const TIP = { x: 22, y: 11 }
const POINTER = 22
const POINTER_TIP = { x: 4, y: 2 }

/** The lit thing follows the hand: the row a hold-move lifts. */
export function liftWith(guide: GuideHandle, distance: number): object {
  return {
    transform: [
      { translateY: guide.demo.interpolate(frames.move(distance)) },
      {
        scale: guide.demo.interpolate({
          inputRange: [0, 0.12, 0.2, 0.78, 0.86, 1],
          outputRange: [1, 1, 1.03, 1.03, 1, 1],
        }),
      },
    ],
    zIndex: 2,
  }
}

/** The row a hold-move passes steps out of the way, the other way. */
export function makeRoomWith(guide: GuideHandle, distance: number): object {
  return { transform: [{ translateY: guide.demo.interpolate(frames.move(-distance)) }] }
}

/** The row a swipe pulls slides with the hand, showing what is behind it. */
export function slideWith(guide: GuideHandle, distance: number): object {
  return { transform: [{ translateX: guide.demo.interpolate(frames.slide(-distance)) }] }
}

/** The cover a flick up lifts a little, the way the real pull begins. */
export function riseWith(guide: GuideHandle, distance: number): object {
  return {
    transform: [
      {
        translateY: guide.demo.interpolate({
          inputRange: [0, 0.16, 0.46, 0.58, 0.76, 1],
          outputRange: [0, 0, -distance, -distance, 0, 0],
        }),
      },
    ],
  }
}

const frames = {
  move: (d: number) => ({
    inputRange: [0, 0.28, 0.48, 0.62, 0.8, 1],
    outputRange: [0, 0, d, d, 0, 0],
  }),
  slide: (d: number) => ({
    inputRange: [0, 0.2, 0.46, 0.6, 0.8, 1],
    outputRange: [0, 0, d, d, 0, 0],
  }),
  press: { inputRange: [0, 0.08, 0.16, 0.78, 0.86, 1], outputRange: [1, 1, 0.88, 0.88, 1, 1] },
  tap: { inputRange: [0, 0.2, 0.26, 0.34, 1], outputRange: [1, 1, 0.86, 1, 1] },
  ring: { inputRange: [0, 0.1, 0.16, 0.36, 1], outputRange: [0, 0, 0.9, 0, 0] },
  tapRing: { inputRange: [0, 0.24, 0.3, 0.5, 1], outputRange: [0, 0, 0.9, 0, 0] },
  ringGrow: { inputRange: [0, 0.1, 0.36, 1], outputRange: [0.5, 0.5, 1.8, 1.8] },
}

/**
 * The guide itself, drawn at the root over everything (`useOverlay`): the
 * layer with the spotlight cut round `guide.target`, the hand going through
 * the gesture, and the words. Any tap closes it, or moves to the next step;
 * that tap does nothing else, so the song under the spotlight does not start.
 * Escape closes it on a computer. Under Reduce Motion the hand holds still.
 */
export function Guide({
  guide,
  steps,
  at = { x: 0.72, y: 0.5 },
  radius = 14,
  reach = 0,
  inline = false,
}: {
  guide: GuideHandle
  steps: readonly GuideStep[]
  /** Where in the lit thing the gesture happens, as fractions of its size. */
  at?: { x: number; y: number }
  radius?: number
  /** Light this much more below the target: the row a moved row goes to. */
  reach?: number
  /**
   * Drawn where it is placed rather than at the root: for a page that is a
   * native modal over the shell (Now Playing on a phone), which the root's
   * layer would sit under. Placed last in a page that fills the screen.
   */
  inline?: boolean
}): ReactNode {
  const window = useWindowDimensions()
  const { finePointer } = useLayout()
  const reduced = useMotionReduced()
  const { mounted, progress } = usePresence(guide.shown, motion.slow, motion.base)
  const [last, setLast] = useState<Box | null>(guide.box)
  if (guide.box !== null && guide.box !== last) setLast(guide.box)
  const host = useRef<View>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!guide.shown || reduced) return undefined
    guide.demo.setValue(0)
    const round = Animated.loop(
      Animated.timing(guide.demo, {
        toValue: 1,
        duration: ROUND_MS,
        easing: Easing.linear,
        useNativeDriver: nativeDriver,
      }),
    )
    round.start()
    return () => {
      round.stop()
      guide.demo.setValue(0)
    }
  }, [guide.shown, guide.demo, reduced])

  const close = (): void => {
    if (guide.step + 1 < steps.length) guide.next(steps.length)
    else guide.dismiss()
  }
  useEscape(guide.shown, guide.dismiss, { layer: true })

  const step = steps[Math.max(0, Math.min(guide.step, steps.length - 1))]
  let node: ReactNode = null
  if (mounted && last !== null && step !== undefined) {
    const screen = { width: window.width, height: window.height }
    const target = { ...last, x: last.x - offset.x, y: last.y - offset.y }
    const hole = holeAround({ ...target, height: target.height + reach }, screen)
    const words = placeWords(hole, screen)
    const spot = { x: target.x + target.width * at.x, y: target.y + target.height * at.y }
    node = (
      <Animated.View
        ref={host}
        style={[StyleSheet.absoluteFill, { opacity: progress }]}
        onLayout={() =>
          host.current?.measureInWindow((x, y) => {
            if (x !== offset.x || y !== offset.y) setOffset({ x, y })
          })
        }
        testID="guide"
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={step.sub ? `${step.text}. ${step.sub}` : step.text}
          accessibilityHint={
            guide.step + 1 < steps.length ? 'Shows the next tip' : 'Closes the tip'
          }
          accessibilityLiveRegion="polite"
          testID={`guide-${guide.name}`}
        >
          <Svg width={screen.width} height={screen.height} style={StyleSheet.absoluteFill}>
            <Path d={layerPath(screen, hole, radius)} fill={LAYER} fillRule="evenodd" />
            <Rect
              x={hole.x}
              y={hole.y}
              width={hole.width}
              height={hole.height}
              rx={radius}
              fill="none"
              stroke={INK}
              strokeOpacity={0.75}
              strokeWidth={1.5}
              strokeDasharray="5 5"
            />
          </Svg>
          <Gesture step={step} spot={spot} hole={hole} demo={guide.demo} pointer={finePointer} />
          <View
            style={[
              styles.words,
              words.kind === 'above'
                ? { bottom: words.bottom, left: words.left, width: words.width }
                : { top: words.top, left: words.left, width: words.width },
              words.kind === 'beside' && { alignItems: 'flex-start' },
            ]}
            pointerEvents="none"
          >
            <Text style={[styles.text, words.kind === 'beside' && styles.left]}>{step.text}</Text>
            {step.sub ? (
              <Text style={[styles.sub, words.kind === 'beside' && styles.left]}>{step.sub}</Text>
            ) : null}
            {steps.length > 1 ? (
              <View style={styles.steps}>
                {steps.map((_, index) => (
                  <View key={index} style={[styles.dot, index === guide.step && styles.dotOn]} />
                ))}
              </View>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    )
  }
  useOverlay(inline ? null : node, mounted && !inline)
  return inline ? node : null
}

/** The hand (or, with a mouse, the pointer) going through one round of the gesture. */
function Gesture({
  step,
  spot,
  hole,
  demo,
  pointer,
}: {
  step: GuideStep
  spot: { x: number; y: number }
  hole: Box
  demo: Animated.Value
  pointer: boolean
}): ReactNode {
  const d = step.distance ?? 56
  const size = pointer ? POINTER : HAND
  const tip = pointer ? POINTER_TIP : TIP

  if (step.gesture === 'drag-to') {
    // From off to the right of the spotlight into its middle, carrying a song.
    const from = { x: hole.x + hole.width + 260, y: hole.y + hole.height / 2 + 40 }
    const to = { x: hole.x + hole.width / 2, y: hole.y + hole.height / 2 }
    const along = { inputRange: [0, 0.14, 0.5, 0.76, 0.78, 1] }
    const x = demo.interpolate({
      ...along,
      outputRange: [0, 0, to.x - from.x, to.x - from.x, 0, 0],
    })
    const y = demo.interpolate({
      ...along,
      outputRange: [0, 0, to.y - from.y, to.y - from.y, 0, 0],
    })
    const seen = demo.interpolate({
      inputRange: [0, 0.6, 0.68, 0.84, 0.92, 1],
      outputRange: [1, 1, 0, 0, 1, 1],
    })
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          styles.carry,
          {
            left: from.x - tip.x,
            top: from.y - tip.y,
            opacity: seen,
            transform: [{ translateX: x }, { translateY: y }],
          },
        ]}
      >
        <View style={styles.ghost}>
          <Music size={14} color={INK} />
          <View style={styles.ghostLine} />
        </View>
        <View style={styles.ghostHand}>{pointer ? <PointerShape /> : <HandShape />}</View>
      </Animated.View>
    )
  }

  const press = demo.interpolate(step.gesture === 'tap' ? frames.tap : frames.press)
  const motionStyle =
    step.gesture === 'hold-move'
      ? [{ translateY: demo.interpolate(frames.move(d)) }]
      : step.gesture === 'swipe-left'
        ? [{ translateX: demo.interpolate(frames.slide(-d)) }]
        : step.gesture === 'swipe-up'
          ? [
              {
                translateY: demo.interpolate({
                  inputRange: [0, 0.16, 0.46, 0.6, 0.62, 1],
                  outputRange: [0, 0, -d, -d, 0, 0],
                }),
              },
            ]
          : []
  const handSeen =
    step.gesture === 'swipe-up'
      ? demo.interpolate({
          inputRange: [0, 0.46, 0.54, 0.84, 0.92, 1],
          outputRange: [1, 1, 0, 0, 1, 1],
        })
      : 1
  const ring = step.gesture === 'tap' ? frames.tapRing : frames.ring
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            left: spot.x - RING / 2,
            top: spot.y - RING / 2,
            opacity: demo.interpolate(ring),
            transform: [{ scale: demo.interpolate(frames.ringGrow) }],
          },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: spot.x - tip.x,
          top: spot.y - tip.y,
          width: size,
          height: size,
          opacity: handSeen,
          transform: [...motionStyle, { scale: press }],
        }}
      >
        {pointer ? <PointerShape /> : <HandShape />}
      </Animated.View>
    </>
  )
}

const RING = 34

/** A pointing hand, its fingertip touching: drawn on the 24 grid like the app's icons. */
function HandShape(): ReactNode {
  return (
    <Svg width={HAND} height={HAND} viewBox="0 0 24 24">
      <Path
        fill={INK}
        stroke="#0b0d12"
        strokeWidth={0.5}
        d="M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z"
      />
    </Svg>
  )
}

function PointerShape(): ReactNode {
  return (
    <Svg width={POINTER} height={POINTER} viewBox="0 0 24 24">
      <Path d="M4 2l14 11h-7l4 8-3 1.5-4-8-4 4z" fill={INK} stroke="#0b0d12" strokeWidth={1} />
    </Svg>
  )
}

const styles = StyleSheet.create({
  words: { position: 'absolute', alignItems: 'center', gap: space.xs },
  text: {
    color: INK,
    fontSize: type.title,
    lineHeight: leading.title,
    fontWeight: '700',
    textAlign: 'center',
  },
  sub: { color: INK_SOFT, fontSize: type.sub, lineHeight: leading.sub, textAlign: 'center' },
  left: { textAlign: 'left' },
  steps: { flexDirection: 'row', gap: 6, marginTop: space.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255, 255, 255, 0.3)' },
  dotOn: { backgroundColor: INK },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2,
    borderColor: INK,
  },
  carry: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-start' },
  ghost: {
    position: 'absolute',
    left: -18,
    top: -14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#2a2e3a',
  },
  ghostLine: { width: 72, height: 6, borderRadius: 3, backgroundColor: 'rgba(255, 255, 255, 0.5)' },
  ghostHand: { position: 'absolute', left: 0, top: 0 },
})

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the dark layer is the whole tip and any tap closes it: a pressed look would light the screen it darkens
import { Animated, Easing, Pressable, Text, View, useWindowDimensions } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { Defs, LinearGradient, Path, Rect, Stop, Svg } from 'react-native-svg'
import { leading, motion, space, type } from '@selfmp3/client'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useLayoutFlags } from '../../shell/useLayout'
import { nativeDriver, useMotionReduced, usePresence } from '../../ui/motion'
import { Music } from '../../ui/components/Icons'
import { useSvgId } from '../../ui/useSvgId'
import { holeAround, layerPath, placeWords, type Box } from './guide.model'
import type { GuideHandle } from './useGuide'

/**
 * What the touch acts out: a finger's circle, the way iOS draws one in a
 * screen recording (H1, Xiao 2026-10-13, over a drawn hand that read as clip
 * art), leaving a fading streak where it swipes.
 *
 * - `hold-move`: press, then carry the thing one `distance` down and back.
 * - `hold`: press and keep pressing.
 * - `tap`: a quick press.
 * - `swipe-left`: press and pull `distance` to the left, then let it go back.
 * - `swipe-up`: a flick `distance` up from the spot.
 * - `drag-to`: carry a song from `from` (points off the spotlight's centre)
 *   into the spotlight.
 *
 * With a mouse it is a pointer, and holding is just pressing.
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

const TOUCH = 30
/** The touch's middle, so its middle and not its corner lands on the spot. */
const TIP = { x: TOUCH / 2, y: TOUCH / 2 }
/** How thick a swipe's streak is. */
const STREAK = 14
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

/**
 * A swipeable the guide opens and shuts in step with the hand, for a row
 * whose actions only the swipeable itself can show (Import's Next and
 * Remove): opened as the hand pulls left, shut as it lets go.
 */
export function useOpenWith(guide: GuideHandle | null, open: () => void, shut: () => void): void {
  const acts = useRef({ open, shut })
  useEffect(() => {
    acts.current = { open, shut }
  })
  const on = guide !== null && guide.shown && guide.step === 0
  const demo = guide?.demo
  useEffect(() => {
    if (!on || demo === undefined) return undefined
    let opened = false
    const listener = demo.addListener(({ value }) => {
      const want = value >= PULL && value < LET_GO
      if (want === opened) return
      opened = want
      if (want) acts.current.open()
      else acts.current.shut()
    })
    return () => {
      demo.removeListener(listener)
      acts.current.shut()
    }
  }, [on, demo])
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

/** When in a round a swipe's hand starts pulling, and when it lets go. */
const PULL = 0.2
const LET_GO = 0.6

const frames = {
  move: (d: number) => ({
    inputRange: [0, 0.28, 0.48, 0.62, 0.8, 1],
    outputRange: [0, 0, d, d, 0, 0],
  }),
  slide: (d: number) => ({
    inputRange: [0, PULL, 0.46, LET_GO, 0.8, 1],
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
  const { finePointer } = useLayoutFlags()
  const reduced = useMotionReduced()
  const { mounted, progress } = usePresence(guide.shown, motion.slow, motion.base)
  const [last, setLast] = useState<Box | null>(guide.box)
  if (guide.box !== null && guide.box !== last) setLast(guide.box)
  const host = useRef<View>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  // Each step starts its own round: moving on stops the last one (`useGuide`).
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
  }, [guide.shown, guide.step, guide.demo, reduced])

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
  const size = pointer ? POINTER : TOUCH
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
        <View style={styles.ghostHand}>{pointer ? <PointerShape /> : <TouchShape />}</View>
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
      {pointer ? null : step.gesture === 'swipe-left' ? (
        <Streak spot={spot} length={d} demo={demo} across />
      ) : step.gesture === 'swipe-up' ? (
        <Streak spot={spot} length={d} demo={demo} across={false} />
      ) : null}
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
        {pointer ? <PointerShape /> : <TouchShape />}
      </Animated.View>
    </>
  )
}

const RING = 34

/** A finger on the glass: a pale disc with a bright rim. */
function TouchShape(): ReactNode {
  return <View style={styles.touch} />
}

/**
 * Where a swipe has been: a streak from the spot to the touch, brightest at
 * the touch, growing with it and fading once it lets go. `across` for a swipe
 * left; otherwise a flick up.
 */
function Streak({
  spot,
  length,
  demo,
  across,
}: {
  spot: { x: number; y: number }
  length: number
  demo: Animated.Value
  across: boolean
}): ReactNode {
  const id = useSvgId('streak')
  // When in the round it starts, is longest, and is gone: the gesture's own frames.
  const at = across
    ? { start: PULL, full: 0.46, gone: LET_GO }
    : { start: 0.16, full: 0.46, gone: 0.56 }
  // Never quite 0: a transform scaled to nothing cannot be inverted on iOS.
  const grown = demo.interpolate({
    inputRange: [0, at.start, at.full, at.gone + 0.04, at.gone + 0.05, 1],
    outputRange: [0.001, 0.001, 1, 1, 0.001, 0.001],
  })
  // Scaled about its middle, then moved so the end at the spot stays put.
  const keep = Animated.multiply(Animated.add(1, Animated.multiply(grown, -1)), length / 2)
  const seen = demo.interpolate({
    inputRange: [0, at.start, at.start + 0.03, at.full, at.gone, 1],
    outputRange: [0, 0, 1, 1, 0, 0],
  })
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        across
          ? { left: spot.x - length, top: spot.y - STREAK / 2, width: length, height: STREAK }
          : { left: spot.x - STREAK / 2, top: spot.y - length, width: STREAK, height: length },
        styles.streak,
        {
          opacity: seen,
          transform: across
            ? [{ translateX: keep }, { scaleX: grown }]
            : [{ translateY: keep }, { scaleY: grown }],
        },
      ]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2={across ? '1' : '0'} y2={across ? '0' : '1'}>
            <Stop offset="0" stopColor={INK} stopOpacity={0} />
            <Stop offset="1" stopColor={INK} stopOpacity={0.5} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="1" height="1" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
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
  // Under the touch's middle, its music note just left of it.
  ghost: {
    position: 'absolute',
    left: -11,
    top: 0,
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
  touch: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    backgroundColor: 'rgba(255, 255, 255, 0.42)',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)',
  },
  streak: { position: 'absolute', borderRadius: STREAK / 2, overflow: 'hidden' },
})

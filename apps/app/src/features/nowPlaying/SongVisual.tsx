import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { StyleSheet, View, Image } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg'
import type { Song } from '@selfmp3/shared'
import { radius } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import type { MotionSampler } from './motionSource'
import { useReducedMotion } from '../../ui/useReducedMotion'
import { useVisualLook } from './useVisualLook'
import {
  createMotionState,
  HILL_LAYERS,
  hillPoints,
  hillShare,
  hillShift,
  MAX_RINGS,
  PlayheadClock,
  ringFade,
  ringReach,
  stepMotion,
  stillMotion,
  type MotionState,
  type MotionTuning,
} from './visualMotion.model'
import {
  horizonColors,
  RING_FROM,
  RING_TO,
  rgbCss,
  rippleDisc,
  sunPlace,
  type VisualColors,
  type VisualKind,
} from './visuals.model'

export interface SongVisualProps {
  song: Song
  kind: VisualKind
  /** What the visual follows: the song's curve on a phone, or its tempo (`useMotionSampler`). */
  sampler: MotionSampler
  /** Round the corners, for a visual in a box rather than one filling the screen. */
  rounded?: boolean
  /** The song's cover: Ripples' disc is the cover itself (docs/ui-mock `P24`). */
  cover?: string | null
}

/**
 * A song's visual on a phone (and an iPad): plain views, moved once a frame.
 * The browser's is `SongVisual.web.tsx`, a canvas.
 *
 * A phone's player gives no sound to listen to, so the visual follows the
 * song's stored motion curve (or, for a song with none, its tempo) against
 * the playhead. The playhead only ticks once a second here, a whole bar of
 * music, so a `PlayheadClock` runs on between ticks and snaps to each one.
 *
 * One `requestAnimationFrame` loop on the JavaScript thread steps the motion
 * (`visualMotion.model.ts`, the same steps the browser takes) and writes every
 * number a style moves into one Reanimated shared value, once a frame. Each
 * view's `useAnimatedStyle` reads its numbers from that array on the UI
 * thread and sets the view's opacity and transform there directly: no React
 * render, and no shadow-tree commit. (It used to set a few dozen
 * `Animated.Value`s a frame; on the New Architecture each `setValue` is a
 * `setNativeProps`, which is a commit of the whole shadow tree — a dozen to
 * twenty of them a frame, on the thread that also has to answer a tap.)
 *
 * Every moving thing is a transform or an opacity, which the UI thread sets
 * without a layout. Horizon's hills are the one shape that changes, so they
 * are not drawn as paths: each point of a line is a view holding the same
 * rounded cap, raised or lowered to its level, and the caps side by side
 * make the ridge (their union is the line through the points, with a soft
 * dip between equal ones and a crease in a valley, as hills have).
 *
 * Nothing is written once a paused visual has settled. Reduce Motion writes
 * one still frame.
 */
export function SongVisual({
  song,
  kind,
  sampler,
  rounded = false,
  cover = null,
}: SongVisualProps): ReactNode {
  const player = usePlayer()
  const reduced = useReducedMotion()
  const [size, setSize] = useState<Size | null>(null)
  const { colors, tuning } = useVisualLook(song)
  const frame = useSharedValue<readonly number[]>(EMPTY_FRAME)
  const ringWidths = useSharedValue<readonly number[]>(NO_RINGS)
  const [drawn] = useState(makeDrawn)
  const [clock] = useState(() => new PlayheadClock())
  const edge = colors.ground[1]

  const live = useRef({ player, sampler, tuning })
  useEffect(() => {
    live.current = { player, sampler, tuning }
  })

  // The clock: each progress tick (and a seek, which arrives as one), play and pause, and the rate.
  const { subscribeProgress, getPosition, isPlaying, rate } = player
  useEffect(() => {
    clock.tick(getPosition(), performance.now())
    return subscribeProgress(() => clock.tick(getPosition(), performance.now()))
  }, [clock, subscribeProgress, getPosition])
  useEffect(() => clock.setPlaying(isPlaying, performance.now()), [clock, isPlaying])
  useEffect(() => clock.setRate(rate, performance.now()), [clock, rate])

  useEffect(() => {
    if (!size || !reduced) return
    const motion = createMotionState(tuning.feel.loudness)
    stillMotion(motion, tuning, sampler.source)
    write(kind, motion, drawn, tuning, size, true, frame, ringWidths)
  }, [kind, reduced, size, tuning, sampler.source, drawn, frame, ringWidths])

  useEffect(() => {
    if (!size || reduced) return undefined
    const motion = createMotionState(live.current.tuning.feel.loudness)
    let last = performance.now()
    let handle = 0
    // The frame outlives a style: a paused Ripples left it settled, and a style
    // picked then must still write its first frame, or Horizon never raises its hills.
    let first = true
    const tick = (): void => {
      handle = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { player: p, sampler: s, tuning: tu } = live.current
      stepMotion(motion, s, clock.read(now), dt, p.isPlaying, tu)
      write(kind, motion, drawn, tu, size, first, frame, ringWidths)
      first = false
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [kind, reduced, size, drawn, clock, frame, ringWidths])

  return (
    <View
      pointerEvents="none"
      style={[styles.fill, { backgroundColor: rgbCss(edge) }, rounded && styles.rounded]}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout
        setSize(current =>
          current?.width === width && current.height === height ? current : { width, height },
        )
      }}
    >
      {size ? (
        kind === 'horizon' ? (
          <Horizon size={size} colors={colors} frame={frame} />
        ) : (
          <Ripples
            size={size}
            colors={colors}
            frame={frame}
            ringWidths={ringWidths}
            cover={cover}
          />
        )
      ) : null}
    </View>
  )
}

interface Size {
  width: number
  height: number
}

/*
 * Where each moving number sits in a frame. One array holds both styles'
 * numbers, so a frame is one write from the JavaScript thread however many
 * views move; each view's style reads its own few.
 */
/** Per ring: scale, opacity. Its width is a layout prop and travels apart (`ringWidths`). */
const RING_AT = 0
const RING_SIZE = 2
const DISC_AT = RING_AT + MAX_RINGS * RING_SIZE
const HALO_AT = DISC_AT + 1
/** The sun's scale, then its glow's opacity. */
const SUN_AT = HALO_AT + 1
/** Per hill line: how far it has moved left, in points, then each point's drop below its peak. */
const HILL_AT = SUN_AT + 2
const HILL_OFFSETS: number[] = []
let hillEnd = HILL_AT
for (const layer of HILL_LAYERS) {
  HILL_OFFSETS.push(hillEnd)
  hillEnd += 1 + hillPoints(layer.gaps)
}
const FRAME_LENGTH = hillEnd

const EMPTY_FRAME: readonly number[] = Array.from({ length: FRAME_LENGTH }, () => 0)
const NO_RINGS: readonly number[] = Array.from({ length: MAX_RINGS }, () => 2)

type Frame = SharedValue<readonly number[]>

/** What the loop remembers between frames, made once per visual. */
interface Drawn {
  /** The frame being filled in, written to the shared value as a copy. */
  out: number[]
  /** Each ring view's border width, sent only when a new ring takes the view. */
  widths: number[]
  /** Which ring each ring view last showed, so its width is set once, when a new ring takes it. */
  ringIds: number[]
  /** Whether the last frame written was a settled, silent one. */
  settled: boolean
}

function makeDrawn(): Drawn {
  return {
    out: [...EMPTY_FRAME],
    widths: [...NO_RINGS],
    ringIds: Array.from({ length: MAX_RINGS }, () => -1),
    settled: false,
  }
}

/** Whether the showing style has anything left to move. Horizon's hills roll on while it plays. */
function isSettled(kind: VisualKind, m: MotionState): boolean {
  if (m.glow > 0.002 || m.kick > 0.002 || m.flash > 0.002 || m.swell > 0.002) return false
  return kind === 'horizon' ? !m.travelled : m.rings.length === 0
}

/** Writes this frame into the shared value the showing style reads. */
function write(
  kind: VisualKind,
  m: MotionState,
  drawn: Drawn,
  tu: MotionTuning,
  size: Size,
  force: boolean,
  frame: Frame,
  ringWidths: Frame,
): void {
  const settled = isSettled(kind, m)
  if (settled && drawn.settled && !force) return
  drawn.settled = settled
  const out = drawn.out
  const g = m.glow
  if (kind === 'horizon') {
    out[SUN_AT] = 0.94 + 0.08 * g + 0.14 * m.swell
    out[SUN_AT + 1] = Math.min(1, 0.35 + 0.4 * g + 0.25 * m.flash)
    HILL_LAYERS.forEach((layer, index) => {
      const trail = m.hills[index]!
      const at = HILL_OFFSETS[index]!
      const rise = size.height * layer.rise
      out[at] = -hillShift(trail) * (size.width / layer.gaps)
      for (let i = 0; i < trail.levels.length; i++)
        out[at + 1 + i] = rise * (1 - hillShare(trail.levels[i] ?? 0))
    })
  } else {
    let widthsChanged = false
    for (let slot = 0; slot < MAX_RINGS; slot++) {
      const at = RING_AT + slot * RING_SIZE
      const ring = m.rings.find(candidate => candidate.id % MAX_RINGS === slot)
      if (!ring) {
        out[at + 1] = 0
        continue
      }
      if (drawn.ringIds[slot] !== ring.id) {
        drawn.ringIds[slot] = ring.id
        drawn.widths[slot] = 1.5 + 1.5 * ring.strength
        widthsChanged = true
      }
      out[at] = RING_FROM + (RING_TO - RING_FROM) * ringReach(ring, tu)
      out[at + 1] = ringFade(ring, tu) * 0.85
    }
    if (widthsChanged || force) ringWidths.value = drawn.widths.slice()
    out[DISC_AT] = 1 + 0.06 * m.kick
    out[HALO_AT] = Math.min(1, 0.15 + 0.45 * g + 0.3 * m.kick)
  }
  // A copy: the shared value is handed to the UI thread after this frame's
  // work, and `out` is filled in again on the next.
  frame.value = out.slice()
}

interface StyleProps {
  size: Size
  colors: VisualColors
  frame: Frame
}

/*
 * Horizon (P23): a dusk sky in the song's colours, a sun that swells on each
 * hit, and three hill lines drawn from the loudness heard, rolling left.
 */
function Horizon({ size, colors, frame }: StyleProps): ReactNode {
  const look = horizonColors(colors)
  const sun = sunPlace(size.width, size.height)
  const glow = sun.d * 2.6
  const sunStyle = useAnimatedStyle(() => ({ transform: [{ scale: frame.value[SUN_AT] ?? 1 }] }))
  const glowStyle = useAnimatedStyle(() => ({ opacity: frame.value[SUN_AT + 1] ?? 0.5 }))
  const sunInk = rgbCss(look.sun)
  return (
    <>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="horizon-sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={rgbCss(look.sky[0])} stopOpacity={1} />
            <Stop offset="0.42" stopColor={rgbCss(look.sky[1])} stopOpacity={1} />
            <Stop offset="0.74" stopColor={rgbCss(look.sky[2])} stopOpacity={1} />
            <Stop offset="1" stopColor={rgbCss(look.sky[3])} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#horizon-sky)" />
      </Svg>
      <Animated.View
        style={[
          styles.at,
          { left: sun.x - glow / 2, top: sun.y - glow / 2, width: glow, height: glow },
          glowStyle,
        ]}
      >
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="horizon-glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0.3" stopColor={sunInk} stopOpacity={0.45} />
              <Stop offset="1" stopColor={sunInk} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx="50%" cy="50%" r="50%" fill="url(#horizon-glow)" />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[
          styles.at,
          {
            left: sun.x - sun.d / 2,
            top: sun.y - sun.d / 2,
            width: sun.d,
            height: sun.d,
            borderRadius: sun.d / 2,
            backgroundColor: sunInk,
          },
          sunStyle,
        ]}
      />
      {HILL_LAYERS.map((layer, index) => (
        <HillLine
          key={index}
          index={index}
          size={size}
          ink={rgbCss(look.hills[index]!)}
          frame={frame}
        />
      ))}
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="horizon-foot" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.6" stopColor={rgbCss(look.foot)} stopOpacity={0} />
            <Stop offset="0.86" stopColor={rgbCss(look.foot)} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#horizon-foot)" />
      </Svg>
    </>
  )
}

/**
 * One hill line: a row of caps that moves left by the share of a point the
 * line has travelled, each cap lowered from its peak by its point's level.
 */
function HillLine({
  index,
  size,
  ink,
  frame,
}: {
  index: number
  size: Size
  ink: string
  frame: Frame
}): ReactNode {
  const layer = HILL_LAYERS[index]!
  const at = HILL_OFFSETS[index]!
  const gap = size.width / layer.gaps
  const rise = size.height * layer.rise
  const peak = size.height * layer.base - rise
  // A cap is a parabola four gaps wide with straight sides below it: two
  // equal neighbours meet a quarter of `bow` down, and its sides are always
  // hidden, sitting lower than any neighbour can.
  const bow = rise * 0.35
  const tall = size.height - peak + rise
  const cap = `M0 ${4 * bow} Q ${2 * gap} ${-4 * bow} ${4 * gap} ${4 * bow} L ${4 * gap} ${tall} L 0 ${tall} Z`
  const moving = useAnimatedStyle(() => ({ transform: [{ translateX: frame.value[at] ?? 0 }] }))
  return (
    <Animated.View style={[styles.line, moving]}>
      {Array.from({ length: hillPoints(layer.gaps) }, (_, point) => (
        <HillCap
          key={point}
          at={at + 1 + point}
          left={(point - 1) * gap - 2 * gap}
          top={peak}
          width={4 * gap}
          height={tall}
          path={cap}
          ink={ink}
          frame={frame}
        />
      ))}
    </Animated.View>
  )
}

function HillCap({
  at,
  left,
  top,
  width,
  height,
  path,
  ink,
  frame,
}: {
  at: number
  left: number
  top: number
  width: number
  height: number
  path: string
  ink: string
  frame: Frame
}): ReactNode {
  const moving = useAnimatedStyle(() => ({ transform: [{ translateY: frame.value[at] ?? 0 }] }))
  return (
    <Animated.View style={[styles.at, { left, top, width, height }, moving]}>
      <Svg width={width} height={height}>
        <Path d={path} fill={ink} />
      </Svg>
    </Animated.View>
  )
}

/*
 * Ripples (P24): the cover as a disc that kicks on each hit and
 * sends a ring out from behind it, as strong as the hit; a halo that glows
 * with the level; the cover's colours washed faintly over the ground.
 */
function Ripples({
  size,
  colors,
  frame,
  ringWidths,
  cover,
}: StyleProps & { ringWidths: Frame; cover: string | null }): ReactNode {
  const disc = rippleDisc(size.width, size.height)
  const halo = disc * 1.9
  const [middle, edge] = colors.ground
  const haloInk = rgbCss(colors.inks[0])
  const haloStyle = useAnimatedStyle(() => ({ opacity: frame.value[HALO_AT] ?? 0 }))
  const discStyle = useAnimatedStyle(() => ({
    transform: [{ scale: frame.value[DISC_AT] ?? 1 }],
  }))
  return (
    <>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="ripples-ground" cx="50%" cy="50%" r="70%">
            <Stop offset="0" stopColor={rgbCss(middle)} stopOpacity={1} />
            <Stop offset="1" stopColor={rgbCss(edge)} stopOpacity={1} />
          </RadialGradient>
          <RadialGradient id="ripples-wash-a" cx="20%" cy="18%" r="60%">
            <Stop offset="0" stopColor={rgbCss(colors.inks[0])} stopOpacity={0.2} />
            <Stop offset="1" stopColor={rgbCss(colors.inks[0])} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="ripples-wash-b" cx="82%" cy="84%" r="60%">
            <Stop offset="0" stopColor={rgbCss(colors.inks[1])} stopOpacity={0.16} />
            <Stop offset="1" stopColor={rgbCss(colors.inks[1])} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ripples-ground)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ripples-wash-a)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ripples-wash-b)" />
      </Svg>
      <View style={styles.centre}>
        <Animated.View style={[styles.at, { width: halo, height: halo }, haloStyle]}>
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id="ripples-halo" cx="50%" cy="50%" r="50%">
                <Stop offset="0.4" stopColor={haloInk} stopOpacity={0.5} />
                <Stop offset="1" stopColor={haloInk} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx="50%" cy="50%" r="50%" fill="url(#ripples-halo)" />
          </Svg>
        </Animated.View>
        {Array.from({ length: MAX_RINGS }, (_, slot) => (
          <Ring
            key={slot}
            slot={slot}
            reach={disc}
            ink={rgbCss(colors.inks[RING_INKS[slot % RING_INKS.length]!])}
            frame={frame}
            ringWidths={ringWidths}
          />
        ))}
        <Animated.View style={[{ width: disc, height: disc }, discStyle]}>
          {/* The cover itself, cut to a circle (`P24`); its colours stand in
              for a song that has no cover. */}
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <RadialGradient id="ripples-disc" cx="42%" cy="38%" r="70%">
                <Stop offset="0" stopColor={rgbCss(colors.inks[2])} stopOpacity={1} />
                <Stop offset="0.7" stopColor={rgbCss(colors.inks[0])} stopOpacity={1} />
                <Stop offset="1" stopColor={rgbCss(colors.inks[1])} stopOpacity={1} />
              </RadialGradient>
            </Defs>
            <Circle cx="50%" cy="50%" r="50%" fill="url(#ripples-disc)" />
          </Svg>
          {cover ? (
            <Image
              source={{ uri: cover }}
              resizeMode="cover"
              style={{ width: disc, height: disc, borderRadius: disc / 2 }}
            />
          ) : null}
        </Animated.View>
      </View>
    </>
  )
}

/** Which ink each ring view draws in: the lead, then the other two, as P24's rings take turns. */
const RING_INKS = [2, 0, 1] as const

function Ring({
  slot,
  reach,
  ink,
  frame,
  ringWidths,
}: {
  slot: number
  reach: number
  ink: string
  frame: Frame
  ringWidths: Frame
}): ReactNode {
  const at = RING_AT + slot * RING_SIZE
  const moving = useAnimatedStyle(() => {
    const f = frame.value
    return { opacity: f[at + 1] ?? 0, transform: [{ scale: f[at] ?? RING_FROM }] }
  })
  // Its own style, off its own value: a border width is a layout prop, so a
  // change to it is a shadow-tree commit. Set when a ring takes this view —
  // a few times a second at most — rather than carried in every frame.
  const width = useAnimatedStyle(() => ({ borderWidth: ringWidths.value[slot] ?? 2 }))
  return (
    <Animated.View
      style={[
        styles.at,
        { width: reach, height: reach, borderRadius: reach / 2, borderColor: ink },
        width,
        moving,
      ]}
    />
  )
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  rounded: { borderRadius: radius.card },
  at: { position: 'absolute' },
  // Unclipped: its caps reach past both edges, and it moves.
  line: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  centre: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

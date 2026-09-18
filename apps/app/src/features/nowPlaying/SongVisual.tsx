import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg'
import type { Song } from '@selfmp3/shared'
import { radius } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import type { MotionSampler } from './motionSource'
import { useReducedMotion } from '../../ui/useReducedMotion'
import { useVisualLook } from './useVisualLook'
import {
  AURORA_INKS,
  auroraBrightness,
  createMotionState,
  MAX_RINGS,
  PlayheadClock,
  ringFade,
  ringReach,
  stepMotion,
  stillMotion,
  type MotionState,
  type MotionTuning,
} from './visualMotion.model'
import { driftReach, rgbCss, type VisualColors, type VisualKind } from './visuals.model'

export interface SongVisualProps {
  song: Song
  kind: VisualKind
  /** What the visual follows: the song's curve on a phone, or its tempo (`useMotionSampler`). */
  sampler: MotionSampler
  /** Round the corners, for a visual in a box rather than one filling the screen. */
  rounded?: boolean
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
 * Nothing is written once a paused visual has settled. Reduce Motion writes
 * one still frame.
 */
export function SongVisual({ song, kind, sampler, rounded = false }: SongVisualProps): ReactNode {
  const player = usePlayer()
  const reduced = useReducedMotion()
  const [size, setSize] = useState<Size | null>(null)
  const { colors, tuning } = useVisualLook(song)
  const frame = useSharedValue<readonly number[]>(EMPTY_FRAME)
  const ringWidths = useSharedValue<readonly number[]>(NO_RINGS)
  const [drawn] = useState(makeDrawn)
  const [clock] = useState(() => new PlayheadClock())
  const [middle, edge] = colors.ground

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
    const motion = createMotionState(BARS)
    stillMotion(motion, tuning, sampler.source)
    write(kind, motion, drawn, tuning, size, true, frame, ringWidths)
  }, [kind, reduced, size, tuning, sampler.source, drawn, frame, ringWidths])

  useEffect(() => {
    if (!size || reduced) return undefined
    const motion = createMotionState(BARS)
    let last = performance.now()
    let handle = 0
    // The frame outlives a style: a paused Pulse left it settled, and a style
    // picked then must still write its first frame, or Aurora never draws its floor.
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
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="visual-ground" cx="50%" cy="50%" r="70%">
            <Stop offset="0" stopColor={rgbCss(middle)} stopOpacity={1} />
            <Stop offset="1" stopColor={rgbCss(edge)} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Circle cx="50%" cy="50%" r="80%" fill="url(#visual-ground)" />
      </Svg>
      {size ? (
        kind === 'aurora' ? (
          <Aurora size={size} colors={colors} frame={frame} />
        ) : kind === 'pulse' ? (
          <Pulse size={size} colors={colors} frame={frame} ringWidths={ringWidths} />
        ) : kind === 'spectrum' ? (
          <Spectrum size={size} colors={colors} frame={frame} />
        ) : (
          <Drift size={size} colors={colors} frame={frame} tuning={tuning} />
        )
      ) : null}
    </View>
  )
}

interface Size {
  width: number
  height: number
}

const BARS = 20
const BLOBS = 3
const DRIFT_RINGS = 3
const SPECKS_PER_RING = 9

/*
 * Where each moving number sits in a frame. One array holds every style's
 * numbers, so a frame is one write from the JavaScript thread however many
 * views move; each view's style reads its own few.
 */
/** Per blob: opacity, x, y, scale. */
const BLOB_AT = 0
const BLOB_SIZE = 4
/** Per ring: scale, opacity. Its width is a layout prop and travels apart (`ringWidths`). */
const RING_AT = BLOB_AT + BLOBS * BLOB_SIZE
const RING_SIZE = 2
const DOT_AT = RING_AT + MAX_RINGS * RING_SIZE
const HALO_AT = DOT_AT + 1
const BAR_AT = HALO_AT + 1
/** Per orbit: turn in degrees, scale, opacity. */
const ORBIT_AT = BAR_AT + BARS
const ORBIT_SIZE = 3
const FRAME_LENGTH = ORBIT_AT + DRIFT_RINGS * ORBIT_SIZE

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

function isSettled(m: MotionState): boolean {
  if (m.glow > 0.002 || m.kick > 0.002 || m.flash > 0.002 || m.burst > 0.002 || m.rings.length > 0)
    return false
  for (const band of m.bands) if (band > 0.002) return false
  return true
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
  const settled = isSettled(m)
  if (settled && drawn.settled && !force) return
  drawn.settled = settled
  const out = drawn.out
  const g = m.glow
  if (kind === 'aurora') {
    const r = Math.max(size.width, size.height) * 0.42
    for (let i = 0; i < BLOBS; i++) {
      const at = BLOB_AT + i * BLOB_SIZE
      out[at] = auroraBrightness(g, m.flash)
      out[at + 1] = Math.sin(m.sway * 0.9 + i * 2.1) * r * 0.3 * (0.3 + 0.7 * g)
      out[at + 2] = Math.cos(m.sway * 0.7 + i * 1.3) * r * 0.12
      out[at + 3] = 0.75 + 0.35 * g + 0.08 * m.flash
    }
  } else if (kind === 'pulse') {
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
        drawn.widths[slot] = 1.5 + 5 * ring.strength
        widthsChanged = true
      }
      out[at] = 0.02 + 0.98 * ringReach(ring, tu)
      out[at + 1] = ringFade(ring, tu) * 0.9
    }
    if (widthsChanged || force) ringWidths.value = drawn.widths.slice()
    out[DOT_AT] = 0.5 + 0.8 * g + 0.7 * m.kick
    out[HALO_AT] = Math.min(1, 0.08 + 0.35 * g + 0.35 * m.kick)
  } else if (kind === 'spectrum') {
    for (let i = 0; i < BARS; i++) out[BAR_AT + i] = Math.max(0.03, m.bands[i] ?? 0)
  } else {
    for (let ring = 0; ring < DRIFT_RINGS; ring++) {
      const at = ORBIT_AT + ring * ORBIT_SIZE
      out[at] = ((m.spin * (1 + ring * 0.25) * 180) / Math.PI) % 360
      out[at + 1] = 1 + 0.3 * m.burst * ((ring + 1) / DRIFT_RINGS)
      out[at + 2] = 0.3 + 0.55 * g
    }
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

/* Soft glows in the cover's colours: bigger, brighter and quicker the louder it is. */
function Aurora({ size, colors, frame }: StyleProps): ReactNode {
  return (
    <>
      {AURORA_INKS.slice(0, BLOBS).map((inkIndex, index) => (
        <Blob
          key={index}
          index={index}
          size={size}
          ink={rgbCss(colors.inks[inkIndex]!)}
          frame={frame}
        />
      ))}
    </>
  )
}

function Blob({
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
  const r = Math.max(size.width, size.height) * 0.42
  const id = `aurora-${index}`
  const at = BLOB_AT + index * BLOB_SIZE
  const moving = useAnimatedStyle(() => {
    const f = frame.value
    return {
      opacity: f[at] ?? 0,
      transform: [
        { translateX: f[at + 1] ?? 0 },
        { translateY: f[at + 2] ?? 0 },
        { scale: f[at + 3] ?? 1 },
      ],
    }
  })
  return (
    <Animated.View
      style={[
        styles.blob,
        {
          left: size.width * (0.2 + index * 0.3) - r,
          top: size.height * (0.35 + (index % 2) * 0.25) - r,
          width: r * 2,
          height: r * 2,
        },
        moving,
      ]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={ink} stopOpacity={0.9} />
            <Stop offset="1" stopColor={ink} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="50%" cy="50%" r="50%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  )
}

/* A ring leaves the centre on each hit; the dot follows the level and kicks. */
function Pulse({ size, colors, frame, ringWidths }: StyleProps & { ringWidths: Frame }): ReactNode {
  const reach = Math.min(size.width, size.height) * 0.96
  const dot = Math.min(size.width, size.height) * 0.09
  const halo = reach * 0.6
  const haloInk = rgbCss(colors.inks[0])
  const haloStyle = useAnimatedStyle(() => ({ opacity: frame.value[HALO_AT] ?? 0 }))
  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: frame.value[DOT_AT] ?? 1 }],
  }))
  return (
    <View style={styles.centre}>
      <Animated.View style={[styles.ring, { width: halo, height: halo }, haloStyle]}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="pulse-halo" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={haloInk} stopOpacity={0.6} />
              <Stop offset="1" stopColor={haloInk} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx="50%" cy="50%" r="50%" fill="url(#pulse-halo)" />
        </Svg>
      </Animated.View>
      {Array.from({ length: MAX_RINGS }, (_, slot) => (
        <Ring
          key={slot}
          slot={slot}
          reach={reach}
          ink={rgbCss(colors.inks[slot % 2]!)}
          frame={frame}
          ringWidths={ringWidths}
        />
      ))}
      <Animated.View
        style={[
          {
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: rgbCss(colors.inks[2]),
          },
          dotStyle,
        ]}
      />
    </View>
  )
}

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
    return { opacity: f[at + 1] ?? 0, transform: [{ scale: f[at] ?? 0.02 }] }
  })
  // Its own style, off its own value: a border width is a layout prop, so a
  // change to it is a shadow-tree commit. Set when a ring takes this view —
  // a few times a second at most — rather than carried in every frame.
  const width = useAnimatedStyle(() => ({ borderWidth: ringWidths.value[slot] ?? 2 }))
  return (
    <Animated.View
      style={[
        styles.ring,
        { width: reach, height: reach, borderRadius: reach / 2, borderColor: ink },
        width,
        moving,
      ]}
    />
  )
}

/* Bars for the song: its curve's level and hits, low to high. */
function Spectrum({ size, colors, frame }: StyleProps): ReactNode {
  const gap = Math.max(3, size.width / BARS / 5)
  const barWidth = (size.width - gap * (BARS + 1)) / BARS
  const tall = size.height * 0.62
  return (
    <View style={[styles.bars, { gap, paddingHorizontal: gap, bottom: size.height * 0.14 }]}>
      {Array.from({ length: BARS }, (_, index) => (
        <Bar
          key={index}
          index={index}
          width={barWidth}
          height={tall}
          ink={rgbCss(index < BARS / 2 ? colors.inks[0] : colors.inks[1])}
          frame={frame}
        />
      ))}
    </View>
  )
}

function Bar({
  index,
  width,
  height,
  ink,
  frame,
}: {
  index: number
  width: number
  height: number
  ink: string
  frame: Frame
}): ReactNode {
  const at = BAR_AT + index
  const moving = useAnimatedStyle(() => ({ transform: [{ scaleY: frame.value[at] ?? 0.03 }] }))
  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: Math.min(3, width / 2),
          backgroundColor: ink,
          transformOrigin: 'bottom',
        },
        moving,
      ]}
    />
  )
}

/* Specks orbiting the centre: faster the louder it is, thrown outward on a hit. */
function Drift({ size, colors, frame, tuning }: StyleProps & { tuning: MotionTuning }): ReactNode {
  const base = Math.min(size.width, size.height)
  const reach = driftReach(tuning.feel.energy)
  return (
    <>
      {Array.from({ length: DRIFT_RINGS }, (_, ring) => (
        <Orbit
          key={ring}
          ring={ring}
          size={size}
          radius={base * (0.08 + ((ring + 1) / DRIFT_RINGS) * reach)}
          ink={rgbCss(colors.inks[ring % 3]!)}
          frame={frame}
        />
      ))}
    </>
  )
}

function Orbit({
  ring,
  size,
  radius,
  ink,
  frame,
}: {
  ring: number
  size: Size
  radius: number
  ink: string
  frame: Frame
}): ReactNode {
  const at = ORBIT_AT + ring * ORBIT_SIZE
  const moving = useAnimatedStyle(() => {
    const f = frame.value
    return {
      opacity: f[at + 2] ?? 0.5,
      transform: [{ rotate: `${f[at] ?? 0}deg` }, { scale: f[at + 1] ?? 1 }],
    }
  })
  const speck = 1.6 + ring * 0.8
  const offset = ring * 0.7
  return (
    <Animated.View style={[styles.fill, moving]}>
      {Array.from({ length: SPECKS_PER_RING }, (_, index) => {
        const angle = offset + (index / SPECKS_PER_RING) * Math.PI * 2
        const r = radius * (0.85 + ((index * 7) % 5) * 0.06)
        const dot = speck * (1 + (index % 3) * 0.5)
        return (
          <View
            key={index}
            style={{
              position: 'absolute',
              left: size.width / 2 + Math.cos(angle) * r - dot,
              top: size.height / 2 + Math.sin(angle) * r - dot,
              width: dot * 2,
              height: dot * 2,
              borderRadius: dot,
              backgroundColor: ink,
            }}
          />
        )
      })}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  rounded: { borderRadius: radius.card, overflow: 'hidden' },
  blob: { position: 'absolute' },
  centre: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: { position: 'absolute' },
  bars: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
})

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg'
import { hueFromString, type Song } from '@selfmp3/shared'
import { usePlayer } from '../../player/PlayerProvider'
import type { MotionSampler } from './motionSource'
import { useReducedMotion } from './useReducedMotion'
import {
  AURORA_INKS,
  auroraBrightness,
  createMotionState,
  MAX_RINGS,
  motionTuning,
  PlayheadClock,
  ringFade,
  ringReach,
  stepMotion,
  stillMotion,
  type MotionState,
  type MotionTuning,
} from './visualMotion.model'
import { driftReach, rgbCss, visualColors, visualFeel, type VisualColors, type VisualKind } from './visuals.model'

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
 * (`visualMotion.model.ts`, the same steps the browser takes) and sets a few
 * dozen `Animated.Value`s; Animated applies those to the views directly, with
 * no React render. Only the style showing is written, and nothing is written
 * once a paused visual has settled. Reduce Motion sets one still frame.
 */
export function SongVisual({ song, kind, sampler, rounded = false }: SongVisualProps): ReactNode {
  const player = usePlayer()
  const reduced = useReducedMotion()
  const [size, setSize] = useState<Size | null>(null)
  const colors = useMemo(
    () =>
      visualColors(
        song.coverTone?.hue ?? hueFromString(song.album || song.title),
        song.audioFeatures?.camelot,
        song.coverTone?.palette,
      ),
    [
      song.coverTone?.hue,
      song.coverTone?.palette,
      song.album,
      song.title,
      song.audioFeatures?.camelot,
    ],
  )
  const bpmKnown = song.audioFeatures?.bpm != null
  const tuning = useMemo(
    () => motionTuning(visualFeel(song.audioFeatures), bpmKnown),
    [song.audioFeatures, bpmKnown],
  )
  const [channels] = useState(makeChannels)
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
    apply(kind, motion, channels, tuning, size, true)
  }, [kind, reduced, size, tuning, sampler.source, channels])

  useEffect(() => {
    if (!size || reduced) return undefined
    const motion = createMotionState(BARS)
    let last = performance.now()
    let frame = 0
    // The channels outlive a style: a paused Pulse left them settled, and a
    // style picked then must still write its first frame, or Aurora never draws its floor.
    let first = true
    const tick = (): void => {
      frame = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { player: p, sampler: s, tuning: tu } = live.current
      stepMotion(motion, s, clock.read(now), dt, p.isPlaying, tu)
      apply(kind, motion, channels, tu, size, first)
      first = false
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [kind, reduced, size, channels, clock])

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
          <Aurora size={size} colors={colors} channels={channels} />
        ) : kind === 'pulse' ? (
          <Pulse size={size} colors={colors} channels={channels} />
        ) : kind === 'spectrum' ? (
          <Spectrum size={size} colors={colors} channels={channels} />
        ) : (
          <Drift size={size} colors={colors} channels={channels} tuning={tuning} />
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

/** Every value a style moves, made once per visual and written each frame. */
interface Channels {
  blobs: { opacity: Animated.Value; x: Animated.Value; y: Animated.Value; scale: Animated.Value }[]
  rings: { scale: Animated.Value; opacity: Animated.Value; width: Animated.Value }[]
  /** Which ring each ring view last showed, so its width is set once, when a new ring takes it. */
  ringIds: number[]
  dot: Animated.Value
  halo: Animated.Value
  bars: Animated.Value[]
  orbits: { turn: Animated.Value; scale: Animated.Value; opacity: Animated.Value }[]
  /** Whether the last frame written was a settled, silent one. */
  settled: boolean
}

function makeChannels(): Channels {
  const value = (initial = 0): Animated.Value => new Animated.Value(initial)
  return {
    blobs: Array.from({ length: BLOBS }, () => ({
      opacity: value(),
      x: value(),
      y: value(),
      scale: value(1),
    })),
    rings: Array.from({ length: MAX_RINGS }, () => ({ scale: value(0.02), opacity: value(), width: value(2) })),
    ringIds: Array.from({ length: MAX_RINGS }, () => -1),
    dot: value(1),
    halo: value(),
    bars: Array.from({ length: BARS }, () => value(0.03)),
    orbits: Array.from({ length: DRIFT_RINGS }, () => ({ turn: value(), scale: value(1), opacity: value(0.5) })),
    settled: false,
  }
}

function isSettled(m: MotionState): boolean {
  if (m.glow > 0.002 || m.kick > 0.002 || m.flash > 0.002 || m.burst > 0.002 || m.rings.length > 0) return false
  for (const band of m.bands) if (band > 0.002) return false
  return true
}

/** Writes this frame into the showing style's values. */
function apply(
  kind: VisualKind,
  m: MotionState,
  ch: Channels,
  tu: MotionTuning,
  size: Size,
  force: boolean,
): void {
  const settled = isSettled(m)
  if (settled && ch.settled && !force) return
  ch.settled = settled
  const g = m.glow
  if (kind === 'aurora') {
    const r = Math.max(size.width, size.height) * 0.42
    ch.blobs.forEach((blob, i) => {
      blob.opacity.setValue(auroraBrightness(g, m.flash))
      blob.x.setValue(Math.sin(m.sway * 0.9 + i * 2.1) * r * 0.3 * (0.3 + 0.7 * g))
      blob.y.setValue(Math.cos(m.sway * 0.7 + i * 1.3) * r * 0.12)
      blob.scale.setValue(0.75 + 0.35 * g + 0.08 * m.flash)
    })
  } else if (kind === 'pulse') {
    ch.rings.forEach((view, slot) => {
      const ring = m.rings.find(candidate => candidate.id % MAX_RINGS === slot)
      if (!ring) {
        view.opacity.setValue(0)
        return
      }
      if (ch.ringIds[slot] !== ring.id) {
        ch.ringIds[slot] = ring.id
        view.width.setValue(1.5 + 5 * ring.strength)
      }
      view.scale.setValue(0.02 + 0.98 * ringReach(ring, tu))
      view.opacity.setValue(ringFade(ring, tu) * 0.9)
    })
    ch.dot.setValue(0.5 + 0.8 * g + 0.7 * m.kick)
    ch.halo.setValue(Math.min(1, 0.08 + 0.35 * g + 0.35 * m.kick))
  } else if (kind === 'spectrum') {
    ch.bars.forEach((bar, i) => bar.setValue(Math.max(0.03, m.bands[i] ?? 0)))
  } else {
    ch.orbits.forEach((orbit, ring) => {
      const degrees = ((m.spin * (1 + ring * 0.25) * 180) / Math.PI) % 360
      orbit.turn.setValue(degrees)
      orbit.scale.setValue(1 + 0.3 * m.burst * ((ring + 1) / DRIFT_RINGS))
      orbit.opacity.setValue(0.3 + 0.55 * g)
    })
  }
}

interface StyleProps {
  size: Size
  colors: VisualColors
  channels: Channels
}

/* Soft glows in the cover's colours: bigger, brighter and quicker the louder it is. */
function Aurora({ size, colors, channels }: StyleProps): ReactNode {
  const r = Math.max(size.width, size.height) * 0.42
  return (
    <>
      {channels.blobs.map((blob, index) => {
        const id = `aurora-${index}`
        const ink = rgbCss(colors.inks[AURORA_INKS[index]!])
        return (
          <Animated.View
            key={index}
            style={[
              styles.blob,
              {
                left: size.width * (0.2 + index * 0.3) - r,
                top: size.height * (0.35 + (index % 2) * 0.25) - r,
                width: r * 2,
                height: r * 2,
                opacity: blob.opacity,
                transform: [{ translateX: blob.x }, { translateY: blob.y }, { scale: blob.scale }],
              },
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
      })}
    </>
  )
}

/* A ring leaves the centre on each hit; the dot follows the level and kicks. */
function Pulse({ size, colors, channels }: StyleProps): ReactNode {
  const reach = Math.min(size.width, size.height) * 0.96
  const dot = Math.min(size.width, size.height) * 0.09
  const halo = reach * 0.6
  const haloInk = rgbCss(colors.inks[0])
  return (
    <View style={styles.centre}>
      <Animated.View style={[styles.ring, { width: halo, height: halo, opacity: channels.halo }]}>
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
      {channels.rings.map((ring, slot) => (
        <Animated.View
          key={slot}
          style={[
            styles.ring,
            {
              width: reach,
              height: reach,
              borderRadius: reach / 2,
              borderColor: rgbCss(colors.inks[slot % 2]!),
              borderWidth: ring.width,
              opacity: ring.opacity,
              transform: [{ scale: ring.scale }],
            },
          ]}
        />
      ))}
      <Animated.View
        style={{
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: rgbCss(colors.inks[2]),
          transform: [{ scale: channels.dot }],
        }}
      />
    </View>
  )
}

/* Bars for the song: its curve's level and hits, low to high. */
function Spectrum({ size, colors, channels }: StyleProps): ReactNode {
  const gap = Math.max(3, size.width / BARS / 5)
  const barWidth = (size.width - gap * (BARS + 1)) / BARS
  const tall = size.height * 0.62
  return (
    <View style={[styles.bars, { gap, paddingHorizontal: gap, bottom: size.height * 0.14 }]}>
      {channels.bars.map((bar, index) => (
        <Animated.View
          key={index}
          style={{
            width: barWidth,
            height: tall,
            borderRadius: Math.min(3, barWidth / 2),
            backgroundColor: rgbCss(index < BARS / 2 ? colors.inks[0] : colors.inks[1]),
            transformOrigin: 'bottom',
            transform: [{ scaleY: bar }],
          }}
        />
      ))}
    </View>
  )
}

/* Specks orbiting the centre: faster the louder it is, thrown outward on a hit. */
function Drift({ size, colors, channels, tuning }: StyleProps & { tuning: MotionTuning }): ReactNode {
  const base = Math.min(size.width, size.height)
  const reach = driftReach(tuning.feel.energy)
  const turns = useMemo(
    () =>
      channels.orbits.map(orbit =>
        orbit.turn.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] }),
      ),
    [channels],
  )
  return (
    <>
      {channels.orbits.map((orbit, ring) => {
        const radius = base * (0.08 + ((ring + 1) / DRIFT_RINGS) * reach)
        const ink = rgbCss(colors.inks[ring % 3]!)
        const speck = 1.6 + ring * 0.8
        const offset = ring * 0.7
        return (
          <Animated.View
            key={ring}
            style={[
              styles.fill,
              { opacity: orbit.opacity, transform: [{ rotate: turns[ring]! }, { scale: orbit.scale }] },
            ]}
          >
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
      })}
    </>
  )
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  rounded: { borderRadius: 14, overflow: 'hidden' },
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

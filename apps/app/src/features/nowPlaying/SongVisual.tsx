import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg'
import { hueFromString, type Song } from '@selfmp3/shared'
import { usePlayer } from '../../player/PlayerProvider'
import { useReducedMotion } from './useReducedMotion'
import {
  beatPhase,
  driftReach,
  driftSpeed,
  PULSE_RINGS,
  rgbCss,
  synthLevels,
  visualColors,
  visualFeel,
  type VisualColors,
  type VisualFeel,
  type VisualKind,
} from './visuals.model'

export interface SongVisualProps {
  song: Song
  kind: VisualKind
  /** Round the corners, for a visual in a box rather than one filling the screen. */
  rounded?: boolean
}

/**
 * A song's visual on a phone (and an iPad): plain views on Animated's native
 * driver, so no frame comes back to JavaScript. The browser's is
 * `SongVisual.web.tsx`, a canvas.
 *
 * Simpler than the canvas on purpose. A phone's player gives no sound to
 * listen to, so every style moves with the song's tempo and energy: loops one
 * beat long, started on the beat from where the song is, and stopped while it
 * is paused. Reduce Motion leaves each style standing still.
 */
export function SongVisual({ song, kind, rounded = false }: SongVisualProps): ReactNode {
  const player = usePlayer()
  const reduced = useReducedMotion()
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const colors = useMemo(
    () =>
      visualColors(song.coverTone?.hue ?? hueFromString(song.album || song.title), song.features?.camelot),
    [song.coverTone?.hue, song.album, song.title, song.features?.camelot],
  )
  const feel = useMemo(() => visualFeel(song.features), [song.features])
  const moving = player.isPlaying && !reduced
  const [middle, edge] = colors.ground

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
          <Aurora size={size} colors={colors} feel={feel} moving={moving} />
        ) : kind === 'pulse' ? (
          <Pulse size={size} colors={colors} feel={feel} moving={moving} />
        ) : kind === 'spectrum' ? (
          <Spectrum size={size} colors={colors} feel={feel} moving={moving} />
        ) : (
          <Drift size={size} colors={colors} feel={feel} moving={moving} />
        )
      ) : null}
    </View>
  )
}

interface StyleProps {
  size: { width: number; height: number }
  colors: VisualColors
  feel: VisualFeel
  moving: boolean
}

/** Milliseconds a beat lasts at this tempo. */
const beatMs = (bpm: number): number => 60_000 / bpm

/**
 * Milliseconds until the next beat from where the song is now, so a loop one
 * beat long starts on the beat. Read once, when the loop starts.
 */
function untilBeat(position: number, bpm: number): number {
  return (1 - beatPhase(position, bpm)) * beatMs(bpm)
}

/**
 * One looping value, 0 to 1 over `duration`, started after `delay` and
 * stopped (left where it is) while not moving.
 */
function useLoop(moving: boolean, duration: number, delay: number, easing = Easing.linear) {
  const [value] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (!moving) return undefined
    value.setValue(0)
    const loop = Animated.sequence([
      Animated.delay(delay),
      Animated.loop(
        Animated.timing(value, { toValue: 1, duration, easing, useNativeDriver: true }),
      ),
    ])
    loop.start()
    return () => loop.stop()
  }, [moving, duration, delay, easing, value])
  return value
}

/* Soft glows in the cover's colours, drifting; brighter for a louder song. */
function Aurora({ size, colors, feel, moving }: StyleProps): ReactNode {
  const period = 16_000 - 8_000 * feel.energy
  const blobs = [0, 1, 2].map(index => ({
    index,
    x: size.width * (0.2 + index * 0.3),
    y: size.height * (0.35 + (index % 2) * 0.25),
    r: Math.max(size.width, size.height) * 0.42,
  }))
  return (
    <>
      {blobs.map(blob => (
        <AuroraBlob
          key={blob.index}
          {...blob}
          ink={rgbCss(colors.inks[blob.index]!)}
          strength={0.35 + 0.35 * feel.loudness}
          period={period * (1 + blob.index * 0.35)}
          moving={moving}
        />
      ))}
    </>
  )
}

function AuroraBlob({
  index,
  x,
  y,
  r,
  ink,
  strength,
  period,
  moving,
}: {
  index: number
  x: number
  y: number
  r: number
  ink: string
  strength: number
  period: number
  moving: boolean
}): ReactNode {
  const t = useLoop(moving, period, 0)
  const sway = r * 0.35
  const id = `aurora-${index}`
  return (
    <Animated.View
      style={[
        styles.blob,
        {
          left: x - r,
          top: y - r,
          width: r * 2,
          height: r * 2,
          opacity: t.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [strength, strength * 0.7, strength],
          }),
          transform: [
            {
              translateX: t.interpolate({
                inputRange: [0, 0.25, 0.5, 0.75, 1],
                outputRange: [0, sway, 0, -sway, 0],
              }),
            },
            {
              translateY: t.interpolate({
                inputRange: [0, 0.25, 0.5, 0.75, 1],
                outputRange: [0, -sway * 0.4, 0, sway * 0.4, 0],
              }),
            },
          ],
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
}

/* Rings leave the centre on every beat; the centre dot kicks. */
function Pulse({ size, colors, feel, moving }: StyleProps): ReactNode {
  const player = usePlayer()
  const beat = beatMs(feel.bpm)
  // Read once per start: the loop keeps the beat from there.
  const [start] = useState(() => untilBeat(player.getPosition(), feel.bpm))
  const reach = Math.min(size.width, size.height) * 0.96
  const dot = Math.min(size.width, size.height) * 0.09
  const kick = useLoop(moving, beat, start, Easing.out(Easing.exp))
  return (
    <View style={styles.centre}>
      {Array.from({ length: PULSE_RINGS }, (_, ring) => (
        <PulseRing
          key={ring}
          reach={reach}
          ink={rgbCss(colors.inks[ring % 2]!)}
          width={1.5 + feel.energy * 3}
          duration={beat * PULSE_RINGS}
          delay={start + beat * ring}
          moving={moving}
        />
      ))}
      <Animated.View
        style={{
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: rgbCss(colors.inks[2]),
          transform: [{ scale: kick.interpolate({ inputRange: [0, 1], outputRange: [1.6, 1] }) }],
        }}
      />
    </View>
  )
}

function PulseRing({
  reach,
  ink,
  width,
  duration,
  delay,
  moving,
}: {
  reach: number
  ink: string
  width: number
  duration: number
  delay: number
  moving: boolean
}): ReactNode {
  const age = useLoop(moving, duration, delay)
  return (
    <Animated.View
      style={[
        styles.ring,
        {
          width: reach,
          height: reach,
          borderRadius: reach / 2,
          borderColor: ink,
          borderWidth: width,
          opacity: age.interpolate({ inputRange: [0, 1], outputRange: [0.85, 0] }),
          transform: [{ scale: age.interpolate({ inputRange: [0, 1], outputRange: [0.02, 1] }) }],
        },
      ]}
    />
  )
}

/* Bars on the beat: bass on the beat, the top end on the off-beats. */
const BARS = 20

function Spectrum({ size, colors, feel, moving }: StyleProps): ReactNode {
  const player = usePlayer()
  const beat = beatMs(feel.bpm)
  const [start] = useState(() => untilBeat(player.getPosition(), feel.bpm))
  // Two shapes a beat apart, from the same stand-in the browser draws.
  const peaks = useMemo(() => synthLevels(BARS, 0, feel.bpm, feel.energy), [feel.bpm, feel.energy])
  const rests = useMemo(
    () => synthLevels(BARS, (60 / feel.bpm) * 0.55, feel.bpm, feel.energy),
    [feel.bpm, feel.energy],
  )
  const gap = Math.max(3, size.width / BARS / 5)
  const barWidth = (size.width - gap * (BARS + 1)) / BARS
  const tall = size.height * 0.62
  return (
    <View style={[styles.bars, { gap, paddingHorizontal: gap, bottom: size.height * 0.14 }]}>
      {peaks.map((peak, index) => (
        <SpectrumBar
          key={index}
          width={barWidth}
          height={tall}
          peak={Math.max(0.08, peak)}
          rest={Math.max(0.04, rests[index] ?? 0)}
          ink={rgbCss(index < BARS / 2 ? colors.inks[0] : colors.inks[1])}
          // The top end moves twice a beat.
          duration={index > BARS * 0.6 ? beat / 2 : beat}
          delay={start}
          moving={moving}
        />
      ))}
    </View>
  )
}

function SpectrumBar({
  width,
  height,
  peak,
  rest,
  ink,
  duration,
  delay,
  moving,
}: {
  width: number
  height: number
  peak: number
  rest: number
  ink: string
  duration: number
  delay: number
  moving: boolean
}): ReactNode {
  const t = useLoop(moving, duration, delay)
  return (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: Math.min(3, width / 2),
        backgroundColor: ink,
        transformOrigin: 'bottom',
        transform: [
          {
            scaleY: t.interpolate({
              inputRange: [0, 0.12, 1],
              outputRange: [rest, peak, rest],
            }),
          },
        ],
      }}
    />
  )
}

/* Specks orbiting the centre: faster with tempo, closer with energy. */
const RINGS = 3
const SPECKS_PER_RING = 9

function Drift({ size, colors, feel, moving }: StyleProps): ReactNode {
  const base = Math.min(size.width, size.height)
  const reach = driftReach(feel.energy)
  // One full turn, at Drift's speed for this tempo.
  const turn = ((Math.PI * 2) / driftSpeed(feel.bpm)) * 1000
  return (
    <>
      {Array.from({ length: RINGS }, (_, ring) => (
        <DriftRing
          key={ring}
          size={size}
          radius={base * (0.08 + ((ring + 1) / RINGS) * reach)}
          ink={rgbCss(colors.inks[ring % 3]!)}
          speck={1.6 + ring * 0.8}
          duration={turn * (1 + ring * 0.25)}
          offset={ring * 0.7}
          moving={moving}
        />
      ))}
    </>
  )
}

function DriftRing({
  size,
  radius,
  ink,
  speck,
  duration,
  offset,
  moving,
}: {
  size: { width: number; height: number }
  radius: number
  ink: string
  speck: number
  duration: number
  offset: number
  moving: boolean
}): ReactNode {
  const t = useLoop(moving, duration, 0)
  return (
    <Animated.View
      style={[
        styles.fill,
        {
          transform: [
            { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
          ],
        },
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
              opacity: 0.75,
            }}
          />
        )
      })}
    </Animated.View>
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

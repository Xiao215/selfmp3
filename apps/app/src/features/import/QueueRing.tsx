import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, View } from 'react-native'
import { useUnistyles } from 'react-native-unistyles'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { IconButton } from '../../ui/components/IconButton'
import { ease, timing } from '../../ui/motion'
import { MOVE_MS } from '../../ui/motion.model'

/** The ring's box, its radius and how thick it is drawn. */
const BOX = 32
const R = 13
const STROKE = 2.5
const ROUND = 2 * Math.PI * R

/** What the middle of the ring says, and does when pressed. */
type Glyph = 'pause' | 'play' | 'retry' | null

/**
 * One import's control, App Store style (docs: the "Import queue rows"
 * canvas, E): a ring that fills as the song goes through its steps
 * (`stepFraction`), with what pressing it does in the middle — pause while it
 * waits or downloads, play while it is paused, retry once it failed. A
 * waiting song's ring is dotted: it has not started. A song adding itself to
 * the library has nothing to stop, and its ring is only a ring.
 *
 * The pause and the × this replaces were two grey glyphs on every row, forty
 * rows deep; this is one, and it is the row's progress as well.
 */
export function QueueRing({
  fill,
  glyph,
  tone = 'accent',
  waiting = false,
  label,
  onPress,
  testID,
}: {
  /** 0 to 1. */
  fill: number
  glyph: Glyph
  tone?: 'accent' | 'danger' | 'warning'
  /** Not started: a dotted ring. */
  waiting?: boolean
  label: string
  onPress?: () => void
  testID?: string
}): ReactNode {
  const { theme } = useUnistyles()
  const ink =
    tone === 'danger'
      ? theme.colors.danger
      : tone === 'warning'
        ? theme.colors.warning
        : theme.colors.accent
  /*
   * The arc moves on from where it was to where the next step puts it. It
   * follows the value by a listener rather than as an animated component:
   * one of those marks what it wraps `collapsable={false}`, and in a browser
   * react-native-svg writes every prop onto the `<circle>` itself, which
   * React refuses aloud. A few renders of one small ring per step is nothing.
   */
  const [drawn] = useState(() => new Animated.Value(fill))
  const [shown, setShown] = useState(fill)
  useEffect(() => {
    const id = drawn.addListener(({ value }) => setShown(value))
    return () => drawn.removeListener(id)
  }, [drawn])
  const sent = useRef(fill)
  useEffect(() => {
    if (sent.current === fill) return
    sent.current = fill
    // A dash length is no transform: the native driver cannot move it.
    timing(drawn, fill, MOVE_MS.ringFill, undefined, { easing: ease.out, native: false })
  }, [fill, drawn])

  const centre = BOX / 2
  const ring = (
    <Svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`}>
      <Circle
        cx={centre}
        cy={centre}
        r={R}
        stroke={waiting ? theme.colors.textMuted : theme.colors.surface2}
        strokeWidth={waiting ? 1.5 : STROKE}
        strokeDasharray={waiting ? '2 4' : undefined}
        fill="none"
      />
      {shown > 0.001 ? (
        <Circle
          cx={centre}
          cy={centre}
          r={R}
          stroke={ink}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${ROUND} ${ROUND}`}
          strokeDashoffset={ROUND * (1 - Math.min(1, Math.max(0, shown)))}
          fill="none"
          // Starting at twelve o'clock, as a clock's hand and the App Store's do.
          transform={`rotate(-90 ${centre} ${centre})`}
        />
      ) : null}
      {glyph === 'pause' ? (
        <>
          <Rect x={11.5} y={10} width={3} height={12} rx={1} fill={theme.colors.textPrimary} />
          <Rect x={17.5} y={10} width={3} height={12} rx={1} fill={theme.colors.textPrimary} />
        </>
      ) : glyph === 'play' ? (
        <Path d="M13 9.5v13l10-6.5z" fill={theme.colors.textPrimary} />
      ) : glyph === 'retry' ? (
        <Path
          d="M22.5 16a6.5 6.5 0 1 1-2.1-4.8M22.5 9.5v4h-4"
          stroke={ink}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : null}
    </Svg>
  )

  if (!onPress || glyph === null) {
    return (
      <View
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(fill * 100) }}
        testID={testID}
      >
        {ring}
      </View>
    )
  }
  return (
    <IconButton onPress={onPress} label={label} testID={testID}>
      {ring}
    </IconButton>
  )
}

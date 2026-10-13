import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, PanResponder, View } from 'react-native'
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { clamp } from '@selfmp3/shared'
import { space } from '@selfmp3/client'
import { useAccent } from '../accent'
import { spring } from '../motion'
import { tip } from '../tip'
import { filledTenths, valueAlong } from './scrubber.model'
import { ADJUST_ACTIONS } from './slider.model'

/**
 * Closer than this to a seek, the player is taken to be there. Wide enough for
 * a second of play at twice the speed, so a seek that landed is not pulled back.
 */
const SEEK_LANDED_SECONDS = 2.1
/** How long a let-go position is held against an engine still reporting the old one. */
const SEEK_SETTLE_MS = 1000

/**
 * Where a seek let go, until the player says it is there: `held` while it is
 * still somewhere else, null once it reports the new time (or a second on).
 * A phone's engine reports the pre-seek time for a tick or two, and without
 * this a bar's thumb jumps back to it and forward again.
 */
function useSeekHold(position: number): {
  held: number | null
  hold: (seconds: number) => void
} {
  const [pending, setPending] = useState<number | null>(null)
  // Held only while the player is still somewhere else: once it reports the
  // new time, the bar follows it again.
  const held =
    pending !== null && Math.abs(position - pending) >= SEEK_LANDED_SECONDS ? pending : null
  /*
   * The hold lets go on its own, a second after the finger did. The timer is
   * the effect's rather than the gesture's so that it goes when the bar does:
   * a scrubbed song closed before it woke had it setting state on a bar that
   * is no longer there.
   */
  useEffect(() => {
    if (pending === null) return undefined
    const timer = setTimeout(
      // This seek only: a later one, made meanwhile, starts its own hold.
      () => setPending(current => (current === pending ? null : current)),
      SEEK_SETTLE_MS,
    )
    return () => clearTimeout(timer)
  }, [pending])
  return { held, hold: setPending }
}

/** The two drawings: Now Playing's thick track, and the thin one of a bar or a row. */
const SIZES = {
  large: { track: 6, thumb: 16, pad: space.md },
  small: { track: 4, thumb: 12, pad: space.sm },
} as const

/** How far the thumb swells while it is held. */
const THUMB_GRABBED = 1.2

/**
 * A track to drag along: the one primitive under the song's seek bar
 * (`SeekBar`), a preview's (`ListenBar`) and the volume fader. Each had built
 * its own on PanResponder, and each fix had to be carried to the others by
 * hand — "hold where let go" (6c72cde0), the rounding that keeps the web's
 * style sheet from growing (56ded63e), the ARIA values a browser announces —
 * and some never were: the volume announced nothing on the web and let a
 * wandering drag be stolen, and the preview's bar wrote a new CSS rule a tick
 * and stepped from the wrong value.
 *
 * Hand-built on PanResponder rather than a slider package: it keeps showing
 * the dragged place while the finger is down instead of fighting the
 * player's own reports, it avoids a dependency, and the hue slider's native
 * range input (`Slider`) is a different control.
 *
 * `value` is where it is, 0 to `max`. `onChange` hears every step of a drag
 * (the volume, which follows the finger); `onCommit` hears where it was let
 * go, and a screen reader's step (a seek, which lands once). `hold` keeps a
 * let-go value showing until `value` catches up with it (`useSeekHold`).
 */
export function Scrubber({
  value,
  max,
  onCommit,
  onChange,
  hold = false,
  label,
  step,
  spokenScale = 1,
  vertical = false,
  size = 'small',
  thumb = true,
  color,
  caption,
  testID,
  style,
  around,
}: {
  value: number
  max: number
  onCommit: (value: number) => void
  onChange?: (value: number) => void
  /** Hold where it was let go until `value` gets there: a seek the engine reports late. */
  hold?: boolean
  /** What a screen reader calls it: "Seek", "Volume". */
  label: string
  /** How far a screen reader's swipe moves it. */
  step: number
  /** The value as it is said: seconds as they are, a 0 to 1 level as a per cent (100). */
  spokenScale?: number
  /** Upright, filling from the foot: the volume pop-up's fader. */
  vertical?: boolean
  size?: keyof typeof SIZES
  /** The round handle; a bar that only fills (the volume beside its speaker) has none. */
  thumb?: boolean
  /** What the played part fills with; the accent when not given. */
  color?: string
  /** The hover caption, where a pointer can ask. */
  caption?: string
  testID?: string
  /** The hit area's own size and room, which is bigger than the track it holds. */
  style?: StyleProp<ViewStyle>
  /** What goes round the track and moves with it: the seek bar's times. */
  around?: (bar: ReactNode, shown: number) => ReactNode
}): ReactNode {
  const accent = useAccent()
  const fill = color ?? accent.accent
  const sizes = SIZES[size]
  // The track's length along the way it slides: its width, or its height upright.
  const [length, setLength] = useState(0)
  const [dragging, setDragging] = useState<number | null>(null)
  const seekHold = useSeekHold(value)
  const held = hold ? seekHold.held : null
  const holdAt = seekHold.hold

  // Rebuilt when the length or the end changes rather than reading refs:
  // PanResponder objects are cheap, and the alternative is a handler that
  // quietly lands using the previous track's length. A track not measured yet
  // has no place to give, and a press on it changes nothing.
  const responder = useMemo(() => {
    // locationX is relative to the view the finger is on. On iOS that is the
    // innermost one, so the track, fill and thumb take no touches: a drag that
    // began on the thumb read positions from the thumb's own edge, and the
    // thumb flickered between two places as it moved. With them out of the way
    // it is always this view, and stays right as it moves round the screen.
    const valueAt = (x: number, y: number): number | null =>
      valueAlong(vertical ? length - y : x, length, max)
    const drag = (x: number, y: number): void => {
      const at = valueAt(x, y)
      if (at === null) return
      setDragging(at)
      onChange?.(at)
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // A drag that wanders is still a drag: not the page's swipe to close,
      // nor the list's scroll.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: event => drag(event.nativeEvent.locationX, event.nativeEvent.locationY),
      onPanResponderMove: event => drag(event.nativeEvent.locationX, event.nativeEvent.locationY),
      onPanResponderRelease: event => {
        const at = valueAt(event.nativeEvent.locationX, event.nativeEvent.locationY)
        setDragging(null)
        if (at === null) return
        if (hold) holdAt(at)
        onCommit(at)
      },
      onPanResponderTerminate: () => setDragging(null),
    })
  }, [length, max, vertical, onChange, onCommit, hold, holdAt])

  const shown = dragging ?? held ?? value
  // A tenth of a per cent at a time (`filledTenths` says why).
  const tenths = filledTenths(shown, max)
  const share = `${tenths / 10}%` as const
  // Whole points, for the same reason.
  const thumbAt = Math.max(0, Math.round(length * (tenths / 1000) - sizes.thumb / 2))

  /*
   * The thumb swells under the finger, on the spring, as every press in the
   * app does (`M1`, "Press").
   */
  const grabbing = dragging !== null
  const [grabbed] = useState(() => new Animated.Value(1))
  useEffect(() => {
    spring(grabbed, grabbing ? THUMB_GRABBED : 1)
  }, [grabbing, grabbed])
  const [swell] = useState(() => ({ transform: [{ scale: grabbed }] }))

  /** A screen reader's swipe up or down: a step along, as the keyboard does. */
  const onAccessibilityAction = (event: { nativeEvent: { actionName: string } }): void => {
    const by = event.nativeEvent.actionName === 'increment' ? step : -step
    const target = clamp(shown + by, 0, max)
    if (hold) holdAt(target)
    onCommit(target)
  }

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout
    setLength(vertical ? height : width)
  }

  const spoken = (at: number): number => Math.round(at * spokenScale)
  const track = sizes.track
  const bar = (
    <View
      style={[vertical ? styles.hitUpright : [styles.hit, { paddingVertical: sizes.pad }], style]}
      onLayout={onLayout}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: spoken(max), now: spoken(shown) }}
      /*
       * The same numbers again as ARIA props: `react-native-web` renders
       * `accessibilityRole="adjustable"` as `role="slider"` and then drops
       * `accessibilityValue`, leaving a slider that announces no position.
       * React Native maps these to the same place, so it is the one spelling
       * that works on both.
       */
      aria-valuemin={0}
      aria-valuemax={spoken(max)}
      aria-valuenow={spoken(shown)}
      accessibilityActions={ADJUST_ACTIONS}
      onAccessibilityAction={onAccessibilityAction}
      {...tip(caption)}
      testID={testID}
      {...responder.panHandlers}
    >
      {/* Draws only: every touch belongs to the bar, see the responder. */}
      {vertical ? (
        <View
          pointerEvents="none"
          style={[styles.trackUpright, { width: track, borderRadius: track / 2 }]}
        >
          <View
            style={{ width: track, height: share, borderRadius: track / 2, backgroundColor: fill }}
          />
          {thumb ? (
            <Animated.View
              style={[
                styles.thumb,
                thumbSize(sizes.thumb),
                { left: track / 2 - sizes.thumb / 2, bottom: thumbAt },
                swell,
              ]}
            />
          ) : null}
        </View>
      ) : (
        <View
          pointerEvents="none"
          style={[styles.track, { height: track, borderRadius: track / 2 }]}
        >
          <View
            style={{ height: track, width: share, borderRadius: track / 2, backgroundColor: fill }}
          />
          {thumb ? (
            <Animated.View
              style={[styles.thumb, thumbSize(sizes.thumb), { left: thumbAt }, swell]}
            />
          ) : null}
        </View>
      )}
    </View>
  )

  return around ? around(bar, shown) : bar
}

function thumbSize(side: number): ViewStyle {
  return { width: side, height: side, borderRadius: side / 2 }
}

const styles = StyleSheet.create(theme => ({
  hit: {
    justifyContent: 'center',
    // A pointing hand where there is a mouse: the bar is a control, not a
    // picture. React Native types `cursor` as `auto | pointer`, so this needs
    // no port.
    cursor: 'pointer',
  },
  hitUpright: { alignItems: 'center', cursor: 'pointer' },
  track: { backgroundColor: theme.colors.surface3, justifyContent: 'center' },
  trackUpright: {
    height: '100%',
    backgroundColor: theme.colors.surface3,
    justifyContent: 'flex-end',
  },
  thumb: { position: 'absolute', backgroundColor: theme.colors.textPrimary },
}))

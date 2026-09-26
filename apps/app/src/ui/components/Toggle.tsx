import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { spring } from '../motion'
import { Press } from './Press'

/**
 * On or off.
 *
 * A 42 by 24 track with the knob inside it, the accent when on. A switch to
 * assistive technology, named by the setting it changes.
 *
 * One value — `position` — carries the whole change: the knob slides on the
 * spring, and both on-colours are drawn as layers over the off-colours whose
 * opacity follows the same value, so the colour arrives with the knob instead
 * of snapping at the first frame. A colour cannot go on the native driver; an
 * opacity can, so the fade is a crossfade of two layers rather than an
 * animated colour on the JavaScript side.
 */
export function Toggle({
  value,
  onChange,
  label,
  disabled = false,
  testID,
}: {
  value: boolean
  onChange: (value: boolean) => void
  /** The setting's name, read out with its state. */
  label: string
  disabled?: boolean
  testID?: string
}): ReactNode {
  const [position] = useState(() => new Animated.Value(value ? 1 : 0))

  useEffect(() => {
    spring(position, value ? 1 : 0)
  }, [value, position])

  // Built once: the knob's travel and the two on-layers' opacity are the same
  // three nodes for the life of the switch, not new ones per render.
  const slide = useMemo(
    () => ({
      transform: [
        { translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] }) },
      ],
    }),
    [position],
  )
  const lit = useMemo(() => ({ opacity: position }), [position])

  return (
    <Press
      depth="control"
      testID={testID}
      onPress={() => onChange(!value)}
      disabled={disabled}
      // The track is 42 by 24; the slop brings the target up to the 44-point
      // minimum without changing what is drawn.
      hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
      role="switch"
      aria-checked={value}
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      style={[styles.track, disabled && styles.disabled]}
    >
      {/* The accent track, over the off track, as far in as the knob is along. */}
      <Animated.View pointerEvents="none" style={[styles.trackOn, lit]} />
      {/*
        Each of these carries one whole Unistyles style and nothing else of
        Unistyles': `Animated.View` flattens its style array into the single
        object it animates, so two of Unistyles' styles arrive merged into one,
        which is the case it warns about because it can no longer tell them
        apart. That is why the knob is a shape *with* its colour twice over
        rather than a shape with a colour laid on it.
      */}
      <Animated.View pointerEvents="none" style={[styles.knobOff, slide]} />
      <Animated.View pointerEvents="none" style={[styles.knobOn, slide, lit]} />
    </Press>
  )
}

/** The track, and the knob that sits inside it with `KNOB_INSET` all round. */
const TRACK = { width: 42, height: 24 } as const
const KNOB_SIZE = 18
const KNOB_INSET = 3

/**
 * How far the knob slides: the track's width less the knob and the room on
 * either side of it. Written out rather than as 18, which is also the knob's
 * own width and the same number for the wrong reason.
 */
const TRAVEL = TRACK.width - KNOB_SIZE - KNOB_INSET * 2

/** The knob's shape, shared by its two colours. */
const KNOB = {
  position: 'absolute',
  top: KNOB_INSET,
  left: KNOB_INSET,
  width: KNOB_SIZE,
  height: KNOB_SIZE,
  borderRadius: KNOB_SIZE / 2,
} as const

/** The track's shape, shared by its two colours. */
const TRACK_SHAPE = {
  width: TRACK.width,
  height: TRACK.height,
  borderRadius: TRACK.height / 2,
} as const

const styles = StyleSheet.create(theme => ({
  track: {
    ...TRACK_SHAPE,
    backgroundColor: theme.colors.surfaceSelected,
  },
  // Both halves of the switch come from the palette, so the accent picker
  // recolours it without re-rendering whatever screen it is sitting on.
  trackOn: {
    ...TRACK_SHAPE,
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: theme.colors.accent,
  },
  knobOn: { ...KNOB, backgroundColor: theme.colors.onAccent },
  knobOff: { ...KNOB, backgroundColor: theme.colors.textPrimary },
  disabled: { opacity: 0.45 },
}))

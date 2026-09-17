import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'

/**
 * On or off.
 *
 * A 42 by 24 track with the knob inside it, the accent when on. A switch to
 * assistive technology, named by the setting it changes.
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
    Animated.timing(position, {
      toValue: value ? 1 : 0,
      duration: 160,
      useNativeDriver: false,
    }).start()
  }, [value, position])

  return (
    <Pressable
      testID={testID}
      onPress={() => onChange(!value)}
      disabled={disabled}
      role="switch"
      aria-checked={value}
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      style={[styles.track, value && styles.trackOn, disabled && styles.disabled]}
    >
      <Animated.View
        style={[
          value ? styles.knobOn : styles.knobOff,
          {
            transform: [
              { translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) },
            ],
          },
        ]}
      />
    </Pressable>
  )
}

/** The knob's shape, shared by its two states. */
const KNOB = {
  position: 'absolute',
  top: 2,
  left: 2,
  width: 18,
  height: 18,
  borderRadius: 9,
} as const

const styles = StyleSheet.create(theme => ({
  track: {
    width: 42,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface3,
  },
  // Both halves of the switch come from the palette, so the accent picker
  // recolours it without re-rendering whatever screen it is sitting on.
  trackOn: { backgroundColor: theme.colors.accent, borderColor: 'transparent' },
  /*
   * The knob is given one whole style rather than a shape with a colour laid
   * over it. `Animated.View` flattens its style array into the single object
   * it animates, so two of Unistyles' styles arrive merged into one — which
   * is the case it warns about, because it can no longer tell them apart.
   */
  knobOn: { ...KNOB, backgroundColor: theme.colors.onAccent },
  knobOff: { ...KNOB, backgroundColor: theme.colors.textSecondary },
  disabled: { opacity: 0.45 },
}))

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useAccent } from '../accent'

/**
 * On or off: the web's `.toggle`.
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
  const { theme } = useUnistyles()
  const accent = useAccent()
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
      style={[
        styles.track,
        value && { backgroundColor: accent.accent, borderColor: 'transparent' },
        disabled && styles.disabled,
      ]}
    >
      <Animated.View
        style={[
          styles.knob,
          {
            backgroundColor: value ? accent.onAccent : theme.colors.textSecondary,
            transform: [
              { translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) },
            ],
          },
        ]}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create(theme => ({
  track: {
    width: 42,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface3,
  },
  knob: { position: 'absolute', top: 2, left: 2, width: 18, height: 18, borderRadius: 9 },
  disabled: { opacity: 0.45 },
}))

import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native'
import { colors, radius, space, type } from '../theme'

/** The one button in the app, in three weights. */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  busy = false,
}: {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
  busy?: boolean
}): ReactNode {
  const inactive = disabled || busy

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.primary,
        variant === 'danger' && styles.danger,
        pressed && styles.pressed,
        inactive && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onAccent : colors.textPrimary} />
      ) : (
        <Text
          style={[
            styles.label,
            variant === 'primary' && styles.primaryLabel,
            variant === 'danger' && styles.dangerLabel,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: 40,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  primary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  danger: {
    borderColor: colors.danger,
    backgroundColor: colors.surface2,
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    color: colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
  },
  primaryLabel: {
    color: colors.onAccent,
  },
  dangerLabel: {
    color: colors.danger,
  },
})

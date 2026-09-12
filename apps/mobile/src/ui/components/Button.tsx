import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useAccent } from '../accent'
import { colors, HIT_TARGET, radius } from '../theme'

/**
 * The web's `.button`, in the same three weights, at the phone's 44px.
 *
 * An icon goes before the label the way it does on the web (`<Play /> Play`);
 * with no label at all it is the web's icon-only phone button — the shuffle
 * in the library header — which is square rather than a pill.
 */
export function Button({
  label,
  icon,
  onPress,
  variant = 'secondary',
  disabled = false,
  busy = false,
  grow = false,
}: {
  label?: string
  icon?: ReactNode
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
  busy?: boolean
  /** Take the row's spare width, so a group of buttons shares a line evenly. */
  grow?: boolean
}): ReactNode {
  const accent = useAccent()
  const inactive = disabled || busy
  const ink =
    variant === 'primary'
      ? colors.onAccent
      : variant === 'danger'
        ? colors.danger
        : colors.textPrimary

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive }}
      style={({ pressed }) => [
        styles.button,
        label === undefined && styles.square,
        grow && styles.grow,
        variant === 'primary' && { backgroundColor: accent.accent, borderColor: accent.accent },
        variant === 'danger' && styles.danger,
        pressed && !inactive && styles.pressed,
        inactive && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <View style={styles.content}>
          {icon}
          {label !== undefined ? (
            <Text style={[styles.label, { color: ink }]} numberOfLines={1}>
              {label}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: HIT_TARGET,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  square: {
    width: HIT_TARGET,
    paddingHorizontal: 0,
  },
  grow: {
    flex: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  danger: {
    borderColor: '#5a2a2e',
  },
  pressed: {
    backgroundColor: colors.surface3,
    borderColor: colors.borderStrong,
    transform: [{ translateY: 1 }],
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
})

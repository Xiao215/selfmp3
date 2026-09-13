import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { HIT_TARGET, radius, oklchToHexAlpha } from '@selfmp3/client'

/**
 * The web's `.button`, in the same three weights: at the phone's 44px, and at
 * the web's own desktop height where there is a mouse (`useLayout().dense`).
 *
 * An icon goes before the label the way it does on the web (`<Play /> Play`);
 * with no label at all it is the web's icon-only phone button — the shuffle
 * in the library header — which is square rather than a pill.
 */
export function Button({
  testID,
  label,
  icon,
  onPress,
  variant = 'secondary',
  disabled = false,
  busy = false,
  grow = false,
  active = false,
  accessibilityLabel,
}: {
  testID?: string
  label?: string
  icon?: ReactNode
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
  busy?: boolean
  /** Take the row's spare width, so a group of buttons shares a line evenly. */
  grow?: boolean
  /**
   * On, the way the web's `.library-select.is-active` is: a dim accent fill with
   * an accent edge, for a button that toggles a mode.
   */
  active?: boolean
  /** What a screen reader says when there is no label, or a fuller one: a square icon button. */
  accessibilityLabel?: string
}): ReactNode {
  const accent = useAccent()
  const { dense } = useLayout()
  const { theme } = useUnistyles()
  const inactive = disabled || busy
  const ink =
    variant === 'primary'
      ? theme.colors.onAccent
      : variant === 'danger'
        ? theme.colors.danger
        : theme.colors.textPrimary

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, selected: active }}
      style={({ pressed }) => [
        styles.button,
        dense && styles.buttonDense,
        label === undefined && (dense ? styles.squareDense : styles.square),
        grow && styles.grow,
        variant === 'primary' && { backgroundColor: accent.accent, borderColor: accent.accent },
        variant === 'danger' && styles.danger,
        active && {
          backgroundColor: oklchToHexAlpha(0.42, 0.1, accent.hue, 1),
          borderColor: accent.accent,
        },
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

const styles = StyleSheet.create(theme => ({
  button: {
    minHeight: HIT_TARGET,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  /* 8 by 14 around 13-point type, as `.button` is with a mouse. */
  buttonDense: {
    minHeight: 36,
  },
  squareDense: {
    width: 36,
    paddingHorizontal: 0,
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
    backgroundColor: theme.colors.surface3,
    borderColor: theme.colors.borderStrong,
    transform: [{ translateY: 1 }],
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
}))

import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLayout } from '../../shell/useLayout'
import { tip } from '../tip'
import { HIT_TARGET, radius } from '@selfmp3/client'

/**
 * The same three weights: 44px with a finger, and a shorter desktop height
 * where there is a mouse (`useLayout().dense`).
 *
 * An icon goes before the label (`<Play /> Play`); with no label at all it is
 * an icon-only button — the shuffle in the library header — which is square
 * rather than a pill.
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
   * On: a dim accent fill with an accent edge, for a button that toggles a
   * mode.
   */
  active?: boolean
  /** What a screen reader says when there is no label, or a fuller one: a square icon button. */
  accessibilityLabel?: string
}): ReactNode {
  const { dense } = useLayout()
  const inactive = disabled || busy
  const ink =
    variant === 'primary'
      ? styles.inkOnAccent
      : variant === 'danger'
        ? styles.inkDanger
        : styles.inkPlain

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      // An icon-only button has nothing on it to read; one with a label has said it.
      {...tip(label === undefined ? accessibilityLabel : undefined)}
      accessibilityState={{ disabled: inactive, selected: active }}
      style={({ pressed }) => [
        styles.button,
        dense && styles.buttonDense,
        label === undefined && (dense ? styles.squareDense : styles.square),
        grow && styles.grow,
        variant === 'primary' && styles.primary,
        variant === 'danger' && styles.danger,
        active && styles.active,
        pressed && !inactive && styles.pressed,
        inactive && styles.disabled,
      ]}
    >
      {busy ? (
        <Spinner variant={variant} />
      ) : (
        <View style={styles.content}>
          {icon}
          {label !== undefined ? (
            <Text style={[styles.label, ink]} numberOfLines={1}>
              {label}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  )
}

/**
 * The busy spinner, which is the one thing on a button whose colour has to be
 * a prop rather than a style. Kept apart so that reading the theme for it
 * re-renders a spinner nobody can see standing still, rather than every button
 * on the screen, on every step of a drag on the accent picker.
 */
function Spinner({ variant }: { variant: 'primary' | 'secondary' | 'danger' }): ReactNode {
  const { theme } = useUnistyles()
  return (
    <ActivityIndicator
      color={
        variant === 'primary'
          ? theme.colors.onAccent
          : variant === 'danger'
            ? theme.colors.danger
            : theme.colors.textPrimary
      }
    />
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
  // The accent's three appearances on a button, all from the palette, so the
  // picker recolours every button in the app without re-rendering one of them.
  primary: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  active: { backgroundColor: theme.colors.accentDim, borderColor: theme.colors.accent },
  inkOnAccent: { color: theme.colors.onAccent },
  inkDanger: { color: theme.colors.danger },
  inkPlain: { color: theme.colors.textPrimary },
}))

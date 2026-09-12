import type { ReactNode } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import { colors, HIT_TARGET, radius } from '@selfmp3/client'

/**
 * The web's `.icon-button`: a square target that darkens while pressed.
 *
 * 34px with a mouse; a phone has no mouse, so the default here is the web's
 * own touch size, `--hit-target`. The icon inside is the caller's, because
 * every icon already takes its own size and colour.
 */
export function IconButton({
  children,
  testID,
  onPress,
  label,
  size = HIT_TARGET,
  disabled = false,
  active = false,
  round = false,
}: {
  children: ReactNode
  testID?: string
  onPress: () => void
  /** What a screen reader says: "Pause", "Next", "Love". */
  label: string
  size?: number
  disabled?: boolean
  /** Toggled on, for anything that stays lit — shuffle, repeat, a loved heart. */
  active?: boolean
  round?: boolean
}): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={size < HIT_TARGET ? (HIT_TARGET - size) / 2 : 0}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size, borderRadius: round ? size / 2 : radius.sm },
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: colors.surface3,
  },
  disabled: {
    opacity: 0.4,
  },
})

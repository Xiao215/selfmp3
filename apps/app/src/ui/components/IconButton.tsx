import type { ReactNode } from 'react'
import { Pressable } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { HIT_TARGET, radius } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { tip } from '../tip'

/**
 * The web's `.icon-button`: a square target that darkens while pressed.
 *
 * 34px with a mouse, which is the default where there is one at desktop
 * width; otherwise the web's own touch size, `--hit-target`. The icon inside
 * is the caller's, because every icon already takes its own size and colour.
 */
export function IconButton({
  children,
  testID,
  onPress,
  label,
  size: sizeProp,
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
  const { dense } = useLayout()
  const size = sizeProp ?? (dense ? 34 : HIT_TARGET)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={size < HIT_TARGET ? (HIT_TARGET - size) / 2 : 0}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...tip(label)}
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

const styles = StyleSheet.create(theme => ({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: theme.colors.surface3,
  },
  disabled: {
    opacity: 0.4,
  },
}))

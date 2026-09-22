import type { ReactNode } from 'react'
import { Animated, Pressable } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { HIT_TARGET, withAlpha } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { usePressScale } from '../motion'
import { tip } from '../tip'

/**
 * A round target for an icon (docs/ui-mock `S2`).
 *
 * Bare by default — the transport, a row's ⋯ — and a veil while pressed.
 * `filled` puts it on the control surface, 40 across on a phone and 36 with a
 * mouse: the + and the sort in a page's header, anything that sits on its own.
 * Either way it is round and sinks to 0.96 on the spring while pressed. The
 * icon inside is the caller's, because every icon already takes its own size
 * and colour.
 */
export function IconButton({
  children,
  testID,
  onPress,
  label,
  size: sizeProp,
  disabled = false,
  active = false,
  filled = false,
  caption,
}: {
  children: ReactNode
  testID?: string
  onPress: () => void
  /** What a screen reader says: "Pause", "Next", "Like". */
  label: string
  /** The hover caption, when a shorter one than the label reads better: "Edit tags". */
  caption?: string
  size?: number
  disabled?: boolean
  /** Toggled on, for anything that stays lit — shuffle, repeat, a loved heart. */
  active?: boolean
  /** On the control surface, for a button standing on its own in a header. */
  filled?: boolean
}): ReactNode {
  const { dense } = useLayout()
  const press = usePressScale()
  const size = sizeProp ?? (dense ? (filled ? 36 : 34) : filled ? 40 : HIT_TARGET)
  return (
    /*
     * The press's scale wants the button's own size, not whatever a parent
     * gives it. Left to stretch — a direct child of a page's column, as the
     * way back from Profile is — the wrapper was as wide as the page, and
     * scaling that about its centre walked the button ten points to the
     * right every time it was pressed.
     */
    <Animated.View style={[press.style, { width: size, height: size }]}>
      <Pressable
        {...press.handlers}
        onPress={onPress}
        disabled={disabled}
        hitSlop={size < HIT_TARGET ? (HIT_TARGET - size) / 2 : 0}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        {...tip(caption ?? label)}
        accessibilityState={{ disabled, selected: active }}
        style={({ pressed }) => [
          styles.button,
          { width: size, height: size, borderRadius: size / 2 },
          filled && styles.filled,
          pressed && !disabled && (filled ? styles.filledPressed : styles.pressed),
          disabled && styles.disabled,
        ]}
      >
        {children}
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create(theme => ({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  filled: {
    backgroundColor: theme.colors.surface2,
  },
  filledPressed: {
    backgroundColor: theme.colors.surface3,
  },
  /* A light veil rather than a surface: over a song-coloured page a solid box read as a dark square. */
  pressed: {
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.1),
  },
  disabled: {
    opacity: 0.4,
  },
}))

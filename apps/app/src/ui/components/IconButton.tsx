import type { ReactNode } from 'react'
import { StyleSheet } from 'react-native-unistyles'
import { HIT_TARGET, hitSlopFor, iconSize } from '@selfmp3/client'
import { OPACITY } from '../motion.model'
import { useLayoutValue } from '../../shell/useLayout'
import { tip } from '../tip'
import { Press } from './Press'
import { sizedIcon } from './Icons'

/**
 * A round target for an icon (docs/ui-mock `S2`).
 *
 * Bare by default — the transport, a row's ⋯ — and a veil while pressed.
 * `filled` puts it on the control surface, 40 across on a phone and 36 with a
 * mouse: the + and the sort in a page's header, anything that sits on its own.
 * `filled="primary"` is the white round of the one thing to do now (Ask's
 * Stop), and `filled="accent"` the accent's (a field's send).
 * Either way it is round and sinks to 0.96 on the spring while pressed. The
 * icon inside is the caller's, with its colour; it is drawn at
 * `iconSize.medium` unless the caller sizes it (the transport, a ring).
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
  onFocus,
  onBlur,
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
  /** On the control surface, for a button standing on its own in a header; or white, or the accent. */
  filled?: boolean | 'primary' | 'accent'
  /** For a button that only shows itself on hover or keyboard focus. */
  onFocus?: () => void
  onBlur?: () => void
}): ReactNode {
  const dense = useLayoutValue(layout => layout.dense)
  const size = sizeProp ?? (dense ? (filled ? 36 : 34) : filled ? 40 : HIT_TARGET)
  return (
    /*
     * The press's scale wants the button's own size, not whatever a parent
     * gives it. Left to stretch — a direct child of a page's column, as the
     * way back from Profile is — the wrapper was as wide as the page, and
     * scaling that about its centre walked the button ten points to the
     * right every time it was pressed.
     */
    <Press
      depth="control"
      wrap={{ width: size, height: size }}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      disabled={disabled}
      hitSlop={hitSlopFor(size)}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...tip(caption ?? label)}
      accessibilityState={{ disabled, selected: active }}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size, borderRadius: size / 2 },
        filled === true && styles.filled,
        filled === 'primary' && styles.primary,
        filled === 'accent' && styles.accent,
        pressed &&
          !disabled &&
          (filled === true ? styles.filledPressed : filled ? styles.inkPressed : styles.pressed),
        disabled && styles.disabled,
      ]}
    >
      {sizedIcon(children, iconSize.medium, 'fill')}
    </Press>
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
  primary: { backgroundColor: theme.colors.textPrimary },
  accent: { backgroundColor: theme.colors.accent },
  inkPressed: { opacity: OPACITY.pressed },
  /* A light veil rather than a surface: over a song-coloured page a solid box read as a dark square. */
  pressed: {
    backgroundColor: theme.colors.veilPressed,
  },
  disabled: {
    opacity: OPACITY.disabled,
  },
}))

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Animated, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLayout } from '../../shell/useLayout'
import { useFade, useMinimumBusy, usePressScale, usePresence } from '../motion'
import { tip } from '../tip'
import { HIT_TARGET, motion, radius } from '@selfmp3/client'

/**
 * A button, in one of the design's shapes and no others (docs/ui-mock `S2`,
 * "Parts, as drawn"):
 *
 * - `secondary`, the **tonal pill**: a control-surface fill, no edge. Most
 *   buttons are this.
 * - `primary`, the **commit pill**: the accent filled in, kept for the one
 *   button that commits something (Import, Show songs, Save).
 * - `text`, the **text action**: accent ink and nothing behind it.
 * - `danger`: a tonal pill whose ink says it removes something.
 *
 * The fourth shape, the round white Play, is `PlayButton` below; a page has at
 * most one.
 *
 * 44 high with a finger, 36 where there is a mouse (`useLayout().dense`). An
 * icon goes before the label; with no label at all it is round. Everything
 * sinks to 0.96 on the spring while pressed.
 *
 * Busy, the spinner crossfades with the icon over `motion.fast` rather than
 * cutting it out, and once shown it stays for at least `MOVE_MS.busyHold`
 * (`useMinimumBusy`), so a press answered in fifty milliseconds does not flash a
 * spinner and take it away again.
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
  variant?: 'primary' | 'secondary' | 'danger' | 'text'
  disabled?: boolean
  busy?: boolean
  /** Take the row's spare width, so a group of buttons shares a line evenly. */
  grow?: boolean
  /** On: white, as a chosen chip is, for a button that toggles a mode. */
  active?: boolean
  /** What a screen reader says when there is no label, or a fuller one: a square icon button. */
  accessibilityLabel?: string
}): ReactNode {
  const { dense } = useLayout()
  const press = usePressScale()
  // What the button *does* follows `busy`; what it *shows* follows the held
  // spinner, so the extra moment a spinner is kept never blocks a second press.
  const inactive = disabled || busy
  const spin = useMinimumBusy(busy)
  // Kept mounted for as long as its fade out takes, so the swap is a crossfade
  // rather than a cut. Both halves are the same length: a crossfade with a
  // shorter exit leaves a frame with neither thing on it.
  const spinner = usePresence(spin, motion.fast, motion.fast)
  const iconShown = useFade(!spin, motion.fast, motion.fast)
  const iconFade = useMemo(() => ({ opacity: iconShown }), [iconShown])
  const spinnerFade = useMemo(() => ({ opacity: spinner.progress }), [spinner.progress])
  const ink = active
    ? styles.inkOnPrimary
    : variant === 'primary'
      ? styles.inkOnAccent
      : variant === 'danger'
        ? styles.inkDanger
        : variant === 'text'
          ? styles.inkAccent
          : styles.inkPlain

  return (
    <Animated.View
      style={[
        grow && styles.grow,
        grow && (dense ? styles.growDense : styles.growTouch),
        press.style,
      ]}
    >
      <Pressable
        {...press.handlers}
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
          variant === 'text' && styles.text,
          active && styles.active,
          pressed && !inactive && styles.pressed,
          inactive && styles.disabled,
        ]}
      >
        <View style={styles.content}>
          {/* Busy takes the icon's place and leaves the label, so a button can
            say what it is doing — "Removing…" — while it spins. With no label
            there is nothing to say and the spinner is the whole button.
            With an icon to replace, the spinner is laid over it and the two
            crossfade in the same slot, so the button's width never changes;
            with no icon it takes its own room, as it always did. */}
          {icon || spinner.mounted ? (
            <View style={styles.badge}>
              {icon ? <Animated.View style={iconFade}>{icon}</Animated.View> : null}
              {spinner.mounted ? (
                <Animated.View style={[icon ? styles.overIcon : undefined, spinnerFade]}>
                  <Spinner variant={variant} />
                </Animated.View>
              ) : null}
            </View>
          ) : null}
          {label !== undefined ? (
            <Text style={[styles.label, ink]} numberOfLines={1}>
              {label}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  )
}

/**
 * The round white Play (`S2`): 56 across, the one primary on a page. Its icon
 * is the caller's, so it can be Play or Pause.
 */
export function PlayButton({
  testID,
  label,
  icon,
  onPress,
  size = 56,
  disabled = false,
}: {
  testID?: string
  /** What a screen reader says: "Play", "Pause", "Play Evening". */
  label: string
  icon: ReactNode
  onPress: () => void
  size?: number
  disabled?: boolean
}): ReactNode {
  const press = usePressScale()
  return (
    <Animated.View style={press.style}>
      <Pressable
        {...press.handlers}
        onPress={onPress}
        disabled={disabled}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        {...tip(label)}
        accessibilityState={{ disabled }}
        style={[
          styles.play,
          { width: size, height: size, borderRadius: size / 2 },
          disabled && styles.disabled,
        ]}
      >
        {icon}
      </Pressable>
    </Animated.View>
  )
}

/**
 * The busy spinner, which is the one thing on a button whose colour has to be
 * a prop rather than a style. Kept apart so that reading the theme for it
 * re-renders a spinner nobody can see standing still, rather than every button
 * on the screen, on every step of a drag on the accent picker.
 */
function Spinner({ variant }: { variant: 'primary' | 'secondary' | 'danger' | 'text' }): ReactNode {
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
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
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
  text: {
    backgroundColor: 'transparent',
    paddingHorizontal: 8,
  },
  square: {
    width: HIT_TARGET,
    paddingHorizontal: 0,
  },
  /*
   * `flex: 1` on the wrapper as well as the button, so a row of them shares its
   * width. In a column — a phone's dialog stacks its buttons — `flex: 1` starts
   * from nothing and the wrapper had no height of its own, so the buttons fell
   * on top of one another; it keeps the button's own height at least.
   */
  growTouch: { minHeight: HIT_TARGET },
  growDense: { minHeight: 36 },
  grow: {
    flex: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  // The icon's slot, which the spinner shares with it.
  badge: { alignItems: 'center', justifyContent: 'center' },
  overIcon: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: theme.colors.surface3,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  play: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.textPrimary,
  },
  // The accent's three appearances on a button, all from the palette, so the
  // picker recolours every button in the app without re-rendering one of them.
  primary: { backgroundColor: theme.colors.accent },
  active: { backgroundColor: theme.colors.textPrimary },
  inkOnAccent: { color: theme.colors.onAccent },
  inkAccent: { color: theme.colors.accent },
  inkOnPrimary: { color: theme.colors.onPrimary },
  inkDanger: { color: theme.colors.danger },
  inkPlain: { color: theme.colors.textPrimary },
}))

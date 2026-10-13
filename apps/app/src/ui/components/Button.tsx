import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Animated, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLayoutValue } from '../../shell/useLayout'
import { useMinimumBusy, usePresence } from '../motion'
import { tip } from '../tip'
import { Press } from './Press'
import { HIT_TARGET, iconSize, motion, radius, type, withAlpha } from '@selfmp3/client'
import { sizedIcon } from './Icons'

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
 * 44 high with a finger, 36 where there is a mouse (`useLayoutValue`, `dense`).
 * `size="small"` is the quiet one in a line of words: 28 high, its label a
 * size down — Import's "Show 4 more", the tag sheet's "Clear all", Now
 * Playing's Stop. `ground="translucent"` gives a pill a veil of the ink
 * rather than a surface, for a pill over a song-coloured page, where a solid
 * one reads as a dark box. An icon goes before the label; with no label at
 * all it is round. Everything sinks to 0.96 on the spring while pressed.
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
  size = 'regular',
  ground = 'solid',
  expanded,
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
  /** The quiet one in a line of words: 28 high, a size down. */
  size?: 'regular' | 'small'
  /** A veil of the ink instead of the control surface, over a song's colour. */
  ground?: 'solid' | 'translucent'
  /** For a button that shows or hides more: whether it is showing it. */
  expanded?: boolean
  /** What a screen reader says when there is no label, or a fuller one: a square icon button. */
  accessibilityLabel?: string
}): ReactNode {
  const dense = useLayoutValue(layout => layout.dense)
  const small = size === 'small'
  // What the button *does* follows `busy`; what it *shows* follows the held
  // spinner, so the extra moment a spinner is kept never blocks a second press.
  const inactive = disabled || busy
  const spin = useMinimumBusy(busy)
  // Kept mounted for as long as its fade out takes, so the swap is a crossfade
  // rather than a cut. Both halves are the same length: a crossfade with a
  // shorter exit leaves a frame with neither thing on it. The icon is the
  // spinner's fade turned round, one value for the two of them.
  const spinner = usePresence(spin, motion.fast, motion.fast)
  const iconFade = useMemo(
    () => ({ opacity: spinner.progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }),
    [spinner.progress],
  )
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
    <Press
      depth="control"
      wrap={[grow && styles.grow, grow && (dense ? styles.growDense : styles.growTouch)]}
      onPress={onPress}
      disabled={inactive}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      // An icon-only button has nothing on it to read; one with a label has said it.
      {...tip(label === undefined ? accessibilityLabel : undefined)}
      accessibilityState={{ disabled: inactive, selected: active, expanded }}
      hitSlop={small ? { top: 8, bottom: 8 } : undefined}
      style={({ pressed }) => [
        styles.button,
        dense && styles.buttonDense,
        small && styles.small,
        label === undefined &&
          (small ? styles.squareSmall : dense ? styles.squareDense : styles.square),
        grow && styles.grow,
        ground === 'translucent' && styles.translucent,
        variant === 'primary' && styles.primary,
        variant === 'text' && (small ? styles.textSmall : styles.text),
        active && styles.active,
        pressed &&
          !inactive &&
          (ground === 'translucent' ? styles.translucentPressed : styles.pressed),
        inactive && styles.disabled,
      ]}
    >
      <View style={[styles.content, small && styles.contentSmall]}>
        {/* Busy takes the icon's place and leaves the label, so a button can
          say what it is doing — "Removing…" — while it spins. With no label
          there is nothing to say and the spinner is the whole button.
          With an icon to replace, the spinner is laid over it and the two
          crossfade in the same slot, so the button's width never changes;
          with no icon it takes its own room. */}
        {icon || spinner.mounted ? (
          <View style={styles.badge}>
            {icon ? (
              <Animated.View style={iconFade}>
                {sizedIcon(icon, small ? iconSize.sub : iconSize.button)}
              </Animated.View>
            ) : null}
            {spinner.mounted ? (
              <Animated.View style={[icon ? styles.overIcon : undefined, spinnerFade]}>
                <Spinner variant={variant} />
              </Animated.View>
            ) : null}
          </View>
        ) : null}
        {label !== undefined ? (
          <Text style={[styles.label, small && styles.labelSmall, ink]} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
      </View>
    </Press>
  )
}

/** The round Play's glyph, for a round `size` across: 24 in the 56. */
export function playGlyph(size: number): number {
  return Math.round(size * 0.43)
}

/**
 * The round white Play (`S2`): 56 across, the one primary on a page. Its icon
 * is the caller's, so it can be Play or Pause, drawn at `playGlyph` unless
 * the caller sizes it.
 */
export function PlayButton({
  testID,
  label,
  icon,
  onPress,
  size = 56,
  disabled = false,
  busy = false,
}: {
  testID?: string
  /** What a screen reader says: "Play", "Pause", "Play Evening". */
  label: string
  icon: ReactNode
  onPress: () => void
  size?: number
  disabled?: boolean
  /** Waiting on the track: said to a screen reader; the icon draws it (`PlayPauseButton`). */
  busy?: boolean
}): ReactNode {
  return (
    <Press
      depth="control"
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...tip(label)}
      accessibilityState={{ disabled, busy }}
      style={[
        styles.play,
        { width: size, height: size, borderRadius: size / 2 },
        disabled && styles.disabled,
      ]}
    >
      {sizedIcon(icon, playGlyph(size), 'fill')}
    </Press>
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
  /* With a mouse: 36 high rather than a finger's 44. */
  buttonDense: {
    minHeight: 36,
  },
  squareDense: {
    width: 36,
    paddingHorizontal: 0,
  },
  small: { minHeight: 28, paddingHorizontal: 10 },
  squareSmall: { width: 28, paddingHorizontal: 0 },
  textSmall: { backgroundColor: 'transparent', paddingHorizontal: 4 },
  contentSmall: { gap: 4 },
  labelSmall: { fontSize: type.small },
  translucent: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.08) },
  translucentPressed: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.14) },
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
    fontSize: type.body,
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

import type { ReactNode } from 'react'
import { Animated, Pressable, Text } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { usePressScale } from '../motion'
import { hitSlopFor, leading, radius, type, iconSize, space } from '@selfmp3/client'
import { Check, sizedIcon } from './Icons'
import { Press } from './Press'
import { TagDot } from './TagDot'
import { plural } from '@selfmp3/shared'
import { CONTROL_SCALE } from '../textScale'

/**
 * A chip (docs/ui-mock `S2`, "Parts, as drawn"): a neutral pill. A tag carries
 * a dot of its hue before its name; a chip with no hue is a plain one — the
 * "All" in Library's strip, the "on this phone" switch.
 *
 * Two faces: off, and chosen. **Chosen is white** with dark ink, whatever the
 * tag's hue, so a row of nine tags in nine hues is one quiet row with the
 * chosen ones plainly lit — the difference is light against dark, which
 * survives a glance, a dark room and a colour-blind reader.
 *
 * `choice` adds a check to the chosen state, for a chip picked from a set.
 * A chip reading a choice back leaves it off, because it carries an × instead.
 *
 * `count` puts the tag's song count on the pill, dimmed.
 *
 * A finger's target on a phone: 8 by 14 around 13-point text. `compact` is
 * the smaller chip for a row with a mouse. `onRemove` adds the ×, which says
 * "Remove tag <name>" unless `removeLabel` says better (an artist's chip).
 * `dashed` is the add chip: an outline and no fill, for "+ tag", whose
 * `accessibilityLabel` can say more than its two words.
 *
 * A chip is a toggle; `role="link"` makes it a way to a place instead — the
 * Settings index on a phone, whose lit chip is the section on screen.
 * `onLayout` reports where it sits in its row, for a row that scrolls the lit
 * one into view.
 */
export function Chip({
  testID,
  label,
  selected,
  hue,
  icon,
  count,
  choice = false,
  compact = false,
  dashed = false,
  onPress,
  onRemove,
  removeLabel,
  accessibilityLabel,
  onLayout,
  role = 'button',
}: {
  testID?: string
  label: string
  selected: boolean
  hue?: number
  icon?: ReactNode
  count?: number
  choice?: boolean
  compact?: boolean
  dashed?: boolean
  onPress: () => void
  onRemove?: () => void
  /** What the × says: "Remove tag <name>" by default. */
  removeLabel?: string
  /** What the chip says, when its label is too short to: "Add a tag it fills from". */
  accessibilityLabel?: string
  onLayout?: (event: LayoutChangeEvent) => void
  role?: 'button' | 'link'
}): ReactNode {
  const { theme } = useUnistyles()
  const press = usePressScale()
  const text = selected ? theme.colors.onPrimary : theme.colors.textPrimary

  const padding = compact ? styles.labelCompact : styles.labelStrip

  const name = (
    <Text
      style={[styles.label, { color: text }]}
      numberOfLines={1}
      maxFontSizeMultiplier={CONTROL_SCALE}
    >
      {label}
    </Text>
  )

  return (
    <Animated.View
      testID={testID}
      onLayout={onLayout}
      style={[
        styles.chip,
        selected ? styles.chipSelected : dashed ? styles.chipDashed : styles.chipOff,
        press.style,
      ]}
    >
      <Pressable
        {...press.handlers}
        onPress={onPress}
        accessibilityRole={role}
        accessibilityLabel={
          accessibilityLabel ??
          (count === undefined ? label : `${label}, ${plural(count, 'song', 'songs')}`)
        }
        accessibilityState={{ selected }}
        // react-native-web does not turn `accessibilityState` into anything a
        // browser reads, so the state is said here too: pressed for a toggle,
        // the current place for a link.
        aria-pressed={role === 'button' ? selected : undefined}
        aria-current={role === 'link' && selected ? 'page' : undefined}
        style={({ pressed }) => [
          styles.press,
          padding,
          onRemove !== undefined && styles.beforeRemove,
          pressed && styles.pressed,
        ]}
      >
        {sizedIcon(icon, iconSize.small)}
        {hue === undefined ? null : <TagDot hue={hue} size={7} />}
        {choice && selected ? (
          <Check size={compact ? iconSize.tiny : iconSize.small} color={text} />
        ) : null}
        {name}
        {count === undefined ? null : (
          <Text style={[styles.count, { color: text }]} maxFontSizeMultiplier={CONTROL_SCALE}>
            {count}
          </Text>
        )}
      </Pressable>
      {onRemove ? (
        // Its own press: the chip around it is a separate target with a separate answer.
        <Press
          feedback="dim"
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={removeLabel ?? `Remove tag ${label}`}
          hitSlop={hitSlopFor(leading.body)}
          style={styles.remove}
        >
          <Text style={[styles.removeGlyph, { color: text }]} maxFontSizeMultiplier={CONTROL_SCALE}>
            ×
          </Text>
        </Press>
      ) : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create(theme => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
  },
  chipOff: { backgroundColor: theme.colors.surface2 },
  chipSelected: { backgroundColor: theme.colors.textPrimary },
  // The add chip is the one drawn by its edge: it is a place something will go.
  chipDashed: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  // Both give way in a chip held narrower than its name (a song page's long
  // tag), so the name ends in "…" rather than running off the display.
  press: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tight,
    flexShrink: 1,
    minWidth: 0,
  },
  labelStrip: { paddingHorizontal: space.roomy, paddingVertical: space.sm },
  labelCompact: { paddingHorizontal: space.snug, paddingVertical: 5 },
  beforeRemove: { paddingRight: 2 },
  pressed: {
    opacity: 0.8,
  },
  count: { fontSize: type.tiny, fontWeight: '500', opacity: 0.6, fontVariant: ['tabular-nums'] },
  label: {
    fontSize: type.sub,
    fontWeight: '500',
    flexShrink: 1,
  },
  remove: { paddingLeft: 2, paddingRight: space.snug },
  removeGlyph: { fontSize: type.body, opacity: 0.6 },
}))

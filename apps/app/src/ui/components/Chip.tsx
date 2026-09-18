import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useAccent } from '../accent'
import { tagColors, type } from '@selfmp3/client'
import { Check } from './Icons'

/**
 * A tag: a pill in the tag's own hue. With no hue it is a plain chip in the
 * app's accent — the "on this phone" switch.
 *
 * Two faces for a tag: off, and chosen. There is no third — every tag you turn
 * on adds its songs to the list, so "hide these" has nothing left to mean.
 *
 * **Off is hollow, chosen is filled.** They used to be the same pill at two
 * brightnesses one step apart, which on a phone, among nine tags in nine
 * different hues, told you nothing: brighter than what? Now the off chip has
 * no fill at all — an edge in the tag's colour and the name inside it — and
 * the chosen one is that colour filled in, ringed, with ink that reads on it.
 * The difference survives a glance, a dark room and a colour-blind reader,
 * because it is shape before it is colour.
 *
 * `choice` adds a check to the chosen state: it is for a chip you are picking
 * from a set of them, where several are on show and only some are on. A chip
 * that is reading a choice back — the tags in the library's title, the ones a
 * playlist follows — leaves it off, because it carries an × instead and a row
 * of ✓× is noise.
 *
 * `count` puts the tag's song count on the pill, dimmed, for the places where
 * a tag is being weighed up rather than read back: the picker offers it,
 * the chips in a heading do not.
 *
 * A finger's target on a phone: 8 by 12 points of padding around 12-point
 * text. `compact` is the smaller chip, 5 by 10, for a row with a mouse.
 * `onRemove` adds the ×.
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
  onPress,
  onLongPress,
  onRemove,
}: {
  testID?: string
  label: string
  selected: boolean
  hue?: number
  icon?: ReactNode
  count?: number
  choice?: boolean
  compact?: boolean
  onPress: () => void
  onLongPress?: () => void
  onRemove?: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const palette = tagColors(hue ?? accent.hue)
  // A chip with no hue of its own is not a tag, so its off state stays the
  // app's grey rather than borrowing the accent's colour for an edge.
  const plain = hue === undefined && !selected
  const background = selected ? palette.activeBackground : 'transparent'
  const border = plain
    ? theme.colors.borderStrong
    : selected
      ? palette.activeOutline
      : palette.outline
  const text = plain ? theme.colors.textSecondary : selected ? palette.activeText : palette.text

  const padding = compact ? styles.labelCompact : styles.labelStrip

  const name = (
    <Text style={[styles.label, { color: text }]} numberOfLines={1}>
      {label}
    </Text>
  )

  return (
    <View
      testID={testID}
      style={[styles.chip, { backgroundColor: background, borderColor: border }]}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={450}
        accessibilityRole="button"
        accessibilityLabel={
          count === undefined ? label : `${label}, ${count} ${count === 1 ? 'song' : 'songs'}`
        }
        accessibilityState={{ selected }}
        style={({ pressed }) => [
          styles.press,
          padding,
          onRemove !== undefined && styles.beforeRemove,
          pressed && styles.pressed,
        ]}
      >
        {icon}
        {choice && selected ? <Check size={compact ? 11 : 12} color={text} /> : null}
        {name}
        {count === undefined ? null : <Text style={[styles.count, { color: text }]}>{count}</Text>}
      </Pressable>
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Remove tag ${label}`}
          hitSlop={6}
          style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
        >
          <Text style={[styles.removeGlyph, { color: text }]}>×</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(() => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    // Both states carry the edge, so turning one on never moves the row.
    borderWidth: 1,
  },
  press: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  // A point off each side, for the border that is now always there: the chip
  // is the size it has always been.
  labelStrip: { paddingHorizontal: 11, paddingVertical: 7 },
  labelCompact: { paddingHorizontal: 9, paddingVertical: 4 },
  beforeRemove: { paddingRight: 2 },
  pressed: {
    opacity: 0.7,
  },
  count: { fontSize: type.tiny, fontWeight: '500', opacity: 0.6, fontVariant: ['tabular-nums'] },
  label: {
    fontSize: type.small,
    fontWeight: '500',
  },
  remove: { paddingLeft: 2, paddingRight: 8 },
  removeGlyph: { fontSize: 14, opacity: 0.6 },
}))

import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useAccent } from '../accent'
import { tagColors, type } from '@selfmp3/client'

/**
 * A tag: a pill in the tag's own hue, brighter when it is the filter. With no
 * hue it is a plain chip in the app's accent — the sort field, the
 * "downloaded only" switch.
 *
 * Two faces for a tag: off, and chosen. There is no third — every tag you turn
 * on adds its songs to the list, so "hide these" has nothing left to mean.
 *
 * `count` puts the tag's song count on the pill, dimmed, for the places where
 * a tag is being weighed up rather than read back: the picker offers it,
 * the chips in a heading do not.
 *
 * A finger's target on a phone: 8 by 12 points of padding around 12-point
 * text. `compact` is the ordinary chip, 5 by 10, for the "Filtered by" row.
 * `onRemove` adds the ×.
 */
export function Chip({
  testID,
  label,
  selected,
  hue,
  icon,
  count,
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
  compact?: boolean
  onPress: () => void
  onLongPress?: () => void
  onRemove?: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const palette = tagColors(hue ?? accent.hue)
  const background =
    hue === undefined && !selected
      ? theme.colors.surface2
      : selected
        ? palette.activeBackground
        : palette.background
  const text =
    hue === undefined && !selected
      ? theme.colors.textSecondary
      : selected
        ? palette.activeText
        : palette.text

  const padding = compact ? styles.labelCompact : styles.labelStrip

  const name = (
    <Text style={[styles.label, { color: text }]} numberOfLines={1}>
      {label}
    </Text>
  )

  return (
    <View testID={testID} style={[styles.chip, { backgroundColor: background }]}>
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
  },
  press: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  labelStrip: { paddingHorizontal: 12, paddingVertical: 8 },
  labelCompact: { paddingHorizontal: 10, paddingVertical: 5 },
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

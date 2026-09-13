import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useAccent } from '../accent'
import { oklchToHexAlpha, tagColors, type } from '@selfmp3/client'

/**
 * A tag, as the web draws it: a pill in the tag's own hue, brighter when it
 * is the filter. With no hue it is a plain chip in the app's accent — the
 * sort field, the "downloaded only" switch.
 *
 * Three faces for a tag, as on the web: off, showing only it (`selected`),
 * and hiding it (`excluded`), which draws the pill quiet with an outline in
 * the tag's hue and a red "not" in front of the name.
 *
 * A finger's target on a phone (`.mobile-tag-strip .tag-chip`): 8 by 12
 * points of padding around 12-point text. `compact` is the web's ordinary
 * chip, 5 by 10, for the "Filtered by" row. `onRemove` adds the ×.
 */
export function Chip({
  testID,
  label,
  selected,
  excluded = false,
  hue,
  icon,
  compact = false,
  onPress,
  onLongPress,
  onRemove,
}: {
  testID?: string
  label: string
  selected: boolean
  excluded?: boolean
  hue?: number
  icon?: ReactNode
  compact?: boolean
  onPress: () => void
  onLongPress?: () => void
  onRemove?: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const palette = tagColors(hue ?? accent.hue)
  const background = excluded
    ? theme.colors.surface2
    : hue === undefined && !selected
      ? theme.colors.surface2
      : selected
        ? palette.activeBackground
        : palette.background
  const text = excluded
    ? theme.colors.textSecondary
    : hue === undefined && !selected
      ? theme.colors.textSecondary
      : selected
        ? palette.activeText
        : palette.text

  const padding = compact ? styles.labelCompact : styles.labelStrip
  // The web draws the excluded outline as an inset shadow, which takes no
  // room; a border does, so the padding gives the point back.
  const edge = excluded
    ? { borderWidth: 1, borderColor: oklchToHexAlpha(0.5, 0.1, hue ?? accent.hue, 0.55) }
    : null

  const name = (
    <Text style={[styles.label, { color: text }]} numberOfLines={1}>
      {excluded ? <Text style={styles.not}>NOT </Text> : null}
      {label}
    </Text>
  )

  return (
    <View testID={testID} style={[styles.chip, { backgroundColor: background }, edge]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={450}
        accessibilityRole="button"
        accessibilityLabel={excluded ? `not ${label}` : label}
        accessibilityState={{ selected: selected || excluded }}
        style={({ pressed }) => [
          styles.press,
          padding,
          excluded && styles.inset,
          onRemove !== undefined && styles.beforeRemove,
          pressed && styles.pressed,
        ]}
      >
        {icon}
        {name}
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

const styles = StyleSheet.create(theme => ({
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
  inset: { margin: -1 },
  beforeRemove: { paddingRight: 2 },
  pressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: type.small,
    fontWeight: '500',
  },
  not: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.24,
    color: theme.colors.danger,
  },
  remove: { paddingLeft: 2, paddingRight: 8 },
  removeGlyph: { fontSize: 14, opacity: 0.6 },
}))

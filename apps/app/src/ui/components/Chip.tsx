import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { useAccent } from '../accent'
import { colors, tagColors, type } from '@selfmp3/client'

/**
 * A tag, as the web draws it: a pill in the tag's own hue, brighter when it
 * is the filter. With no hue it is a plain chip in the app's accent — the
 * sort field, the "downloaded only" switch.
 *
 * A finger's target on a phone (`.mobile-tag-strip .tag-chip`): 8px by 12px
 * of padding around 12px text, not the sidebar's label-sized version.
 */
export function Chip({
  testID,
  label,
  selected,
  hue,
  icon,
  onPress,
  onLongPress,
}: {
  testID?: string
  label: string
  selected: boolean
  hue?: number
  icon?: ReactNode
  onPress: () => void
  onLongPress?: () => void
}): ReactNode {
  const accent = useAccent()
  const palette = tagColors(hue ?? accent.hue)
  const background =
    hue === undefined && !selected
      ? colors.surface2
      : selected
        ? palette.activeBackground
        : palette.background
  const text =
    hue === undefined && !selected
      ? colors.textSecondary
      : selected
        ? palette.activeText
        : palette.text

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: background },
        pressed && styles.pressed,
      ]}
    >
      {icon}
      <Text style={[styles.label, { color: text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: type.small,
    fontWeight: '500',
  },
})

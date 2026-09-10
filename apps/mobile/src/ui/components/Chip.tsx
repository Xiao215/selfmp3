import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { colors, space, type } from '../theme'

/** A small toggle: tag filters, sort fields, the downloaded-only switch. */
export function Chip({
  label,
  selected,
  hue,
  onPress,
}: {
  label: string
  selected: boolean
  hue?: number
  onPress: () => void
}): ReactNode {
  const tint = hue === undefined ? colors.accent : `hsl(${hue}, 60%, 68%)`

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && { borderColor: tint, backgroundColor: colors.surface2 },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, selected && { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    color: colors.textSecondary,
    fontSize: type.small,
    fontWeight: '500',
  },
})

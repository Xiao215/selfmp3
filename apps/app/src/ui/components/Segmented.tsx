import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { radius } from '@selfmp3/client'

/**
 * A row of mutually exclusive choices. For a range or a mode, where every
 * option is worth seeing at once.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  /** What is being chosen, e.g. "Time range". */
  label: string
}): ReactNode {
  return (
    <View style={styles.group} role="group" accessibilityLabel={label}>
      {options.map(option => (
        <Segment
          key={option.value}
          label={option.label}
          active={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  )
}

function Segment({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}): ReactNode {
  const [hovered, setHovered] = useState(false)
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      aria-pressed={active}
      style={({ pressed }) => [
        styles.item,
        (hovered || pressed) && !active && styles.itemHovered,
        active && styles.itemActive,
      ]}
    >
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create(theme => ({
  // A pill on the control surface; the chosen segment is a lighter pill inside
  // it (`S2`, "Selected segment"). Tone, not an edge.
  group: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: 2,
    padding: 3,
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.pill,
  },
  item: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: radius.pill },
  itemHovered: { backgroundColor: theme.colors.surface3 },
  itemActive: { backgroundColor: theme.colors.surfaceSelected },
  label: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600' },
  labelActive: { color: theme.colors.textPrimary },
}))

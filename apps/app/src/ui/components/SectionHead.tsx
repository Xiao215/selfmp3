import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space, type } from '@selfmp3/client'
import { sectionTitle } from '../surfaces'

/**
 * A section's heading inside a page: its name in the display face at 18, and
 * at the other end, when there is more than the section shows, a link to the
 * rest — "All 9", "See all", "Library". One heading for every page, so the
 * same kind of thing reads as one.
 *
 * The small uppercase label (`label()` in surfaces) stays what it is for: a
 * quiet name over a group of settings or a card's figure, not a section.
 */
export function SectionHead({
  title,
  action,
  testID,
  style,
}: {
  title: string
  action?: { label: string; onPress: () => void; accessibilityLabel?: string } | null
  /** The link's, for a flow to press it. */
  testID?: string
  style?: StyleProp<ViewStyle>
}): ReactNode {
  return (
    <View style={[styles.head, style]}>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="link"
          accessibilityLabel={action.accessibilityLabel ?? action.label}
          hitSlop={8}
          testID={testID}
        >
          <Text style={styles.link}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
  },
  title: { ...sectionTitle(theme.colors), flexShrink: 1 },
  link: { color: theme.colors.accent, fontSize: type.sub, fontWeight: '600' },
}))

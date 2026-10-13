import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space, type } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { label, sectionTitle } from '../surfaces'
import { ChevronDown, ChevronRight } from './Icons'

/**
 * A section's heading inside a page: its name in the display face at 18, and
 * at the other end, when there is more than the section shows, a link to the
 * rest — "All 9", "See all", "Library". One heading for every page, so the
 * same kind of thing reads as one, and every one of them is a header to a
 * screen reader.
 *
 * - `aside`: quiet words about the section beside its name ("12 songs you
 *   liked…", "120 BPM, bright"); on a phone they go under it, where there is
 *   room for them.
 * - `collapsible`: the name folds the section away and back, with a chevron
 *   that says which, as Forgotten gems does.
 * - `end`: buttons in place of the link, at the far end.
 * - `look="label"`: the small uppercase name (`label()` in surfaces), for a
 *   quiet group inside a sheet or a list — Import's lists, a room's shelves —
 *   rather than a section of a page.
 */
export function SectionHead({
  title,
  lead,
  aside,
  action,
  end,
  collapsible,
  look = 'section',
  testID,
  titleTestID,
  style,
}: {
  title: string
  /** Before the name: a face, an icon. */
  lead?: ReactNode
  aside?: string
  action?: { label: string; onPress: () => void; accessibilityLabel?: string } | null
  end?: ReactNode
  collapsible?: { collapsed: boolean; onToggle: () => void }
  look?: 'section' | 'label'
  /** The link's, for a flow to press it. */
  testID?: string
  /** The name's, for a flow to find the section by. */
  titleTestID?: string
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const wide = useLayoutValue(layout => layout.wide)
  const name = (
    <Text
      style={look === 'label' ? styles.label : styles.title}
      accessibilityRole="header"
      numberOfLines={1}
      testID={titleTestID}
    >
      {title}
    </Text>
  )
  const words = aside ? (
    <Text style={styles.aside} numberOfLines={wide ? 1 : 2}>
      {aside}
    </Text>
  ) : null
  // On a phone the words go under the name: beside it, they run off the edge.
  const named = (
    <View style={wide ? styles.named : styles.namedStacked}>
      {name}
      {words}
    </View>
  )
  return (
    <View
      style={[
        styles.head,
        // Words alone line up on their baseline; beside a face or a chevron, on their middle.
        lead || collapsible || end ? styles.headCentred : null,
        // A phone has no room for words and buttons on one line: the buttons go under.
        !wide && aside && end ? styles.headStacked : null,
        style,
      ]}
    >
      {collapsible ? (
        <Pressable
          onPress={() => collapsible.onToggle()}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded: !collapsible.collapsed }}
          style={styles.start}
        >
          {collapsible.collapsed ? (
            <ChevronRight size={15} tone="textMuted" />
          ) : (
            <ChevronDown size={15} tone="textMuted" />
          )}
          {named}
        </Pressable>
      ) : (
        <View style={styles.start}>
          {lead}
          {named}
        </View>
      )}
      {end ? <View style={styles.end}>{end}</View> : null}
      {action && !end ? (
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
    flexWrap: 'wrap',
    gap: space.md,
  },
  headCentred: { alignItems: 'center' },
  headStacked: { flexDirection: 'column', alignItems: 'stretch', gap: space.sm },
  start: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 0, flexShrink: 1 },
  named: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
    minWidth: 0,
    flexShrink: 1,
  },
  namedStacked: { gap: 2, minWidth: 0, flexShrink: 1 },
  title: { ...sectionTitle(theme.colors), flexShrink: 1 },
  label: { ...label(theme.colors), flexShrink: 1 },
  aside: { color: theme.colors.textMuted, fontSize: type.small, flexShrink: 1 },
  end: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  link: { color: theme.colors.accent, fontSize: type.sub, fontWeight: '600' },
}))

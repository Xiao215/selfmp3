import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { hitSlopFor, leading, space, type, iconSize } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { useContentWidthValue } from '../../shell/contentWidth'
import { COLUMN_WIDTH } from '../../shell/widths'
import { label, sectionTitle } from '../surfaces'
import { ChevronDown, ChevronRight } from './Icons'
import { Press } from './Press'

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
 * - `look="label"`: the quiet sentence-case name (`label()` in surfaces), for a
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
  // On a very wide page the link sits beside the name rather than across the
  // page from it: at 3200 Home's "All 1" stood 1678 px from its tiles.
  const linkBeside = useContentWidthValue(page => page !== null && page >= COLUMN_WIDTH.wideFill)
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
        linkBeside && action && !end ? styles.headLinkBeside : null,
        style,
      ]}
    >
      {collapsible ? (
        <Press
          feedback="dim"
          onPress={() => collapsible.onToggle()}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded: !collapsible.collapsed }}
          style={styles.start}
        >
          {collapsible.collapsed ? (
            <ChevronRight size={iconSize.button} tone="textMuted" />
          ) : (
            <ChevronDown size={iconSize.button} tone="textMuted" />
          )}
          {named}
        </Press>
      ) : (
        <View style={styles.start}>
          {lead}
          {named}
        </View>
      )}
      {end ? <View style={styles.end}>{end}</View> : null}
      {action && !end ? (
        <Press
          feedback="dim"
          onPress={action.onPress}
          accessibilityRole="link"
          accessibilityLabel={action.accessibilityLabel ?? action.label}
          hitSlop={hitSlopFor(leading.sub)}
          testID={testID}
        >
          <Text style={styles.link}>{action.label}</Text>
        </Press>
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
  headLinkBeside: { justifyContent: 'flex-start', gap: space.lg },
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

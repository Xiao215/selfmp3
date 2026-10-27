import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space, textStyle } from '@selfmp3/client'
import { lineSub } from '../surfaces'

/**
 * What stands where a list would be, when there is nothing in it: an optional
 * icon, on a round mark one step up from the ground, a title saying what is missing, one short line saying what to do
 * about it, and the button that does it — one kind of "nothing" on every
 * page.
 *
 * `children` go under the line — the button, or the one thing a page needs to
 * show there (Library's "You're looking inside" and its tags). `picture`
 * takes the icon's place with a faint drawing of what the page becomes
 * (`EmptyPictures`): the sound map's sky, Liked's heart, a link's page.
 * `compact` is for a sheet, a panel or the palette, where a page's room above
 * it would push it out of sight.
 */
export function EmptyState({
  icon,
  picture,
  title,
  line,
  children,
  compact = false,
  testID,
  style,
}: {
  icon?: ReactNode
  /** A drawing of what will be here, in place of the icon's round mark. */
  picture?: ReactNode
  title: string
  line?: ReactNode
  children?: ReactNode
  compact?: boolean
  testID?: string
  style?: StyleProp<ViewStyle>
}): ReactNode {
  return (
    <View style={[styles.empty, compact && styles.compact, style]} testID={testID}>
      {picture ? (
        // A picture of nothing there yet: the title says it.
        <View style={styles.picture} aria-hidden>
          {picture}
        </View>
      ) : icon ? (
        <View style={styles.icon}>{icon}</View>
      ) : null}
      <Text style={styles.title} accessibilityRole="header" aria-level={2}>
        {title}
      </Text>
      {line ? <Text style={styles.line}>{line}</Text> : null}
      {children ? <View style={styles.after}>{children}</View> : null}
    </View>
  )
}

/** The round the icon sits on. */
const ICON_MARK = 64

const styles = StyleSheet.create(theme => ({
  empty: {
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.xl * 2,
    paddingBottom: space.xl,
    paddingHorizontal: space.xl,
  },
  compact: { paddingTop: space.lg, paddingBottom: space.lg, paddingHorizontal: space.lg },
  icon: {
    width: ICON_MARK,
    height: ICON_MARK,
    borderRadius: ICON_MARK / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
    backgroundColor: theme.colors.surface1,
  },
  picture: { marginBottom: space.md },
  title: {
    color: theme.colors.textPrimary,
    ...textStyle('body'),
    fontWeight: '600',
    textAlign: 'center',
  },
  line: {
    ...lineSub(theme.colors),
    textAlign: 'center',
    maxWidth: 340,
  },
  after: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
  },
}))

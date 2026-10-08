import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { leading, space, type } from '@selfmp3/client'

/**
 * What stands where a list would be, when there is nothing in it (proposal P1,
 * 2026-10-08): an optional icon, a title saying what is missing, one short
 * line saying what to do about it, and the button that does it. There were
 * nine of these, each laid out its own way; a person met a different kind of
 * "nothing" on every page.
 *
 * `children` go under the line — the button, or the one thing a page needs to
 * show there (Library's "You're looking inside" and its tags). `compact` is
 * for a sheet, a panel or the palette, where a page's room above it would push
 * it out of sight.
 */
export function EmptyState({
  icon,
  title,
  line,
  children,
  compact = false,
  testID,
  style,
}: {
  icon?: ReactNode
  title: string
  line?: ReactNode
  children?: ReactNode
  compact?: boolean
  testID?: string
  style?: StyleProp<ViewStyle>
}): ReactNode {
  return (
    <View style={[styles.empty, compact && styles.compact, style]} testID={testID}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {line ? <Text style={styles.line}>{line}</Text> : null}
      {children ? <View style={styles.after}>{children}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  empty: {
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.xl * 2,
    paddingBottom: space.xl,
    paddingHorizontal: space.xl,
  },
  compact: { paddingTop: space.lg, paddingBottom: space.lg, paddingHorizontal: space.lg },
  icon: { marginBottom: space.xs },
  title: {
    color: theme.colors.textPrimary,
    fontSize: type.body,
    lineHeight: leading.body,
    fontWeight: '600',
    textAlign: 'center',
  },
  line: {
    color: theme.colors.textSecondary,
    fontSize: type.sub,
    lineHeight: leading.sub,
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

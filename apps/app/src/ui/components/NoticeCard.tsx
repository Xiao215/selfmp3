import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { iconSize, radius, space, type, textStyle } from '@selfmp3/client'
import { card, rowTitle, lineSub } from '../surfaces'
import { IconButton } from './IconButton'
import { X } from './Icons'
import { Why } from './Why'

/** What a notice is about: news, a warning, a failure, or something that worked. */
type NoticeTone = 'plain' | 'warn' | 'error' | 'good'

/**
 * A notice on a page: something the page cannot do, or has to say, and what
 * to do about it — the server away, a library that did not answer, a tool
 * that is not installed, a link added for later.
 *
 * A card, with its tone in its words and a dot rather than an edge; `wash`
 * fills it with the tone instead, for a notice inside a card already (a
 * Settings panel's), where a card on a card would be lost. `title` is said
 * first, in the body's ink at its weight; `children` are the line or two
 * under it, `why` the rest of the explanation kept behind a Why? under them,
 * and `actions` the buttons under those. `onDismiss` puts a × at its end.
 *
 * Read out as it arrives: a failure interrupts (`role="alert"`), anything
 * else waits its turn (`live`). Each screen drew its own: three title sizes,
 * two paddings, two gaps, and only two that said anything to a screen
 * reader.
 *
 * It has no margin: the page places it (`style`), and two stacked notices
 * are spaced by the page's own gap.
 */
export function NoticeCard({
  tone = 'plain',
  wash = false,
  compact = false,
  title,
  children,
  why,
  whyTestID,
  actions,
  onDismiss,
  live = false,
  style,
  testID,
}: {
  tone?: NoticeTone
  wash?: boolean
  /** Smaller type and room, for the sidebar's foot. */
  compact?: boolean
  title?: string
  children?: ReactNode
  /** What the notice means in full, one Why? away under its line. */
  why?: string | null
  /** The Why?'s own testID; `<testID>-why` when left out. */
  whyTestID?: string
  actions?: ReactNode
  onDismiss?: () => void
  /** Read out when it appears or changes; a failure always is. */
  live?: boolean
  style?: StyleProp<ViewStyle>
  testID?: string
}): ReactNode {
  const alert = tone === 'error'
  // With no title the words carry the tone; with one, its dot does.
  const ink = title
    ? styles.body
    : tone === 'error'
      ? styles.bodyError
      : tone === 'good'
        ? styles.bodyGood
        : styles.body
  return (
    <View
      style={[
        wash ? styles.wash : styles.card,
        wash && washes[tone],
        compact && styles.compact,
        onDismiss && styles.dismissable,
        style,
      ]}
      role={alert ? 'alert' : undefined}
      accessibilityLiveRegion={alert ? 'assertive' : live ? 'polite' : undefined}
      testID={testID}
    >
      <View style={styles.words}>
        {title ? (
          <View style={styles.titleRow}>
            {tone === 'plain' ? null : <View style={[styles.dot, dots[tone]]} />}
            <Text
              style={[styles.title, compact && styles.titleCompact]}
              accessibilityRole="header"
              aria-level={2}
            >
              {title}
            </Text>
          </View>
        ) : null}
        {children === undefined || children === null ? null : typeof children === 'string' ? (
          <Text style={[ink, compact && styles.bodyCompact]}>{children}</Text>
        ) : (
          children
        )}
        {why ? (
          <Why
            text={why}
            style={[styles.body, compact && styles.bodyCompact]}
            testID={whyTestID ?? (testID ? `${testID}-why` : undefined)}
          />
        ) : null}
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
      {onDismiss ? (
        <IconButton onPress={onDismiss} label="Dismiss">
          <X size={iconSize.field} tone="textMuted" />
        </IconButton>
      ) : null}
    </View>
  )
}

/**
 * The words of a notice, for one whose line is more than a string: a bold
 * lead-in, a command to copy. In the notice's own ink.
 */
export function NoticeText({ children }: { children: ReactNode }): ReactNode {
  return <Text style={styles.body}>{children}</Text>
}

const styles = StyleSheet.create(theme => ({
  card: {
    ...card(theme.colors),
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.lg,
  },
  wash: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.card,
  },
  compact: { paddingVertical: space.sm, paddingHorizontal: space.snug },
  // The × brings its own room on the right.
  dismissable: { paddingRight: space.xs },
  words: { flex: 1, minWidth: 0, gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: rowTitle(theme.colors),
  titleCompact: { fontSize: type.small },
  body: lineSub(theme.colors),
  bodyError: { color: theme.colors.danger, ...textStyle('sub') },
  bodyGood: { color: theme.colors.good, ...textStyle('sub') },
  bodyCompact: { ...textStyle('tiny') },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
}))

/** Each tone's wash: its own colour, faint, as a review's removed and added names are. */
const washes = StyleSheet.create(theme => ({
  plain: { backgroundColor: theme.colors.surface2 },
  warn: { backgroundColor: theme.colors.warningWash },
  error: { backgroundColor: theme.colors.dangerWash },
  good: { backgroundColor: theme.colors.goodWash },
}))

/** Each tone's dot, beside a title. */
const dots = StyleSheet.create(theme => ({
  plain: {},
  warn: { backgroundColor: theme.colors.warning },
  error: { backgroundColor: theme.colors.danger },
  good: { backgroundColor: theme.colors.good },
}))

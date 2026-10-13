import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space, type } from '@selfmp3/client'
import { usePageBack } from '../useBackTo'
import { pageTitle, TITLE_UNDER_BACK } from '../surfaces'
import { BackButton, type BackProps } from './BackButton'

/**
 * The head of a page (J1): the way back on its own line, the page's name
 * under it on the left, and one quiet line under the name. The page's buttons
 * go on the way back's line when there is one, and beside the name when there
 * is not, so they never sit lower than the first row.
 *
 * Every page that has a name at its head draws it here — Library, Tags,
 * Playlists, Stats, Settings, Import — so the name is one face at one size in
 * one place, and the line under it one colour at one distance. Each had built
 * its own, and the subtitles had drifted to two colours and two gaps.
 *
 * The name is the display face (`pageTitle`) on every page, a thing's name as
 * well as the app's own: the serif is for a person's name and big numbers.
 *
 * `back` is the way back's props (`BackButton`); left out, there is none.
 * `beside` sits right after the name on its line — Stats' window menu on a
 * phone. `subtitle` is set in the subtitle's face; a page that needs part of
 * it said differently nests a `Text` of its own.
 */
export function PageHeader({
  title,
  subtitle,
  subtitleTestID,
  back,
  actions,
  beside,
  titleLines = 1,
  style,
  testID,
}: {
  title: string
  subtitle?: ReactNode
  subtitleTestID?: string
  back?: BackProps
  actions?: ReactNode
  beside?: ReactNode
  /** How many lines a long name may take before it is cut: a review's link name. */
  titleLines?: number
  /** Places the head in its page (a margin, a flex); never its look. */
  style?: StyleProp<ViewStyle>
  testID?: string
}): ReactNode {
  const page = usePageBack(back?.to ?? '/')
  const backShown = back !== undefined && (back.always === true || page.shown)
  const buttons = actions ? <View style={styles.actions}>{actions}</View> : null
  return (
    <View style={[styles.head, style]} testID={testID}>
      {backShown ? (
        <View style={styles.row}>
          <BackButton {...back} always />
          {buttons}
        </View>
      ) : null}
      <View>
        <View style={styles.row}>
          <Text style={styles.title} numberOfLines={titleLines} accessibilityRole="header">
            {title}
          </Text>
          {beside}
          {backShown ? null : buttons}
        </View>
        {subtitle === undefined || subtitle === null ? null : (
          <Text style={styles.sub} testID={subtitleTestID}>
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  head: { gap: TITLE_UNDER_BACK },
  // Wraps, so a computer's buttons beside a long name go under it rather than
  // squeezing it to nothing.
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  title: { ...pageTitle(theme.colors), flexShrink: 1, minWidth: 0 },
  // At the far end of the line, whatever is before them.
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginLeft: 'auto' },
  sub: { color: theme.colors.textMuted, fontSize: type.sub, marginTop: 3 },
}))

import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { fonts, radius, space, textStyle } from '@selfmp3/client'
import { keyboardAvoidBehavior } from '../../ports/keyboard'
import { titleBarInset } from '../../ports/titleBarInset'
import { useLayoutValue } from '../../shell/useLayout'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ScrollView } from '../../ui/components/Scroll'
import { card, bodyText, nameTitle, hint } from '../../ui/surfaces'

/**
 * The side margin of every page on the way in — Welcome, Where it lives and
 * First sync — a little wider than a page's inside the app, as `P01` draws
 * them: there is nothing else on the screen to line up with.
 */
export const ONBOARDING_GUTTER = 28

/**
 * A page on the way in that is one column of words and a card or two: Where
 * it lives and First sync (docs/ui-mock `P03`, `C02`). On a phone the column
 * runs down from the top, with its last child pushed to the foot where a thumb
 * is; on a computer it is one column in the middle of the window.
 *
 * The two pages had each built this, and drifted: the top, the gap down the
 * column and the title's spacing were all a little different between them.
 *
 * `keyboard` lifts the column clear of the keyboard, for a page with fields.
 */
export function OnboardingPage({
  title,
  lead,
  keyboard = false,
  children,
}: {
  title: string
  lead: ReactNode
  keyboard?: boolean
  children: ReactNode
}): ReactNode {
  const wide = useLayoutValue(layout => layout.wide)
  const scroll = (
    <ScrollView contentContainerStyle={[styles.page, wide && styles.pageWide]}>
      <View style={[styles.column, wide && styles.columnWide]}>
        <View style={styles.head}>
          <OnboardingTitle>{title}</OnboardingTitle>
          <Text style={styles.lead}>{lead}</Text>
        </View>
        {children}
      </View>
    </ScrollView>
  )
  return (
    <SafeAreaView style={styles.screen}>
      {keyboard ? (
        <KeyboardAvoidingView style={styles.screen} behavior={keyboardAvoidBehavior}>
          {scroll}
        </KeyboardAvoidingView>
      ) : (
        scroll
      )}
    </SafeAreaView>
  )
}

/**
 * The big serif title of a page on the way in, with its full stop in the
 * accent's italic. A greeting, so the serif: one weight, never bolded.
 * Welcome's too, so the three pages' titles are one size, one spacing.
 */
export function OnboardingTitle({
  children,
  mark = '.',
}: {
  children: ReactNode
  mark?: string
}): ReactNode {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
      <Text style={styles.titleMark}>{mark}</Text>
    </Text>
  )
}

/** A card on a page on the way in: a big one (`S2`: 22 round), told apart by tone. */
export function OnboardingCard({
  children,
  style,
  testID,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  testID?: string
}): ReactNode {
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  )
}

/**
 * The small print under a page's button: centred under a phone's full-width
 * button, left under a computer's.
 */
export function OnboardingFootnote({
  children,
  link = false,
}: {
  children: ReactNode
  /** Underlined, for a footnote that is a link (the privacy policy). */
  link?: boolean
}): ReactNode {
  const wide = useLayoutValue(layout => layout.wide)
  return (
    <Text style={[styles.footnote, wide && styles.footnoteWide, link && styles.footnoteLink]}>
      {children}
    </Text>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: {
    flexGrow: 1,
    paddingHorizontal: ONBOARDING_GUTTER,
    paddingTop: 44 + titleBarInset,
    paddingBottom: 40,
  },
  pageWide: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  column: { flexGrow: 1, gap: space.xl },
  columnWide: { flexGrow: 0, width: 560, maxWidth: '100%' },
  head: { gap: space.sm },
  title: nameTitle(theme.colors),
  titleMark: { fontFamily: fonts.serifItalic, color: theme.colors.accent },
  lead: bodyText(theme.colors),
  card: { ...card(theme.colors, radius.cardLg), padding: space.card, gap: space.roomy },
  footnote: {
    ...hint(theme.colors),
    textAlign: 'center',
  },
  footnoteWide: { ...textStyle('sub'), maxWidth: 420, textAlign: 'left' },
  footnoteLink: { color: theme.colors.textSecondary, textDecorationLine: 'underline' },
}))

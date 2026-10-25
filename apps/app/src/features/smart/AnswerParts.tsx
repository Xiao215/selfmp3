import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space } from '@selfmp3/client'
import { rowTitle, lineSub, hint } from '../../ui/surfaces'

/**
 * The words every Ask answer is made of, so each kind of answer says itself
 * the same way: a head ("Found 4", "Delete 2 playlists?"), a line of plain
 * words, a quiet note, and the buttons at the foot, right-aligned. A failure
 * is a `StatusLine`. Eight answers and the new-playlist steps each wrote these
 * styles out.
 */

/** What a proposal closed without doing anything says it came to (S1). */
export const CLOSED = 'Closed. Nothing changed.'

/** What the answer is, in a word or a sentence. */
export function AnswerHead({
  children,
  testID,
}: {
  children: ReactNode
  testID?: string
}): ReactNode {
  return (
    <Text style={styles.head} accessibilityRole="header" testID={testID}>
      {children}
    </Text>
  )
}

/** A line of what the answer says: "Those playlists are gone already." */
export function AnswerLine({
  children,
  numberOfLines,
  testID,
}: {
  children: ReactNode
  numberOfLines?: number
  testID?: string
}): ReactNode {
  return (
    <Text style={styles.line} numberOfLines={numberOfLines} testID={testID}>
      {children}
    </Text>
  )
}

/** A quiet word beside it: why, what else, "It is in that order already." */
export function AnswerNote({
  children,
  testID,
}: {
  children: ReactNode
  testID?: string
}): ReactNode {
  return (
    <Text style={styles.note} testID={testID}>
      {children}
    </Text>
  )
}

/** The answer's buttons, at its foot on the right: Cancel, then the one that does it. */
export function AnswerActions({ children }: { children: ReactNode }): ReactNode {
  return <View style={styles.actions}>{children}</View>
}

const styles = StyleSheet.create(theme => ({
  head: rowTitle(theme.colors),
  line: lineSub(theme.colors),
  note: hint(theme.colors),
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
}))

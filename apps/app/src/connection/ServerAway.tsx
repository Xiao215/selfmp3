import type { ReactNode } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { awayCopy, space, type Reach, type ServerNeed, leading, type } from '@selfmp3/client'
import { useAccent } from '../ui/accent'
import { Button } from '../ui/components/Button'
import { Refresh } from '../ui/components/Icons'
import { card } from '../ui/surfaces'

/**
 * What a screen shows instead of what it came for, while the server behind a
 * cloud library is being looked for or is away.
 *
 * One card rather than one per screen: the reason is the same every time, and
 * only the sentence about what is lost differs (`SERVER_NEEDS`). It is a card
 * and not a page, so each screen keeps its own heading and chrome around it —
 * Stats draws it inside its tabs, Import under its title.
 *
 * Saying this is the whole point of the exercise. A feature that is simply not
 * drawn is indistinguishable, from where the user sits, from one that does not
 * exist.
 */
export function ServerAway({
  reach,
  need,
  testID,
}: {
  reach: Reach & { readonly lookAgain: () => void }
  need: ServerNeed
  testID: string
}): ReactNode {
  const accent = useAccent()
  const { theme } = useUnistyles()

  if (reach.state === 'looking') {
    return (
      <View style={styles.looking} accessibilityLiveRegion="polite" testID={`${testID}-looking`}>
        <ActivityIndicator size="small" color={accent.accent} />
        <Text style={styles.lookingText}>Looking for your library’s computer…</Text>
      </View>
    )
  }

  const copy = awayCopy(reach.state === 'away' && reach.said, need)
  return (
    <View style={styles.card} accessibilityLiveRegion="polite" testID={`${testID}-away`}>
      <Text style={styles.cardTitle} accessibilityRole="header">
        {copy.title}
      </Text>
      <Text style={styles.cardBody}>{copy.body}</Text>
      <View style={styles.actions}>
        <Button
          label="Look again"
          icon={<Refresh size={13} color={theme.colors.textPrimary} />}
          onPress={reach.lookAgain}
          testID={`${testID}-look-again`}
        />
      </View>
    </View>
  )
}

/** The card's type: its title, and the line or two under it. */
const TEXT = { title: type.body, body: type.sub, bodyLine: leading.sub } as const
/** Room inside the card. */
const CARD_PADDING = 18
/** Between the spinner and what it says. */
const LOOKING_GAP = 10

const styles = StyleSheet.create(theme => ({
  looking: { flexDirection: 'row', alignItems: 'center', gap: LOOKING_GAP, marginTop: space.xl },
  lookingText: { color: theme.colors.textMuted, fontSize: TEXT.body },
  card: {
    marginTop: space.xl,
    padding: CARD_PADDING,
    gap: space.sm,
    ...card(theme.colors),
  },
  cardTitle: { color: theme.colors.textPrimary, fontSize: TEXT.title, fontWeight: '600' },
  cardBody: { color: theme.colors.textSecondary, fontSize: TEXT.body, lineHeight: TEXT.bodyLine },
  actions: { flexDirection: 'row', marginTop: space.sm },
}))

import type { ReactNode } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import {
  awayCopy,
  space,
  type Reach,
  type ServerNeed,
  leading,
  type,
  useJoinSharedServer,
} from '@selfmp3/client'
import { sharedServerUrl } from '../ports/sharedServerUrl'
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
 *
 * A library with no computer joins the shared one by itself
 * (docs/features/shared-server.md); one that removed it here is offered it
 * again — one tap, and the screen finds it.
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

  const said = reach.state === 'away' && reach.said
  const offered = !said && sharedServerUrl !== ''
  const copy = awayCopy(said, need, offered)
  return (
    <View style={styles.card} accessibilityLiveRegion="polite" testID={`${testID}-away`}>
      <Text style={styles.cardTitle} accessibilityRole="header">
        {copy.title}
      </Text>
      <Text style={styles.cardBody}>{copy.body}</Text>
      <View style={styles.actions}>
        {offered ? <JoinShared joined={reach.lookAgain} testID={testID} /> : null}
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

/**
 * Use the shared computer: joined, the screen looks again and finds it. Drawn
 * only where it is offered, so a card for a computer that is only off asks
 * nothing of the query client.
 */
function JoinShared({ joined, testID }: { joined: () => void; testID: string }): ReactNode {
  const join = useJoinSharedServer()
  return (
    <>
      <Button
        label={join.isPending ? 'Joining…' : 'Use the shared computer'}
        variant="primary"
        disabled={join.isPending}
        onPress={() => join.mutate(undefined, { onSuccess: joined })}
        testID={`${testID}-join`}
      />
      {join.error ? <Text style={styles.failed}>{join.error.message}</Text> : null}
    </>
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  failed: { color: theme.colors.danger, fontSize: TEXT.body, lineHeight: TEXT.bodyLine },
}))

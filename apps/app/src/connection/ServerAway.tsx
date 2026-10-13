import type { ReactNode } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import {
  awayCopy,
  space,
  type Reach,
  type ServerNeed,
  type,
  useJoinSharedServer,
} from '@selfmp3/client'
import { Row } from '../features/settings/SettingsParts'
import { sharedServerUrl } from '../ports/sharedServerUrl'
import { useAccent } from '../ui/accent'
import { Button } from '../ui/components/Button'
import { Refresh } from '../ui/components/Icons'
import { NoticeCard } from '../ui/components/NoticeCard'
import { StatusLine } from '../ui/components/StatusLine'

/**
 * What a screen shows instead of what it came for, while the server behind a
 * cloud library is being looked for or is away.
 *
 * One notice rather than one per screen: the reason is the same every time,
 * and only the sentence about what is lost differs (`SERVER_NEEDS`). It is a
 * card and not a page, so each screen keeps its own heading and chrome around
 * it — Stats draws it inside its tabs, Import under its title. In a Settings
 * panel it is a row instead (`row`), with the same words and the same buttons:
 * the smart features' panel had its own sentence, and never offered the
 * shared computer.
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
  row = false,
  testID,
}: {
  reach: Reach & { readonly lookAgain: () => void }
  need: ServerNeed
  row?: boolean
  testID: string
}): ReactNode {
  const accent = useAccent()
  const { theme } = useUnistyles()
  const said = reach.state === 'away' && reach.said
  const offered = !said && sharedServerUrl !== ''
  const copy = awayCopy(said, need, offered)

  const buttons =
    reach.state === 'away' ? (
      <>
        {offered ? <JoinSharedButton onJoined={reach.lookAgain} testID={`${testID}-join`} /> : null}
        <Button
          label="Look again"
          icon={<Refresh color={theme.colors.textPrimary} />}
          onPress={reach.lookAgain}
          testID={`${testID}-look-again`}
        />
      </>
    ) : null

  if (row) {
    return (
      <Row
        label="Your library’s computer"
        hint={reach.state === 'looking' ? 'Looking for it…' : copy.title}
        last
      >
        {buttons}
      </Row>
    )
  }

  if (reach.state === 'looking') {
    return (
      <View style={styles.looking} accessibilityLiveRegion="polite" testID={`${testID}-looking`}>
        <ActivityIndicator size="small" color={accent.accent} />
        <Text style={styles.lookingText}>Looking for your library’s computer…</Text>
      </View>
    )
  }

  return (
    <NoticeCard
      title={copy.title}
      live
      actions={buttons}
      style={styles.card}
      testID={`${testID}-away`}
    >
      {copy.body}
    </NoticeCard>
  )
}

/**
 * Use the shared computer (docs/features/shared-server.md): joined, the screen
 * looks again (`onJoined`) and finds it. The away notice offers it, and so does
 * Settings' list of computers when it has none; a refusal is said under it.
 * Drawn only where it is offered, so a screen whose computer is only off asks
 * nothing of the query client.
 */
export function JoinSharedButton({
  onJoined,
  testID,
}: {
  onJoined?: () => void
  testID: string
}): ReactNode {
  const join = useJoinSharedServer()
  return (
    <View style={styles.join}>
      <Button
        label={join.isPending ? 'Joining…' : 'Use the shared computer'}
        variant="primary"
        disabled={join.isPending}
        onPress={() => join.mutate(undefined, { onSuccess: onJoined })}
        testID={testID}
      />
      {join.error ? <StatusLine>{join.error.message}</StatusLine> : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  looking: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: space.xl },
  lookingText: { color: theme.colors.textMuted, fontSize: type.sub },
  card: { marginTop: space.xl },
  join: { gap: space.xs },
}))

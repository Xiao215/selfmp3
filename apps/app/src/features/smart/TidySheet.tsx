import type { ReactNode } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useQuery } from '@tanstack/react-query'
import { failureText, space } from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { Button } from '../../ui/components/Button'
import { Sheet } from '../../ui/components/Sheet'
import { TidyReview } from './TidyReview'
import { useSmartServer } from './useSmartServer'

/** A4 · Tidy up, opened from Library: the server looks, the list asks. */
export function TidySheet({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const server = useSmartServer()
  const { theme } = useUnistyles()
  const via = server.reach.state === 'reachable' ? server.reach.connection.baseUrl : null
  const answer = useQuery({
    queryKey: ['via-server', via, 'ai', 'tidy'],
    queryFn: () => server.api!.tidy(),
    enabled: open && server.api !== null,
    retry: false,
    // A second look after edits should find what is left, not what was fixed.
    staleTime: 0,
  })

  let body: ReactNode
  if (server.reach.state !== 'reachable') {
    body = <ServerAway reach={server.reach} need="ai" testID="tidy-server" />
  } else if (answer.isPending) {
    body = (
      <View style={styles.waiting} accessibilityLiveRegion="polite" testID="tidy-waiting">
        <ActivityIndicator color={theme.colors.textMuted} />
        <Text style={styles.hint}>Reading your song names. This takes a few seconds.</Text>
      </View>
    )
  } else if (answer.error) {
    body = (
      <View style={styles.waiting}>
        <Text style={styles.error}>{failureText('Couldn’t look', answer.error)}</Text>
        <Button label="Try again" onPress={() => void answer.refetch()} />
      </View>
    )
  } else {
    body = <TidyReview result={answer.data} height={460} onClose={onClose} />
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Tidy up"
      subtitle="Song names worth fixing. Nothing changes until you apply."
      width={640}
      testID="tidy"
    >
      <View style={styles.body}>{body}</View>
    </Sheet>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { padding: space.sm },
  waiting: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  hint: { color: theme.colors.textMuted, fontSize: 13 },
  error: { color: theme.colors.danger, fontSize: 12.5 },
}))

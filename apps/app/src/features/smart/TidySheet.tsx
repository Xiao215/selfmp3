import type { ReactNode } from 'react'
import { Text, useWindowDimensions, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useQuery } from '@tanstack/react-query'
import { failureText, space, useLibrary } from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { useLayout } from '../../shell/useLayout'
import { Button } from '../../ui/components/Button'
import { Sheet } from '../../ui/components/Sheet'
import { TidyReview } from './TidyReview'
import { useSmartServer } from './useSmartServer'
import { Working } from './Working'

/** A4 · Tidy up, opened from Library: the server looks, the list asks. */
export function TidySheet({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const server = useSmartServer()
  const { data: library } = useLibrary()
  const window = useWindowDimensions()
  const { wide } = useLayout()
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
    const count = library?.songs.length ?? 0
    body = (
      <Working
        steps={[
          {
            doing: 'Reading your song names',
            done: `Read ${count.toLocaleString('en')} song ${count === 1 ? 'name' : 'names'}`,
          },
          {
            doing: 'Checking them against plain rules',
            done: 'Checked them against plain rules',
            after: 400,
          },
          { doing: 'Asking the model about spellings, credits and albums', after: 900 },
        ]}
        testID="tidy-waiting"
      />
    )
  } else if (answer.error) {
    body = (
      <View style={styles.waiting}>
        <Text style={styles.error}>{failureText('Couldn’t look', answer.error)}</Text>
        <Button label="Try again" onPress={() => void answer.refetch()} />
      </View>
    )
  } else {
    body = (
      <TidyReview
        result={answer.data}
        // The computer's sheet is at most 80% of the window and its title,
        // the head and the buttons take the rest; the phone's has no cap of
        // its own, and a grabber and the home bar under it as well.
        height={Math.max(240, Math.min(600, window.height * 0.8 - (wide ? 240 : 340)))}
        onClose={onClose}
      />
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Tidy up"
      subtitle="Song names worth fixing. Nothing changes until you apply."
      width={720}
      testID="tidy"
    >
      <View style={styles.body}>{body}</View>
    </Sheet>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { padding: space.sm },
  waiting: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  error: { color: theme.colors.danger, fontSize: 12.5 },
}))

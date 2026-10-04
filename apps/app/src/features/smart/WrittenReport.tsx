import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { WrappedRange } from '@selfmp3/shared'
import { failureText, radius, space } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { Refresh, Sparkle } from '../../ui/components/Icons'
import { card, label } from '../../ui/surfaces'
import { useSmartServer } from './useSmartServer'
import { useSmartSwitches } from './useSmartSwitches'

/**
 * A5 · the Report in a few sentences (docs/features/ai.md), under the page.
 * Every number in them is one of the report's: the server drops a sentence
 * that says one it was not given. Quiet when the server is away — the report
 * above is the page, and this is a note on it.
 */
export function WrittenReport({ range }: { range: WrappedRange }): ReactNode {
  const server = useSmartServer()
  const { written } = useSmartSwitches()
  const queryClient = useQueryClient()
  const via = server.reach.state === 'reachable' ? server.reach.connection.baseUrl : null
  const key = ['via-server', via, 'ai', 'written', range]
  const answer = useQuery({
    queryKey: key,
    queryFn: () => server.api!.written(range),
    enabled: written && server.api !== null,
    retry: false,
    staleTime: 30 * 60_000,
  })
  const [again, setAgain] = useState(false)

  const writeAgain = async (): Promise<void> => {
    if (!server.api) return
    setAgain(true)
    try {
      queryClient.setQueryData(key, await server.api.written(range, true))
    } catch {
      // The card keeps what it had; the next look tries again.
    } finally {
      setAgain(false)
    }
  }

  if (!written || server.reach.state !== 'reachable') return null
  if (answer.data && answer.data.sentences.length === 0) return null

  return (
    <View style={styles.card} testID="report-written">
      <View style={styles.head}>
        <Sparkle size={12} />
        <Text style={styles.label} accessibilityRole="header">
          In words
        </Text>
      </View>
      {answer.isPending ? (
        <Text style={styles.muted}>Writing it…</Text>
      ) : answer.error ? (
        <Text style={styles.muted}>{failureText('Couldn’t write it', answer.error)}</Text>
      ) : (
        <Text style={styles.body} selectable>
          {answer.data.sentences.join(' ')}
        </Text>
      )}
      <View style={styles.actions}>
        <Button
          label="Write it again"
          variant="text"
          icon={<Refresh size={13} tone="textSecondary" />}
          busy={again}
          disabled={answer.isPending || !server.api}
          onPress={() => void writeAgain()}
          testID="report-written-again"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  card: {
    ...card(theme.colors),
    alignSelf: 'center',
    width: '100%',
    maxWidth: 560,
    padding: space.md,
    gap: space.sm,
    borderRadius: radius.card,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: label(theme.colors),
  body: { color: theme.colors.textPrimary, fontSize: 15, lineHeight: 23 },
  muted: { color: theme.colors.textMuted, fontSize: 13 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
}))

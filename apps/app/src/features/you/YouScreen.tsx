import { ChromeSpacer } from '../../shell/ChromeSpacer'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { HIT_TARGET, useLibrary, type ServerConnection } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { BarChart, ChevronRight, Settings, Tag } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { useStatsFor } from '../stats/statsSource'
import { useServerDirect } from '../../connection/useServerDirect'
import { useConnection } from '../../connection/ConnectionProvider'
import { card, pageTitle } from '../../ui/surfaces'
import { youRows, type YouRow, type YouRowId } from './you.model'

const ICONS: Record<YouRowId, typeof Tag> = {
  stats: BarChart,
  tags: Tag,
  settings: Settings,
}

/**
 * You: a short list of the pages that are not a tab of their own
 * (you.model.ts), behind the avatar in Home's header on a phone.
 *
 * A computer reaches it from the name row at the foot of its sidebar, which
 * has the rest of these as rows already.
 */
export function YouScreen(): ReactNode {
  const { fromCloud } = useConnection()
  return fromCloud ? <CloudPlays /> : <WithPlays via={undefined} />
}

/**
 * Stats' row carries the plays in its opening window, and the plays are the
 * server's. A cloud library therefore has a number for the row only while its
 * server is within reach; without one the row says nothing, and the page it
 * opens explains why.
 */
function CloudPlays(): ReactNode {
  const reach = useServerDirect()
  return <WithPlays via={reach.state === 'reachable' ? reach.connection : undefined} />
}

/** The plays for Stats' row, from the window Stats opens on — the same cached answer. */
function WithPlays({ via }: { via: ServerConnection | undefined }): ReactNode {
  const { data: stats } = useStatsFor(via, '30d')
  return <YouPage plays={stats?.totals.plays} />
}

function YouPage({ plays }: { plays: number | undefined }): ReactNode {
  const { wide } = useLayout()
  const { data: library } = useLibrary()
  const rows = youRows({ plays, tags: library?.tags.length })

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentNarrow]}
        testID="you-screen"
      >
        <Text style={styles.heading} accessibilityRole="header">
          You
        </Text>
        <View style={styles.card}>
          {rows.map(row => (
            <Row key={row.id} row={row} />
          ))}
        </View>
        <ChromeSpacer />
      </ScrollView>
    </SafeAreaView>
  )
}

function Row({ row }: { row: YouRow }): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const Icon = ICONS[row.id]
  const spoken = [row.label, row.hint].filter(part => part !== null).join(', ')

  return (
    <Pressable
      onPress={() => router.push(row.href as never)}
      accessibilityRole="link"
      accessibilityLabel={spoken}
      testID={`you-${row.id}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.colors.surface2 }]}
    >
      <Icon size={19} color={accent.accent} />
      <Text style={styles.label} numberOfLines={1}>
        {row.label}
      </Text>
      {row.hint ? (
        <Text style={styles.hint} numberOfLines={1}>
          {row.hint}
        </Text>
      ) : null}
      <ChevronRight size={16} color={theme.colors.textMuted} />
    </Pressable>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  contentWide: { paddingTop: 28, paddingHorizontal: 32, maxWidth: 640 },
  contentNarrow: { paddingTop: 18, paddingHorizontal: 16 },
  heading: { ...pageTitle(theme.colors), marginBottom: 16 },
  card: { overflow: 'hidden', ...card(theme.colors) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: HIT_TARGET + 8,
    paddingHorizontal: 14,
  },
  label: { flex: 1, minWidth: 0, color: theme.colors.textPrimary, fontSize: 15 },
  hint: { color: theme.colors.textMuted, fontSize: 13, flexShrink: 1 },
}))

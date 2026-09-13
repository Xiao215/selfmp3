import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { space, useCloudImports } from '@selfmp3/client'
import { useLibrary } from '../../api/queries'
import { Cover } from '../../ui/components/Cover'
import { pendingImports } from './pendingImports.model'

/**
 * Songs on their way into a cloud library, above the list: the links this
 * device asked the server for, until the server has published what they bring.
 * They cannot play, so they are drawn as a missing file is, and say where they
 * are: waiting, downloading, almost ready, or why they failed.
 */
export function PendingImports(): ReactNode {
  const { theme } = useUnistyles()
  const { data } = useCloudImports()
  const library = useLibrary()
  const rows = useMemo(
    () =>
      pendingImports(
        data?.imports ?? [],
        new Set((library.data?.songs ?? []).map(song => song.id)),
      ),
    [data, library.data],
  )
  if (rows.length === 0) return null

  return (
    <View style={styles.list} accessibilityLabel="Songs on their way" testID="pending-imports">
      {rows.map(row => (
        <View key={row.uid} style={styles.row} testID={`pending-import-${row.uid}`}>
          <View style={styles.faded}>
            <Cover uri={row.thumbnail} title={row.title} size={44} />
          </View>
          <View style={[styles.text, styles.faded]}>
            <Text style={styles.title} numberOfLines={1}>
              {row.title}
            </Text>
            <Text
              style={[styles.status, row.failed && { color: theme.colors.danger }]}
              numberOfLines={2}
            >
              {row.status}
            </Text>
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  list: { paddingHorizontal: space.lg, paddingBottom: space.sm, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  faded: { opacity: 0.55 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '500' },
  status: { color: theme.colors.textMuted, fontSize: 12 },
}))

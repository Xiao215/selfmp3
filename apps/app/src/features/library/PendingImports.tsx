import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space, type, useCloudImports, useLibrary, coverSize } from '@selfmp3/client'
import { ImportCover } from '../import/ImportCover'
import { useLayoutValue } from '../../shell/useLayout'
import { pendingImports } from './pendingImports.model'
import { OPACITY } from '../../ui/motion.model'
import { textColumn } from '../../ui/surfaces'

/**
 * Songs on their way into a cloud library, above the list: the links this
 * device asked the server for, until the server has published what they bring.
 * They cannot play, so they are drawn as a missing file is, and say where they
 * are: waiting, downloading, almost ready, or why they failed.
 */
export function PendingImports(): ReactNode {
  const { data } = useCloudImports()
  const library = useLibrary()
  // The size of the library's own rows below, so the two line up.
  const wide = useLayoutValue(layout => layout.wide)
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
          <ImportCover
            uri={row.thumbnail}
            title={row.title}
            size={wide ? coverSize.rowDense : coverSize.row}
            failed={row.failed}
            untitled={row.untitled}
            dim
          />
          <View style={[styles.text, styles.faded]}>
            <Text style={styles.title} numberOfLines={1}>
              {row.title}
            </Text>
            {/* A failure's reason in the same quiet words: its red is the dot (AB1). */}
            <Text style={styles.status} numberOfLines={2}>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.tight },
  faded: { opacity: OPACITY.dim },
  text: textColumn,
  title: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '500' },
  status: { color: theme.colors.textMuted, fontSize: type.small },
}))

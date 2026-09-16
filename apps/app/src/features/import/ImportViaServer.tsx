import type { ReactNode } from 'react'
import { ScrollView, Text } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useLayout } from '../../shell/useLayout'
import { ServerAway } from '../../connection/ServerAway'
import { useServerDirect } from '../../connection/useServerDirect'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ImportScreen } from './ImportScreen'

/**
 * Importing into a cloud library: through the server, when it can be reached.
 *
 * The bucket has no yt-dlp, so a link can only be read, listened to and
 * downloaded by the server — and that is the whole import screen, the same one
 * the server shows for itself, pointed at the server directly (@selfmp3/client reach.ts).
 * What it downloads goes up to the bucket as every import does, and this
 * device sees it with the next sync. When no address of the server's answers,
 * there is nothing to import with, and this says so instead.
 */
export function ImportViaServer(): ReactNode {
  const { wide } = useLayout()
  const reach = useServerDirect()
  if (reach.state === 'reachable') return <ImportScreen via={reach.connection} />

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentNarrow]}
      >
        <Text style={[styles.heading, !wide && styles.headingNarrow]} accessibilityRole="header">
          Import
        </Text>
        <ServerAway reach={reach} need="import" testID="import-server" />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  contentWide: { paddingTop: 28, paddingHorizontal: 32, maxWidth: 820 },
  contentNarrow: { paddingTop: 18, paddingHorizontal: 16 },
  heading: { color: theme.colors.textPrimary, fontSize: 26, fontWeight: '700' },
  headingNarrow: { fontSize: 22 },
}))

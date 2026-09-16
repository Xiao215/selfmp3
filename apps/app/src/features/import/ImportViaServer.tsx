import type { ReactNode } from 'react'
import { ScrollView, Text } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useLayout } from '../../shell/useLayout'
import { ServerAway } from '../../connection/ServerAway'
import { useServerDirect } from '../../connection/useServerDirect'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ImportScreen } from './ImportScreen'
import { QueueViaBucket } from './QueueViaBucket'

/**
 * Importing into a cloud library.
 *
 * The bucket has no yt-dlp, so only the server can read a link, play it before
 * it is added, or download it. When this device can reach it — the addresses
 * come with every snapshot, so nothing is typed (`reach.ts`) — that is the
 * whole import screen, pointed straight at it.
 *
 * When it cannot, there is still an import. The link goes into the bucket and
 * the server takes it when it is next awake, which is the rule the whole design
 * runs on (SYNC.md, rule 6). This screen used to stop here and say to come back
 * when the server was in reach, which quietly made "you are near your server" a
 * requirement for adding music — and a device is hardly ever near its server.
 * So the away card now says what is lost, which is the *looking* rather than
 * the importing, and the form beneath it adds the song anyway.
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
        {reach.state === 'away' ? <QueueViaBucket /> : null}
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

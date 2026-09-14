import type { ReactNode } from 'react'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { radius } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Refresh } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ImportScreen } from './ImportScreen'
import { awayCopy } from './serverReach.model'
import { useServerDirect } from './useServerDirect'

/**
 * Importing into a cloud library: through the server, when it can be reached.
 *
 * The bucket has no yt-dlp, so a link can only be read, listened to and
 * downloaded by the server — and that is the whole import screen, the same one
 * the server shows for itself, pointed at the server directly (serverReach.model.ts).
 * What it downloads goes up to the bucket as every import does, and this
 * device sees it with the next sync. When no address of the server's answers,
 * there is nothing to import with, and this says so instead.
 */
export function ImportViaServer(): ReactNode {
  const reach = useServerDirect()
  if (reach.state === 'reachable') return <ImportScreen via={reach.connection} />

  return <ServerAway looking={reach.state === 'looking'} said={reach.state === 'away' && reach.said} onLookAgain={reach.lookAgain} />
}

function ServerAway({
  looking,
  said,
  onLookAgain,
}: {
  looking: boolean
  said: boolean
  onLookAgain: () => void
}): ReactNode {
  const { wide } = useLayout()
  const accent = useAccent()
  const copy = awayCopy(said)

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentNarrow]}
        testID={looking ? 'import-server-looking' : 'import-server-away'}
      >
        <Text style={[styles.heading, !wide && styles.headingNarrow]} accessibilityRole="header">
          Import
        </Text>
        {looking ? (
          <View style={styles.looking} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={accent.accent} />
            <Text style={styles.lookingText}>Looking for your server…</Text>
          </View>
        ) : (
          <View style={styles.card} accessibilityLiveRegion="polite">
            <Text style={styles.cardTitle} accessibilityRole="header">
              {copy.title}
            </Text>
            <Text style={styles.cardBody}>{copy.body}</Text>
            <View style={styles.actions}>
              <Button
                label="Look again"
                icon={<Refresh size={13} color={accent.onAccent} />}
                variant="primary"
                onPress={onLookAgain}
                testID="import-server-look-again"
              />
            </View>
          </View>
        )}
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
  looking: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 24 },
  lookingText: { color: theme.colors.textMuted, fontSize: 13 },
  card: {
    marginTop: 24,
    padding: 18,
    gap: 8,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
  },
  cardTitle: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  cardBody: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', marginTop: 8 },
}))

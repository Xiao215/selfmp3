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
import { awayCopy } from './macReach.model'
import { useMacDirect } from './useMacDirect'

/**
 * Importing into a cloud library: through the Mac, when it can be reached.
 *
 * The bucket has no yt-dlp, so a link can only be read, listened to and
 * downloaded by the Mac — and that is the whole import screen, the same one
 * the Mac shows for itself, pointed at the Mac directly (macReach.model.ts).
 * What it downloads goes up to the bucket as every import does, and this
 * device sees it with the next sync. When no address of the Mac's answers,
 * there is nothing to import with, and this says so instead.
 */
export function ImportViaMac(): ReactNode {
  const reach = useMacDirect()
  if (reach.state === 'reachable') return <ImportScreen via={reach.connection} />

  return <MacAway looking={reach.state === 'looking'} said={reach.state === 'away' && reach.said} onLookAgain={reach.lookAgain} />
}

function MacAway({
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
        testID={looking ? 'import-mac-looking' : 'import-mac-away'}
      >
        <Text style={[styles.heading, !wide && styles.headingNarrow]} accessibilityRole="header">
          Import
        </Text>
        {looking ? (
          <View style={styles.looking} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={accent.accent} />
            <Text style={styles.lookingText}>Looking for your Mac…</Text>
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
                testID="import-mac-look-again"
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

import type { ReactNode } from 'react'
import { Linking, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { space, type } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { useLayout } from '../../shell/useLayout'
import { Button } from '../../ui/components/Button'
import { card } from '../../ui/surfaces'
import { BACKBLAZE_CAPS_URL, bucketCapped, unreachableCopy } from './library.model'

/**
 * What stands where the library would, when it did not answer and nothing is
 * kept from before: the Library's list and the Playlists grid.
 *
 * One state, said once, with the two things that can fix it. "Nothing here
 * yet" and "Nothing of your own yet" were what these pages said before, which
 * told someone with four hundred songs to import one. Try again asks at once
 * rather than waiting for the next refetch; Connection settings opens Settings
 * at the address, which is the other half of most of these. A bucket whose
 * daily allowance is used up was reached fine: the second button is then
 * Backblaze's page for raising it.
 */
export function CantReach({
  error,
  onRetry,
}: {
  /** What the library failed with: a used-up bucket allowance is said as that. */
  error: unknown
  onRetry: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const { wide } = useLayout()
  const { fromCloud, connection } = useConnection()
  const capped = bucketCapped(error)
  const copy = unreachableCopy({
    fromCloud,
    address: connection?.baseUrl ?? null,
    compact: !wide,
    error,
  })

  return (
    <View style={[styles.card, !wide && styles.cardCompact]} testID="cant-reach">
      <View style={styles.titleRow}>
        <View style={[styles.dot, { backgroundColor: theme.colors.danger }]} />
        <Text style={styles.title} accessibilityRole="header">
          {copy.title}
        </Text>
      </View>
      <Text style={styles.body}>{copy.body}</Text>
      <View style={styles.actions}>
        <Button label="Try again" onPress={onRetry} />
        {capped ? (
          <Button label="Open Backblaze" onPress={() => void Linking.openURL(BACKBLAZE_CAPS_URL)} />
        ) : (
          <Button
            label={wide ? 'Connection settings' : 'Settings'}
            onPress={() => router.push({ pathname: '/settings', params: { section: 'account' } })}
          />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  card: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
    marginTop: space.xl,
    padding: 18,
    gap: space.sm,
    ...card(theme.colors),
  },
  cardCompact: { maxWidth: undefined },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  body: { color: theme.colors.textMuted, fontSize: type.small, lineHeight: 19 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
}))

import type { ReactNode } from 'react'
import { Linking } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { space } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { useLayout } from '../../shell/useLayout'
import { Button } from '../../ui/components/Button'
import { Refresh } from '../../ui/components/Icons'
import { NoticeCard } from '../../ui/components/NoticeCard'
import { BACKBLAZE_CAPS_URL } from '@selfmp3/shared'
import { bucketCapped, unreachableCopy } from './library.model'

/**
 * What stands where the library would, when it did not answer and nothing is
 * kept from before: the Library's list and the Playlists grid.
 *
 * One state, said once, with the two things that can fix it — not "Nothing
 * here yet", which would tell someone with four hundred songs to import one.
 * Try again asks at once
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
    <NoticeCard
      tone="error"
      title={copy.title}
      live
      why={copy.why}
      style={[styles.card, !wide && styles.cardCompact]}
      testID="cant-reach"
      actions={
        <>
          <Button
            label="Try again"
            icon={<Refresh color={theme.colors.textPrimary} />}
            onPress={onRetry}
          />
          {capped ? (
            <Button
              label="Open Backblaze"
              onPress={() => void Linking.openURL(BACKBLAZE_CAPS_URL)}
            />
          ) : (
            <Button
              label={wide ? 'Connection settings' : 'Settings'}
              onPress={() => router.push({ pathname: '/settings', params: { section: 'account' } })}
            />
          )}
        </>
      }
    >
      {copy.body}
    </NoticeCard>
  )
}

const styles = StyleSheet.create(() => ({
  card: { alignSelf: 'center', width: '100%', maxWidth: 420, marginTop: space.xl },
  cardCompact: { maxWidth: undefined },
}))

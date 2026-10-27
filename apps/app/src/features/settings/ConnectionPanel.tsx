import type { ReactNode } from 'react'
import { Linking, Text } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useLibrary, useRemoveServerGrant, useServerGrants } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { useAskBucketAgain } from '../../connection/useDoormanTrouble'
import { sharedServerUrl } from '../../ports/sharedServerUrl'
import { Avatar } from '../../ui/components/Avatar'
import { Button } from '../../ui/components/Button'
import { useLayoutFlags } from '../../shell/useLayout'
import { BACKBLAZE_CAPS_URL } from '@selfmp3/shared'
import { untilCapResets } from '../library/library.model'
import { useBucketHold } from '../profile/useBucketHold'
import { useAccount } from '../profile/useAccount'
import { useCloudSession } from '../profile/useCloudSession'
import { STORAGE_ROUTE, whereItIs } from '../welcome/storage.model'
import { JoinSharedButton } from '../../connection/ServerAway'
import { Card, DangerButton, LinkRow, partStyles, Row } from './SettingsParts'
import { computerRow, noComputersHint } from './computers.model'
import { ACCOUNT_ROUTE, type Confirming } from './settings.model'
import { plural } from '@selfmp3/shared'

/** The avatar on the account row. */
const AVATAR = 36

/**
 * Account: whose library this is, as one row under About that opens the
 * Account page (B, 2026-10-26), and on that page the storage and the
 * computers. Signing out is at the foot of Settings itself.
 *
 * Google sign-in is the only way in on every device: the library is the
 * bucket's, and no server has to be awake or even exist. Connecting to a server
 * by typing its address was the older way, and is gone — the desktop app was
 * the last place it survived. The Import screen still reaches the server
 * directly when it can, and finds it by the addresses in the bucket's own
 * snapshot rather than by anything typed (`packages/client/src/connection/reach.ts`).
 *
 * The address rows are for a development build, where `/onboarding` can
 * still point the app at a server so the simulator flows have a library without
 * a Google account.
 *
 * Storage is the account's bucket, as the doorman last said: a cloud device
 * has no Settings → Cloud, and this is where the bucket connected on Where it
 * lives can be changed or forgotten afterwards. A bucket refusing for the day
 * says so there too, with the way to raise its cap.
 *
 * Computers are the servers the account has let into its bucket
 * (docs/features/shared-server.md): each can be removed here, and with none,
 * the shared one this build offers is a tap away.
 */
export function AccountRow(): ReactNode {
  const { connection, fromCloud } = useConnection()
  const account = useAccount()
  const router = useRouter()
  const line = fromCloud
    ? (account?.email ?? 'Signed in with Google')
    : connection
      ? // The address itself is on the Account page it opens, with the token.
        'Connected by address'
      : 'Not set'
  return (
    <Card flush>
      <LinkRow
        label={account?.name ?? 'Your library'}
        hint={line}
        lead={<Avatar account={account} size={AVATAR} />}
        onPress={() => router.push(ACCOUNT_ROUTE)}
        testID="settings-account"
      />
    </Card>
  )
}

/** Settings › Account, the page: the storage, the computers, and leaving the storage. */
export function AccountCards({ onConfirm }: { onConfirm: (what: Confirming) => void }): ReactNode {
  const { connection, fromCloud } = useConnection()
  const library = useLibrary()
  const router = useRouter()
  // The bucket as the stored session has it; undefined until it has been read.
  const me = useCloudSession()
  const storage = me.isPending ? undefined : (me.data?.storage ?? null)
  // The bucket refusing for the day: said for as long as it is left alone.
  const hold = useBucketHold()
  const askBucketAgain = useAskBucketAgain()
  const { wide } = useLayoutFlags()
  const where = storage ? whereItIs(storage) : null
  if (!fromCloud) {
    return (
      <Card title="Library">
        <Row label="Address">
          <Text style={partStyles.valueText} numberOfLines={1}>
            {connection ? withoutScheme(connection.baseUrl) : 'Not set'}
          </Text>
        </Row>
        <Row label="Token">
          <Text style={partStyles.valueText}>
            {connection?.token ? 'Saved in the keychain' : 'None'}
          </Text>
        </Row>
        <Row label="Songs" hint={songsLine(library)} last>
          <Button label="Refresh" variant="text" onPress={() => void library.refetch()} />
        </Row>
      </Card>
    )
  }
  return (
    <>
      <Card title="Storage">
        <Row
          label={where ?? (storage === undefined ? 'Loading…' : 'Not connected yet')}
          hint={
            hold ? (
              <Text style={styles.capped}>
                {`● Daily limit used up · ${
                  wide
                    ? `resets in about ${untilCapResets(new Date())}`
                    : `${untilCapResets(new Date(), true)} left`
                }`}
              </Text>
            ) : undefined
          }
          last={!hold}
        >
          <Button
            label={storage ? 'Change' : 'Connect'}
            variant="text"
            onPress={() => router.push(STORAGE_ROUTE)}
            testID="cloud-storage-change"
          />
        </Row>
        {hold ? (
          <Row label="Raise the limit" hint="On Backblaze, then try again here." last>
            <Button
              label="Backblaze"
              variant="text"
              onPress={() => void Linking.openURL(BACKBLAZE_CAPS_URL)}
              testID="cloud-storage-backblaze"
            />
            {/* Raised there, it is not noticed here until the hold is up. */}
            <Button
              label="Try again"
              variant="text"
              onPress={askBucketAgain}
              testID="cloud-storage-try-again"
            />
          </Row>
        ) : null}
      </Card>
      <Card title="Computers">
        <Computers />
      </Card>
      <Card title="This library">
        <Row label="Songs" hint={songsLine(library)} last>
          <Button label="Refresh" variant="text" onPress={() => void library.refetch()} />
        </Row>
      </Card>
      {storage ? (
        <DangerButton
          label="Disconnect storage"
          onPress={() => onConfirm('forget-storage')}
          testID="cloud-storage-forget"
        />
      ) : null}
    </>
  )
}

/** How many songs the library has, or why it cannot say. */
function songsLine(library: ReturnType<typeof useLibrary>): string {
  return library.isError
    ? library.data
      ? `Unreachable — showing the cached copy, ${plural(library.data.songs.length, 'song', 'songs')}`
      : 'Unreachable, and nothing is cached yet'
    : library.data
      ? `${plural(library.data.songs.length, 'song', 'songs')} · version ${library.data.version}`
      : 'Loading…'
}

/** An address as people say it: "localhost:4650", the scheme left to Details. */
function withoutScheme(address: string): string {
  return address.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '')
}

/** The servers this account has let in, each with Remove; the shared one offered when there are none. */
function Computers(): ReactNode {
  const grants = useServerGrants()
  const remove = useRemoveServerGrant()
  const failed = remove.error
  const list = grants.data?.grants
  if (!list || list.length === 0) {
    return (
      <Row
        label="None yet"
        last
        hint={
          grants.isPending
            ? 'Loading…'
            : grants.isError
              ? 'Can’t say right now.'
              : noComputersHint(sharedServerUrl)
        }
      >
        {list && sharedServerUrl ? <JoinSharedButton testID="cloud-computer-join" /> : null}
      </Row>
    )
  }
  return (
    <>
      {list.map(grant => {
        const row = computerRow(grant)
        return (
          <Row
            key={grant.id}
            label={row.label}
            hint={failed ? failed.message : row.hint}
            last={grant.id === list.at(-1)?.id}
          >
            <Button
              label="Remove"
              variant="text"
              disabled={remove.isPending}
              onPress={() => remove.mutate(grant.id)}
              testID="cloud-computer-remove"
            />
          </Row>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  capped: { color: theme.colors.danger },
}))

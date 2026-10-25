import type { ReactNode } from 'react'
import { Linking, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useLibrary, useRemoveServerGrant, useServerGrants, space } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { sharedServerUrl } from '../../ports/sharedServerUrl'
import { Button } from '../../ui/components/Button'
import { Refresh } from '../../ui/components/Icons'
import { useLayoutFlags } from '../../shell/useLayout'
import { BACKBLAZE_CAPS_URL } from '@selfmp3/shared'
import { untilCapResets } from '../library/library.model'
import { useBucketHold } from '../profile/useBucketHold'
import { useCloudSession } from '../profile/useCloudSession'
import { STORAGE_ROUTE, whereItIs } from '../welcome/storage.model'
import { JoinSharedButton } from '../../connection/ServerAway'
import { ButtonRow, Details, Panel, partStyles, Row } from './SettingsParts'
import { computerRow, noComputersHint } from './computers.model'
import type { Confirming } from './settings.model'
import { plural } from '@selfmp3/shared'

/**
 * Account: which library this device answers from, and how to leave it. First
 * on the page, as `P38` draws it.
 *
 * Google sign-in is the only way in on every device: the library is the
 * bucket's, and no server has to be awake or even exist. Connecting to a server
 * by typing its address was the older way, and is gone — the desktop app was
 * the last place it survived. The Import screen still reaches the server
 * directly when it can, and finds it by the addresses in the bucket's own
 * snapshot rather than by anything typed (`packages/client/src/connection/reach.ts`).
 *
 * The address row below is for a development build, where `/onboarding` can
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
export function ConnectionPanel({
  anchor,
  onConfirm,
}: {
  anchor: (node: View | null) => void
  onConfirm: (what: Confirming) => void
}): ReactNode {
  const { connection, fromCloud } = useConnection()
  const library = useLibrary()
  const router = useRouter()
  // The bucket as the stored session has it; undefined until it has been read.
  const me = useCloudSession()
  const storage = me.isPending ? undefined : (me.data?.storage ?? null)
  // The bucket refusing for the day: said for as long as it is left alone.
  const hold = useBucketHold()
  const { wide } = useLayoutFlags()
  const where = storage ? whereItIs(storage) : null
  return (
    <Panel title="Account" anchor={anchor}>
      {fromCloud ? (
        <>
          <Row label="Signed in" hint="With Google.">
            <Button
              label="Sign out"
              variant="danger"
              onPress={() => onConfirm('sign-out')}
              testID="cloud-sign-out"
            />
          </Row>
          <Row
            label="Storage"
            hint={
              storage === undefined
                ? 'Loading…'
                : where === null
                  ? 'Not connected yet.'
                  : hold
                    ? [
                        `${where}\n`,
                        <Text key="cap" style={styles.capped}>
                          {`● Daily limit used up · ${
                            wide
                              ? `resets in about ${untilCapResets(new Date())}`
                              : `${untilCapResets(new Date(), true)} left`
                          }`}
                        </Text>,
                      ]
                    : where
            }
          >
            <View style={styles.pair}>
              {hold ? (
                <Button
                  label="Open Backblaze"
                  onPress={() => void Linking.openURL(BACKBLAZE_CAPS_URL)}
                  testID="cloud-storage-backblaze"
                />
              ) : null}
              <Button
                label={storage ? 'Change' : 'Connect'}
                onPress={() => router.push(STORAGE_ROUTE)}
                testID="cloud-storage-change"
              />
              {storage ? (
                <Button
                  label="Disconnect"
                  variant="danger"
                  onPress={() => onConfirm('forget-storage')}
                  testID="cloud-storage-forget"
                />
              ) : null}
            </View>
          </Row>
          <Computers />
        </>
      ) : (
        <Row label="Library">
          <Text style={partStyles.valueText} numberOfLines={1}>
            {connection ? withoutScheme(connection.baseUrl) : 'Not set'}
          </Text>
        </Row>
      )}
      {/*
        Folded away: a token and a library version are for someone working out
        why something is wrong, and the line under Settings' title already says
        whether the library can be reached.
      */}
      <Details>
        {fromCloud || !connection ? null : (
          <Row label="Address">
            <Text style={partStyles.valueText} numberOfLines={1}>
              {connection.baseUrl}
            </Text>
          </Row>
        )}
        {fromCloud ? null : (
          <Row label="Token">
            <Text style={partStyles.valueText}>
              {connection?.token ? 'Saved in the keychain' : 'None'}
            </Text>
          </Row>
        )}
        <Row label="Songs" last>
          <Text style={partStyles.valueText}>
            {library.isError
              ? library.data
                ? `Unreachable — showing the cached copy, ${plural(library.data.songs.length, 'song', 'songs')}`
                : 'Unreachable, and nothing is cached yet'
              : library.data
                ? `${plural(library.data.songs.length, 'song', 'songs')} · version ${library.data.version}`
                : 'Loading…'}
          </Text>
        </Row>
      </Details>
      <ButtonRow>
        <Button
          label="Refresh"
          icon={<Refresh tone="textPrimary" />}
          onPress={() => void library.refetch()}
        />
      </ButtonRow>
    </Panel>
  )
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
        label="Computers"
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
          <Row key={grant.id} label={row.label} hint={failed ? failed.message : row.hint}>
            <Button
              label="Remove"
              variant="danger"
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
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  capped: { color: theme.colors.danger },
}))

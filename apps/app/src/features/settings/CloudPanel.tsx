import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Linking, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import * as Crypto from 'expo-crypto'
import {
  bucketPlace,
  plural,
  formatBytes,
  formatRelative,
  newUid,
  signInStartUrl,
  type CloudStatus,
} from '@selfmp3/shared'
import {
  useCloudCancelSignIn,
  useCloudConnect,
  useCloudConnectStorage,
  useCloudDisconnect,
  useCloudEnterCode,
  useCloudSignIn,
  useCloudStatus,
  useCloudSync,
} from '@selfmp3/client'
import { onSignInCode, signInReturnUrl } from '../../ports/signInReturn'
import { LINK_GRACE_MS } from '../signIn/signIn.model'
import { Button } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { CloudUpload, Refresh, Trash, X } from '../../ui/components/Icons'
import { addressReady, cloudConnectInput, type AddressFields } from '../welcome/storage.model'
import { BucketAddressFields } from '../welcome/BucketAddressFields'
import { Lead, Panel, partStyles, Row } from './SettingsParts'
import { ProgressBar } from '../../ui/components/ProgressBar'
import { NoticeCard } from '../../ui/components/NoticeCard'
import { Spinner } from '../../ui/components/Spinner'
import { MoreMenu } from '../../ui/components/MoreMenu'

/**
 * Settings → Cloud (docs/SYNC.md).
 *
 * With a doorman set up, this server signs in with Google first, and the bucket
 * belongs to that Google account: connected once, and every device signed in
 * to the account gets the same library. Without one, the bucket is connected
 * directly with its key. A key is sent once and never comes back.
 *
 * This is the server's cloud, asked about through the server: it is shown wherever
 * the app talks to a server, and hidden for a library that is itself the cloud's.
 */
export function CloudPanel({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const { data: status, error } = useCloudStatus()
  const [editing, setEditing] = useState(false)

  let body: ReactNode
  if (!status) {
    body = <Lead>{error ? 'Could not ask the server about the cloud right now.' : 'Loading…'}</Lead>
  } else if (status.connected && !editing) {
    body = <Connected status={status} onChange={() => setEditing(true)} />
  } else if (status.doormanUrl !== null && !status.account) {
    body = <SignIn status={status} />
  } else if (status.account && !status.connected && status.state === 'error') {
    // Signed in once, but the doorman no longer takes that sign-in.
    body = (
      <>
        {status.lastError ? (
          <NoticeCard wash style={partStyles.notice} tone="error">
            {status.lastError}
          </NoticeCard>
        ) : null}
        <SignIn status={status} again />
      </>
    )
  } else {
    body = (
      <BucketForm
        status={status}
        onDone={() => setEditing(false)}
        onCancel={status.connected ? () => setEditing(false) : null}
      />
    )
  }

  return (
    <Panel title="Cloud" hint={status ? stateLabel(status) : undefined} anchor={anchor}>
      <SignInReturn />
      {body}
    </Panel>
  )
}

function stateLabel(status: CloudStatus): string {
  if (status.signingIn) return status.signInNeedsCode ? 'finishing sign-in' : 'waiting for Google'
  switch (status.state) {
    case 'off':
      return status.account ? 'no bucket yet' : 'off'
    case 'syncing':
      return 'uploading'
    case 'error':
      return 'needs attention'
    case 'idle':
      return status.songs.inCloud >= status.songs.total ? 'up to date' : 'waiting'
  }
}

/** An attempt id nobody could guess: a guessed one is a session somebody could claim. */
const attemptId = (): string => newUid(into => into.set(Crypto.getRandomBytes(into.length)))

/**
 * Signing in with Google, through the doorman. The doorman's page opens from
 * the press itself, and the server is told to wait for Google to finish. Google
 * comes back to this page — `selfmp3://settings` in an installed app, this
 * site's `/settings` in a browser — with the code inside the link, and
 * `SignInReturn` hands it to the server. Nobody types it.
 */
function SignIn({ status, again = false }: { status: CloudStatus; again?: boolean }): ReactNode {
  const signIn = useCloudSignIn()
  const cancelSignIn = useCloudCancelSignIn()
  const enterCode = useCloudEnterCode()
  const lost = useLinkLost(status.signingIn && status.signInNeedsCode)

  // Opened from the press itself, so a browser does not block it. Starting
  // again while the server is waiting replaces that sign-in (`beginSignIn`).
  const start = (): void => {
    if (!status.doormanUrl) return
    const attempt = attemptId()
    void Linking.openURL(signInStartUrl(status.doormanUrl, attempt, signInReturnUrl('settings')))
    signIn.mutate(attempt)
  }

  const cancel = (
    <Button
      label="Cancel"
      icon={<X size={15} tone="textPrimary" />}
      onPress={() => cancelSignIn.mutate()}
    />
  )

  if (status.signingIn && lost) {
    return (
      <Row label="Didn’t come back?" hint="Start again, and choose Open when it asks." last>
        <Button label="Try again" variant="primary" disabled={signIn.isPending} onPress={start} />
        {cancel}
      </Row>
    )
  }

  if (status.signingIn) {
    return (
      <Row label="Waiting for Google" hint="Finish signing in where Google opened." last>
        <Spinner />
        {cancel}
      </Row>
    )
  }

  const failure = signIn.error ?? enterCode.error
  return (
    <>
      {again ? null : <Lead>Keep your library in your Google account’s bucket.</Lead>}
      <Row
        label={again ? 'Sign in again' : 'Google account'}
        hint={again ? 'Publishing waits until you do.' : 'Then connect a bucket, just once.'}
        last
      >
        <Button
          label="Sign in with Google"
          variant="primary"
          disabled={signIn.isPending}
          onPress={start}
        />
      </Row>
      {failure ? (
        <NoticeCard wash style={partStyles.notice} tone="error">
          {failure.message}
        </NoticeCard>
      ) : null}
    </>
  )
}

/**
 * True once Google has finished and the link back has had its moment
 * (`LINK_GRACE_MS`) without arriving. It starts over whenever the server stops
 * waiting for one.
 */
function useLinkLost(googleDone: boolean): boolean {
  const [lost, setLost] = useState(false)
  useEffect(() => {
    if (!googleDone) return
    const timer = setTimeout(() => setLost(true), LINK_GRACE_MS)
    return () => {
      clearTimeout(timer)
      setLost(false)
    }
  }, [googleDone])
  return googleDone && lost
}

/**
 * Arriving back from Google with the code inside the link: hand it to the server,
 * which has been waiting for it. `ports/signInReturn` keeps a link that came in
 * before this was listening — and one that comes while it is — and hands each
 * code over once.
 */
function SignInReturn(): ReactNode {
  const enterCode = useCloudEnterCode()
  const { data: status } = useCloudStatus()
  const [arrived, setArrived] = useState(false)
  const { mutate } = enterCode

  useEffect(
    () =>
      onSignInCode('settings', code => {
        setArrived(true)
        mutate(code)
      }),
    [mutate],
  )

  if (!arrived) return null
  const failed = enterCode.isError && !status?.account
  return (
    <NoticeCard wash style={partStyles.notice} tone={failed ? 'error' : 'good'}>
      {failed
        ? `Signing in didn’t work: ${enterCode.error?.message ?? 'try again'}`
        : enterCode.isSuccess || status?.account
          ? 'Signed in.'
          : 'Signing in…'}
    </NoticeCard>
  )
}

function Connected({ status, onChange }: { status: CloudStatus; onChange: () => void }): ReactNode {
  const sync = useCloudSync()
  const leave = useLeaveCloud(status)
  const target = status.target
  const syncing = status.state === 'syncing'
  const { host, folder } = target ? bucketPlace(target) : { host: '', folder: '' }
  const account = status.account
  const progress = status.progress

  return (
    <>
      <Lead>
        Publishing to <Text style={partStyles.code}>{folder}</Text> at{' '}
        <Text style={partStyles.code}>{host}</Text>.
      </Lead>

      <Row
        label="In the cloud"
        hint={`${status.songs.inCloud} of ${plural(status.songs.total, 'song', 'songs')} · ${formatBytes(status.bytesInCloud)}${
          status.lastSnapshotAt ? ` · last published ${formatRelative(status.lastSnapshotAt)}` : ''
        }`}
      >
        <Button
          label={syncing ? 'Uploading…' : 'Publish now'}
          icon={<Refresh size={15} tone="textPrimary" />}
          disabled={syncing || sync.isPending}
          onPress={() => sync.mutate()}
        />
      </Row>

      {syncing ? (
        <View style={partStyles.progress} accessibilityLiveRegion="polite">
          <Text style={partStyles.progressText}>
            {progress && progress.total > 0
              ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}${
                  progress.current ? ` — ${progress.current}` : ''
                }`
              : 'Checking what changed…'}
          </Text>
          {progress && progress.total > 0 ? (
            <ProgressBar fraction={progress.done / progress.total} label="Songs uploaded" />
          ) : null}
        </View>
      ) : null}

      {status.state === 'error' && status.lastError ? (
        <NoticeCard wash style={partStyles.notice} tone="error">
          {status.lastError}
        </NoticeCard>
      ) : null}

      <Row
        label={account ? 'Google account' : 'Connection'}
        hint={`${account ? `Signed in as ${account.email}` : `Key ${target?.keyIdHint ?? ''}`} · this server is ${
          status.deviceId ?? 'unnamed'
        } in the bucket`}
        last
      >
        <Button label={account ? 'Change bucket…' : 'Change…'} onPress={onChange} />
        {account ? (
          <AccountMenu disabled={leave.pending} onSignOut={leave.ask} />
        ) : (
          <Button
            label="Disconnect"
            icon={<Trash size={15} tone="danger" />}
            variant="danger"
            disabled={leave.pending}
            onPress={leave.ask}
          />
        )}
      </Row>
      {leave.dialog}
    </>
  )
}

/**
 * Signing this server out of its Google account, or stopping it publishing to
 * a bucket it reached with a key: asked first, wherever it is offered. The
 * bucket form's Sign out did it at once while the connected view's asked.
 */
function useLeaveCloud(status: CloudStatus): {
  readonly ask: () => void
  readonly pending: boolean
  readonly dialog: ReactNode
} {
  const disconnect = useCloudDisconnect()
  const [confirming, setConfirming] = useState(false)
  const account = status.account
  const target = status.target
  const folder = target ? (target.prefix ? `${target.bucket}/${target.prefix}` : target.bucket) : ''
  return {
    ask: () => setConfirming(true),
    pending: disconnect.isPending,
    dialog: (
      <ConfirmDialog
        open={confirming}
        title={
          account ? `Sign this server out of ${account.email}?` : `Stop publishing to ${folder}?`
        }
        body={
          account
            ? 'Your music stays in the bucket.'
            : 'Everything already in the bucket stays there.'
        }
        confirmLabel={account ? 'Sign out' : 'Disconnect'}
        danger
        onConfirm={() => {
          setConfirming(false)
          disconnect.mutate()
        }}
        onCancel={() => setConfirming(false)}
      />
    ),
  }
}

/**
 * Sign out, one step away from Change bucket…: side by side as buttons, the red
 * one that stops this server publishing sat a finger's slip from the everyday
 * one. It still asks before it does anything.
 */
function AccountMenu({
  disabled,
  onSignOut,
}: {
  disabled: boolean
  onSignOut: () => void
}): ReactNode {
  return (
    <MoreMenu
      name="this Google account"
      filled={false}
      disabled={disabled}
      caption="More"
      title="Google account"
      items={[
        {
          key: 'sign-out',
          label: 'Sign out',
          icon: <Trash size={15} tone="danger" />,
          danger: true,
          onPress: onSignOut,
        },
      ]}
      menuTestID="cloud-account-menu"
    />
  )
}

/**
 * The bucket's details: connected directly with no doorman, or — signed in —
 * connected to the Google account, with the doorman trying the key first.
 * The four things a bucket's page and B2's key dialog show, in that order,
 * and the region only for an address it cannot be read from.
 */
function BucketForm({
  status,
  onDone,
  onCancel,
}: {
  status: CloudStatus
  onDone: () => void
  onCancel: (() => void) | null
}): ReactNode {
  const connect = useCloudConnect()
  const connectStorage = useCloudConnectStorage()
  const leave = useLeaveCloud(status)
  const account = status.account
  const action = account ? connectStorage : connect
  const initial = status.target

  // The same form as Where it lives, judged by the same rules (storage.model).
  const [address, setAddress] = useState<AddressFields>({
    // Only `https://` comes off: it is what an address without one means, and
    // an `http://` one (a bucket on this network) has to keep saying so.
    endpoint: initial?.endpoint.replace(/^https:\/\//, '') ?? '',
    region: initial?.region ?? '',
    bucket: initial?.bucket ?? '',
    prefix: initial?.prefix ?? 'selfmp3',
    keyId: '',
    applicationKey: '',
  })
  const complete = addressReady(address)

  const submit = (): void => {
    if (!complete || action.isPending) return
    action.mutate(cloudConnectInput(address), { onSuccess: onDone })
  }

  return (
    <>
      <Lead>
        {account
          ? `Signed in as ${account.email}. Now a private B2 bucket and a read-write key.`
          : 'A private B2 bucket and a read-write key for it.'}
      </Lead>
      <Text style={[partStyles.hint, styles.where]}>
        The endpoint and the name are on the bucket’s own page, under Buckets. Set its Lifecycle
        Settings to Keep only the last version of the file: B2 keeps a deleted file’s old version
        otherwise, and removed songs would go on counting against the 10 GB. The key is a new one
        from Account → Application Keys: allow access to this bucket only, with Read and Write. Not
        the master key — a key made for one bucket can reach nothing else. B2 shows the application
        key once, as you make it.
      </Text>

      <BucketAddressFields
        rows
        value={address}
        onChange={setAddress}
        // Not while the key is being tried: what is tried is what was typed.
        disabled={action.isPending}
        keyIdHint={
          initial
            ? `Currently ${initial.keyIdHint}.`
            : 'B2 calls it keyID, and shows it beside the key.'
        }
        keyHint={
          account
            ? 'Shown once by B2. Sealed for the doorman.'
            : 'Shown once by B2. Stays on this server.'
        }
        testID="cloud-address"
      />

      {action.error ? (
        <NoticeCard wash style={partStyles.notice} tone="error">
          {action.error.message}
        </NoticeCard>
      ) : null}

      <Row label="" hint="The key is tried before it is saved." last>
        {account && !onCancel ? (
          <Button
            label="Sign out"
            disabled={leave.pending}
            onPress={leave.ask}
            testID="cloud-form-sign-out"
          />
        ) : null}
        {onCancel ? (
          <Button label="Cancel" icon={<X size={15} tone="textPrimary" />} onPress={onCancel} />
        ) : null}
        <Button
          label={action.isPending ? 'Checking the bucket…' : 'Connect'}
          icon={<CloudUpload size={15} tone="onAccent" />}
          variant="primary"
          disabled={!complete || action.isPending}
          onPress={submit}
        />
      </Row>
      {leave.dialog}
    </>
  )
}

const styles = StyleSheet.create(() => ({
  where: { marginBottom: 6 },
}))

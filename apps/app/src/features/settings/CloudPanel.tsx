import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Linking, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import * as Crypto from 'expo-crypto'
import {
  formatBytes,
  formatRelative,
  newUid,
  parseEndpoint,
  type CloudConnect,
  type CloudStatus,
} from '@selfmp3/shared'
import { useCloudActions, useCloudStatus } from '@selfmp3/client'
import { onSignInCode, signInReturnUrl } from '../../ports/signInReturn'
import { LINK_GRACE_MS } from '../signIn/signIn.model'
import { Button } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { CloudUpload, Refresh, Trash, X } from '../../ui/components/Icons'
import { ButtonRow, Lead, Meter, Notice, Panel, partStyles, Row } from './SettingsParts'

/**
 * Settings → Cloud: the web's `CloudSettings` (docs/SYNC.md).
 *
 * With a doorman set up, this Mac signs in with Google first, and the bucket
 * belongs to that Google account: connected once, and every device signed in
 * to the account gets the same library. Without one, the bucket is connected
 * directly with its key. A key is sent once and never comes back.
 *
 * This is the Mac's cloud, asked about through the Mac: it is shown wherever
 * the app talks to a Mac, and hidden for a library that is itself the cloud's.
 */
export function CloudPanel({ onTop }: { onTop: (top: number) => void }): ReactNode {
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
        {status.lastError ? <Notice tone="error">{status.lastError}</Notice> : null}
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
    <Panel title="Cloud" hint={status ? stateLabel(status) : undefined} onTop={onTop}>
      <SignInReturn />
      {body}
    </Panel>
  )
}

function stateLabel(status: CloudStatus): string {
  if (status.signingIn)
    return status.signInNeedsCode ? 'finishing sign-in' : 'waiting for Google'
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
 * the press itself, and the Mac is told to wait for Google to finish. Google
 * comes back to this page — `selfmp3://settings` in an installed app, this
 * site's `/settings` in a browser — with the code inside the link, and
 * `SignInReturn` hands it to the Mac. Nobody types it.
 */
function SignIn({ status, again = false }: { status: CloudStatus; again?: boolean }): ReactNode {
  const { theme } = useUnistyles()
  const { signIn, cancelSignIn, enterCode } = useCloudActions()
  const lost = useLinkLost(status.signingIn && status.signInNeedsCode)

  // Opened from the press itself, so a browser does not block it. Starting
  // again while the Mac is waiting replaces that sign-in (`beginSignIn`).
  const start = (): void => {
    if (!status.doormanUrl) return
    const attempt = attemptId()
    const params = new URLSearchParams({ attempt, return: signInReturnUrl('settings') })
    void Linking.openURL(`${status.doormanUrl}/v1/auth/start?${params.toString()}`)
    signIn.mutate(attempt)
  }

  const cancel = (
    <Button
      label="Cancel"
      icon={<X size={15} color={theme.colors.textPrimary} />}
      onPress={() => cancelSignIn.mutate()}
    />
  )

  if (status.signingIn && lost) {
    return (
      <Row
        label="Didn’t come back?"
        hint="Google finished, but the browser didn’t hand the sign-in back. Start again, and choose Open when it asks."
        last
      >
        <Button label="Try again" variant="primary" disabled={signIn.isPending} onPress={start} />
        {cancel}
      </Row>
    )
  }

  if (status.signingIn) {
    return (
      <Row
        label="Waiting for Google"
        hint="Finish signing in where Google opened. This comes back by itself."
        last
      >
        <ActivityIndicator color={theme.colors.textMuted} />
        {cancel}
      </Row>
    )
  }

  const failure = signIn.error ?? enterCode.error
  return (
    <>
      {again ? null : (
        <Lead>
          Keep your library in a storage bucket that belongs to your Google account, so every device
          you sign in on gets the same music and your changes — even while this server is off.
        </Lead>
      )}
      <Row
        label={again ? 'Sign in again' : 'Google account'}
        hint={
          again
            ? 'Publishing stopped until you do. Nothing in the bucket is lost.'
            : 'Sign in first. The bucket is connected to the account after that, just once.'
        }
        last
      >
        <Button
          label="Sign in with Google"
          variant="primary"
          disabled={signIn.isPending}
          onPress={start}
        />
      </Row>
      {failure ? <Notice tone="error">{failure.message}</Notice> : null}
    </>
  )
}

/**
 * True once Google has finished and the link back has had its moment
 * (`LINK_GRACE_MS`) without arriving. It starts over whenever the Mac stops
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
 * Arriving back from Google with the code inside the link: hand it to the Mac,
 * which has been waiting for it. `ports/signInReturn` keeps a link that came in
 * before this was listening — and one that comes while it is — and hands each
 * code over once.
 */
function SignInReturn(): ReactNode {
  const { enterCode } = useCloudActions()
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
    <Notice tone={failed ? 'error' : 'good'}>
      {failed
        ? `Signing in didn’t work: ${enterCode.error?.message ?? 'try again'}`
        : enterCode.isSuccess || status?.account
          ? 'Signed in.'
          : 'Signing in…'}
    </Notice>
  )
}

function Connected({ status, onChange }: { status: CloudStatus; onChange: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const { sync, disconnect } = useCloudActions()
  const [confirming, setConfirming] = useState(false)
  const target = status.target
  const syncing = status.state === 'syncing'
  const host = target?.endpoint.replace(/^https?:\/\//, '') ?? ''
  const folder = target ? (target.prefix ? `${target.bucket}/${target.prefix}` : target.bucket) : ''
  const account = status.account
  const progress = status.progress

  return (
    <>
      <Lead>
        Publishing to <Text style={partStyles.code}>{folder}</Text> at{' '}
        <Text style={partStyles.code}>{host}</Text>. Every song goes up once with its cover and
        lyrics, and a snapshot of the library follows each change.
      </Lead>

      <Row
        label="In the cloud"
        hint={`${status.songs.inCloud} of ${status.songs.total} ${
          status.songs.total === 1 ? 'song' : 'songs'
        } · ${formatBytes(status.bytesInCloud)}${
          status.lastSnapshotAt ? ` · last published ${formatRelative(status.lastSnapshotAt)}` : ''
        }`}
      >
        <Button
          label={syncing ? 'Uploading…' : 'Publish now'}
          icon={<Refresh size={15} color={theme.colors.textPrimary} />}
          disabled={syncing || sync.isPending}
          onPress={() => sync.mutate()}
        />
      </Row>

      {syncing ? (
        <View style={styles.progress} accessibilityLiveRegion="polite">
          <Text style={styles.progressText}>
            {progress && progress.total > 0
              ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}${
                  progress.current ? ` — ${progress.current}` : ''
                }`
              : 'Checking what changed…'}
          </Text>
          {progress && progress.total > 0 ? (
            <Meter fraction={progress.done / progress.total} />
          ) : null}
        </View>
      ) : null}

      {status.state === 'error' && status.lastError ? (
        <Notice tone="error">{status.lastError}</Notice>
      ) : null}

      <Row
        label={account ? 'Google account' : 'Connection'}
        hint={`${account ? `Signed in as ${account.email}` : `Key ${target?.keyIdHint ?? ''}`} · this server is ${
          status.deviceId ?? 'unnamed'
        } in the bucket`}
        last
      >
        <Button label={account ? 'Change bucket…' : 'Change…'} onPress={onChange} />
        <Button
          label={account ? 'Sign out' : 'Disconnect'}
          icon={<Trash size={15} color={theme.colors.danger} />}
          variant="danger"
          disabled={disconnect.isPending}
          onPress={() => setConfirming(true)}
        />
      </Row>

      <ConfirmDialog
        open={confirming}
        title={account ? `Sign this server out of ${account.email}?` : `Stop publishing to ${folder}?`}
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
    </>
  )
}

/**
 * The bucket's details: connected directly with no doorman, or — signed in —
 * connected to the Google account, with the doorman trying the key first.
 * The web's `BucketFields`: the four things a bucket's page and B2's key dialog
 * show, in that order, and the region only for an address it cannot be read
 * from.
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
  const { theme } = useUnistyles()
  const { connect, connectStorage, disconnect } = useCloudActions()
  const account = status.account
  const action = account ? connectStorage : connect
  const initial = status.target

  const [endpoint, setEndpoint] = useState(initial?.endpoint.replace(/^https:\/\//, '') ?? '')
  const [region, setRegion] = useState(initial?.region ?? '')
  const [bucket, setBucket] = useState(initial?.bucket ?? '')
  const [prefix, setPrefix] = useState(initial?.prefix ?? 'selfmp3')
  const [keyId, setKeyId] = useState('')
  const [applicationKey, setApplicationKey] = useState('')

  const parsed = endpoint.trim() ? parseEndpoint(endpoint) : null
  const needsRegion = parsed !== null && parsed.region === null
  const complete =
    parsed !== null &&
    bucket.trim() !== '' &&
    keyId.trim() !== '' &&
    applicationKey.trim() !== '' &&
    (!needsRegion || region.trim() !== '')

  const submit = (): void => {
    if (!complete || action.isPending) return
    const input: CloudConnect = {
      endpoint,
      bucket,
      prefix,
      keyId,
      applicationKey,
      ...(needsRegion ? { region } : {}),
    }
    action.mutate(input, { onSuccess: onDone })
  }

  const field = (
    label: string,
    hint: string,
    value: string,
    onChange: (text: string) => void,
    options: { placeholder?: string; secret?: boolean } = {},
  ): ReactNode => (
    <Row label={label} hint={hint}>
      <TextInput
        style={[partStyles.input, styles.field]}
        value={value}
        onChangeText={onChange}
        placeholder={options.placeholder}
        placeholderTextColor={theme.colors.textMuted}
        secureTextEntry={options.secret}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        accessibilityLabel={label}
      />
    </Row>
  )

  return (
    <>
      <Lead>
        {account
          ? `Signed in as ${account.email}. Now the bucket that belongs to this account — Backblaze B2 is free up to 10 GB: a private bucket, and an application key for it with read and write access. The doorman tries the key, then keeps it; no device sees it again.`
          : 'Keep your library in a storage bucket you own, so your other devices can get new songs and edits while this server is off. Backblaze B2 is free up to 10 GB: create a private bucket, then an application key for it with read and write access.'}
      </Lead>
      <Text style={[partStyles.hint, styles.where]}>
        The endpoint and the name are on the bucket’s own page, under Buckets. The key is a new one
        from Account → Application Keys: allow access to this bucket only, with Read and Write. Not
        the master key — a key made for one bucket can reach nothing else. B2 shows the application
        key once, as you make it.
      </Text>

      {field('Endpoint', 'On the bucket’s page in B2.', endpoint, setEndpoint, {
        placeholder: 's3.us-west-004.backblazeb2.com',
      })}
      {needsRegion
        ? field(
            'Region',
            'As your provider names it. For Cloudflare R2 it is auto.',
            region,
            setRegion,
          )
        : null}
      {field('Bucket', 'Its name, not its ID.', bucket, setBucket, {
        placeholder: 'selfmp3-yourname',
      })}
      {field('Folder', 'Everything goes under this folder in the bucket.', prefix, setPrefix)}
      {field(
        'Key ID',
        initial
          ? `Currently ${initial.keyIdHint} — enter it again, or a new one.`
          : 'B2 calls it keyID, and shows it beside the key.',
        keyId,
        setKeyId,
      )}
      {field(
        'Application key',
        account
          ? 'B2 shows it once, when the key is made. It goes to the doorman, sealed.'
          : 'B2 shows it once, when the key is made. It stays on this server.',
        applicationKey,
        setApplicationKey,
        { secret: true },
      )}

      {action.error ? <Notice tone="error">{action.error.message}</Notice> : null}

      <Row
        label=""
        hint="The key is tried before anything is saved: listed, written to and read back."
        last
      >
        {account && !onCancel ? (
          <Button
            label="Sign out"
            disabled={disconnect.isPending}
            onPress={() => disconnect.mutate()}
          />
        ) : null}
        {onCancel ? (
          <Button
            label="Cancel"
            icon={<X size={15} color={theme.colors.textPrimary} />}
            onPress={onCancel}
          />
        ) : null}
        <Button
          label={action.isPending ? 'Checking the bucket…' : 'Connect'}
          icon={<CloudUpload size={15} color={theme.colors.onAccent} />}
          variant="primary"
          disabled={!complete || action.isPending}
          onPress={submit}
        />
      </Row>
      <ButtonRow>{null}</ButtonRow>
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  field: { minWidth: 280 },
  where: { marginBottom: 6 },
  progress: { marginVertical: 14, gap: 8 },
  progressText: { color: theme.colors.textSecondary, fontSize: 13 },
}))

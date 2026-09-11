import { useState, type FormEvent } from 'react'
import {
  formatBytes,
  formatRelative,
  newUid,
  parseEndpoint,
  type CloudConnect,
  type CloudStatus,
} from '@selfmp3/shared'
import { useCloudActions, useCloudStatus } from '../lib/queries.js'
import { CloudUpload, Refresh, Trash, X } from '../components/Icons.js'

/**
 * The cloud section of Settings (docs/SYNC.md).
 *
 * With a doorman set up, this Mac signs in with Google first, and the bucket
 * belongs to that Google account: connected once, from any device, and every
 * device signed in to the account gets the same library. Without one, the
 * bucket is connected directly with its key, as the only way in.
 *
 * Either way the form asks for the four things a bucket's page and B2's key
 * dialog show, in that order, and nothing else unless it has to — the region
 * only appears for an address it cannot be read from. A key is sent once and
 * never comes back.
 */
export function CloudSettings() {
  const { data: status, error } = useCloudStatus()
  const [editing, setEditing] = useState(false)

  let body
  if (!status) {
    body = (
      <p className="panel-lead">
        {error ? 'Could not ask this Mac about the cloud right now.' : 'Loading…'}
      </p>
    )
  } else if (status.connected && !editing) {
    body = <Connected status={status} onChange={() => setEditing(true)} />
  } else if (status.doormanUrl !== null && !status.account) {
    body = <SignIn status={status} />
  } else if (status.account && !status.connected && status.state === 'error') {
    // Signed in once, but the doorman no longer takes that sign-in.
    body = (
      <>
        {status.lastError && (
          <p className="notice notice-error" role="alert">
            <span>{status.lastError}</span>
          </p>
        )}
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
    <section className="panel" id="cloud">
      <header className="panel-head">
        <h2>Cloud</h2>
        <span className="hint">{status ? stateLabel(status) : ''}</span>
      </header>
      {body}
    </section>
  )
}

function stateLabel(status: CloudStatus): string {
  if (status.signingIn) return 'waiting for Google'
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

/**
 * Signing in with Google, through the doorman. The attempt id is made here
 * and the doorman's page opened straight from the click — a window opened
 * after waiting for the server would be a popup, and get blocked — and then
 * the Mac is told to wait for Google to finish.
 */
function SignIn({ status, again = false }: { status: CloudStatus; again?: boolean }) {
  const { signIn, cancelSignIn } = useCloudActions()

  const start = (): void => {
    if (!status.doormanUrl) return
    const attempt = newUid()
    const params = new URLSearchParams({
      attempt,
      return: `${window.location.origin}/settings#cloud`,
    })
    window.open(`${status.doormanUrl}/v1/auth/start?${params.toString()}`, '_blank', 'noopener')
    signIn.mutate(attempt)
  }

  if (status.signingIn) {
    return (
      <div className="setting-row">
        <span className="setting-label">
          Waiting for Google
          <span className="setting-hint">
            Finish signing in in the tab that opened, then come back here.
          </span>
        </span>
        <span className="setting-control">
          <span className="spinner" />
          <button type="button" className="button" onClick={() => cancelSignIn.mutate()}>
            <X size={15} /> Cancel
          </button>
        </span>
      </div>
    )
  }

  return (
    <>
      {!again && (
        <p className="panel-lead">
          Keep your library in a storage bucket that belongs to your Google account, so every device
          you sign in on gets the same music and your changes — even while this Mac is asleep.
        </p>
      )}
      <div className="setting-row">
        <span className="setting-label">
          {again ? 'Sign in again' : 'Google account'}
          <span className="setting-hint">
            {again
              ? 'Publishing stopped until you do. Nothing in the bucket is lost.'
              : 'Sign in first. The bucket is connected to the account after that, just once.'}
          </span>
        </span>
        <span className="setting-control">
          <button
            type="button"
            className="button button-primary"
            onClick={start}
            disabled={signIn.isPending}
          >
            Sign in with Google
          </button>
        </span>
      </div>
      {signIn.error && (
        <p className="notice notice-error" role="alert">
          <span>{signIn.error.message}</span>
        </p>
      )}
    </>
  )
}

function Connected({ status, onChange }: { status: CloudStatus; onChange: () => void }) {
  const { sync, disconnect } = useCloudActions()
  const target = status.target
  const syncing = status.state === 'syncing'
  const host = target?.endpoint.replace(/^https?:\/\//, '') ?? ''
  const folder = target ? (target.prefix ? `${target.bucket}/${target.prefix}` : target.bucket) : ''
  const account = status.account

  return (
    <>
      <p className="panel-lead">
        Publishing to <code>{folder}</code> at <code>{host}</code>. Every song goes up once with its
        cover and lyrics, and a snapshot of the library follows each change.
      </p>

      <div className="setting-row">
        <span className="setting-label">
          In the cloud
          <span className="setting-hint">
            {status.songs.inCloud} of {status.songs.total}{' '}
            {status.songs.total === 1 ? 'song' : 'songs'} · {formatBytes(status.bytesInCloud)}
            {status.lastSnapshotAt && ` · last published ${formatRelative(status.lastSnapshotAt)}`}
          </span>
        </span>
        <span className="setting-control">
          <button
            type="button"
            className="button"
            onClick={() => sync.mutate()}
            disabled={syncing || sync.isPending}
          >
            <Refresh size={15} /> {syncing ? 'Uploading…' : 'Publish now'}
          </button>
        </span>
      </div>

      {syncing && (
        <div className="sync-progress" aria-live="polite">
          <div className="sync-progress-head">
            <span className="spinner" />
            <span>
              {status.progress && status.progress.total > 0
                ? `Uploading ${Math.min(status.progress.done + 1, status.progress.total)} of ${status.progress.total}${
                    status.progress.current ? ` — ${status.progress.current}` : ''
                  }`
                : 'Checking what changed…'}
            </span>
          </div>
          {status.progress && status.progress.total > 0 && (
            <div className="offline-meter">
              <span style={{ width: `${(status.progress.done / status.progress.total) * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {status.state === 'error' && status.lastError && (
        <p className="notice notice-error" role="alert">
          <span>{status.lastError}</span>
        </p>
      )}

      <div className="setting-row">
        <span className="setting-label">
          {account ? 'Google account' : 'Connection'}
          <span className="setting-hint">
            {account ? `Signed in as ${account.email}` : `Key ${target?.keyIdHint}`} · this Mac is{' '}
            <code>{status.deviceId}</code> in the bucket
          </span>
        </span>
        <span className="setting-control">
          <button type="button" className="button" onClick={onChange}>
            {account ? 'Change bucket…' : 'Change…'}
          </button>
          <button
            type="button"
            className="button button-danger"
            disabled={disconnect.isPending}
            onClick={() => {
              const question = account
                ? `Sign this Mac out of ${account.email}? Your music stays in the bucket.`
                : `Stop publishing to ${folder}? Everything already in the bucket stays there.`
              if (window.confirm(question)) disconnect.mutate()
            }}
          >
            <Trash size={15} /> {account ? 'Sign out' : 'Disconnect'}
          </button>
        </span>
      </div>
    </>
  )
}

/**
 * The bucket's details: connected directly with no doorman, or — signed in —
 * connected to the Google account, with the doorman trying the key first.
 */
function BucketForm({
  status,
  onDone,
  onCancel,
}: {
  status: CloudStatus
  onDone: () => void
  onCancel: (() => void) | null
}) {
  const { connect, connectStorage, disconnect } = useCloudActions()
  const account = status.account
  const action = account ? connectStorage : connect
  const target = status.target
  const [endpoint, setEndpoint] = useState(target?.endpoint.replace(/^https:\/\//, '') ?? '')
  const [region, setRegion] = useState(target?.region ?? '')
  const [bucket, setBucket] = useState(target?.bucket ?? '')
  const [prefix, setPrefix] = useState(target?.prefix ?? 'selfmp3')
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

  const submit = (event: FormEvent): void => {
    event.preventDefault()
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

  return (
    <form onSubmit={submit}>
      <p className="panel-lead">
        {account ? (
          <>
            Signed in as <strong>{account.email}</strong>. Now the bucket that belongs to this
            account — Backblaze B2 is free up to 10 GB: a private bucket, and an application key for
            it with read and write access. The doorman tries the key, then keeps it; no device sees
            it again.
          </>
        ) : (
          <>
            Keep your library in a storage bucket you own, so your other devices can get new songs
            and edits while this Mac is asleep. Backblaze B2 is free up to 10 GB: create a private
            bucket, then an application key for it with read and write access.
          </>
        )}
      </p>

      <label className="setting-row">
        <span className="setting-label">
          Endpoint
          <span className="setting-hint">On the bucket&rsquo;s page in B2.</span>
        </span>
        <input
          className="input setting-input-path"
          value={endpoint}
          onChange={event => setEndpoint(event.target.value)}
          placeholder="s3.us-west-004.backblazeb2.com"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-invalid={endpoint.trim() !== '' && parsed === null}
        />
      </label>

      {needsRegion && (
        <label className="setting-row">
          <span className="setting-label">
            Region
            <span className="setting-hint">
              As your provider names it. For Cloudflare R2 it is <code>auto</code>.
            </span>
          </span>
          <input
            className="input setting-input-path"
            value={region}
            onChange={event => setRegion(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
        </label>
      )}

      <label className="setting-row">
        <span className="setting-label">
          Bucket
          <span className="setting-hint">Its name, not its ID.</span>
        </span>
        <input
          className="input setting-input-path"
          value={bucket}
          onChange={event => setBucket(event.target.value)}
          placeholder="selfmp3-yourname"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
        />
      </label>

      <label className="setting-row">
        <span className="setting-label">
          Folder
          <span className="setting-hint">Everything goes under this folder in the bucket.</span>
        </span>
        <input
          className="input setting-input-path"
          value={prefix}
          onChange={event => setPrefix(event.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
        />
      </label>

      <label className="setting-row">
        <span className="setting-label">
          Key ID
          <span className="setting-hint">
            {target
              ? `Currently ${target.keyIdHint} — enter it again, or a new one.`
              : 'From Application Keys, once you have added one.'}
          </span>
        </span>
        <input
          className="input setting-input-path"
          value={keyId}
          onChange={event => setKeyId(event.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
        />
      </label>

      <label className="setting-row">
        <span className="setting-label">
          Application key
          <span className="setting-hint">
            {account
              ? 'B2 shows it once, when the key is made. It goes to the doorman, sealed.'
              : 'B2 shows it once, when the key is made. It stays on this Mac.'}
          </span>
        </span>
        <input
          className="input setting-input-path"
          type="password"
          value={applicationKey}
          onChange={event => setApplicationKey(event.target.value)}
          autoComplete="off"
        />
      </label>

      {action.error && (
        <p className="notice notice-error" role="alert">
          <span>{action.error.message}</span>
        </p>
      )}

      <div className="setting-row">
        <span className="setting-label">
          <span className="setting-hint">
            The key is tried before anything is saved: listed, written to and read back.
          </span>
        </span>
        <span className="setting-control">
          {account && !onCancel && (
            <button
              type="button"
              className="button"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Sign out
            </button>
          )}
          {onCancel && (
            <button type="button" className="button" onClick={onCancel}>
              <X size={15} /> Cancel
            </button>
          )}
          <button
            type="submit"
            className="button button-primary"
            disabled={!complete || action.isPending}
          >
            <CloudUpload size={15} /> {action.isPending ? 'Checking the bucket…' : 'Connect'}
          </button>
        </span>
      </div>
    </form>
  )
}

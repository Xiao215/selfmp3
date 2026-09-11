import { useState, type FormEvent } from 'react'
import { formatBytes, formatRelative, parseEndpoint, type CloudStatus } from '@selfmp3/shared'
import { useCloudActions, useCloudStatus } from '../lib/queries.js'
import { CloudUpload, Refresh, Trash, X } from '../components/Icons.js'

/**
 * The cloud section of Settings (docs/SYNC.md): connect this Mac to a bucket,
 * watch it publish, publish now, disconnect.
 *
 * The form asks for the four things a bucket's page and B2's key dialog show,
 * in that order, and nothing else unless it has to — the region only appears
 * for an address it cannot be read from. The key is sent once and never comes
 * back: a connected panel shows which key it is by its first few characters.
 */
export function CloudSettings() {
  const { data: status, error } = useCloudStatus()
  const [editing, setEditing] = useState(false)

  return (
    <section className="panel" id="cloud">
      <header className="panel-head">
        <h2>Cloud</h2>
        <span className="hint">{status ? stateLabel(status) : ''}</span>
      </header>

      {!status ? (
        <p className="panel-lead">
          {error ? 'Could not ask this Mac about the cloud right now.' : 'Loading…'}
        </p>
      ) : status.connected && !editing ? (
        <Connected status={status} onChange={() => setEditing(true)} />
      ) : (
        <ConnectForm
          status={status}
          onDone={() => setEditing(false)}
          onCancel={status.connected ? () => setEditing(false) : null}
        />
      )}
    </section>
  )
}

function stateLabel(status: CloudStatus): string {
  switch (status.state) {
    case 'off':
      return 'off'
    case 'syncing':
      return 'uploading'
    case 'error':
      return 'needs attention'
    case 'idle':
      return status.songs.inCloud >= status.songs.total ? 'up to date' : 'waiting'
  }
}

function Connected({ status, onChange }: { status: CloudStatus; onChange: () => void }) {
  const { sync, disconnect } = useCloudActions()
  const target = status.target
  const syncing = status.state === 'syncing'
  const host = target?.endpoint.replace(/^https?:\/\//, '') ?? ''
  const folder = target ? (target.prefix ? `${target.bucket}/${target.prefix}` : target.bucket) : ''

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
          Connection
          <span className="setting-hint">
            Key {target?.keyIdHint} · this Mac is <code>{status.deviceId}</code> in the bucket
          </span>
        </span>
        <span className="setting-control">
          <button type="button" className="button" onClick={onChange}>
            Change…
          </button>
          <button
            type="button"
            className="button button-danger"
            disabled={disconnect.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Stop publishing to ${folder}? Everything already in the bucket stays there.`,
                )
              ) {
                disconnect.mutate()
              }
            }}
          >
            <Trash size={15} /> Disconnect
          </button>
        </span>
      </div>
    </>
  )
}

function ConnectForm({
  status,
  onDone,
  onCancel,
}: {
  status: CloudStatus
  onDone: () => void
  onCancel: (() => void) | null
}) {
  const { connect } = useCloudActions()
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
    if (!complete || connect.isPending) return
    connect.mutate(
      {
        endpoint,
        bucket,
        prefix,
        keyId,
        applicationKey,
        ...(needsRegion ? { region } : {}),
      },
      { onSuccess: onDone },
    )
  }

  return (
    <form onSubmit={submit}>
      <p className="panel-lead">
        Keep your library in a storage bucket you own, so your other devices can get new songs and
        edits while this Mac is asleep. Backblaze B2 is free up to 10 GB: create a private bucket,
        then an application key for it with read and write access.
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
          <span className="setting-hint">Its name.</span>
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
            B2 shows it once, when the key is made. It stays on this Mac.
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

      {connect.error && (
        <p className="notice notice-error" role="alert">
          <span>{connect.error.message}</span>
        </p>
      )}

      <div className="setting-row">
        <span className="setting-label">
          <span className="setting-hint">
            The key is tried before anything is saved: listed, written to and read back.
          </span>
        </span>
        <span className="setting-control">
          {onCancel && (
            <button type="button" className="button" onClick={onCancel}>
              <X size={15} /> Cancel
            </button>
          )}
          <button
            type="submit"
            className="button button-primary"
            disabled={!complete || connect.isPending}
          >
            <CloudUpload size={15} /> {connect.isPending ? 'Checking the bucket…' : 'Connect'}
          </button>
        </span>
      </div>
    </form>
  )
}

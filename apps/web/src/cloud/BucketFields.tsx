import { useState, type FormEvent, type ReactNode } from 'react'
import { parseEndpoint, type CloudConnect, type CloudStatus } from '@selfmp3/shared'
import { CloudUpload } from '../components/Icons.js'

/**
 * A bucket's details, as a form: the four things a bucket's page and B2's
 * key dialog show, in that order, and nothing else unless it has to — the
 * region only appears for an address it cannot be read from.
 *
 * Shared by the Mac's Settings → Cloud and the web app's first run, which
 * send the same details to different places.
 */
export function BucketFields({
  initial,
  lead,
  keyNote,
  pending,
  error,
  onSubmit,
  actions,
}: {
  readonly initial?: CloudStatus['target']
  readonly lead: ReactNode
  /** Under the application key: where it goes once sent. */
  readonly keyNote: string
  readonly pending: boolean
  readonly error: string | null
  readonly onSubmit: (input: CloudConnect) => void
  /** Buttons beside Connect: Cancel, Sign out. */
  readonly actions?: ReactNode
}) {
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

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!complete || pending) return
    onSubmit({
      endpoint,
      bucket,
      prefix,
      keyId,
      applicationKey,
      ...(needsRegion ? { region } : {}),
    })
  }

  return (
    <form onSubmit={submit}>
      <p className="panel-lead">{lead}</p>

      <p className="setting-hint bucket-where">
        The endpoint and the name are on the bucket&rsquo;s own page, under{' '}
        <a href="https://secure.backblaze.com/b2_buckets.htm" target="_blank" rel="noreferrer">
          Buckets
        </a>
        . The key is a new one from{' '}
        <a href="https://secure.backblaze.com/app_keys.htm" target="_blank" rel="noreferrer">
          Account &rarr; Application Keys
        </a>
        : allow access to <em>this bucket only</em>, with <strong>Read and Write</strong>. Not the
        master key &mdash; a key made for one bucket can reach nothing else. B2 shows the
        application key once, as you make it.
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
            {initial
              ? `Currently ${initial.keyIdHint} — enter it again, or a new one.`
              : 'B2 calls it keyID, and shows it beside the key.'}
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
          <span className="setting-hint">{keyNote}</span>
        </span>
        <input
          className="input setting-input-path"
          type="password"
          value={applicationKey}
          onChange={event => setApplicationKey(event.target.value)}
          autoComplete="off"
        />
      </label>

      {error && (
        <p className="notice notice-error" role="alert">
          <span>{error}</span>
        </p>
      )}

      <div className="setting-row">
        <span className="setting-label">
          <span className="setting-hint">
            The key is tried before anything is saved: listed, written to and read back.
          </span>
        </span>
        <span className="setting-control">
          {actions}
          <button type="submit" className="button button-primary" disabled={!complete || pending}>
            <CloudUpload size={15} /> {pending ? 'Checking the bucket…' : 'Connect'}
          </button>
        </span>
      </div>
    </form>
  )
}

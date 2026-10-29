import { bucketPlace, parseEndpoint, type CloudConnect, type DoormanStorage } from '@selfmp3/shared'

/**
 * Where it lives, without the screen: the page after the first Google sign-in
 * on an account that has no bucket yet (docs/SYNC.md, "Each device").
 *
 * The bucket belongs to the Google account, not the device, so the page is
 * shown once per account: the second device signed in finds the bucket
 * already there and goes straight on. It is asked for again only when the
 * bucket is forgotten (Settings → Account → Storage).
 *
 * Two ways to fill it in. With a Backblaze key the person pastes two strings
 * and the doorman asks Backblaze for the rest — the bucket a key made for one
 * bucket opens, and the account's S3 address. With any other provider it is
 * the server's form: endpoint, region where the address does not name one,
 * bucket and folder. The steps for someone with no bucket yet are
 * `BUCKET_GUIDE` in @selfmp3/shared, which the published guide reads too.
 */

export const STORAGE_ROUTE = '/storage'

export type StorageMode = 'backblaze' | 'address'

/** Signed in to an account with no bucket: the page is due. */
export function storageDue(
  session: { readonly me: { readonly storage: unknown } } | null,
): boolean {
  return session !== null && session.me.storage === null
}

/** Both strings pasted, which is all Backblaze needs. */
export function backblazeReady(keyId: string, applicationKey: string): boolean {
  return keyId.trim() !== '' && applicationKey.trim() !== ''
}

export interface AddressFields {
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  readonly prefix: string
  readonly keyId: string
  readonly applicationKey: string
}

/** An address that does not name its region — Cloudflare R2's, say — needs one typed. */
export function needsRegion(endpoint: string): boolean {
  const parsed = endpoint.trim() ? parseEndpoint(endpoint) : null
  return parsed !== null && parsed.region === null
}

/** Everything the server's form needs before Connect means anything. */
export function addressReady(fields: AddressFields): boolean {
  const parsed = fields.endpoint.trim() ? parseEndpoint(fields.endpoint) : null
  return (
    parsed !== null &&
    fields.bucket.trim() !== '' &&
    fields.keyId.trim() !== '' &&
    fields.applicationKey.trim() !== '' &&
    (!needsRegion(fields.endpoint) || fields.region.trim() !== '')
  )
}

/** "selfmp3-xiao on Backblaze, us-west-004", or "my-music at r2.cloudflarestorage.com". */
export function whereItIs(storage: DoormanStorage): string {
  const { host } = bucketPlace(storage)
  return /\.backblazeb2\.com$/i.test(host)
    ? `${storage.bucket} on Backblaze, ${storage.region}`
    : `${storage.bucket} at ${host}`
}

/** What the page says while the doorman tries the key. No step is invented: it is one request. */
export const TRYING =
  'Trying the key: listing the bucket, writing a small note into it, reading the note back…'

/**
 * What each field of a bucket's address is called and said to be, on the way
 * in and in Settings alike. `id` names the field's test id.
 */
export const BUCKET_FIELDS: {
  readonly [field in keyof AddressFields]: {
    readonly label: string
    readonly hint?: string
    readonly placeholder?: string
    readonly id: string
  }
} = {
  endpoint: {
    label: 'Endpoint',
    hint: 'On the bucket’s own page.',
    placeholder: 's3.us-west-004.backblazeb2.com',
    id: 'endpoint',
  },
  region: {
    label: 'Region',
    hint: 'As your provider names it. For Cloudflare R2 it is auto.',
    id: 'region',
  },
  bucket: {
    label: 'Bucket',
    hint: 'Its name, not its ID.',
    placeholder: 'selfmp3-yourname',
    id: 'bucket',
  },
  prefix: {
    label: 'Folder',
    hint: 'Everything goes under this folder in the bucket.',
    id: 'folder',
  },
  keyId: { label: 'Key ID', hint: 'Shown beside the key, where you made it.', id: 'key-id' },
  applicationKey: {
    label: 'Application key',
    hint: 'Shown once, as you make it. Read and write, for this bucket only.',
    id: 'application-key',
  },
}

/**
 * The address as the server and the doorman take it: the region only for an
 * endpoint that does not name one, so a typed region never overrides the one
 * an address already says.
 */
export function cloudConnectInput(fields: AddressFields): CloudConnect {
  return {
    endpoint: fields.endpoint,
    bucket: fields.bucket,
    prefix: fields.prefix,
    keyId: fields.keyId,
    applicationKey: fields.applicationKey,
    ...(needsRegion(fields.endpoint) ? { region: fields.region } : {}),
  }
}

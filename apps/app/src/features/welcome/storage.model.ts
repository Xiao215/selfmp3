import { parseEndpoint, type DoormanStorage } from '@selfmp3/shared'

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
 * bucket and folder.
 */

export const STORAGE_ROUTE = '/storage'

/** Where the helper sends someone who has no bucket yet. */
export const BACKBLAZE_URL = 'https://www.backblaze.com/cloud-storage'

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
  const host = storage.endpoint.replace(/^https?:\/\//, '')
  return /\.backblazeb2\.com$/i.test(host)
    ? `${storage.bucket} on Backblaze, ${storage.region}`
    : `${storage.bucket} at ${host}`
}

/** The three steps for someone with no bucket yet, as the helper lists them. */
export const HELPER_STEPS: readonly { readonly title: string; readonly detail: string }[] = [
  {
    title: 'Make a private bucket',
    detail: 'On Backblaze: Buckets → Create a Bucket. Any name, private. Free up to 10 GB.',
  },
  {
    title: 'Then a key for it',
    detail: 'App Keys → Add a New Application Key. Access: that bucket only, Read and Write.',
  },
  {
    title: 'Paste the two strings here',
    detail: 'Backblaze shows the application key once, when it makes it.',
  },
]

/** What the page says while the doorman tries the key. No step is invented: it is one request. */
export const TRYING =
  'Trying the key: listing the bucket, writing a small note into it, reading the note back…'

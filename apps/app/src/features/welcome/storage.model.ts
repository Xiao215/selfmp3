import {
  DRIVE_FOLDER_NAME,
  parseEndpoint,
  storagePlace,
  type CloudConnect,
  type DoormanStorage,
} from '@selfmp3/shared'

/**
 * Where it lives, without the screen: the page after the first Google sign-in
 * on an account that has no storage yet (docs/SYNC.md, "Each device").
 *
 * The storage belongs to the Google account, not the device, so the page is
 * shown once per account: the second device signed in finds it already there
 * and goes straight on. It is asked for again only when the storage is
 * forgotten (Settings → Account → Storage).
 *
 * The page opens on Google Drive, which needs nothing but a yes on Google's
 * own page (docs/features/storage-providers.md). A bucket of the person's own
 * is the other choice, with two ways to fill it in. With a Backblaze key the person pastes two strings
 * and the doorman asks Backblaze for the rest — the bucket a key made for one
 * bucket opens, and the account's S3 address. With any other provider it is
 * the server's form: endpoint, region where the address does not name one,
 * bucket and folder. The steps for someone with no bucket yet are
 * `BUCKET_GUIDE` in @selfmp3/shared, which the published guide reads too.
 */

export const STORAGE_ROUTE = '/storage'

export type StorageMode = 'drive' | 'backblaze' | 'address'

/** Signed in to an account with no storage: the page is due. */
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

/**
 * "self.mp3 in your Google Drive", "selfmp3-xiao on Backblaze, us-west-004", or
 * "my-music at r2.cloudflarestorage.com".
 */
export function whereItIs(storage: DoormanStorage): string {
  if (storage.kind === 'drive') return `${DRIVE_FOLDER_NAME} in your Google Drive`
  const { host } = storagePlace(storage)
  return /\.backblazeb2\.com$/i.test(host)
    ? `${storage.bucket} on Backblaze, ${storage.region}`
    : `${storage.bucket} at ${host}`
}

/**
 * Whether what the doorman now says is the Google Drive the page left for
 * Google to connect, when no link came back to say so: the app was brought
 * back by hand, or Google's page was finished in another browser. Storage
 * that was there before the trip, unchanged, is not news.
 */
export function driveArrived(before: DoormanStorage | null, now: DoormanStorage | null): boolean {
  if (now?.kind !== 'drive') return false
  return before?.kind !== 'drive' || before.folder !== now.folder
}

/**
 * How long to wait before each look at the doorman once a link has said Drive
 * is connected. The doorman keeps the answer in one place and remembers
 * "nothing" in others for up to a minute, so the first looks can still say so.
 */
export const CONNECTED_LOOKS_MS = [0, 1000, 2000, 4000, 8000, 15_000] as const

/** What the page says while it waits for the doorman to say so too. */
export const FINISHING_DRIVE = 'Google said yes. Finding your storage…'

/** What the page says when every one of those looks found nothing. */
export const CONNECTED_NOT_SEEN =
  'Google Drive is connected, but it is not showing here yet. Try again in a moment.'

/** What the page says while Google's page is open somewhere else. */
export const WAITING_FOR_GOOGLE = 'Waiting for Google. Finish there, then come back here.'

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

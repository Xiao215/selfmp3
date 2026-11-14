import { bytesInWords, type MoveProgress } from '@selfmp3/replica'
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

/** What is typed for a bucket, either way of saying which: its key alone, or its address. */
export interface BucketEntryValue {
  readonly mode: 'backblaze' | 'address'
  readonly keyId: string
  readonly applicationKey: string
  readonly address: AddressFields
}

export const NEW_BUCKET_ENTRY: BucketEntryValue = {
  mode: 'backblaze',
  keyId: '',
  applicationKey: '',
  address: {
    endpoint: '',
    region: '',
    bucket: '',
    prefix: 'selfmp3',
    keyId: '',
    applicationKey: '',
  },
}

/** Enough typed for Connect, or Move, to mean anything. */
export function bucketEntryReady(entry: BucketEntryValue): boolean {
  return entry.mode === 'backblaze'
    ? backblazeReady(entry.keyId, entry.applicationKey)
    : addressReady(entry.address)
}

/** What to say when it is pressed before that. */
export function bucketEntryMissing(entry: BucketEntryValue): string {
  return entry.mode === 'backblaze'
    ? 'Both strings are needed: the key ID and the application key.'
    : 'The address, the bucket, the key ID and the application key are all needed.'
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

/** "self.mp3 in your Google Drive" as the place something was left: "the self.mp3 folder in your Google Drive". */
function placeOf(storage: DoormanStorage): string {
  return storage.kind === 'drive'
    ? `the ${DRIVE_FOLDER_NAME} folder in your Google Drive`
    : whereItIs(storage)
}

/** Where a library is moved from the Account page (`features/settings/MoveScreen`). */
export const MOVE_ROUTE = '/move'

/** The one other place a library can go: a bucket's goes to Google Drive, a Drive's to a bucket. */
export function moveTarget(storage: DoormanStorage): 'drive' | 'bucket' {
  return storage.kind === 'drive' ? 'bucket' : 'drive'
}

/** The one thing to do about where the library is, on the Account page. */
export function moveAction(storage: DoormanStorage): string {
  return moveTarget(storage) === 'drive'
    ? 'Move your library to Google Drive'
    : 'Move your library to your own bucket'
}

/** "4.1 GB free of 15 GB", or what is used where a Google account has no limit. */
export function spaceLine(space: { readonly used: number; readonly limit: number | null }): string {
  if (space.limit === null) return `${bytesInWords(space.used)} used`
  const free = Math.max(0, space.limit - space.used)
  return `${bytesInWords(free)} free of ${bytesInWords(space.limit)}`
}

/** Nearly full: the line is drawn as a warning from here (`SPACE_LOW`). */
export function spaceLow(space: { readonly used: number; readonly limit: number | null }): boolean {
  return space.limit !== null && space.used >= space.limit * SPACE_LOW
}
const SPACE_LOW = 0.8

const counted = (n: number): string => n.toLocaleString('en-US')

/** "Moving 412 of 1,930 songs", and what the page says before and after the songs. */
export function moveProgressLine(progress: MoveProgress): string {
  switch (progress.phase) {
    case 'looking':
      return 'Looking at what there is to move…'
    case 'songs':
      return `Moving ${counted(progress.done)} of ${counted(progress.total)} songs`
    case 'rest':
      return `Moving covers, lyrics and the rest: ${counted(progress.done)} of ${counted(progress.total)}`
    case 'finishing':
      return 'Everything is across. Finishing…'
  }
}

/** What the page says once the library is in its new place. */
export function movedLine(from: DoormanStorage, to: DoormanStorage): string {
  return `Your library is now in ${placeOf(to)}. The copy in ${placeOf(from)} was left as it was; you can delete it there.`
}

/** What the page says of a move begun before and not finished. */
export function unfinishedMoveLine(to: DoormanStorage): string {
  return `A move to ${placeOf(to)} was started and not finished. Nothing has changed: your library is still where it was.`
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

/**
 * The doorman's wire, as every side of it spells it: its addresses, the codes
 * its refusals carry, how long a sign-in and a cap's hold last, and the keys a
 * device keeps its session under (docs/SYNC.md; the Worker is apps/doorman).
 *
 * Without a schema in it, on purpose. The service worker bundles this module
 * on its own (`@selfmp3/shared/wire`), and zod would be most of what it
 * carried. Everything else imports it from `@selfmp3/shared` like any other
 * module.
 *
 * Each of these used to be written out where it was used — thirty `/v1/…`
 * paths across five packages, a cap code and its ten minutes in four, the
 * session's storage key in two — and the copies drifted: every 409 read as
 * "no bucket" while the doorman also answered one for the grant limit, and the
 * replica's hold keyed itself off a path a rename would have quietly missed.
 */

/**
 * Every `code` a doorman refusal carries (`{ error, code }`, `ErrorBodySchema`),
 * and the few a client gives a request the doorman never answered. A client
 * decides what to do by these, never by the status alone: two refusals can
 * share a status and mean different things (409 is both "connect your bucket
 * first" and "remove a server before adding another").
 */
export const DOORMAN_ERROR = {
  // The request itself.
  badRequest: 'bad_request',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not_found',
  methodNotAllowed: 'method_not_allowed',
  unsupportedMediaType: 'unsupported_media_type',
  tooLarge: 'too_large',
  lengthRequired: 'length_required',
  unprocessable: 'unprocessable',
  preconditionFailed: 'precondition_failed',
  rangeNotSatisfiable: 'range_not_satisfiable',
  upgradeRequired: 'upgrade_required',
  /** Something the doorman's owner has to fix in the Worker's settings. */
  notSetUp: 'not_set_up',
  internal: 'internal',

  // Signing in and the account.
  /** The code typed or read back is not the one shown; the attempt is over. */
  wrongCode: 'wrong_code',
  /** The account has no bucket yet: connect one first. */
  noStorage: 'no_storage',
  /** The account already lets the most servers in it may (`MAX_GRANTS`). */
  tooManyGrants: 'too_many_grants',

  // The bucket behind the doorman (`BucketRefusalKind`).
  bucketRefusedKey: 'bucket_refused_key',
  noSuchBucket: 'no_such_bucket',
  bucketUnreachable: 'bucket_unreachable',
  /** Backblaze's daily allowance used up: held for a while (`BUCKET_HOLD_MS`). */
  bucketCapExceeded: 'bucket_cap_exceeded',
  /**
   * A lent song's owner's bucket is past its day's allowance: a link's, a
   * room's or a shared playlist's song. Not `bucketCapExceeded`, which holds
   * every read of the device's own bucket — the friend's bucket is fine.
   */
  lenderCapExceeded: 'lender_cap_exceeded',
  bucketError: 'bucket_error',

  // Listening rooms and shared playlists (`RoomRefusal`, and their own).
  roomTaken: 'room_taken',
  roomCodes: 'room_codes',
  roomMissing: 'room_missing',
  roomForbidden: 'room_forbidden',
  roomFull: 'room_full',
  roomEnded: 'room_ended',
  roomInvalid: 'room_invalid',
  roomUnauthorized: 'room_unauthorized',
  /** Removed from the room by its host: over for this member, as an ended room is. */
  roomLeft: 'room_left',
  linkUnreachable: 'link_unreachable',
  linkUnplayable: 'link_unplayable',
  sharedTaken: 'shared_taken',
  sharedMissing: 'shared_missing',
  sharedForbidden: 'shared_forbidden',
  sharedFull: 'shared_full',
  sharedEnded: 'shared_ended',
  sharedInvalid: 'shared_invalid',
  sharedUnauthorized: 'shared_unauthorized',
  shareMissing: 'share_missing',
  shareForbidden: 'share_forbidden',
  shareEnded: 'share_ended',
  shareInvalid: 'share_invalid',
  shareTaken: 'share_taken',

  // Never sent by the doorman: what a client calls a request it did not answer.
  /** No answer at all — offline, or the doorman down. Always status 0. */
  unreachable: 'unreachable',
  /** This build names no doorman to ask. Always status 0. */
  noDoorman: 'no_doorman',
  /** An answer, but not the doorman's: a Cloudflare page, a proxy's error. */
  unexpected: 'unexpected',
} as const

export type DoormanErrorCode = (typeof DOORMAN_ERROR)[keyof typeof DOORMAN_ERROR]

/** The doorman's word for a bucket past its day's allowance (docs/SYNC.md, "Caps"). */
export const BUCKET_CAP_CODE = DOORMAN_ERROR.bucketCapExceeded

/** The same, for a song lent from someone else's bucket. */
export const LENDER_CAP_CODE = DOORMAN_ERROR.lenderCapExceeded

/**
 * How long a cap's refusal is believed before the bucket is asked again: ten
 * minutes, then one real request finds out whether it is over — a cap raised
 * at backblaze.com should not wait for midnight. The replica's hold
 * (packages/replica/src/hold.ts) and the service worker's both last this long.
 */
export const BUCKET_HOLD_MS = 10 * 60_000

/**
 * How many songs a device that streams from the bucket keeps whole for having
 * played them, so a replay or a seek is not another read: a tab's service
 * worker (apps/app/sw/sw.ts) and the desktop shell (apps/desktop/src/main/stream.ts).
 */
export const PLAYED_KEPT = 10

/**
 * How far past what has arrived a range may start and still wait for the
 * download of the whole song under way, rather than ask the bucket for itself:
 * a second or two of a song arriving, against a request of its own.
 */
export const WAIT_AHEAD_BYTES = 2 * 1024 * 1024

/** How long a sign-in may take, from opening the start page to claiming the session. */
export const SIGN_IN_TTL_MS = 10 * 60_000

/** A refusal as the doorman words it: `ErrorBodySchema`'s two fields, read without zod. */
export interface DoormanRefusal {
  readonly error: string
  readonly code: string
}

/**
 * The doorman's refusal in an answer's body — the text, or what JSON made of
 * it — or null when the body is not one: a page, nothing, a stream's bytes.
 */
export function parseDoormanRefusal(body: unknown): DoormanRefusal | null {
  let value = body
  if (typeof body === 'string') {
    try {
      value = JSON.parse(body) as unknown
    } catch {
      return null
    }
  }
  if (typeof value !== 'object' || value === null) return null
  const { error, code } = value as { error?: unknown; code?: unknown }
  return typeof error === 'string' && typeof code === 'string' ? { error, code } : null
}

/** How much of an answer that is not the doorman's is worth repeating. */
const QUOTED_CHARACTERS = 200

/**
 * What a refused answer said, in words: the doorman's `error` when the answer
 * is its own, else whatever text the page holds with its tags stripped —
 * "error code: 1027" is the whole diagnosis of a Worker past its day's quota.
 * Empty when it said nothing at all.
 */
export function refusalWords(body: string, limit = QUOTED_CHARACTERS): string {
  const refusal = parseDoormanRefusal(body)
  if (refusal) return refusal.error.trim()
  return body
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

/** A file's key in a path: each part encoded on its own, so the slashes stay slashes. */
function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

/**
 * `?a=1&b=2`, built by hand: React Native's `URLSearchParams` cannot be relied
 * on, and every value here is encoded anyway.
 */
function query(params: Readonly<Record<string, string | null | undefined>>): string {
  const pairs = Object.entries(params).flatMap(([name, value]) =>
    value === null || value === undefined ? [] : [`${name}=${encodeURIComponent(value)}`],
  )
  return pairs.length > 0 ? `?${pairs.join('&')}` : ''
}

const FILES = '/v1/files/'
const LIST = '/v1/list'
const ROOMS = '/v1/rooms'
const SHARED = '/v1/shared'
const SHARE = '/v1/share'
const GRANTS = '/v1/grants'

/**
 * The doorman's routes, as paths under its address. The doorman's router is
 * keyed by these, so a client and the Worker cannot name a route two ways.
 */
export const DOORMAN_PATHS = {
  health: '/v1/health',
  signInStart: '/v1/auth/start',
  signInCallback: '/v1/auth/callback',
  claim: '/v1/auth/claim',
  signOut: '/v1/auth/signout',
  signOutEverywhere: '/v1/auth/signout-everywhere',
  me: '/v1/me',
  access: '/v1/access',
  stats: '/v1/stats',
  storage: '/v1/storage',
  backblaze: '/v1/storage/backblaze',
  changes: '/v1/changes',
  /** An iPhone's ID, for the iPhone app's install page (apps/doorman/src/device.ts). */
  device: '/v1/device',
  list: LIST,
  files: FILES,
  grants: GRANTS,
  rooms: ROOMS,
  shared: SHARED,
  share: SHARE,

  /** One page of a folder: `/v1/list?prefix=log/&cursor=…`. */
  listing: (prefix: string, cursor?: string | null): string =>
    `${LIST}${query({ prefix, cursor })}`,
  /** `/v1/files/<key>`. */
  file: (key: string): string => `${FILES}${encodeKey(key)}`,
  grant: (id: string): string => `${GRANTS}/${encodeURIComponent(id)}`,
  /**
   * A room, or something in it (`/act`, `/socket`, `/files/<entry>/<part>`),
   * with the member's token when the request is a member's.
   */
  room: (code: string, rest = '', token?: string): string =>
    `${ROOMS}/${encodeURIComponent(code)}${rest}${query({ t: token })}`,
  /** A shared playlist, or something in it, with its listen token for a song's file. */
  sharedPlaylist: (id: string, rest = '', token?: string): string =>
    `${SHARED}/${encodeURIComponent(id)}${rest}${query({ t: token })}`,
  /**
   * A share link, or something in it, with its key where the request needs
   * one, and the signed-out device that opens it (`visitor`).
   */
  shareLink: (id: string, rest = '', key?: string, visitor?: string): string =>
    `${SHARE}/${encodeURIComponent(id)}${rest}${query({ k: key, v: visitor })}`,
} as const

/**
 * What a request costs against the bucket's day (docs/SYNC.md, "Caps"):
 * reading a file (Backblaze's Class B) or listing a folder (Class C), each
 * under a cap of its own. Null for anything the cap does not touch — a write,
 * or a question the doorman answers by itself.
 */
export type BucketCall = 'read' | 'list'

export function bucketCallOf(method: string, path: string): BucketCall | null {
  if (method !== 'GET') return null
  if (path === LIST || path.startsWith(`${LIST}?`)) return 'list'
  if (path.startsWith(FILES)) return 'read'
  return null
}

/**
 * Where to send a browser to sign in: the doorman's start page, with the
 * attempt the device made up and, where the device can be returned to, where
 * Google should bring it back.
 */
export function signInStartUrl(
  doormanUrl: string,
  attempt: string,
  returnUrl: string | null,
): string {
  const base = doormanUrl.replace(/\/+$/, '')
  return `${base}${DOORMAN_PATHS.signInStart}${query({ attempt, return: returnUrl })}`
}

/**
 * Where a device keeps the doorman session, and each song's bucket files, in
 * its own store (packages/replica's `DeviceStore`). The browser's service
 * worker reads both straight out of IndexedDB (apps/app/sw/sw.ts) to fetch a
 * song from the bucket, so the replica's writer and the worker's reader have
 * to name them alike.
 */
export const CLOUD_SESSION_KEY = 'cloud-session'
export const CLOUD_FILES_KEY = 'cloud-files'

/**
 * A file's name in the bucket when it is named by the SHA-256 of its bytes:
 * the hash and its extension, `4f1c….jpg`. A pattern's source, for every
 * pattern that matches one (a key, a kept copy's name, a worker's path).
 */
export const HASH_FILE_NAME = '[0-9a-f]{64}\\.[a-z0-9]{1,5}'

import type { CloudSmartRules } from './schemas/cloud.js'
import type { SmartRules } from './schemas/smart.js'

/**
 * The cloud bucket's layout, as code every device shares — see docs/SYNC.md.
 *
 * Only pure functions here: what a file is called, which snapshot is newest,
 * which old ones to delete. Talking to the bucket is each platform's business.
 */

/**
 * A new uid: 32 random hex characters, the same shape SQLite's
 * `lower(hex(randomblob(16)))` gives an existing row in the migration.
 *
 * Uses the platform's cryptographic random source when there is one. React
 * Native's engine may not have it, and there `Math.random` is enough: a uid
 * only has to be unique among the things one person makes.
 */
export function newUid(random: (bytes: Uint8Array<ArrayBuffer>) => void = fillRandom): string {
  const bytes = new Uint8Array(16)
  random(bytes)
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

function fillRandom(bytes: Uint8Array<ArrayBuffer>): void {
  const source = (globalThis as {
    crypto?: { getRandomValues?: (array: Uint8Array<ArrayBuffer>) => void }
  })
    .crypto
  if (source?.getRandomValues) {
    source.getRandomValues(bytes)
    return
  }
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
}

/** A device's name in the bucket: its kind and eight random hex characters. */
export function newCloudDeviceId(kind: string): string {
  const safe =
    kind
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'device'
  return `${safe.slice(0, 20)}-${newUid().slice(0, 8)}`
}

// --- File names --------------------------------------------------------------

/** `.M4A` or `m4a` → `m4a`. Anything odd becomes `bin`, never a path. */
export function cleanExtension(extension: string): string {
  const bare = extension.replace(/^\./, '').toLowerCase()
  return /^[a-z0-9]{1,5}$/.test(bare) ? bare : 'bin'
}

export function audioKey(sha256: string, extension: string): string {
  return `audio/${sha256}.${cleanExtension(extension)}`
}

export function coverKey(sha256: string, extension: string): string {
  return `covers/${sha256}.${cleanExtension(extension)}`
}

/** Timed lyrics are `.lrc` and plain ones `.txt`, as sidecars are on the Mac. */
export function lyricsKey(sha256: string, synced: boolean): string {
  return `lyrics/${sha256}.${synced ? 'lrc' : 'txt'}`
}

export const FORMAT_KEY = 'format.json'
export const SNAPSHOTS_FOLDER = 'snapshots/'

/**
 * `snapshots/20260911T142205123Z-mac-3f9a1c2e.json`.
 *
 * The time is UTC and fixed-width, so sorting keys as text sorts them by time
 * and the newest snapshot is the last one in a listing — which is all a device
 * joining for the first time needs to know.
 */
export function snapshotKey(writtenAt: Date, deviceId: string): string {
  const stamp = writtenAt.toISOString().replace(/[-:.]/g, '')
  return `${SNAPSHOTS_FOLDER}${stamp}-${deviceId}.json`
}

const SNAPSHOT_KEY = /^snapshots\/(\d{8}T\d{9}Z)-([a-z0-9][a-z0-9-]{2,62})\.json$/

export function parseSnapshotKey(key: string): { stamp: string; deviceId: string } | null {
  const match = SNAPSHOT_KEY.exec(key)
  if (!match?.[1] || !match[2]) return null
  return { stamp: match[1], deviceId: match[2] }
}

/** The newest snapshot among these keys, by anyone. Other keys are ignored. */
export function newestSnapshotKey(keys: readonly string[]): string | null {
  let newest: { key: string; stamp: string } | null = null
  for (const key of keys) {
    const parsed = parseSnapshotKey(key)
    if (!parsed) continue
    if (!newest || parsed.stamp > newest.stamp) newest = { key, stamp: parsed.stamp }
  }
  return newest?.key ?? null
}

/**
 * This device's snapshots beyond the newest `keep`, oldest first: the ones
 * it should delete. Another device's snapshots are never its to delete.
 */
export function snapshotsToPrune(keys: readonly string[], deviceId: string, keep = 3): string[] {
  const mine = keys
    .map(key => ({ key, parsed: parseSnapshotKey(key) }))
    .filter(entry => entry.parsed?.deviceId === deviceId)
    .sort((a, b) => (a.parsed?.stamp ?? '').localeCompare(b.parsed?.stamp ?? ''))
  return mine.slice(0, Math.max(0, mine.length - keep)).map(entry => entry.key)
}

export const LOG_FOLDER = 'log/'

/**
 * `log/iphone-0b7d44a1/000000000042.json`: a device's 42nd batch of changes.
 * Fixed-width, so a listing gives a device's files in order.
 */
export function logKey(deviceId: string, seq: number): string {
  return `${LOG_FOLDER}${deviceId}/${String(seq).padStart(12, '0')}.json`
}

const LOG_KEY = /^log\/([a-z0-9][a-z0-9-]{2,62})\/(\d{12})\.json$/

export function parseLogKey(key: string): { deviceId: string; seq: number } | null {
  const match = LOG_KEY.exec(key)
  if (!match?.[1] || !match[2]) return null
  const seq = Number(match[2])
  return seq > 0 ? { deviceId: match[1], seq } : null
}

/**
 * The log files a snapshot has not folded in yet, each device's in order.
 * Keys that are not log files are ignored.
 */
export function unfoldedLogKeys(
  keys: readonly string[],
  upTo: Readonly<Record<string, number>>,
): string[] {
  return keys
    .flatMap(key => {
      const parsed = parseLogKey(key)
      return parsed && parsed.seq > (upTo[parsed.deviceId] ?? 0) ? [{ key, ...parsed }] : []
    })
    .sort((a, b) => a.deviceId.localeCompare(b.deviceId) || a.seq - b.seq)
    .map(entry => entry.key)
}

/**
 * Every key a device may read or write through the doorman, and nothing else:
 * the format marker, snapshots, a device's change log, and files named by
 * their hash. A key that does not match is refused before it reaches the
 * bucket, so no request can wander outside the library's own folders.
 *
 * No part of a key may be `.` or `..`: S3 would take them literally, but a
 * URL built from them would not, and the request would land somewhere else.
 */
const FILE_KEY = new RegExp(
  '^(?:' +
    [
      'format\\.json',
      'snapshots/\\d{8}T\\d{9}Z-[a-z0-9][a-z0-9-]{2,62}\\.json',
      'log/[a-z0-9][a-z0-9-]{2,62}/[A-Za-z0-9][A-Za-z0-9._-]{0,99}',
      '(?:audio|covers|lyrics)/[0-9a-f]{64}\\.[a-z0-9]{1,5}',
    ].join('|') +
    ')$',
)

export function isCloudFileKey(key: string): boolean {
  return FILE_KEY.test(key)
}

/** Snapshots and change logs are rewritten and pruned; files named by their hash never are. */
export function isDeletableCloudKey(key: string): boolean {
  return isCloudFileKey(key) && (key.startsWith(SNAPSHOTS_FOLDER) || key.startsWith(LOG_FOLDER))
}

/** The folders a device may list: one of the library's own, or one device's log. */
const LIST_PREFIX =
  /^(?:|snapshots\/|log\/|log\/[a-z0-9][a-z0-9-]{2,62}\/|audio\/|covers\/|lyrics\/)$/

export function isCloudListPrefix(prefix: string): boolean {
  return LIST_PREFIX.test(prefix)
}

// --- Connecting -----------------------------------------------------------------

/**
 * The doorman every device signs in through, unless told otherwise
 * (SELFMP3_DOORMAN_URL on the Mac, VITE_DOORMAN_URL for a web build, or the
 * repository variable DOORMAN_URL for the published web app). A fork deploys
 * its own doorman and changes this one line.
 */
export const DEFAULT_DOORMAN_URL = 'https://selfmp3-doorman.xiaozhang20030215.workers.dev'

/**
 * Tidy an endpoint as it is pasted from a bucket's page, and work out its
 * region where the address says it: `s3.us-west-004.backblazeb2.com` is in
 * `us-west-004`. Other providers need the region given.
 */
export function parseEndpoint(input: string): { url: string; region: string | null } | null {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.pathname !== '/' && url.pathname !== '') return null
  const b2 = /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i.exec(url.hostname)
  return { url: `${url.protocol}//${url.host}`, region: b2?.[1]?.toLowerCase() ?? null }
}

// --- Smart rules ----------------------------------------------------------------

/**
 * Stands in for a tag that has since been deleted. No tag has it, so a rule
 * naming it keeps meaning what it did: "has" matches nothing, "does not have"
 * matches everything — exactly how the SQL treats a deleted tag's id.
 */
export const MISSING_TAG_UID = '0'.repeat(32)

/** Smart rules with each tag named by uid instead of by this device's id. */
export function toCloudRules(
  rules: SmartRules,
  tagUid: (tagId: number) => string | null,
): CloudSmartRules {
  return {
    match: rules.match,
    rules: rules.rules.map(rule =>
      rule.field === 'tag'
        ? { field: 'tag', op: rule.op, tagUid: tagUid(rule.tagId) ?? MISSING_TAG_UID }
        : rule,
    ),
    orderBy: rules.orderBy,
    order: rules.order,
    limit: rules.limit,
  }
}

/**
 * Stands in, on a device, for a tag a smart rule names that the device does
 * not have. No tag has this id, so the rule matches as a deleted tag's would.
 */
export const UNKNOWN_TAG_ID = Number.MAX_SAFE_INTEGER

/** Smart rules with each tag named by this device's id again. */
export function fromCloudRules(
  rules: CloudSmartRules,
  tagId: (tagUid: string) => number | null,
): SmartRules {
  return {
    match: rules.match,
    rules: rules.rules.map(rule =>
      rule.field === 'tag'
        ? { field: 'tag', op: rule.op, tagId: tagId(rule.tagUid) ?? UNKNOWN_TAG_ID }
        : rule,
    ),
    orderBy: rules.orderBy,
    order: rules.order,
    limit: rules.limit,
  }
}

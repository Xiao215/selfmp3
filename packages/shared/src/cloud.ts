import {
  CLOUD_FORMAT,
  CloudFormatSchema,
  type CloudFormat,
  type CloudSmartRules,
} from './schemas/cloud.js'
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
  const source = (
    globalThis as {
      crypto?: { getRandomValues?: (array: Uint8Array<ArrayBuffer>) => void }
    }
  ).crypto
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

/** Timed lyrics are `.lrc` and plain ones `.txt`, as sidecars are on the server. */
export function lyricsKey(sha256: string, synced: boolean): string {
  return `lyrics/${sha256}.${synced ? 'lrc' : 'txt'}`
}

/** A lyric text's romanized lines, as a JSON array, beside the words in `lyrics/`. */
export function romanizedKey(sha256: string): string {
  return `lyrics/${sha256}.json`
}

/**
 * A song's motion curve (schemas/motion.ts), as JSON, also in `lyrics/`: the
 * doorman's key rule already allows the folder, and a new folder would need
 * every doorman redeployed before a device could read it. Named by the hash of
 * its bytes, so it can never be mistaken for a lyric's romanized lines.
 */
export function motionKey(sha256: string): string {
  return `lyrics/${sha256}.json`
}

/**
 * Every song's sound vector as the server's listening model heard it, in one
 * file (the server's sound/pack.ts), also in `lyrics/` for the same reason as
 * the motion curve. Named by the hash of its bytes: a song heard is a new file.
 */
export function soundVectorsKey(sha256: string): string {
  return `lyrics/${sha256}.vec`
}

export const FORMAT_KEY = 'format.json'

/**
 * The format.json a new bucket gets, at the format this build writes, as its
 * text: pretty, with a newline, so it reads well in a provider's file browser.
 */
export function newCloudFormatText(createdAt: string, createdBy: string): string {
  const format: CloudFormat = { app: 'self.mp3', format: CLOUD_FORMAT, createdAt, createdBy }
  return `${JSON.stringify(format, null, 2)}\n`
}

/** Whether a parsed document is a format.json at all: what a read-back checks. */
export function isCloudFormat(document: unknown): boolean {
  return CloudFormatSchema.safeParse(document).success
}

/**
 * Whether this build may use a bucket whose format.json says `document`
 * (parsed; null when it would not parse): null when it may, and otherwise the
 * words for the person connecting it. The server and the doorman judge a
 * bucket alike and say so alike; `update` names what to update when the bucket
 * is newer than this build — "this server", "the doorman".
 */
export function cloudFormatProblem(document: unknown, update: string): string | null {
  const parsed = CloudFormatSchema.safeParse(document)
  if (!parsed.success) {
    return 'That folder of the bucket has a format.json that is not self.mp3’s. Choose another folder.'
  }
  if (parsed.data.format > CLOUD_FORMAT) {
    return (
      `This bucket was set up by a newer version of self.mp3 (format ${parsed.data.format}). ` +
      `Update ${update} before connecting it.`
    )
  }
  return null
}

/** A key that wrote format.json and could not read it back. */
export const CLOUD_FORMAT_UNREADABLE =
  'The key can write to the bucket but not read from it. It needs both.'
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
 * The folders whose files are named by the hash of their bytes (`audioKey`,
 * `coverKey`, `lyricsKey` and the rest above): the same key is the same bytes,
 * forever, so such a file is never replaced and may be cached for good.
 */
const HASH_NAMED_FOLDERS = ['audio', 'covers', 'lyrics'] as const
const HASH_NAMED = new RegExp(`^(?:${HASH_NAMED_FOLDERS.join('|')})/`)

/** Whether a key is a file named by its own hash, in one of `HASH_NAMED_FOLDERS`. */
export function isHashNamedCloudKey(key: string): boolean {
  return HASH_NAMED.test(key)
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
      `(?:${HASH_NAMED_FOLDERS.join('|')})/[0-9a-f]{64}\\.[a-z0-9]{1,5}`,
    ].join('|') +
    ')$',
)

export function isCloudFileKey(key: string): boolean {
  return FILE_KEY.test(key)
}

/**
 * Snapshots and change logs are rewritten and pruned, and a removed song's
 * files go once no song names them (docs/SYNC.md). Only `format.json`, the
 * doorman's own, is never deleted.
 */
export function isDeletableCloudKey(key: string): boolean {
  return isCloudFileKey(key) && key !== FORMAT_KEY
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
 * (SELFMP3_DOORMAN_URL on the server, and on the published app, where it comes
 * from the repository variable DOORMAN_URL). A fork deploys its own doorman
 * and changes this one line.
 */
export const DEFAULT_DOORMAN_URL = 'https://selfmp3-doorman.xiaozhang20030215.workers.dev'

/**
 * Where the app is, for something that has a server's address but needs to send
 * someone to the app instead — the browser extension's "open the queue", say.
 *
 * It used to be enough to open the server's own address, because the server
 * served the app there. It serves its own page now (`apps/server/src/http/admin.ts`),
 * so the two are different places and the difference has to be named. A fork
 * publishes its own Pages site and changes this one line, as with the doorman
 * above. `apps/server/public/admin.html` links to the same address, and is the
 * one copy that cannot import this: it is a plain file with no build step.
 */
export const DEFAULT_APP_URL = 'https://xiao215.github.io/selfmp3'

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
    ...rules,
    rules: rules.rules.map(rule =>
      rule.field === 'tag'
        ? { field: 'tag', op: rule.op, tagUid: tagUid(rule.tagId) ?? MISSING_TAG_UID }
        : rule,
    ),
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
    ...rules,
    rules: rules.rules.map(rule =>
      rule.field === 'tag'
        ? { field: 'tag', op: rule.op, tagId: tagId(rule.tagUid) ?? UNKNOWN_TAG_ID }
        : rule,
    ),
  }
}

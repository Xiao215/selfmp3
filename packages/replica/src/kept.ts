import {
  CLOUD_FILES_KEY,
  CLOUD_FORMAT,
  ChangeSchema,
  CloudDeviceIdSchema,
  CloudSnapshotSchema,
  HlcSchema,
  readLogFile,
  type Change,
  type CloudSnapshot,
  type LogFile,
} from '@selfmp3/shared'
import { z } from 'zod'
import { NO_IDS, type LocalIds } from './snapshotLibrary.js'

/**
 * What this device keeps of its copy of the library (library.ts), under which
 * keys of its store, and how each is read back.
 *
 * IndexedDB and a file both hand back whatever was put there, or whatever a
 * crash left; a row that does not read as what it should be is read again
 * from the bucket rather than replayed and uploaded as it stands. Pure, so it
 * can be tested without a store.
 */

export const IDS_KEY = 'cloud-ids'
export const PLAYLISTS_KEY = 'cloud-playlist-songs'
export const STATE_KEY = 'cloud-state'
export const BASE_KEY = 'cloud-base'
export const LOGS_KEY = 'cloud-logs'
export const OUTBOX_KEY = 'cloud-outbox'
export const LOOK_KEY = 'cloud-look'
export const PLAYED_KEY = 'cloud-playlists-played'

/** Every key the copy is kept under, for forgetting it on signing out. */
export const KEPT_KEYS: readonly string[] = [
  IDS_KEY,
  CLOUD_FILES_KEY,
  PLAYLISTS_KEY,
  STATE_KEY,
  BASE_KEY,
  LOGS_KEY,
  OUTBOX_KEY,
  LOOK_KEY,
  PLAYED_KEY,
]

type Warn = (message: string) => void

// --- The snapshot the copy starts from -------------------------------------------------

const KeptBaseSchema = z.object({
  key: z.string().nullable(),
  snapshot: CloudSnapshotSchema.nullable(),
})
/** The newest snapshot this device has read, and its key in the bucket. */
export type KeptBase = z.infer<typeof KeptBaseSchema>

/**
 * The snapshot this device kept, or null when there is none or it does not
 * read as one. A copy kept before the snapshot's shape was settled is
 * brought up to it (`upgradeKeptBase`) and says so, to be written back.
 */
export function storedBase(
  value: unknown,
  warn: Warn,
): { base: KeptBase; upgraded: boolean } | null {
  if (value === null || value === undefined) return null
  const parsed = KeptBaseSchema.safeParse(value)
  if (parsed.success) return { base: parsed.data, upgraded: false }
  const upgraded = KeptBaseSchema.safeParse(upgradeKeptBase(value))
  if (upgraded.success) return { base: upgraded.data, upgraded: true }
  warn('this device’s copy of the library could not be read; it is fetched again')
  return null
}

/**
 * A copy of the library a device kept before the snapshot's shape was settled,
 * brought up to it.
 *
 * A snapshot once could leave out a song's `motion`, `audioFeatures` and
 * `coverTone`, the snapshot's `upTo`, `artists`, `sound`, `artistNames`,
 * `spellings` and `coverPacks`, and its server's `id`, and a device
 * kept what it had read, so its copy can lack any of them. Thrown away and
 * fetched again instead, such a copy left a phone on a day the bucket refused
 * reads with no library at all, while every song it had downloaded sat on its
 * disk.
 *
 * The copy is migrated instead, with the same answers the old schema gave:
 * a field left out is null (or empty), a cover colour without a palette is
 * no colour, and a server that did not name itself is no server — the next
 * snapshot names it. Data, not a second reading of the schema: once upgraded, the copy
 * is written back and reads as any other.
 */
function upgradeKeptBase(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value['snapshot'])) return value
  const snapshot = value['snapshot']
  const kept: unknown = snapshot['songs']
  const songs: unknown = Array.isArray(kept)
    ? kept.map((song: unknown) => (isRecord(song) ? upgradeSong(song) : song))
    : kept
  return {
    ...value,
    snapshot: {
      ...snapshot,
      upTo: snapshot['upTo'] ?? {},
      artists: snapshot['artists'] ?? [],
      sound: snapshot['sound'] ?? null,
      artistNames: snapshot['artistNames'] ?? [],
      spellings: snapshot['spellings'] ?? {},
      coverPacks: snapshot['coverPacks'] ?? [],
      server: named(snapshot['server']),
      songs,
    },
  }
}

function named(server: unknown): unknown {
  return isRecord(server) && server['id'] === undefined ? undefined : server
}

function upgradeSong(song: Record<string, unknown>): Record<string, unknown> {
  const tone = song['coverTone']
  return {
    ...song,
    motion: song['motion'] ?? null,
    audioFeatures: song['audioFeatures'] ?? null,
    coverTone: isRecord(tone) && tone['palette'] !== undefined ? tone : null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A snapshot with nothing in it: the base of a device that has never looked. */
export function emptySnapshot(): CloudSnapshot {
  return {
    format: CLOUD_FORMAT,
    writtenAt: new Date(0).toISOString(),
    writtenBy: 'none',
    upTo: {},
    songs: [],
    tags: [],
    playlists: [],
    artists: [],
    artistNames: [],
    spellings: {},
    coverPacks: [],
    sound: null,
  }
}

// --- When this device last looked --------------------------------------------------------

/** When this device last looked, kept so a new tab or a relaunch does not look again at once. */
const LookSchema = z.object({
  checkedAt: z.number(),
  listedAt: z.number(),
  changes: z.string().nullable(),
})
export type Look = z.infer<typeof LookSchema>

export const NEVER_LOOKED: Look = { checkedAt: 0, listedAt: 0, changes: null }

/** The last look as kept, or one that never happened when it does not read as one. */
export function storedLook(value: unknown, now = Date.now()): Look {
  const parsed = LookSchema.safeParse(value)
  if (!parsed.success) return NEVER_LOOKED
  // A clock put back makes a look in the future; it is not fresh, it is wrong.
  return parsed.data.checkedAt > now || parsed.data.listedAt > now ? NEVER_LOOKED : parsed.data
}

// --- What `show` writes ------------------------------------------------------------------

const IdsSchema = z.object({
  songs: z.record(z.number()),
  tags: z.record(z.number()),
  playlists: z.record(z.number()),
  next: z.number(),
})

/** This device's ids as kept; anything else is none handed out yet. */
export function storedIds(value: unknown): LocalIds {
  const parsed = IdsSchema.safeParse(value)
  return parsed.success ? parsed.data : NO_IDS
}

const StateSchema = z.object({ version: z.number() })

/** The library's version as kept, or 0. */
export function storedVersion(value: unknown): number {
  const parsed = StateSchema.safeParse(value)
  return parsed.success ? parsed.data.version : 0
}

/** The playlists' played times as kept, or none when they do not read as such. */
export function storedPlayed(value: unknown): Record<string, string> {
  const parsed = z.record(z.string()).safeParse(value)
  return parsed.success ? parsed.data : {}
}

// --- Log files and the outbox ------------------------------------------------------------

/** The log files this device kept, each read the way one from the bucket is. */
export function storedLogs(value: unknown, warn: Warn): Map<string, LogFile> {
  const logs = new Map<string, LogFile>()
  if (typeof value !== 'object' || value === null) return logs
  for (const [key, raw] of Object.entries(value)) {
    const read = readLogFile(raw)
    if (read.ok) logs.set(key, read.file)
    else warn(`skipping a kept log file this version cannot read (${key})`)
  }
  return logs
}

/** The outbox's envelope; each change in it is checked on its own (`knownChanges`). */
const OutboxSchema = z.object({
  device: CloudDeviceIdSchema,
  nextSeq: z.number().int().positive(),
  last: HlcSchema.nullable().catch(null),
  pending: z.array(z.unknown()).catch([]),
  inflight: z
    .object({
      seq: z.number().int().positive(),
      changes: z.array(z.unknown()),
      writtenAt: z.string(),
    })
    .nullable()
    .catch(null),
})

/** This device's changes on their way up. */
export interface Outbox {
  /** This device's name in the bucket, and so the folder its log files go in. */
  readonly device: string
  /** The latest stamp this device's clock made or saw, to carry it across a restart. */
  readonly last: string | null
  readonly nextSeq: number
  /** Made here, not yet in any file. */
  readonly pending: readonly Change[]
  /**
   * A file on its way up. Its number and contents are fixed the first time it
   * is sent, so sending it again — after a lost response — writes the same
   * bytes, and no number is ever used for two different files.
   */
  readonly inflight: {
    readonly seq: number
    readonly changes: readonly Change[]
    readonly writtenAt: string
  } | null
}

/**
 * The outbox as stored, checked rather than cast, or null when there is
 * none to read — never a new one.
 *
 * The device name and the next file number are the parts that must hold: a
 * number used twice is the one thing the bucket's format cannot survive, so
 * a row without them is no outbox at all. Each change is checked too when
 * `changes` says so — on opening, and on a look at what another tab wrote —
 * and one that does not parse is set aside rather than sent. A change made
 * in this session was built here, so the outbox's own updates skip that:
 * checking a long offline outbox on every play was work for nothing.
 */
export function storedOutbox(value: unknown, changes: boolean, warn: Warn): Outbox | null {
  const parsed = OutboxSchema.safeParse(value)
  if (!parsed.success) return null
  const { device, last, nextSeq, pending, inflight } = parsed.data
  const read = (raw: readonly unknown[]): Change[] =>
    changes ? knownChanges(raw, warn) : (raw as Change[])
  return {
    device,
    last,
    nextSeq,
    pending: read(pending),
    inflight: inflight && { ...inflight, changes: read(inflight.changes) },
  }
}

/** The changes of these that this build can read; the rest are said and set aside. */
function knownChanges(raw: readonly unknown[], warn: Warn): Change[] {
  const known: Change[] = []
  for (const change of raw) {
    const parsed = ChangeSchema.safeParse(change)
    if (parsed.success) known.push(parsed.data)
    else warn('skipping a change in the outbox this version cannot read')
  }
  return known
}

/** The changes made here and not in the bucket yet: the file on its way up, then the rest. */
export function localChanges(outbox: Outbox): Change[] {
  return [...(outbox.inflight?.changes ?? []), ...outbox.pending]
}

/** Which changes are waiting, by stamp: every change has its own. */
export function outboxSignature(outbox: Outbox): string {
  return localChanges(outbox)
    .map(change => change.hlc)
    .join(',')
}

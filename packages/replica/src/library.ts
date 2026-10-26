import { z } from 'zod'
import {
  BUCKET_CAP_CODE,
  CHANGES_HEADER,
  CLOUD_FILES_KEY,
  CLOUD_FORMAT,
  DOORMAN_ERROR,
  DOORMAN_PATHS,
  DoormanError,
  ChangeSchema,
  CloudDeviceIdSchema,
  CloudSnapshotSchema,
  DoormanChangesSchema,
  DoormanListSchema,
  HlcClock,
  HlcSchema,
  LOG_FILE_MAX_CHANGES,
  LOG_FOLDER,
  SNAPSHOTS_FOLDER,
  applyChanges,
  artistKey,
  logFile,
  logKey,
  newCloudDeviceId,
  newestSnapshotKey,
  parseChangesHeader,
  readLogFile,
  toSqliteTime,
  unfoldedLogKeys,
  type Change,
  type CloudCoverPack,
  type CloudSnapshot,
  type LibraryVersion,
  type LogFile,
  type SyncLibrary,
  type SyncManifest,
  MotionSchema,
  parseCloudWords,
  type Motion,
  type RoomSong,
  decodeSoundPack,
  parseSoundMap,
  type MapPlace,
  type SoundMap,
} from '@selfmp3/shared'
import type { EditContext } from './edits.js'
import { bucketHold } from './hold.js'
import { upgradeKeptBase } from './keptBase.js'
import { roomSongOf } from './roomSong.js'
import { latestStamp, replay, replayedSnapshot } from './replay.js'
import {
  NO_IDS,
  snapshotToLibrary,
  type ArtistPictureKeys,
  type CloudLibrary,
  type LocalIds,
  type SongFiles,
} from './snapshotLibrary.js'
import type { CloudPlatform, CloudResponse } from './platform.js'
import type { CloudSession, CloudSessionApi } from './session.js'

/**
 * This device's copy of the library (docs/SYNC.md).
 *
 * The newest snapshot in the bucket, with every change it has not folded in
 * yet replayed on top: other devices' log files, this device's own, and the
 * changes this device has made but not uploaded yet — its outbox. An edit
 * here lands in the outbox and in the library at once, and goes up in the
 * background, a batch at a time, as this device's next log file.
 *
 * Everything is kept in IndexedDB, so the library opens, and takes edits,
 * with no connection at all. The bucket is asked again when the app asks for
 * the library and it has not been asked for a little while; in between, what
 * this device has is the library.
 */

const IDS_KEY = 'cloud-ids'
const PLAYLISTS_KEY = 'cloud-playlist-songs'
const STATE_KEY = 'cloud-state'
const BASE_KEY = 'cloud-base'
const LOGS_KEY = 'cloud-logs'
const OUTBOX_KEY = 'cloud-outbox'
const LOOK_KEY = 'cloud-look'
const PLAYED_KEY = 'cloud-playlists-played'

/**
 * Within this long of the last look at the bucket, the library is answered
 * from here.
 *
 * A look asks the doorman's change counter first (`/v1/changes`), which costs
 * the bucket nothing, and lists `log/` and `snapshots/` only when it has moved.
 * While the counter cannot be read, every look is those two listings, and the
 * bucket counts listings against a daily allowance (docs/SYNC.md, "Caps"): a
 * look every minute or so, from one open tab, was most of the allowance on its
 * own. So a device that has no counter to go by looks a good deal less often.
 * One that has looks every twenty seconds: the counter costs the bucket
 * nothing, and a song deleted on another device went on playing here for two
 * minutes at a minute's wait.
 */
const FRESH_MS = 20_000
const LISTED_FRESH_MS = 5 * 60_000
/**
 * A counter that has not moved stands in for a listing for at most this long:
 * it only sees what goes through the doorman, and a server given the bucket's
 * key directly writes snapshots past it.
 */
const COUNTER_TRUSTED_MS = 30 * 60_000
/** Edits made within this long of each other go up as one file. */
const FLUSH_DELAY_MS = 1_500
const FLUSH_RETRY_MS = [5_000, 15_000, 60_000, 300_000]
/**
 * How long after another tab's edit this one sends what that tab left: well
 * after that tab would have sent it itself, so two open tabs do not both send
 * every edit — the second finds the outbox empty and asks the doorman nothing.
 */
const OTHERS_FLUSH_DELAY_MS = 10_000
const LOG_READS_AT_ONCE = 6

/**
 * What this device kept, as it is read back. IndexedDB and a file both hand
 * back whatever was put there, or whatever a crash left; a row that does not
 * read as what it should be is read again from the bucket rather than replayed
 * and uploaded as it stands.
 */
const StoredBaseSchema = z.object({
  key: z.string().nullable(),
  snapshot: CloudSnapshotSchema.nullable(),
})

/** When this device last looked, kept so a new tab or a relaunch does not look again at once. */
const StoredLookSchema = z.object({
  checkedAt: z.number(),
  listedAt: z.number(),
  changes: z.string().nullable(),
})
type Look = z.infer<typeof StoredLookSchema>

const NEVER_LOOKED: Look = { checkedAt: 0, listedAt: 0, changes: null }

/**
 * Whether a moment is less than `ms` ago. One after now is not: the clock was
 * put back since (a fast clock corrected, a wrong date fixed), and taking it
 * for recent kept a look from being due again until the clock caught up — a
 * tab that saw no other device's edit for an hour, or a day.
 */
function within(at: number, ms: number, now = Date.now()): boolean {
  return at <= now && now - at < ms
}

/** The outbox's envelope; each change in it is checked on its own (`knownChanges`). */
const StoredOutboxSchema = z.object({
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
interface Outbox {
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

interface Replica {
  base: { key: string | null; snapshot: CloudSnapshot | null }
  /**
   * Whether the base is kept on the device yet. A bucket with no snapshot in
   * it has the same base as a device that has never looked, and that first
   * look still has to be written down: its presence is what lets the next
   * open answer without the network.
   */
  baseStored: boolean
  /** Log files the base has not folded in, by key. */
  logs: Map<string, LogFile>
  outbox: Outbox
  clock: HlcClock
  library: SyncLibrary
  view: CloudLibrary
  /** When each playlist was last started here, by uid: kept on this device alone. */
  played: Readonly<Record<string, string>>
  /**
   * `library` has changes `view` does not show yet: plays, recorded
   * without rebuilding the view (`recordChanges`' `deferView`). The next read
   * rebuilds it, once for however many there were.
   */
  viewStale: boolean
  /**
   * When the bucket was last looked at (`checkedAt`) and last listed
   * (`listedAt`), and the change counter as it stood before that listing —
   * or as this device's own writes have moved it since. Null when it could not
   * be read.
   */
  look: Look
  /**
   * The next read waits for a look at the bucket rather than answering first:
   * "Check for new songs", or a look in the background that failed in a way
   * the app has to be told about.
   */
  mustCheck: boolean
}

/** What `show` last wrote, kept so the next edit compares with it rather than reading it back. */
interface Written {
  readonly ids: LocalIds
  readonly files: unknown
  readonly playlistSongs: unknown
  readonly version: number
}

interface RecordOptions {
  /**
   * Leave the view as it is until something reads it. For plays:
   * the outbox sends a phone's waiting plays one at a time, and rebuilding the
   * whole library for each — replaying it, and writing it to the device — was
   * the most expensive thing a play did. The edit may read only ids from the
   * view it is handed, and its answer must not read the view at all.
   */
  readonly deferView?: boolean
}

/**
 * What an app asks of its copy of the library. Properties rather than methods,
 * for the same reason as the session's: these are closures over one platform
 * and are meant to be taken apart.
 */
export interface CloudLibraryApi {
  loadCloudLibrary: (session: CloudSession) => Promise<CloudLibrary>
  /**
   * The library from this device's copy, without looking at the bucket
   * however long it has been: for answers that hardly ever change — where the
   * server is, which uid is which song — and are asked for every few seconds.
   * A look that a library read starts brings them up to date.
   */
  peekCloudLibrary: (session: CloudSession) => Promise<CloudLibrary>
  markCloudLibraryStale: () => void
  /**
   * Hear about a look at the bucket, made in the background, that changed the
   * library — so an app that was answered from this device's copy can ask
   * again. Answers the way to stop listening.
   */
  onCloudLibraryChanged: (listener: () => void) => () => void
  cloudLibraryVersion: (session: CloudSession) => Promise<LibraryVersion>
  recordChanges: <T>(
    session: CloudSession,
    build: (ctx: EditContext) => { changes: readonly Change[]; answer: (view: CloudLibrary) => T },
    options?: RecordOptions,
  ) => Promise<T>
  /** A playlist was started: this device's "Recently played" order. False for one it does not have. */
  markPlaylistPlayed: (session: CloudSession, playlistId: number) => Promise<boolean>
  pendingCloudChanges: () => number
  /**
   * Whether those are waiting because sending them failed — the bucket
   * refusing writes, a network that answers nothing — and not just because
   * they were made a moment ago. Retried by itself; true until a send goes up.
   */
  cloudChangesStuck: () => boolean
  /**
   * The same, read from what this device keeps rather than the library in
   * memory: for a device with none open — signed out by the doorman, and
   * opened again — whose outbox is kept for the next sign-in.
   */
  keptCloudChanges: () => Promise<number>
  flushCloudChanges: () => Promise<void>
  cloudPlaylistSongs: (playlistId: number) => Promise<readonly number[]>
  /** Every playlist's songs, by playlist id, brought up to date once. */
  cloudAllPlaylistSongs: () => Promise<Readonly<Record<number, readonly number[]>>>
  cloudLyrics: (
    session: CloudSession | null,
    songId: number,
  ) => Promise<{ text: string; kind: 'plain' | 'synced'; romanized: string[] | null } | null>
  /** A song's motion curve, from this device if it has read it before, else the bucket; null when there is none. */
  cloudMotion: (session: CloudSession | null, songId: number) => Promise<Motion | null>
  /** A song's cover in the bucket (`covers/<sha256>.<ext>`), or null. */
  cloudCoverKey: (songId: number) => Promise<string | null>
  /**
   * The same, answered now from the library held in memory: undefined while
   * none is loaded yet, when only `cloudCoverKey` can say.
   */
  cloudCoverKeyNow: (songId: number) => string | null | undefined
  /**
   * An artist's picture in the bucket, by any spelling of their name, from the
   * library held in memory: null for an artist with none, undefined while no
   * library is loaded.
   */
  cloudArtistPictureNow: (name: string) => ArtistPictureKeys | null | undefined
  /**
   * Every picture the library names in the bucket — each song's cover, each
   * artist's picture — or null while none is loaded: what a device keeping
   * them may keep, and nothing else.
   */
  cloudPicturesNow: () => {
    readonly covers: ReadonlySet<string>
    readonly artists: readonly ArtistPictureKeys[]
    /** The same pictures, packed a few megabytes to a file, for filling a device from nothing. */
    readonly packs: readonly CloudCoverPack[]
  } | null
  cloudManifest: (scope: 'library' | 'playlists') => SyncManifest
  /**
   * One of your songs as a listening room carries it (roomSong.ts), from the
   * library held in memory; null while none is loaded, or for a song a room
   * could not play.
   */
  cloudRoomSongNow: (songId: number) => RoomSong | null
  /**
   * A song's audio in the bucket (`audio/<sha256>.<ext>`), from the library
   * held in memory: what `cloudSoundVectors` names its sound by. Null for a
   * song it does not hold, undefined while none is loaded.
   */
  cloudAudioKeyNow: (songId: number) => string | null | undefined
  /**
   * Whether the bucket answers reads again, while they are refused for the
   * day: one byte of one song's audio, the cheapest read there is. The
   * library's own look only lists the bucket, which Backblaze caps apart, so it
   * cannot say (R2-M9). Asked while the hold stands; answered, the hold on
   * reads is let go, refused, held again (session.ts). False when it could not
   * ask: no library loaded, or none of its songs in the bucket.
   */
  askBucketRead: (session: CloudSession) => Promise<boolean>
  /**
   * How your library's songs sound (shared soundVectors.ts), by audio key,
   * from the pack the snapshot names; null before the server has heard any,
   * or with no library loaded. Read once per pack and kept in memory.
   */
  cloudSoundVectors: (
    session: CloudSession,
  ) => Promise<{ model: string; vectors: ReadonlyMap<string, Float32Array> } | null>
  /**
   * The sound map (docs/features/sound-map.md): each heard song's place, from
   * the file the snapshot names, kept on the device by its hash like the
   * words, so it is read from the bucket once a change.
   */
  cloudSoundMap: (session: CloudSession) => Promise<SoundMap>
  forgetCloudLibrary: () => Promise<void>
}

/**
 * Plain data — what IndexedDB hands back — compared by value. The library's
 * files and playlist members are records of strings and numbers, so this is
 * all the comparing they need.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  return aKeys.every(key => key in bRecord && sameValue(aRecord[key], bRecord[key]))
}

/** Everything below closes over one device's platform, so there is no module state. */
export function createCloudLibrary(
  platform: CloudPlatform,
  sessionApi: CloudSessionApi,
): CloudLibraryApi {
  const { store } = platform
  const warn = (message: string): void => platform.warn?.(message)

  let replica: Replica | null = null
  let opening: Promise<Replica> | null = null
  /** Bumped on signing out, so a look at the bucket that began before it writes nothing after. */
  let generation = 0
  /**
   * What this device last put under IDS_KEY, CLOUD_FILES_KEY, PLAYLISTS_KEY and
   * STATE_KEY, or null before it has looked. Most edits change none of the
   * first three — a love, a tag, a rename — and each is the size of the
   * library, so it is written only when it is different.
   */
  let written: Written | null = null
  const listeners = new Set<() => void>()

  /**
   * One change to the replica at a time.
   *
   * A look at the bucket replaces the replayed library wholesale, and an edit
   * applies itself to the one there. With the look now running in the
   * background, the two can meet: a replay that read the outbox just before an
   * edit was added to it would drop that edit from the screen. The network is
   * asked outside this; only the few steps that swap state in are inside.
   */
  let tail: Promise<unknown> = Promise.resolve()
  function exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = tail.then(run, run)
    tail = result.catch(() => undefined)
    return result
  }

  // --- Opening ------------------------------------------------------------------------

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
  function asStoredOutbox(value: unknown, changes: boolean): Outbox | null {
    const parsed = StoredOutboxSchema.safeParse(value)
    if (!parsed.success) return null
    const { device, last, nextSeq, pending, inflight } = parsed.data
    const read = (raw: readonly unknown[]): Change[] =>
      changes ? knownChanges(raw) : (raw as Change[])
    return {
      device,
      last,
      nextSeq,
      pending: read(pending),
      inflight: inflight && { ...inflight, changes: read(inflight.changes) },
    }
  }

  /** The changes of these that this build can read; the rest are said and set aside. */
  function knownChanges(raw: readonly unknown[]): Change[] {
    const known: Change[] = []
    for (const change of raw) {
      const parsed = ChangeSchema.safeParse(change)
      if (parsed.success) known.push(parsed.data)
      else warn('skipping a change in the outbox this version cannot read')
    }
    return known
  }

  function asOutbox(value: unknown, changes: boolean): Outbox {
    return (
      asStoredOutbox(value, changes) ?? {
        device: newCloudDeviceId(platform.deviceKind),
        last: null,
        nextSeq: 1,
        pending: [],
        inflight: null,
      }
    )
  }

  /** The outbox, changed in one IndexedDB transaction, so two tabs never undo each other. */
  async function changeOutbox(
    change: (outbox: Outbox) => Outbox,
    { check = false }: { check?: boolean } = {},
  ): Promise<Outbox> {
    const next = (await store.update(OUTBOX_KEY, current =>
      change(asOutbox(current, check)),
    )) as Outbox
    if (replica) replica.outbox = next
    return next
  }

  function localChanges(outbox: Outbox): Change[] {
    return [...(outbox.inflight?.changes ?? []), ...outbox.pending]
  }

  /**
   * The snapshot this device kept, or null when there is none or it does not
   * read as one. A copy kept before the snapshot's shape was settled is
   * brought up to it (`upgradeKeptBase`) and says so, to be written back.
   */
  function storedBase(value: unknown): { base: Replica['base']; upgraded: boolean } | null {
    if (value === null || value === undefined) return null
    const parsed = StoredBaseSchema.safeParse(value)
    if (parsed.success) return { base: parsed.data, upgraded: false }
    const upgraded = StoredBaseSchema.safeParse(upgradeKeptBase(value))
    if (upgraded.success) return { base: upgraded.data, upgraded: true }
    warn('this device’s copy of the library could not be read; it is fetched again')
    return null
  }

  /** The last look as kept, or one that never happened when it does not read as one. */
  function storedLook(value: unknown): Look {
    const parsed = StoredLookSchema.safeParse(value)
    if (!parsed.success) return NEVER_LOOKED
    // A clock put back makes a look in the future; it is not fresh, it is wrong.
    const now = Date.now()
    return parsed.data.checkedAt > now || parsed.data.listedAt > now ? NEVER_LOOKED : parsed.data
  }

  /** The log files this device kept, each read the way one from the bucket is. */
  function storedLogs(value: unknown): Map<string, LogFile> {
    const logs = new Map<string, LogFile>()
    if (typeof value !== 'object' || value === null) return logs
    for (const [key, raw] of Object.entries(value)) {
      const read = readLogFile(raw)
      if (read.ok) logs.set(key, read.file)
      else warn(`skipping a kept log file this version cannot read (${key})`)
    }
    return logs
  }

  /** The playlists' played times as kept, or none when they do not read as such. */
  function storedPlayed(value: unknown): Record<string, string> {
    const parsed = z.record(z.string()).safeParse(value)
    return parsed.success ? parsed.data : {}
  }

  async function open(session: CloudSession): Promise<Replica> {
    if (replica) return replica
    if (opening) return opening
    // Signing out while this runs is a different account by the time it ends:
    // what it read must not become the library the next sign-in is answered from.
    const began = generation
    const attempt: Promise<Replica> = (async () => {
      const r = await exclusive(() => openKept(began))
      // Never read from the bucket: there is nothing here to show without it,
      // so a failure here leaves nothing behind to be shown instead. A device
      // that has read it before answers from its copy at once, and looks in
      // the background (loadCloudLibrary).
      if (!r.baseStored) {
        // Reads refused for the day: the snapshot would be refused too, and
        // every screen asking again listed the bucket again first, spending
        // the listings' allowance on an answer known before asking.
        const held = bucketHold('read')
        if (held) throw new DoormanError(502, BUCKET_CAP_CODE, held.message)
        await refresh(r, session, { list: true })
      }
      if (began !== generation) throw signedOut()
      replica = r
      listenForConnection()
      // Anything left over from last time goes up now.
      if (localChanges(r.outbox).length > 0) scheduleFlush(0)
      return r
    })().finally(() => {
      if (opening === attempt) opening = null
    })
    opening = attempt
    return attempt
  }

  /**
   * The replica from what this device kept, shown. In the lock, as signing
   * out removes what is kept in it: begun before a sign-out, this finishes
   * first and the removal follows; begun after, it writes nothing.
   */
  async function openKept(began: number): Promise<Replica> {
    if (began !== generation) throw signedOut()
    const outbox = await changeOutbox(current => current, { check: true })
    const kept = storedBase(await store.read(BASE_KEY))
    const base = kept?.base ?? null
    if (kept?.upgraded) await store.write(BASE_KEY, kept.base)
    const r: Replica = {
      base: base ?? { key: null, snapshot: null },
      baseStored: base !== null,
      logs: storedLogs(await store.read(LOGS_KEY)),
      outbox,
      clock: new HlcClock(outbox.device, { last: outbox.last }),
      library: replay(null, [], []),
      view: snapshotToLibrary(emptySnapshot(), NO_IDS, 0),
      played: storedPlayed(await store.read(PLAYED_KEY)),
      viewStale: false,
      // Only with the copy it describes: a look without a base to go with it says nothing.
      look: base ? storedLook(await store.read(LOOK_KEY)) : NEVER_LOOKED,
      mustCheck: false,
    }
    await rebuild(r)
    return r
  }

  function emptySnapshot(): CloudSnapshot {
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

  /** Replay everything from the base again, and show the result. */
  async function rebuild(r: Replica): Promise<void> {
    const local = localChanges(r.outbox)
    const seen = latestStamp(r.base.snapshot)
    if (seen) r.clock.observe(seen)
    for (const file of r.logs.values())
      for (const change of file.changes) r.clock.observe(change.hlc)
    for (const change of local) r.clock.observe(change.hlc)
    r.library = replay(r.base.snapshot, r.logs.values(), local)
    await show(r)
  }

  /** Turn the replayed library into what the app shows, and keep what the service worker reads. */
  async function show(r: Replica): Promise<void> {
    r.viewStale = false
    // Compared with what the store holds the first time, and with what was
    // last written after that: a read, or a walk over plain values, is much
    // cheaper than putting the whole library through IndexedDB again. The
    // version is kept the same way, rather than read back before every edit.
    const before = (written ??= await readWritten())
    const previous = replica?.view.ids ?? before.ids
    const version = before.version + 1
    r.view = snapshotToLibrary(
      replayedSnapshot(r.library, r.base.snapshot),
      previous,
      version,
      r.played,
    )
    // Ids are only ever added, and every one added moves `next` on.
    if (before.ids.next !== r.view.ids.next) await store.write(IDS_KEY, r.view.ids)
    if (!sameValue(before.files, r.view.files)) await store.write(CLOUD_FILES_KEY, r.view.files)
    if (!sameValue(before.playlistSongs, r.view.playlistSongs)) {
      await store.write(PLAYLISTS_KEY, r.view.playlistSongs)
    }
    await store.write(STATE_KEY, { version })
    written = { ids: r.view.ids, files: r.view.files, playlistSongs: r.view.playlistSongs, version }
  }

  /** What the store holds under the keys `show` writes, read once per sign-in. */
  async function readWritten(): Promise<Written> {
    const state = (await store.read(STATE_KEY)) as { version?: unknown } | null
    return {
      ids: asLocalIds(await store.read(IDS_KEY)),
      files: await store.read(CLOUD_FILES_KEY),
      playlistSongs: await store.read(PLAYLISTS_KEY),
      version: typeof state?.version === 'number' ? state.version : 0,
    }
  }

  // --- Reading the bucket -------------------------------------------------------------

  async function listKeys(session: CloudSession, prefix: string): Promise<string[]> {
    const keys: string[] = []
    let cursor: string | null = null
    do {
      const response = await sessionApi.doormanFetch(session, DOORMAN_PATHS.listing(prefix, cursor))
      const page = DoormanListSchema.parse(await response.json())
      keys.push(...page.objects.map(object => object.key))
      cursor = page.cursor
    } while (cursor)
    return keys
  }

  async function fetchSnapshot(
    session: CloudSession,
    key: string,
  ): Promise<CloudSnapshot | 'gone'> {
    const response = await sessionApi.doormanFetch(session, DOORMAN_PATHS.file(key))
    if (response.status === 404) return 'gone'
    return CloudSnapshotSchema.parse(JSON.parse(await readText(response)))
  }

  /** A log file, or `gone` when it went after the listing; one that cannot be read counts as empty. */
  async function fetchLog(session: CloudSession, key: string): Promise<LogFile | 'gone' | null> {
    const response = await sessionApi.doormanFetch(session, DOORMAN_PATHS.file(key))
    if (response.status === 404) return 'gone'
    let json: unknown = null
    try {
      json = JSON.parse(await readText(response))
    } catch {
      // Read as nothing, below.
    }
    const read = readLogFile(json)
    if (!read.ok) {
      warn(`skipping a log file this version cannot read (${key})`)
      return null
    }
    return read.file
  }

  /** The last listing a look made and could not finish reading, and the counter it was made at. */
  let unread: { changes: string; logKeys: string[]; newest: string | null } | null = null

  /**
   * Where the doorman's change counter stands, or null when it cannot be
   * asked. Then the look lists; a doorman that cannot be reached will say so
   * there.
   */
  async function readCounter(session: CloudSession): Promise<string | null> {
    try {
      const response = await sessionApi.doormanFetch(session, DOORMAN_PATHS.changes)
      return DoormanChangesSchema.parse(await response.json()).changes
    } catch {
      return null
    }
  }

  /**
   * This device's own write or delete moved the counter: from where this
   * device held it, it is where the doorman says now, since nothing else came
   * between. Anything else leaves it, and the next look lists.
   */
  async function followOwnChange(r: Replica, response: CloudResponse): Promise<void> {
    const moved = parseChangesHeader(response.headers.get(CHANGES_HEADER))
    if (!moved || r.look.changes !== moved.before) return
    r.look = { ...r.look, changes: moved.after }
    await store.write(LOOK_KEY, r.look)
  }

  /**
   * Look at the bucket: the newest snapshot, and every log file it has not
   * folded in — never one it has, so a device new to the library reads the
   * snapshot and the last few changes, however long the library's history.
   * The logs are listed first: a file tidied away after the listing (by the
   * server, docs/SYNC.md "Tidying up") means a newer snapshot has it, and one
   * more look finds that snapshot. A device never deletes a log file itself,
   * its own included: only the server knows when nobody needs one any more.
   *
   * The change counter is asked before either listing. Where it stands as
   * this device left it, and the last listing is recent enough to trust it,
   * nothing has been written since and nothing is listed. `list` lists
   * whatever it says: a look asked for by name ("Check for new songs", an
   * import that has just finished) should see what the bucket holds, counted
   * or not.
   */
  async function refresh(
    r: Replica,
    session: CloudSession,
    { list }: { list: boolean },
  ): Promise<boolean> {
    const began = generation
    const startedAt = Date.now()
    const counter = await readCounter(session)
    if (
      !list &&
      counter !== null &&
      counter === r.look.changes &&
      within(r.look.listedAt, COUNTER_TRUSTED_MS, startedAt)
    ) {
      // Kept as it stands when the look settles: an upload of this device's
      // own may have moved it on meanwhile.
      return settleLook(r, began, r.base, r.logs, held => ({ ...held, checkedAt: Date.now() }))
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      // Listed already for this very counter, by a look that could not read
      // what it found — the bucket refusing reads for the day while it still
      // answers listings. Listing again would find the same; only the reads
      // are tried again (and are held, while the refusal lasts).
      const reuse =
        attempt === 0 && !list && counter !== null && unread?.changes === counter ? unread : null
      const logKeys = reuse?.logKeys ?? (await listKeys(session, LOG_FOLDER))
      const newest = reuse
        ? reuse.newest
        : newestSnapshotKey(await listKeys(session, SNAPSHOTS_FOLDER))
      unread = counter === null ? null : { changes: counter, logKeys, newest }

      let base = r.base
      if (newest !== base.key) {
        const snapshot = newest ? await fetchSnapshot(session, newest) : null
        if (snapshot === 'gone') continue
        base = { key: newest, snapshot }
      }

      const upTo = base.snapshot?.upTo ?? {}
      const wanted = unfoldedLogKeys(logKeys, upTo)
      const missing = wanted.filter(key => !r.logs.has(key))
      const fetched = new Map<string, LogFile | 'gone' | null>()
      for (let start = 0; start < missing.length; start += LOG_READS_AT_ONCE) {
        const batch = missing.slice(start, start + LOG_READS_AT_ONCE)
        const files = await Promise.all(batch.map(key => fetchLog(session, key)))
        batch.forEach((key, index) => fetched.set(key, files[index] ?? null))
      }
      if ([...fetched.values()].includes('gone') && attempt === 0) continue

      const logs = new Map<string, LogFile>()
      for (const key of wanted) {
        const file = r.logs.get(key) ?? fetched.get(key)
        if (file && file !== 'gone') logs.set(key, file)
      }
      // One of this device's own files, uploaded moments ago and not listed yet.
      for (const [key, file] of r.logs) {
        if (
          !logs.has(key) &&
          file.device === r.outbox.device &&
          file.seq > (upTo[file.device] ?? 0)
        ) {
          logs.set(key, file)
        }
      }

      // The counter as it stood before the listings: a write during them moved
      // it past this, so the next look lists again rather than miss it.
      const changed = await settleLook(r, began, base, logs, () => ({
        checkedAt: Date.now(),
        listedAt: startedAt,
        changes: counter,
      }))
      unread = null
      return changed
    }
    return false
  }

  /**
   * Take in what a look found — a new base, other logs, or the same ones when
   * the counter said nothing had changed — and whatever another tab added to
   * the outbox meanwhile. Says whether the library is different now.
   */
  function settleLook(
    r: Replica,
    began: number,
    base: Replica['base'],
    logs: Map<string, LogFile>,
    look: (held: Look) => Look,
  ): Promise<boolean> {
    return exclusive(async () => {
      // Signed out while the bucket was being asked: nothing of it is wanted now.
      if (began !== generation) return false
      const baseChanged = base !== r.base
      // Every file kept here is the one already held under the same key
      // (`r.logs.get` comes first above), so the same keys are the same logs.
      const logsChanged =
        logs.size !== r.logs.size || [...logs.keys()].some(key => !r.logs.has(key))
      // Another tab may have added to the outbox since. Read, not updated:
      // an update would write the outbox back on every look.
      const outbox = asStoredOutbox(await store.read(OUTBOX_KEY), true) ?? r.outbox
      const outboxChanged = outboxSignature(outbox) !== outboxSignature(r.outbox)

      r.outbox = outbox
      r.mustCheck = false
      if (baseChanged || !r.baseStored) {
        await store.write(BASE_KEY, base)
        r.baseStored = true
      }
      r.look = look(r.look)
      await store.write(LOOK_KEY, r.look)
      // The usual answer: nothing new anywhere. Replaying and rewriting the
      // whole library to arrive where it already is was most of what a look
      // at the bucket cost.
      if (!baseChanged && !logsChanged && !outboxChanged) return false

      r.base = base
      r.logs = logs
      if (logsChanged) await store.write(LOGS_KEY, Object.fromEntries(logs))
      await rebuild(r)
      return true
    })
  }

  /** Which changes are waiting, by stamp: every change has its own. */
  function outboxSignature(outbox: Outbox): string {
    return localChanges(outbox)
      .map(change => change.hlc)
      .join(',')
  }

  // --- The library, as the app asks for it ---------------------------------------------

  /** Offline, or the doorman having a moment: this device's copy is the library meanwhile. */
  function passing(error: unknown): boolean {
    return error instanceof DoormanError && (error.status === 0 || error.status >= 500)
  }

  /**
   * The library, from this device's copy.
   *
   * A look at the bucket that is due happens behind the answer rather than in
   * front of it, so opening the app does not wait on two listings and every
   * log file to show a library that is already here. What the look finds
   * reaches the app through `onCloudLibraryChanged`. Only a look asked for by
   * name — or the very first, with nothing here yet (open) — is waited for.
   */
  async function loadCloudLibrary(session: CloudSession): Promise<CloudLibrary> {
    const r = await open(session)
    if (r.mustCheck) {
      // A look already under way may have listed the bucket before whatever
      // this one is being asked to find: wait for it, then look again.
      await background?.catch(() => undefined)
      try {
        await refresh(r, session, { list: true })
      } catch (error) {
        if (!passing(error)) throw error
        // Asked for and not answered: offline, or the bucket refusing. The
        // copy answers, and the next read does not wait on the network again,
        // as a look in the background that failed does not (lookInBackground).
        r.mustCheck = false
        r.look = { ...r.look, checkedAt: Date.now() }
      }
    } else if (!within(r.look.checkedAt, r.look.changes === null ? LISTED_FRESH_MS : FRESH_MS)) {
      lookInBackground(r, session)
    }
    return currentView(r)
  }

  async function peekCloudLibrary(session: CloudSession): Promise<CloudLibrary> {
    return currentView(await open(session))
  }

  /** The view with every deferred change in it (`RecordOptions.deferView`). */
  async function currentView(r: Replica): Promise<CloudLibrary> {
    if (r.viewStale) {
      await exclusive(async () => {
        if (r.viewStale) await show(r)
      })
    }
    return r.view
  }

  let background: Promise<void> | null = null

  function lookInBackground(r: Replica, session: CloudSession): void {
    background ??= (async () => {
      try {
        if (await refresh(r, session, { list: false })) announce()
      } catch (error) {
        if (passing(error)) {
          // Not asked again on every read while the bucket cannot answer:
          // after the usual wait, like a look that found nothing.
          r.look = { ...r.look, checkedAt: Date.now() }
          return
        }
        // Signed out elsewhere, say. Nobody was waiting to hear it, so the
        // next read waits for a look of its own, and says so the way it
        // always did — and the app is told to make that read.
        warn(`the bucket could not be read: ${String(error)}`)
        r.mustCheck = true
        announce()
      }
    })().finally(() => {
      background = null
    })
  }

  function announce(): void {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        warn(`a library listener threw: ${String(error)}`)
      }
    }
  }

  function onCloudLibraryChanged(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  /** Look at the bucket on the next read, and wait for it, whenever the last look was: "Check for new songs". */
  function markCloudLibraryStale(): void {
    if (replica) {
      replica.look = { ...replica.look, checkedAt: 0 }
      replica.mustCheck = true
    }
  }

  async function cloudLibraryVersion(session: CloudSession): Promise<LibraryVersion> {
    const view = await loadCloudLibrary(session)
    return { version: view.library.version, songCount: view.library.songs.length }
  }

  /**
   * Make an edit: `build` turns it into changes against the library as it is,
   * and says what to answer with once they are applied. The changes land here
   * at once and go up shortly after. Throws what `build` throws, having
   * recorded nothing.
   */
  async function recordChanges<T>(
    session: CloudSession,
    build: (ctx: EditContext) => { changes: readonly Change[]; answer: (view: CloudLibrary) => T },
    options: RecordOptions = {},
  ): Promise<T> {
    const r = await open(session)
    return exclusive(async () => {
      // Signed out since: this account's outbox is gone, and an edit put in
      // a new one would go up into whichever bucket signs in next.
      if (replica !== r) throw signedOut()
      // A deferred edit reads only ids, which plays never change.
      if (!options.deferView && r.viewStale) await show(r)
      const { changes, answer } = build({
        view: r.view,
        stamp: () => r.clock.tick(),
        counted: r.library.counted,
      })
      if (changes.length > 0) {
        // Stamped after everything this device has seen, so applying them on top
        // is the same as replaying from the start.
        applyChanges(r.library, changes)
        await changeOutbox(outbox => ({
          ...outbox,
          last: r.clock.last,
          pending: [...outbox.pending, ...changes],
        }))
        if (options.deferView) r.viewStale = true
        else await show(r)
        scheduleFlush(FLUSH_DELAY_MS)
        platform.outboxNews?.tell()
      }
      return answer(r.view)
    })
  }

  /**
   * Note that a playlist was just started, for the playlists page's "Recently
   * played" order. Kept on this device, not recorded as a change: it moves on
   * every play, and a server keeps it to itself as well. False for a playlist
   * this device does not have.
   */
  async function markPlaylistPlayed(session: CloudSession, playlistId: number): Promise<boolean> {
    const r = await open(session)
    return exclusive(async () => {
      if (replica !== r) throw signedOut()
      const uid = r.view.uids.playlists.get(playlistId)
      if (!uid) return false
      r.played = { ...r.played, [uid]: toSqliteTime(Date.now()) }
      await store.write(PLAYED_KEY, r.played)
      await show(r)
      return true
    })
  }

  /** How many changes made here have not reached the bucket yet. */
  function pendingCloudChanges(): number {
    return replica ? localChanges(replica.outbox).length : 0
  }

  function cloudChangesStuck(): boolean {
    return retries > 0 && pendingCloudChanges() > 0
  }

  async function keptCloudChanges(): Promise<number> {
    const outbox = asStoredOutbox(await store.read(OUTBOX_KEY).catch(() => null), false)
    return outbox ? localChanges(outbox).length : 0
  }

  // --- Uploading ----------------------------------------------------------------------

  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let flushing: Promise<void> | null = null
  let retries = 0

  function scheduleFlush(delay: number): void {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flushCloudChanges()
    }, delay)
  }

  let listening = false
  function listenForConnection(): void {
    if (listening) return
    listening = true
    // Asked of the platform, not of `window`: in React Native `window` IS the
    // global object, so `typeof window === 'undefined'` is false on a phone
    // and execution carries on into `window.addEventListener`, which is not
    // there.
    platform.onWake(() => {
      if (pendingCloudChanges() > 0) scheduleFlush(0)
    })
    platform.outboxNews?.hear(heardOutbox)
  }

  /**
   * Another tab added to the outbox: show its edit here too, and send it if
   * that tab has not by the time this one looks — it may have closed.
   */
  function heardOutbox(): void {
    const r = replica
    if (!r) return
    void exclusive(async () => {
      if (replica !== r) return false
      const outbox = asStoredOutbox(await store.read(OUTBOX_KEY), true)
      if (!outbox || outboxSignature(outbox) === outboxSignature(r.outbox)) return false
      r.outbox = outbox
      await rebuild(r)
      return true
    }).then(
      changed => {
        if (changed) announce()
      },
      (error: unknown) => warn(`another tab’s edit could not be read: ${String(error)}`),
    )
    if (!flushTimer) scheduleFlush(OTHERS_FLUSH_DELAY_MS)
  }

  /** Send what is waiting, a file at a time. Resolves once all of it is up, or it cannot be for now. */
  function flushCloudChanges(): Promise<void> {
    flushing ??= (async () => {
      try {
        const session = await sessionApi.loadSession()
        const r = replica
        if (!session || !r) return
        for (;;) {
          const outbox = await changeOutbox(current =>
            current.inflight || current.pending.length === 0
              ? current
              : {
                  ...current,
                  // A file at a time, each no longer than a log file may be.
                  inflight: {
                    seq: current.nextSeq,
                    changes: current.pending.slice(0, LOG_FILE_MAX_CHANGES),
                    writtenAt: new Date().toISOString(),
                  },
                  nextSeq: current.nextSeq + 1,
                  pending: current.pending.slice(LOG_FILE_MAX_CHANGES),
                },
          )
          const inflight = outbox.inflight
          if (!inflight) break
          const key = logKey(outbox.device, inflight.seq)
          const file = logFile(
            outbox.device,
            inflight.seq,
            inflight.changes,
            new Date(inflight.writtenAt),
          )
          const response = await sessionApi.doormanFetch(session, DOORMAN_PATHS.file(key), {
            method: 'PUT',
            json: file,
          })
          if (!response.ok) {
            throw new DoormanError(
              response.status,
              DOORMAN_ERROR.notFound,
              'the file could not be written',
            )
          }
          // Inside the lock: a look at the bucket swapping `r.logs` in between
          // would otherwise lose this file from both the logs and the outbox.
          const kept = await exclusive(async () => {
            // Signed out meanwhile: everything of this account's here is gone already.
            if (replica !== r) return false
            // Now a log file like any other device's, until a snapshot folds it in.
            r.logs.set(key, file)
            await store.write(LOGS_KEY, Object.fromEntries(r.logs))
            // A play is a log file, and the next look need not list for it.
            await followOwnChange(r, response)
            await changeOutbox(current =>
              current.inflight?.seq === inflight.seq ? { ...current, inflight: null } : current,
            )
            return true
          })
          if (!kept) return
        }
        retries = 0
      } catch (error) {
        // Signed out, or the account has no bucket: signing in again is what fixes it.
        if (
          error instanceof DoormanError &&
          (error.code === DOORMAN_ERROR.unauthorized || error.code === DOORMAN_ERROR.noStorage)
        ) {
          return
        }
        const delay = FLUSH_RETRY_MS[Math.min(retries, FLUSH_RETRY_MS.length - 1)] ?? 60_000
        retries++
        scheduleFlush(delay)
      }
    })().finally(() => {
      flushing = null
    })
    return flushing
  }

  // --- Reading what the library points at ----------------------------------------------

  /** A playlist's songs, in order, from the library as this device has it — offline too. */
  async function cloudAllPlaylistSongs(): Promise<Readonly<Record<number, readonly number[]>>> {
    // Brought up to date first: plays can move a song into a Live playlist.
    return (
      (replica ? (await currentView(replica)).playlistSongs : null) ??
      ((await store.read(PLAYLISTS_KEY)) as Record<number, number[]> | null) ??
      {}
    )
  }

  async function cloudPlaylistSongs(playlistId: number): Promise<readonly number[]> {
    return (await cloudAllPlaylistSongs())[playlistId] ?? []
  }

  async function filesOf(songId: number): Promise<SongFiles | null> {
    const files =
      replica?.view.files ??
      ((await store.read(CLOUD_FILES_KEY)) as Record<number, SongFiles> | null)
    return files?.[songId] ?? null
  }

  /**
   * A song's lyrics and their romanized lines, the way the server's own lyrics
   * answer carries them: one file (`wordsKey`), from this device if it has
   * read it before, else the bucket.
   */
  async function cloudLyrics(
    session: CloudSession | null,
    songId: number,
  ): Promise<{ text: string; kind: 'plain' | 'synced'; romanized: string[] | null } | null> {
    const files = await filesOf(songId)
    if (!files?.lyrics || !files.lyricsKind) return null
    const json = await cloudText(session, files.lyrics)
    const words = json === null ? null : parseCloudWords(json)
    return words ? { text: words.text, kind: files.lyricsKind, romanized: words.romanized } : null
  }

  /**
   * A song's motion curve, the way the server's own motion answer carries it.
   * Read like the words — a text file named by its hash, kept once read — so a
   * song played once on a cloud library has its visuals on the plane too.
   */
  async function cloudMotion(session: CloudSession | null, songId: number): Promise<Motion | null> {
    const files = await filesOf(songId)
    if (!files?.motion) return null
    const json = await cloudText(session, files.motion)
    if (json === null) return null
    try {
      const parsed = MotionSchema.safeParse(JSON.parse(json))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  /**
   * A text file from the bucket, named by the hash of its own bytes, so a
   * cached copy is never stale. The cache is a convenience: one that fails is
   * a miss, never a failure. Anything thrown here reaches the screen as
   * "offline", and a device whose cache refused a write once said "reconnect"
   * while the words sat in hand.
   */
  async function cloudText(session: CloudSession | null, key: string): Promise<string | null> {
    const cached = await platform.textCache?.read(key).catch((error: unknown) => {
      warn(`the text cache could not be read: ${String(error)}`)
      return null
    })
    if (cached !== null && cached !== undefined) return cached

    if (!session) throw new DoormanError(0, DOORMAN_ERROR.unauthorized, 'Not signed in.')
    const response = await sessionApi.doormanFetch(session, DOORMAN_PATHS.file(key))
    if (response.status === 404) return null
    const text = await readText(response)
    await platform.textCache?.write(key, text).catch((error: unknown) => {
      warn(`the text cache could not be written: ${String(error)}`)
    })
    return text
  }

  /**
   * Where a song's cover is in the bucket.
   *
   * The key rather than the bytes: artwork goes to a file and is handed to the
   * OS image loader as a path, and a base64 round trip through JavaScript for
   * every row in a list is not the way to get there.
   */
  async function cloudCoverKey(songId: number): Promise<string | null> {
    return (await filesOf(songId))?.cover ?? null
  }

  function cloudCoverKeyNow(songId: number): string | null | undefined {
    const files = replica?.view.files
    if (!files) return undefined
    return files[songId]?.cover ?? null
  }

  function cloudAudioKeyNow(songId: number): string | null | undefined {
    const files = replica?.view.files
    if (!files) return undefined
    return files[songId]?.audio ?? null
  }

  async function askBucketRead(session: CloudSession): Promise<boolean> {
    const files = replica?.view.files
    const audio = files ? Object.values(files).find(file => file.audio)?.audio : undefined
    if (!audio) return false
    // Through the hold, which stands until the answer: the session lets it go
    // or holds again, and the screens change only if that changes anything.
    await sessionApi
      .doormanFetch(session, DOORMAN_PATHS.file(audio), {
        headers: { range: 'bytes=0-0' },
        asking: true,
      })
      .catch(() => undefined)
    return true
  }

  function cloudArtistPictureNow(name: string): ArtistPictureKeys | null | undefined {
    const artists = replica?.view.artists
    if (!artists) return undefined
    return artists.get(artistKey(name)) ?? null
  }

  function cloudPicturesNow(): {
    covers: ReadonlySet<string>
    artists: readonly ArtistPictureKeys[]
    packs: readonly CloudCoverPack[]
  } | null {
    const view = replica?.view
    if (!view) return null
    const covers = new Set<string>()
    for (const files of Object.values(view.files)) if (files.cover) covers.add(files.cover)
    return {
      covers,
      artists: [...view.artists.values()],
      packs: replica?.base.snapshot?.coverPacks ?? [],
    }
  }

  /** What this device should keep, for automatic downloads: every song, or those in playlists. */
  function cloudRoomSongNow(songId: number): RoomSong | null {
    const view = replica?.view
    const files = view?.files[songId]
    const song = view?.library.songs.find(candidate => candidate.id === songId)
    if (!view || !files || !song) return null
    const uid = Object.entries(view.ids.songs).find(([, id]) => id === songId)?.[0] ?? null
    return roomSongOf(song, files, uid)
  }

  let soundRead: {
    key: string
    pack: Promise<{ model: string; vectors: ReadonlyMap<string, Float32Array> } | null>
  } | null = null

  function cloudSoundVectors(
    session: CloudSession,
  ): Promise<{ model: string; vectors: ReadonlyMap<string, Float32Array> } | null> {
    const sound = replica?.base.snapshot?.sound
    if (!sound) return Promise.resolve(null)
    if (soundRead?.key !== sound.key) {
      const pack = (async () => {
        const response = await sessionApi.doormanFetch(session, DOORMAN_PATHS.file(sound.key))
        if (!response.ok) return null
        return decodeSoundPack(new Uint8Array(await response.arrayBuffer()))
      })()
      // A failed read is tried again next time, not kept.
      pack.then(
        result => {
          if (result === null && soundRead?.pack === pack) soundRead = null
        },
        () => {
          if (soundRead?.pack === pack) soundRead = null
        },
      )
      soundRead = { key: sound.key, pack }
    }
    return soundRead.pack
  }

  let soundMapRead: { key: string; places: ReadonlyMap<string, MapPlace> } | null = null

  async function cloudSoundMap(session: CloudSession): Promise<SoundMap> {
    const view = await loadCloudLibrary(session)
    const pointer = replica?.base.snapshot?.soundMap
    let places: ReadonlyMap<string, MapPlace> | null = null
    if (pointer && soundMapRead?.key === pointer.key) places = soundMapRead.places
    else if (pointer) {
      const text = await cloudText(session, pointer.key)
      places = text === null ? null : parseSoundMap(text)
      if (places) soundMapRead = { key: pointer.key, places }
    }
    const out: SoundMap['places'] = []
    if (places) {
      for (const song of view.library.songs) {
        const audio = view.files[song.id]?.audio
        const place = audio === undefined ? undefined : places.get(audio)
        if (place) out.push({ id: song.id, x: place.x, y: place.y })
      }
    }
    return { places: out, unheard: view.library.songs.length - out.length }
  }

  function cloudManifest(scope: 'library' | 'playlists'): SyncManifest {
    const view = replica?.view
    if (!view) return { version: 0, songCount: 0, totalBytes: 0, entries: [] }
    const inPlaylists = new Set(Object.values(view.playlistSongs).flat())
    const entries = view.library.songs
      .filter(song => scope === 'library' || inPlaylists.has(song.id))
      .map(song => ({ id: song.id, sizeBytes: song.sizeBytes, etag: song.rev }))
    return {
      version: view.library.version,
      songCount: entries.length,
      totalBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
      entries,
    }
  }

  /**
   * Forget everything read from the bucket, and this device's name in it — on
   * signing out. Signed in again, it starts a log of its own under a new name,
   * rather than numbering files the bucket may already have.
   */
  async function forgetCloudLibrary(): Promise<void> {
    replica = null
    opening = null
    unread = null
    generation++
    retries = 0
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    // In the lock, so an edit or an upload already under way finishes first
    // and nothing it writes outlives the sign-out.
    await exclusive(async () => {
      written = null
      await Promise.all(
        [
          IDS_KEY,
          CLOUD_FILES_KEY,
          PLAYLISTS_KEY,
          STATE_KEY,
          BASE_KEY,
          LOGS_KEY,
          OUTBOX_KEY,
          LOOK_KEY,
          PLAYED_KEY,
        ].map(key => store.remove(key).catch(() => undefined)),
      )
    })
    await platform.textCache?.clear().catch(() => undefined)
  }

  /**
   * A text file from the bucket. Snapshots are stored gzip-compressed; the
   * browser undoes that itself when the doorman passes the encoding on, and
   * here when it does not.
   */
  async function readText(response: CloudResponse): Promise<string> {
    return platform.decodeText(new Uint8Array(await response.arrayBuffer()))
  }

  function signedOut(): DoormanError {
    return new DoormanError(401, DOORMAN_ERROR.unauthorized, 'Signed out.')
  }

  function asLocalIds(value: unknown): LocalIds {
    if (typeof value !== 'object' || value === null) return NO_IDS
    const ids = value as Partial<LocalIds>
    if (
      typeof ids.next !== 'number' ||
      typeof ids.songs !== 'object' ||
      typeof ids.tags !== 'object' ||
      typeof ids.playlists !== 'object'
    ) {
      return NO_IDS
    }
    return ids as LocalIds
  }

  return {
    loadCloudLibrary,
    peekCloudLibrary,
    markCloudLibraryStale,
    onCloudLibraryChanged,
    cloudLibraryVersion,
    recordChanges,
    markPlaylistPlayed,
    pendingCloudChanges,
    cloudChangesStuck,
    keptCloudChanges,
    flushCloudChanges,
    cloudPlaylistSongs,
    cloudAllPlaylistSongs,
    cloudLyrics,
    cloudMotion,
    cloudCoverKey,
    cloudCoverKeyNow,
    cloudArtistPictureNow,
    cloudPicturesNow,
    cloudManifest,
    cloudRoomSongNow,
    cloudAudioKeyNow,
    askBucketRead,
    cloudSoundVectors,
    cloudSoundMap,
    forgetCloudLibrary,
  }
}

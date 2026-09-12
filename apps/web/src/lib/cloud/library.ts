import {
  CloudSnapshotSchema,
  DoormanListSchema,
  HlcClock,
  LOG_FOLDER,
  SNAPSHOTS_FOLDER,
  applyChanges,
  logFile,
  logKey,
  newCloudDeviceId,
  newestSnapshotKey,
  readLogFile,
  unfoldedLogKeys,
  type Change,
  type CloudSnapshot,
  type CloudSong,
  type LogFile,
  type SyncLibrary,
  type SyncManifest,
} from '@selfmp3/shared'
import { readStored, updateStored, writeStored } from '../../offline/mirror.js'
import { appPath } from '../platform.js'
import {
  NO_IDS,
  foldedOwnLogs,
  latestStamp,
  replay,
  replayedSnapshot,
  snapshotToLibrary,
  type CloudLibrary,
  type EditContext,
  type LocalIds,
  type SongFiles,
} from '@selfmp3/cloud'
import type { CloudResponse } from '@selfmp3/cloud'
import { DoormanError, doormanFetch, loadSession, type CloudSession } from './session.js'

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
/** Read by the service worker (sw.ts) — keep the two in step. */
export const FILES_KEY = 'cloud-files'
const PLAYLISTS_KEY = 'cloud-playlist-songs'
const STATE_KEY = 'cloud-state'
const BASE_KEY = 'cloud-base'
const LOGS_KEY = 'cloud-logs'
const OUTBOX_KEY = 'cloud-outbox'
/** Lyrics once read, so they are there on a plane. Named by their hash, they never go stale. */
const FILES_CACHE = 'selfmp3-cloud-files-v1'

/** Within this long of the last look at the bucket, the library is answered from here. */
const FRESH_MS = 20_000
/** Edits made within this long of each other go up as one file. */
const FLUSH_DELAY_MS = 1_500
const FLUSH_RETRY_MS = [5_000, 15_000, 60_000, 300_000]
/**
 * A device tidies away its own log files once a snapshot folded them in, and
 * that snapshot has been up for long enough that anyone still reading the
 * one before it has finished.
 */
const PRUNE_AFTER_MS = 10 * 60_000
const LOG_READS_AT_ONCE = 6

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
  /** Log files the base has not folded in, by key. */
  logs: Map<string, LogFile>
  outbox: Outbox
  clock: HlcClock
  library: SyncLibrary
  view: CloudLibrary
  checkedAt: number
}

let replica: Replica | null = null
let opening: Promise<Replica> | null = null

// --- Opening ------------------------------------------------------------------------

function deviceKind(): string {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/iPhone/.test(agent)) return 'iphone'
  if (/iPad/.test(agent)) return 'ipad'
  if (/Android/.test(agent)) return 'android'
  return 'browser'
}

function asOutbox(value: unknown): Outbox {
  const stored = value as Partial<Outbox> | null
  if (stored && typeof stored.device === 'string' && typeof stored.nextSeq === 'number') {
    return {
      device: stored.device,
      last: typeof stored.last === 'string' ? stored.last : null,
      nextSeq: stored.nextSeq,
      pending: Array.isArray(stored.pending) ? stored.pending : [],
      inflight: stored.inflight ?? null,
    }
  }
  return {
    device: newCloudDeviceId(deviceKind()),
    last: null,
    nextSeq: 1,
    pending: [],
    inflight: null,
  }
}

/** The outbox, changed in one IndexedDB transaction, so two tabs never undo each other. */
async function changeOutbox(change: (outbox: Outbox) => Outbox): Promise<Outbox> {
  const next = await updateStored(OUTBOX_KEY, current => change(asOutbox(current)))
  if (replica) replica.outbox = next
  return next
}

function localChanges(outbox: Outbox): Change[] {
  return [...(outbox.inflight?.changes ?? []), ...outbox.pending]
}

async function open(session: CloudSession): Promise<Replica> {
  if (replica) return replica
  opening ??= (async () => {
    const outbox = await changeOutbox(current => current)
    const storedBase = (await readStored(BASE_KEY)) as Replica['base'] | null
    const storedLogs = (await readStored(LOGS_KEY)) as Record<string, LogFile> | null
    const r: Replica = {
      base: storedBase ?? { key: null, snapshot: null },
      logs: new Map(Object.entries(storedLogs ?? {})),
      outbox,
      clock: new HlcClock(outbox.device, { last: outbox.last }),
      library: replay(null, [], []),
      view: snapshotToLibrary(emptySnapshot(), NO_IDS, 0),
      checkedAt: 0,
    }
    await rebuild(r)
    // Never read from the bucket: there is nothing here to show without it,
    // so a failure here leaves nothing behind to be shown instead.
    if (!storedBase) await refresh(r, session)
    replica = r
    listenForConnection()
    // Anything left over from last time goes up now.
    if (localChanges(r.outbox).length > 0) scheduleFlush(0)
    return r
  })().finally(() => {
    opening = null
  })
  return opening
}

function emptySnapshot(): CloudSnapshot {
  return {
    format: 1,
    writtenAt: new Date(0).toISOString(),
    writtenBy: 'none',
    upTo: {},
    songs: [],
    tags: [],
    playlists: [],
  }
}

/** Replay everything from the base again, and show the result. */
async function rebuild(r: Replica): Promise<void> {
  const local = localChanges(r.outbox)
  const seen = latestStamp(r.base.snapshot)
  if (seen) r.clock.observe(seen)
  for (const file of r.logs.values()) for (const change of file.changes) r.clock.observe(change.hlc)
  for (const change of local) r.clock.observe(change.hlc)
  r.library = replay(r.base.snapshot, r.logs.values(), local)
  await show(r)
}

/** Turn the replayed library into what the app shows, and keep what the service worker reads. */
async function show(r: Replica): Promise<void> {
  const state = (await readStored(STATE_KEY)) as { version?: unknown } | null
  const previous = replica?.view.ids ?? asLocalIds(await readStored(IDS_KEY))
  const version = (typeof state?.version === 'number' ? state.version : 0) + 1
  r.view = snapshotToLibrary(replayedSnapshot(r.library, r.base.snapshot), previous, version)
  await writeStored(IDS_KEY, r.view.ids)
  await writeStored(FILES_KEY, r.view.files)
  await writeStored(PLAYLISTS_KEY, r.view.playlistSongs)
  await writeStored(STATE_KEY, { version })
}

// --- Reading the bucket -------------------------------------------------------------

async function listKeys(session: CloudSession, prefix: string): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | null = null
  do {
    const params = new URLSearchParams({ prefix })
    if (cursor) params.set('cursor', cursor)
    const response = await doormanFetch(session, `/v1/list?${params.toString()}`)
    const page = DoormanListSchema.parse(await response.json())
    keys.push(...page.objects.map(object => object.key))
    cursor = page.cursor
  } while (cursor)
  return keys
}

async function fetchSnapshot(session: CloudSession, key: string): Promise<CloudSnapshot | 'gone'> {
  const response = await doormanFetch(session, `/v1/files/${key}`)
  if (response.status === 404) return 'gone'
  return CloudSnapshotSchema.parse(JSON.parse(await readText(response)))
}

/** A log file, or `gone` when it went after the listing; one that cannot be read counts as empty. */
async function fetchLog(session: CloudSession, key: string): Promise<LogFile | 'gone' | null> {
  const response = await doormanFetch(session, `/v1/files/${key}`)
  if (response.status === 404) return 'gone'
  let json: unknown = null
  try {
    json = JSON.parse(await readText(response))
  } catch {
    // Read as nothing, below.
  }
  const read = readLogFile(json)
  if (!read.ok) {
    console.warn(`self.mp3: skipping a log file this version cannot read (${key})`)
    return null
  }
  return read.file
}

/**
 * Look at the bucket: the newest snapshot, and every log file it has not
 * folded in. The logs are listed first: a file tidied away after the listing
 * means a newer snapshot has it, and one more look finds that snapshot.
 */
async function refresh(r: Replica, session: CloudSession): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const logKeys = await listKeys(session, LOG_FOLDER)
    const newest = newestSnapshotKey(await listKeys(session, SNAPSHOTS_FOLDER))

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

    r.base = base
    r.logs = logs
    r.checkedAt = Date.now()
    await writeStored(BASE_KEY, base)
    await writeStored(LOGS_KEY, Object.fromEntries(logs))
    // Another tab may have added to the outbox since.
    r.outbox = await changeOutbox(current => current)
    await rebuild(r)
    void tidyOwnLogs(r, session, logKeys)
    return
  }
}

/** Delete this device's log files a snapshot has had long enough. Best effort. */
async function tidyOwnLogs(
  r: Replica,
  session: CloudSession,
  keys: readonly string[],
): Promise<void> {
  const snapshot = r.base.snapshot
  if (!snapshot || Date.now() - Date.parse(snapshot.writtenAt) < PRUNE_AFTER_MS) return
  for (const key of foldedOwnLogs(keys, r.outbox.device, snapshot.upTo).slice(0, 50)) {
    try {
      await doormanFetch(session, `/v1/files/${key}`, { method: 'DELETE' })
    } catch {
      return
    }
  }
}

// --- The library, as the app asks for it ---------------------------------------------

export async function loadCloudLibrary(session: CloudSession): Promise<CloudLibrary> {
  const r = await open(session)
  if (Date.now() - r.checkedAt > FRESH_MS) {
    try {
      await refresh(r, session)
    } catch (error) {
      // Offline, or the doorman having a moment: this device's copy is the library.
      if (!(error instanceof DoormanError && (error.status === 0 || error.status >= 500))) {
        throw error
      }
    }
  }
  return r.view
}

/** Look at the bucket on the next read, whenever the last look was: "Check for new songs". */
export function markCloudLibraryStale(): void {
  if (replica) replica.checkedAt = 0
}

export async function cloudLibraryVersion(
  session: CloudSession,
): Promise<{ version: number; songCount: number }> {
  const view = await loadCloudLibrary(session)
  return { version: view.library.version, songCount: view.library.songs.length }
}

/**
 * Make an edit: `build` turns it into changes against the library as it is,
 * and says what to answer with once they are applied. The changes land here
 * at once and go up shortly after. Throws what `build` throws, having
 * recorded nothing.
 */
export async function recordChanges<T>(
  session: CloudSession,
  build: (ctx: EditContext) => { changes: readonly Change[]; answer: (view: CloudLibrary) => T },
): Promise<T> {
  const r = await open(session)
  const { changes, answer } = build({ view: r.view, stamp: () => r.clock.tick() })
  if (changes.length > 0) {
    // Stamped after everything this device has seen, so applying them on top
    // is the same as replaying from the start.
    applyChanges(r.library, changes)
    await changeOutbox(outbox => ({
      ...outbox,
      last: r.clock.last,
      pending: [...outbox.pending, ...changes],
    }))
    await show(r)
    scheduleFlush(FLUSH_DELAY_MS)
  }
  return answer(r.view)
}

/** The library's songs as smart rules read them, newest first — the order a snapshot has. */
export function currentSongs(): CloudSong[] {
  return replica ? [...replica.library.songs.values()] : []
}

/** How many changes made here have not reached the bucket yet. */
export function pendingCloudChanges(): number {
  return replica ? localChanges(replica.outbox).length : 0
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
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('online', () => scheduleFlush(0))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pendingCloudChanges() > 0) scheduleFlush(0)
  })
}

/** Send what is waiting, a file at a time. Resolves once all of it is up, or it cannot be for now. */
export function flushCloudChanges(): Promise<void> {
  flushing ??= (async () => {
    try {
      const session = await loadSession()
      const r = replica
      if (!session || !r) return
      for (;;) {
        const outbox = await changeOutbox(current =>
          current.inflight || current.pending.length === 0
            ? current
            : {
                ...current,
                inflight: {
                  seq: current.nextSeq,
                  changes: current.pending,
                  writtenAt: new Date().toISOString(),
                },
                nextSeq: current.nextSeq + 1,
                pending: [],
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
        const response = await doormanFetch(session, `/v1/files/${key}`, {
          method: 'PUT',
          json: file,
        })
        if (!response.ok) throw new DoormanError(response.status, 'the file could not be written')
        // Signed out meanwhile: everything of this account's here is gone already.
        if (replica !== r) return
        // Now a log file like any other device's, until a snapshot folds it in.
        r.logs.set(key, file)
        await writeStored(LOGS_KEY, Object.fromEntries(r.logs))
        await changeOutbox(current =>
          current.inflight?.seq === inflight.seq ? { ...current, inflight: null } : current,
        )
      }
      retries = 0
    } catch (error) {
      // Signed out, or the account has no bucket: signing in again is what fixes it.
      if (error instanceof DoormanError && (error.status === 401 || error.status === 409)) return
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
export async function cloudPlaylistSongs(playlistId: number): Promise<readonly number[]> {
  const stored =
    replica?.view.playlistSongs ??
    ((await readStored(PLAYLISTS_KEY)) as Record<number, number[]> | null)
  return stored?.[playlistId] ?? []
}

async function filesOf(songId: number): Promise<SongFiles | null> {
  const files =
    replica?.view.files ?? ((await readStored(FILES_KEY)) as Record<number, SongFiles> | null)
  return files?.[songId] ?? null
}

/** A song's lyrics, from this device if it has read them before, else the bucket. */
export async function cloudLyrics(
  session: CloudSession | null,
  songId: number,
): Promise<{ text: string; kind: 'plain' | 'synced' } | null> {
  const files = await filesOf(songId)
  if (!files?.lyrics || !files.lyricsKind) return null

  const cacheKey = appPath(`cloud-files/${files.lyrics}`)
  const cache = typeof caches === 'undefined' ? null : await caches.open(FILES_CACHE)
  const cached = await cache?.match(cacheKey)
  if (cached) return { text: await cached.text(), kind: files.lyricsKind }

  if (!session) throw new DoormanError(0, 'Not signed in.')
  const response = await doormanFetch(session, `/v1/files/${files.lyrics}`)
  if (response.status === 404) return null
  const text = await readText(response)
  await cache?.put(cacheKey, new Response(text, { headers: { 'Content-Type': 'text/plain' } }))
  return { text, kind: files.lyricsKind }
}

/** What this device should keep, for automatic downloads: every song, or those in playlists. */
export function cloudManifest(scope: 'library' | 'playlists'): SyncManifest {
  const view = replica?.view
  if (!view) return { version: 0, songCount: 0, totalBytes: 0, entries: [] }
  const inPlaylists = new Set(Object.values(view.playlistSongs).flat())
  const entries = view.library.songs
    .filter(song => scope === 'library' || inPlaylists.has(song.id))
    .map(song => ({ id: song.id, sizeBytes: song.sizeBytes, etag: song.rev ?? '' }))
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
export async function forgetCloudLibrary(): Promise<void> {
  replica = null
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  for (const key of [
    IDS_KEY,
    FILES_KEY,
    PLAYLISTS_KEY,
    STATE_KEY,
    BASE_KEY,
    LOGS_KEY,
    OUTBOX_KEY,
  ]) {
    await writeStored(key, null).catch(() => undefined)
  }
  if (typeof caches !== 'undefined') await caches.delete(FILES_CACHE).catch(() => false)
}

/**
 * A text file from the bucket. Snapshots are stored gzip-compressed; the
 * browser undoes that itself when the doorman passes the encoding on, and
 * here when it does not.
 */
async function readText(response: CloudResponse): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Response(stream).text()
  }
  return new TextDecoder().decode(bytes)
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

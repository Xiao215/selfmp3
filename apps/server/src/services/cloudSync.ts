import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  CLOUD_FORMAT,
  CloudFormatSchema,
  FORMAT_KEY,
  SNAPSHOTS_FOLDER,
  audioKey,
  coverKey,
  isSynced,
  lyricsKey,
  parseEndpoint,
  snapshotKey,
  snapshotsToPrune,
  type CloudConnect,
  type CloudLyrics,
  type CloudStatus,
} from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { StorageDriver } from '../storage/index.js'
import { CloudError, S3CloudStore, type CloudStore } from '../cloud/store.js'
import type {
  CloudConnection,
  CloudRepository,
  CloudSongState,
  SongFileInfo,
} from '../repositories/cloud.js'
import type { SongRepository } from '../repositories/songs.js'
import type { TagRepository } from '../repositories/tags.js'
import type { PlaylistRepository } from '../repositories/playlists.js'
import type { ImportRepository } from '../repositories/imports.js'
import type { CoverService } from './covers.js'
import type { LyricsService } from './lyrics.js'
import type { MetadataService } from './metadata.js'
import { buildSnapshot } from './cloudSnapshot.js'

/**
 * Publishing the library to the cloud bucket — milestone 1 of docs/SYNC.md.
 *
 * One pass: work out which songs changed since they were last uploaded, upload
 * their audio, cover and lyrics under the SHA-256 of their bytes, then write a
 * snapshot of the whole library. Passes run at startup, a few seconds after
 * anything changes, and on demand; only one runs at a time, and a change
 * during a pass earns exactly one more.
 *
 * What was uploaded, and from which state of each song, is kept in
 * `cloud_songs`. A song whose file, cover and lyric sidecar are unchanged is
 * not read at all, so a pass over a library that is already up there costs a
 * database query and a stat per song.
 */

/** How long after a change a pass starts, so a burst of changes is one pass. */
const DEFAULT_DEBOUNCE_MS = 4_000

/** After a pass fails outright — offline, or the key refused — try again after these. */
const RETRY_DELAYS_MS = [60_000, 120_000, 300_000, 900_000, 1_800_000]

/** Snapshots this Mac keeps in the bucket; older ones are deleted. */
const SNAPSHOTS_KEPT = 3

interface Signatures {
  readonly audio: string
  readonly cover: string
  readonly lyrics: string
}

export interface CloudSyncDeps {
  readonly cloud: CloudRepository
  readonly songs: SongRepository
  readonly tags: TagRepository
  readonly playlists: PlaylistRepository
  readonly imports: ImportRepository
  readonly storage: StorageDriver
  readonly covers: CoverService
  readonly lyrics: LyricsService
  readonly metadata: MetadataService
  readonly logger: Logger
  /** How a bucket client is made for a connection. Tests hand in a memory bucket. */
  readonly openStore?: (connection: CloudConnection) => CloudStore
  readonly debounceMs?: number
  readonly now?: () => Date
}

export class CloudSyncService {
  readonly #deps: CloudSyncDeps
  readonly #logger: Logger
  readonly #openStore: (connection: CloudConnection) => CloudStore
  readonly #debounceMs: number
  readonly #now: () => Date

  #connection: CloudConnection | null = null
  #store: CloudStore | null = null
  /** Bumped on every connect and disconnect, so a pass for an old bucket stops. */
  #generation = 0
  #formatChecked = false
  /** Whether the bookkeeping has been checked against the bucket's own listing. */
  #verified = false

  #running: Promise<void> | null = null
  #again = false
  #debounce: NodeJS.Timeout | null = null
  #retry: NodeJS.Timeout | null = null
  #retryIndex = 0
  #stopped = false

  /** Publishing is one at a time: the import step and a pass can both ask. */
  #publishing: Promise<void> = Promise.resolve()
  #lastSnapshotHash: string | null = null

  #state: CloudStatus['state'] = 'off'
  #progress: CloudStatus['progress'] = null
  #lastSyncAt: string | null = null
  #lastSnapshotAt: string | null = null
  #lastError: string | null = null

  constructor(deps: CloudSyncDeps) {
    this.#deps = deps
    this.#logger = deps.logger.child('cloud')
    this.#openStore = deps.openStore ?? (connection => new S3CloudStore(connection))
    this.#debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.#now = deps.now ?? (() => new Date())
  }

  get connected(): boolean {
    return this.#store !== null
  }

  /** At boot: pick up a saved connection and run a first pass. */
  start(): void {
    const connection = this.#deps.cloud.connection()
    if (!connection) return
    this.#use(connection)
    this.#logger.info('publishing to the cloud', { bucket: this.#store?.description })
    void this.#pass()
  }

  stop(): void {
    this.#stopped = true
    this.#clearTimers()
  }

  /** Something in the library changed. Cheap to call as often as you like. */
  kick(): void {
    if (!this.#store || this.#stopped) return
    if (this.#debounce) clearTimeout(this.#debounce)
    this.#debounce = setTimeout(() => {
      this.#debounce = null
      void this.#pass()
    }, this.#debounceMs)
    this.#debounce.unref()
  }

  /**
   * Run a pass now. Resolves when it (or the one already running) is done.
   * With `verify`, it first checks what the bucket really holds, the way the
   * first pass after connecting or starting up does — for when you publish by
   * hand because something looks wrong.
   */
  syncNow(options: { verify?: boolean } = {}): Promise<void> {
    if (this.#debounce) clearTimeout(this.#debounce)
    this.#debounce = null
    if (options.verify) {
      // Trust nothing about the bucket: its format, its files, its snapshot.
      this.#formatChecked = false
      this.#verified = false
      this.#lastSnapshotHash = null
    }
    return this.#pass()
  }

  /** Resolves once no pass is running or waiting to follow one. */
  async whenIdle(): Promise<void> {
    while (this.#running) await this.#running
  }

  /**
   * Connect to a bucket. The key is tried before anything is saved — listed,
   * written, read back — so a mistake is reported while the form is still
   * open, as a message that says whether it was the key, the address or the
   * bucket. Throws `CloudError`.
   */
  async connect(input: CloudConnect): Promise<CloudStatus> {
    const endpoint = parseEndpoint(input.endpoint)
    if (!endpoint) {
      throw new CloudError(
        'other',
        'That endpoint is not an address, like s3.us-west-004.backblazeb2.com.',
      )
    }
    const region = input.region?.trim() || endpoint.region
    if (!region) {
      throw new CloudError('other', 'Say which region the bucket is in, as its provider names it.')
    }

    const connection: CloudConnection = {
      endpoint: endpoint.url,
      region,
      bucket: input.bucket.trim(),
      prefix: input.prefix.replace(/^\/+|\/+$/g, ''),
      keyId: input.keyId.trim(),
      applicationKey: input.applicationKey.trim(),
    }

    const store = this.#openStore(connection)
    await store.list(FORMAT_KEY)
    await this.#checkFormat(store)

    this.#deps.cloud.saveConnection(connection)
    this.#use(connection, store)
    this.#formatChecked = true
    this.#logger.info('connected to the cloud', { bucket: store.description })
    void this.#pass()
    return this.status()
  }

  /** Stop publishing. The bucket and everything in it are left alone. */
  disconnect(): CloudStatus {
    this.#deps.cloud.clearConnection()
    this.#generation++
    this.#connection = null
    this.#store = null
    this.#clearTimers()
    this.#state = 'off'
    this.#progress = null
    this.#lastError = null
    this.#lastSnapshotHash = null
    this.#logger.info('disconnected from the cloud')
    return this.status()
  }

  status(): CloudStatus {
    const connection = this.#connection
    const totals = this.#deps.cloud.totals()
    return {
      connected: connection !== null,
      target: connection
        ? {
            endpoint: connection.endpoint,
            region: connection.region,
            bucket: connection.bucket,
            prefix: connection.prefix,
            keyIdHint: `${connection.keyId.slice(0, 6)}…`,
          }
        : null,
      deviceId: connection ? this.#deviceId() : null,
      state: connection ? this.#state : 'off',
      progress: this.#progress,
      songs: { total: totals.songs, inCloud: connection ? totals.songsInCloud : 0 },
      bytesInCloud: connection ? totals.bytes : 0,
      lastSyncAt: this.#lastSyncAt,
      lastSnapshotAt: this.#lastSnapshotAt,
      lastError: this.#lastError,
    }
  }

  /**
   * Upload one song now and publish a snapshot that has it: the last step of
   * an import. With no bucket connected this does nothing. Throws when the
   * song could not be put in the bucket.
   */
  async uploadSong(songId: number): Promise<void> {
    const store = this.#store
    if (!store) return
    const file = this.#deps.cloud.songFile(songId)
    if (!file) throw new Error('the song is no longer in the library')

    await this.#ensureFormat(store)
    await this.#uploadSongFiles(store, file, this.#deps.cloud.states().get(songId) ?? null)
    await this.#publish(store)
  }

  // --- A pass ----------------------------------------------------------------

  #pass(): Promise<void> {
    if (!this.#store || this.#stopped) return Promise.resolve()
    if (this.#running) {
      this.#again = true
      return this.#running
    }
    this.#running = this.#runPass().finally(() => {
      this.#running = null
      if (this.#again && !this.#stopped) {
        this.#again = false
        void this.#pass()
      }
    })
    return this.#running
  }

  async #runPass(): Promise<void> {
    const store = this.#store
    if (!store) return
    const generation = this.#generation
    const { cloud } = this.#deps

    if (this.#retry) clearTimeout(this.#retry)
    this.#retry = null
    this.#state = 'syncing'
    let failed = 0

    try {
      await this.#ensureFormat(store)
      if (!this.#verified) {
        await this.#verify(store)
        this.#verified = true
      }

      // Work out what changed first, so progress counts real work.
      const states = cloud.states()
      const changed: Array<{ file: SongFileInfo; signatures: Signatures }> = []
      for (const file of cloud.songFiles()) {
        if (file.missing) continue
        const signatures = await this.#signatures(file)
        const state = states.get(file.id)
        if (
          !state ||
          state.audioSig !== signatures.audio ||
          state.coverSig !== signatures.cover ||
          state.lyricsSig !== signatures.lyrics
        ) {
          changed.push({ file, signatures })
        }
      }

      const total = changed.length
      let done = 0
      this.#progress = { done, total, current: null }
      for (const { file, signatures } of changed) {
        if (generation !== this.#generation || this.#stopped) return
        this.#progress = { done, total, current: file.title }
        try {
          await this.#uploadSongFiles(store, file, states.get(file.id) ?? null, signatures)
        } catch (error) {
          // Offline, a refused key, no bucket: nothing else will work either.
          if (error instanceof CloudError && error.kind !== 'other') throw error
          failed++
          this.#lastError = `${file.title}: ${message(error)}`
          this.#logger.warn('could not upload a song', { songId: file.id, message: message(error) })
        }
        done++
        this.#progress = { done, total, current: null }
      }

      if (generation !== this.#generation) return
      await this.#publish(store)

      const finished = this.#deps.imports.finishUploaded()
      if (finished > 0)
        this.#logger.info('finished imports that were waiting to upload', { count: finished })

      if (changed.length > 0) {
        this.#logger.info('cloud pass complete', { uploaded: changed.length - failed, failed })
      }
      this.#lastSyncAt = this.#now().toISOString()
      this.#retryIndex = 0
      this.#state = failed > 0 ? 'error' : 'idle'
      if (failed === 0) this.#lastError = null
    } catch (error) {
      if (generation !== this.#generation) return
      this.#state = 'error'
      this.#lastError = message(error)
      const delay =
        RETRY_DELAYS_MS[Math.min(this.#retryIndex, RETRY_DELAYS_MS.length - 1)] ?? 60_000
      this.#retryIndex++
      this.#logger.warn('cloud pass failed, will try again', {
        message: this.#lastError,
        inSeconds: delay / 1000,
      })
      this.#retry = setTimeout(() => {
        this.#retry = null
        void this.#pass()
      }, delay)
      this.#retry.unref()
    } finally {
      if (generation === this.#generation) this.#progress = null
    }
  }

  /**
   * Check the bookkeeping against the bucket's own listing: a thousand files
   * to a request, so a few requests for a whole library. Files can go from a
   * bucket without this Mac knowing — deleted by hand, or the bucket made
   * again under the same name — and a song that pointed at one goes up again.
   */
  async #verify(store: CloudStore): Promise<void> {
    const present = new Map<string, number>()
    for (const folder of ['audio/', 'covers/', 'lyrics/']) {
      for (const object of await store.list(folder)) present.set(object.key, object.size)
    }
    const again = this.#deps.cloud.reconcileFiles(present)
    if (again > 0) {
      this.#logger.warn('files missing from the bucket, uploading those songs again', {
        songs: again,
      })
    }
  }

  /**
   * What a song's files look like now, in terms that change exactly when a
   * file does: the audio file's size and mtime (from its row — no disk access),
   * the cover's revision, and the lyric sidecar's size and mtime. Lyrics kept
   * in the audio file's own tags change when the audio file does.
   */
  async #signatures(file: SongFileInfo): Promise<Signatures> {
    const audio = `${file.sizeBytes}-${file.mtimeMs}`
    const cover = file.hasArt ? `art-${file.artRev}` : 'none'
    const sidecar = await this.#deps.lyrics.findSidecar(file.path)
    if (!sidecar) return { audio, cover, lyrics: `tags-${audio}` }
    const stat = await this.#deps.storage.stat(sidecar.key)
    const lyrics = stat
      ? `sidecar${sidecar.extension}-${stat.sizeBytes}-${stat.modifiedAt.getTime()}`
      : `tags-${audio}`
    return { audio, cover, lyrics }
  }

  /** Upload whatever of one song's files the bucket does not have yet. */
  async #uploadSongFiles(
    store: CloudStore,
    file: SongFileInfo,
    state: CloudSongState | null,
    known?: Signatures,
  ): Promise<void> {
    const signatures = known ?? (await this.#signatures(file))

    let audio: { key: string; size: number }
    if (state && state.audioSig === signatures.audio) {
      audio = { key: state.audioKey, size: state.audioSize }
    } else {
      const data = await this.#deps.storage.read(file.path)
      const key = audioKey(sha256(data), path.extname(file.path))
      await this.#putOnce(store, key, data, file.mime)
      audio = { key, size: data.length }
    }

    let cover: { key: string; size: number } | null
    if (state && state.coverSig === signatures.cover) {
      cover = state.coverKey !== null ? { key: state.coverKey, size: state.coverSize ?? 0 } : null
    } else {
      cover = await this.#uploadCover(store, file)
    }

    let lyrics: { key: string; size: number; kind: CloudLyrics['kind'] } | null
    if (state && state.lyricsSig === signatures.lyrics) {
      lyrics =
        state.lyricsKey !== null && state.lyricsKind !== null
          ? { key: state.lyricsKey, size: state.lyricsSize ?? 0, kind: state.lyricsKind }
          : null
    } else {
      lyrics = await this.#uploadLyrics(store, file)
    }

    this.#deps.cloud.saveState({
      songId: file.id,
      audioKey: audio.key,
      audioSize: audio.size,
      audioSig: signatures.audio,
      coverKey: cover?.key ?? null,
      coverSize: cover?.size ?? null,
      coverSig: signatures.cover,
      lyricsKey: lyrics?.key ?? null,
      lyricsSize: lyrics?.size ?? null,
      lyricsKind: lyrics?.kind ?? null,
      lyricsSig: signatures.lyrics,
    })
  }

  async #uploadCover(
    store: CloudStore,
    file: SongFileInfo,
  ): Promise<{ key: string; size: number } | null> {
    if (!file.hasArt) return null
    const found = this.#deps.covers.find(file.id)
    if (!found) return null
    const data = await fsp.readFile(found.path)
    const key = coverKey(sha256(data), path.extname(found.path))
    await this.#putOnce(store, key, data, found.contentType)
    return { key, size: data.length }
  }

  /** The words: the sidecar if there is one, else the audio file's own tags. */
  async #uploadLyrics(
    store: CloudStore,
    file: SongFileInfo,
  ): Promise<{ key: string; size: number; kind: CloudLyrics['kind'] } | null> {
    let text: string | null = null
    let kind: CloudLyrics['kind'] = 'plain'

    const sidecar = await this.#deps.lyrics.readSidecar(file.path)
    if (sidecar && sidecar.kind !== 'none') {
      text = sidecar.text
      kind = sidecar.kind
    } else {
      const embedded = (await this.#deps.metadata.read(file.path)).embeddedLyrics
      if (embedded?.trim()) {
        text = embedded
        kind = isSynced(embedded) ? 'synced' : 'plain'
      }
    }
    if (!text?.trim()) return null

    const data = Buffer.from(text, 'utf8')
    const key = lyricsKey(sha256(data), kind === 'synced')
    await this.#putOnce(store, key, data, 'text/plain; charset=utf-8')
    return { key, size: data.length, kind }
  }

  /**
   * Put a file the bucket may already have. Files are named by their hash, so
   * one that is there with the right size is the right file: remembered once,
   * never asked about or sent again.
   */
  async #putOnce(store: CloudStore, key: string, data: Buffer, contentType: string): Promise<void> {
    if (this.#deps.cloud.hasFile(key)) return
    const existing = await store.head(key)
    if (!existing || existing.size !== data.length) {
      await store.put(key, data, { contentType })
    }
    this.#deps.cloud.recordFile(key, data.length)
  }

  // --- Snapshots -------------------------------------------------------------

  #publish(store: CloudStore): Promise<void> {
    const run = this.#publishing.then(() => this.#publishNow(store))
    this.#publishing = run.catch(() => undefined)
    return run
  }

  /** Write a snapshot, unless it would say exactly what the last one did. */
  async #publishNow(store: CloudStore): Promise<void> {
    const { cloud, songs, tags, playlists } = this.#deps
    const deviceId = this.#deviceId()
    const writtenAt = this.#now()

    const snapshot = buildSnapshot({
      songs: songs.all(),
      songUids: new Map(cloud.songFiles().map(file => [file.id, file.uid])),
      states: cloud.states(),
      tags: tags.all(),
      tagUids: cloud.tagUids(),
      playlists: playlists.all(),
      playlistUids: cloud.playlistUids(),
      playlistSongIds: playlist => playlists.songIds(playlist),
      deviceId,
      writtenAt,
    })

    const { writtenAt: _stamp, ...content } = snapshot
    const hash = sha256(Buffer.from(JSON.stringify(content)))
    if (hash === this.#lastSnapshotHash) return

    const key = snapshotKey(writtenAt, deviceId)
    await store.put(key, gzipSync(Buffer.from(JSON.stringify(snapshot))), {
      contentType: 'application/json',
      contentEncoding: 'gzip',
    })
    this.#lastSnapshotHash = hash
    this.#lastSnapshotAt = snapshot.writtenAt

    try {
      const keys = (await store.list(SNAPSHOTS_FOLDER)).map(object => object.key)
      for (const old of snapshotsToPrune(keys, deviceId, SNAPSHOTS_KEPT)) await store.delete(old)
    } catch (error) {
      // An old snapshot left behind costs a few kilobytes; it is not worth failing over.
      this.#logger.debug('could not delete old snapshots', { message: message(error) })
    }
  }

  // --- The bucket's format -----------------------------------------------------

  async #ensureFormat(store: CloudStore): Promise<void> {
    if (this.#formatChecked) return
    await this.#checkFormat(store)
    this.#formatChecked = true
  }

  /**
   * Make sure the bucket is one this build may write to: `format.json` says
   * so, or there is none yet and this writes it — and reads it back, which is
   * what proves the key can read as well as write.
   */
  async #checkFormat(store: CloudStore): Promise<void> {
    const existing = await store.get(FORMAT_KEY)
    if (existing) {
      const parsed = CloudFormatSchema.safeParse(parseJson(existing))
      if (!parsed.success) {
        throw new CloudError(
          'other',
          'That folder of the bucket has a format.json that is not self.mp3’s. Choose another folder.',
        )
      }
      if (parsed.data.format > CLOUD_FORMAT) {
        throw new CloudError(
          'other',
          `This bucket was set up by a newer version of self.mp3 (format ${parsed.data.format}). ` +
            'Update this Mac before connecting it.',
        )
      }
      return
    }

    const format = {
      app: 'self.mp3',
      format: CLOUD_FORMAT,
      createdAt: this.#now().toISOString(),
      createdBy: this.#deviceId(),
    }
    const body = Buffer.from(`${JSON.stringify(format, null, 2)}\n`)
    await store.put(FORMAT_KEY, body, { contentType: 'application/json' })
    const readBack = await store.get(FORMAT_KEY)
    if (!readBack || !CloudFormatSchema.safeParse(parseJson(readBack)).success) {
      throw new CloudError(
        'auth',
        'The key can write to the bucket but not read from it. It needs both.',
      )
    }
  }

  // --- Plumbing ----------------------------------------------------------------

  #use(connection: CloudConnection, store?: CloudStore): void {
    this.#generation++
    this.#clearTimers()
    this.#connection = connection
    this.#store = store ?? this.#openStore(connection)
    this.#formatChecked = false
    this.#verified = false
    this.#lastSnapshotHash = null
    this.#lastError = null
    this.#retryIndex = 0
    this.#state = 'idle'
  }

  #deviceId(): string {
    return this.#deps.cloud.deviceId(os.platform() === 'darwin' ? 'mac' : os.platform())
  }

  #clearTimers(): void {
    if (this.#debounce) clearTimeout(this.#debounce)
    if (this.#retry) clearTimeout(this.#retry)
    this.#debounce = null
    this.#retry = null
  }
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function parseJson(data: Buffer): unknown {
  try {
    return JSON.parse(data.toString('utf8'))
  } catch {
    return null
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

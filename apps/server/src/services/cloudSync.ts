import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  CLOUD_FORMAT,
  CloudFormatSchema,
  FORMAT_KEY,
  LOG_FOLDER,
  SNAPSHOTS_FOLDER,
  audioKey,
  coverKey,
  detectLyricsLanguage,
  isSynced,
  lyricsKey,
  newestSnapshotKey,
  parseEndpoint,
  parseLogKey,
  parseLyrics,
  readLogFile,
  romanizedKey,
  snapshotKey,
  snapshotsToPrune,
  unfoldedLogKeys,
  type Change,
  type CloudConnect,
  type CloudLyrics,
  type CloudStatus,
  type DoormanMe,
  type CloudServer,
} from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { StorageDriver } from '../storage/index.js'
import { CloudError, S3CloudStore, type CloudStore } from '../cloud/store.js'
import { DoormanClient } from '../cloud/doorman.js'
import { debounce, type Debounced } from './debounce.js'
import type {
  CloudConnection,
  CloudRepository,
  CloudSongState,
  DoormanSession,
  SongFileInfo,
} from '../repositories/cloud.js'
import type { SongRepository } from '../repositories/songs.js'
import type { TagRepository } from '../repositories/tags.js'
import type { PlaylistRepository } from '../repositories/playlists.js'
import type { ImportRepository } from '../repositories/imports.js'
import type { SyncRepository } from '../repositories/sync.js'
import type { ImportRequestRepository } from '../repositories/importRequests.js'
import type { CloudIngest, IngestResult } from './cloudIngest.js'
import type { CoverService } from './covers.js'
import type { LyricsService } from './lyrics.js'
import type { MetadataService } from './metadata.js'
import { buildSnapshot, publishRefusedMessage, publishWouldLoseLibrary } from './cloudSnapshot.js'

/**
 * Keeping the library and the cloud bucket in step (docs/SYNC.md).
 *
 * One pass: fold in what other devices have written to their change logs
 * since the last pass, work out which songs changed since they were last
 * uploaded, upload their audio, cover and lyrics under the SHA-256 of their
 * bytes, then write a snapshot of the whole library — which says how far into
 * each device's log it has read. Passes run at startup, a few seconds after
 * anything changes, when another device has written something, and on
 * demand; only one runs at a time, and a change during a pass earns exactly
 * one more.
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

/**
 * How often to look for changes other devices have written. One listing of
 * the log folder; a pass only follows when there is something new.
 */
const LOG_POLL_MS = 3 * 60_000

/** Log files read at once. */
const LOG_READS_AT_ONCE = 6

/** How often to ask the doorman whether Google has finished, and for how long. */
const SIGN_IN_POLL_MS = 2_000
const SIGN_IN_TIMEOUT_MS = 10 * 60_000

/** The part of the doorman the sync uses. Tests hand in a fake. */
export type Doorman = Pick<
  DoormanClient,
  'url' | 'claim' | 'me' | 'connectStorage' | 'signOut' | 'store'
>

interface Signatures {
  readonly audio: string
  readonly cover: string
  readonly lyrics: string
}

/** A song's words in the bucket, and their romanized lines beside them. */
interface UploadedLyrics {
  readonly key: string
  readonly size: number
  readonly kind: CloudLyrics['kind']
  readonly romanized: string | null
}

/** Whether a lyric text is Chinese or Japanese: words that should have romanized lines. */
function wantsRomanized(text: string): boolean {
  const parsed = parseLyrics(text)
  const lines = parsed.synced ? parsed.lines.map(line => line.text) : parsed.lines
  return detectLyricsLanguage(lines) !== 'none'
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
  /**
   * A lyric text's romanized lines, made once per text and cached
   * (services/romanizedLines.ts), uploaded beside the words. Null when the
   * words need none or the dictionary would not load. Absent where romaji is
   * not what is being tested, which then uploads none.
   */
  readonly romanize?: (songId: number, text: string) => Promise<string[] | null>
  /** Other devices' changes: where this Mac keeps how far it has read, and what applies them. */
  readonly sync?: SyncRepository
  readonly ingest?: CloudIngest
  /** Links other devices asked to import: how each is going goes in every snapshot. */
  readonly importRequests?: ImportRequestRepository
  /**
   * Where this Mac listens right now, for the snapshot, so a device near it
   * can import through it. Asked each time, since an address can change
   * while the library does not; the poll republishes when one has.
   */
  readonly server?: () => CloudServer
  /** How a bucket client is made for a connection. Tests hand in a memory bucket. */
  readonly openStore?: (connection: CloudConnection) => CloudStore
  /** The doorman to sign in through; empty or absent for none. */
  readonly doormanUrl?: string
  readonly openDoorman?: (url: string) => Doorman
  readonly debounceMs?: number
  readonly now?: () => Date
  readonly signInPollMs?: number
  readonly logPollMs?: number
}

export class CloudSyncService {
  readonly #deps: CloudSyncDeps
  readonly #logger: Logger
  readonly #openStore: (connection: CloudConnection) => CloudStore
  readonly #doorman: Doorman | null
  readonly #debounceMs: number
  readonly #now: () => Date
  readonly #signInPollMs: number
  readonly #logPollMs: number

  /**
   * Called after a pass has applied other devices' changes, so the library
   * version moves and the files of songs removed elsewhere go too.
   */
  onIngested: ((result: IngestResult) => void | Promise<void>) | null = null

  /** Where uploads go, for display and for the bookkeeping's sake. */
  #target: CloudStatus['target'] = null
  #store: CloudStore | null = null
  /** Signed in through the doorman: the session, and what it last said about the account. */
  #session: DoormanSession | null = null
  /** A sign-in started from this Mac that Google has not finished yet. */
  #signIn: { attempt: string; until: number; needsCode: boolean } | null = null
  #signInTimer: NodeJS.Timeout | null = null
  /** Bumped on every connect and disconnect, so a pass for an old bucket stops. */
  #generation = 0
  #formatChecked = false
  /** Whether the bookkeeping has been checked against the bucket's own listing. */
  #verified = false

  #running: Promise<void> | null = null
  #again = false
  readonly #kickDebounce: Debounced
  #retry: NodeJS.Timeout | null = null
  #retryIndex = 0
  #logPoll: NodeJS.Timeout | null = null
  #stopped = false

  /** Publishing is one at a time: the import step and a pass can both ask. */
  #publishing: Promise<void> = Promise.resolve()
  #lastSnapshotHash: string | null = null
  /** The addresses the last snapshot carried, to notice when the Mac has moved. */
  #publishedServer: string | null = null

  #state: CloudStatus['state'] = 'off'
  #progress: CloudStatus['progress'] = null
  #lastSyncAt: string | null = null
  #lastSnapshotAt: string | null = null
  #lastError: string | null = null
  /**
   * Whether this run has checked its library against the one in the bucket.
   * Once per process: after the first snapshot goes up, the bucket's newest is
   * this device's own, and comparing it with itself proves nothing.
   */
  #checkedAgainstBucket = false

  constructor(deps: CloudSyncDeps) {
    this.#deps = deps
    this.#logger = deps.logger.child('cloud')
    this.#openStore = deps.openStore ?? (connection => new S3CloudStore(connection))
    const openDoorman = deps.openDoorman ?? ((url: string) => new DoormanClient(url))
    this.#doorman = deps.doormanUrl ? openDoorman(deps.doormanUrl) : null
    this.#debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
    /*
     * The shared debounce, for its ceiling.
     *
     * A hand-rolled trailing debounce pushed the pass back on every change and
     * had nothing to stop it: a steady drip of edits — a big import tagging as
     * it goes — held the cloud off for the whole burst, however long that was.
     * `maxWaitMs` is what guarantees the pass still happens during one.
     */
    this.#kickDebounce = debounce(() => void this.#pass(), this.#debounceMs)
    this.#now = deps.now ?? (() => new Date())
    this.#signInPollMs = deps.signInPollMs ?? SIGN_IN_POLL_MS
    this.#logPollMs = deps.logPollMs ?? LOG_POLL_MS
  }

  get connected(): boolean {
    return this.#store !== null
  }

  /**
   * At boot: pick up where things were — signed in through the doorman, or
   * connected directly — and run a first pass.
   */
  start(): void {
    const session = this.#deps.cloud.doormanSession()
    if (session && this.#doorman && session.url === this.#doorman.url) {
      this.#session = session
      // What the doorman says about the account may have changed since: a
      // bucket connected, or swapped, from another device. Ask, and use the
      // answer; until it comes, the last one known.
      void this.#refreshAccount()
      return
    }
    const connection = this.#deps.cloud.connection()
    if (!connection) return
    this.#useDirect(connection)
    this.#logger.info('publishing to the cloud', { bucket: this.#store?.description })
    void this.#pass()
  }

  stop(): void {
    this.#stopped = true
    this.#clearTimers()
    this.#stopSignIn()
  }

  /** Something in the library changed. Cheap to call as often as you like. */
  kick(): void {
    if (!this.#store || this.#stopped) return
    this.#kickDebounce.trigger()
  }

  /**
   * Run a pass now. Resolves when it (or the one already running) is done.
   * With `verify`, it first checks what the bucket really holds, the way the
   * first pass after connecting or starting up does — for when you publish by
   * hand because something looks wrong.
   */
  syncNow(options: { verify?: boolean } = {}): Promise<void> {
    this.#kickDebounce.cancel()
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

    this.#stopSignIn()
    this.#session = null
    this.#deps.cloud.saveConnection(connection)
    this.#useDirect(connection, store)
    this.#formatChecked = true
    this.#logger.info('connected to the cloud', { bucket: store.description })
    void this.#pass()
    return this.status()
  }

  /**
   * Stop using the cloud, whichever way in: sign out of the doorman, or drop
   * the direct connection. The bucket and everything in it are left alone.
   */
  disconnect(): CloudStatus {
    const session = this.#session
    if (session && this.#doorman) {
      // Best effort: the session is forgotten here either way.
      this.#doorman.signOut(session.token).catch(() => undefined)
    }
    this.#stopSignIn()
    this.#deps.cloud.clearConnection()
    this.#session = null
    this.#drop()
    this.#logger.info('disconnected from the cloud')
    return this.status()
  }

  // --- Signing in through the doorman ------------------------------------------

  /**
   * Wait for Google to finish a sign-in the browser has just started with
   * this attempt id (it opens the doorman's page itself, so no popup is
   * blocked). The doorman is asked every couple of seconds for ten minutes.
   */
  beginSignIn(attempt: string): CloudStatus {
    if (!this.#doorman) {
      throw new CloudError('other', 'No doorman is set up for this Mac to sign in through.')
    }
    this.#stopSignIn()
    this.#signIn = {
      attempt,
      until: this.#now().getTime() + SIGN_IN_TIMEOUT_MS,
      needsCode: false,
    }
    this.#scheduleSignInPoll(0)
    return this.status()
  }

  cancelSignIn(): CloudStatus {
    this.#stopSignIn()
    return this.status()
  }

  /**
   * The code the doorman showed once Google had signed you in: what turns
   * the attempt into a session (packages/shared/src/schemas/doorman.ts). A
   * wrong one ends the attempt, and signing in starts again. Throws
   * `CloudError`.
   */
  async enterSignInCode(code: string): Promise<CloudStatus> {
    const signIn = this.#signIn
    if (!signIn || !this.#doorman) {
      throw new CloudError('other', 'That sign-in is over. Start it again.')
    }
    try {
      const result = await this.#doorman.claim(signIn.attempt, code)
      if (result.status !== 'signed-in') {
        throw new CloudError('other', 'Google has not finished signing you in yet.')
      }
      // By attempt rather than by identity: the poll that runs alongside this
      // replaces the whole object whenever anything about it changes, and then
      // a sign-in that had just succeeded was left looking like one still
      // waiting for its code.
      if (this.#signIn?.attempt === signIn.attempt) this.#stopSignIn()
      this.#logger.info('signed in to the cloud', { account: result.me.email })
      this.#adoptAccount(result.token, result.me)
      return this.status()
    } catch (error) {
      // The doorman forgets an attempt a wrong code was tried against.
      if (this.#signIn?.attempt === signIn.attempt) this.#stopSignIn()
      throw error
    }
  }

  /** Wait for a sign-in to finish or give up. For tests. */
  async whenSignedIn(): Promise<void> {
    while (this.#signIn) await new Promise(resolve => setTimeout(resolve, 5))
  }

  /**
   * Connect a bucket to the signed-in Google account. The doorman tries the
   * key before it keeps it, and says what was wrong if it was. Throws
   * `CloudError`.
   */
  async connectStorage(input: CloudConnect): Promise<CloudStatus> {
    const session = this.#session
    if (!session || !this.#doorman) {
      throw new CloudError('auth', 'Sign in with Google first.')
    }
    const me = await this.#doorman.connectStorage(session.token, input)
    this.#adoptAccount(session.token, me)
    return this.status()
  }

  #scheduleSignInPoll(delay: number): void {
    this.#signInTimer = setTimeout(() => {
      this.#signInTimer = null
      void this.#pollSignIn()
    }, delay)
    this.#signInTimer.unref()
  }

  async #pollSignIn(): Promise<void> {
    const signIn = this.#signIn
    if (!signIn || !this.#doorman || this.#stopped) return
    if (this.#now().getTime() > signIn.until) {
      this.#signIn = null
      return
    }
    // Google has finished and the code is on its way: nothing to ask until it comes.
    if (signIn.needsCode) {
      this.#scheduleSignInPoll(this.#signInPollMs)
      return
    }
    try {
      const result = await this.#doorman.claim(signIn.attempt)
      if (this.#signIn !== signIn) return
      if (result.status === 'code') {
        this.#signIn = { ...signIn, needsCode: true }
      } else if (result.status === 'signed-in') {
        // A doorman from before sign-in codes.
        this.#signIn = null
        this.#logger.info('signed in to the cloud', { account: result.me.email })
        this.#adoptAccount(result.token, result.me)
        return
      }
    } catch (error) {
      // Google takes its time and networks drop: keep asking until the deadline.
      this.#logger.debug('sign-in not claimed yet', { message: message(error) })
    }
    if (this.#signIn?.attempt === signIn.attempt) this.#scheduleSignInPoll(this.#signInPollMs)
  }

  #stopSignIn(): void {
    if (this.#signInTimer) clearTimeout(this.#signInTimer)
    this.#signInTimer = null
    this.#signIn = null
  }

  /** Ask the doorman about the signed-in account, and use what it says. */
  async #refreshAccount(): Promise<void> {
    const session = this.#session
    if (!session || !this.#doorman) return
    // Carry on with what was known while the doorman is asked.
    if (session.storage && !this.#store) this.#useDoorman(session)
    if (this.#store) void this.#pass()
    try {
      this.#adoptAccount(session.token, await this.#doorman.me(session.token))
    } catch (error) {
      if (error instanceof CloudError && error.kind === 'auth') this.#sessionEnded(error)
      this.#logger.warn('could not refresh the cloud account', { message: message(error) })
    }
  }

  /**
   * The doorman no longer knows this session — it expired, or was signed out
   * from elsewhere. Publishing stops (every request would be refused) and the
   * status says to sign in again, until someone does.
   */
  #sessionEnded(error: CloudError): void {
    this.#drop()
    this.#lastError = error.message
  }

  /**
   * Keep a session and what the doorman says about its account. With a
   * bucket connected to the account, publish to it — to a different one than
   * before, the bookkeeping starts afresh.
   */
  #adoptAccount(token: string, me: DoormanMe): void {
    if (!this.#doorman) return
    const session: DoormanSession = {
      url: this.#doorman.url,
      token,
      email: me.email,
      name: me.name,
      picture: me.picture,
      storage: me.storage,
    }
    const previous = this.#session
    this.#session = session
    this.#deps.cloud.saveDoormanSession(session)

    const sameBucket =
      previous?.storage &&
      me.storage &&
      previous.token === token &&
      previous.storage.endpoint === me.storage.endpoint &&
      previous.storage.bucket === me.storage.bucket &&
      previous.storage.prefix === me.storage.prefix
    if (!me.storage) {
      this.#drop()
      return
    }
    if (sameBucket && this.#store) {
      this.#target = { ...me.storage }
      return
    }
    this.#useDoorman(session)
    void this.#pass()
  }

  status(): CloudStatus {
    const store = this.#store
    const totals = this.#deps.cloud.totals()
    const session = this.#session
    return {
      doormanUrl: this.#doorman?.url ?? null,
      account: session
        ? { email: session.email, name: session.name, picture: session.picture }
        : null,
      signingIn: this.#signIn !== null,
      signInNeedsCode: this.#signIn?.needsCode ?? false,
      connected: store !== null,
      target: store ? this.#target : null,
      deviceId: store ? this.#deviceId() : null,
      // Signed in but refused: not off, but in need of a fresh sign-in.
      state: store ? this.#state : session && this.#lastError ? 'error' : 'off',
      progress: this.#progress,
      songs: { total: totals.songs, inCloud: store ? totals.songsInCloud : 0 },
      bytesInCloud: store ? totals.bytes : 0,
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

      // Other devices' changes first: a song removed elsewhere is not worth
      // uploading, and the snapshot at the end should say they are folded in.
      failed += await this.#readLogs(store, generation)
      if (generation !== this.#generation || this.#stopped) return

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
      if (error instanceof CloudError && error.kind === 'auth' && this.#session) {
        // Trying again will not bring a dead session back; signing in will.
        this.#sessionEnded(error)
        return
      }
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
   * Fold in the log files other devices have written since the last pass,
   * all in one transaction with the cursors that say they have been. Returns
   * how many devices' logs could not be read to the end — a file this build
   * does not understand stops that device's log there, rather than skipping
   * a change for good, until this Mac is updated.
   */
  async #readLogs(store: CloudStore, generation: number): Promise<number> {
    const { sync, ingest } = this.#deps
    if (!sync || !ingest) return 0
    const own = this.#deviceId()
    const keys = (await store.list(LOG_FOLDER)).map(object => object.key)
    const pending = unfoldedLogKeys(keys, sync.cursors()).filter(
      key => parseLogKey(key)?.deviceId !== own,
    )
    if (pending.length === 0) return 0

    const read = await inBatches(pending, LOG_READS_AT_ONCE, key => this.#readLog(store, key))
    if (generation !== this.#generation) return 0

    const changes: Change[] = []
    const reached = new Map<string, number>()
    const stuck = new Set<string>()
    let unreadable = 0
    // In each device's order: past a file that cannot be used, nothing of that device's counts.
    pending.forEach((key, index) => {
      const where = parseLogKey(key)
      const file = read[index]
      if (!where || stuck.has(where.deviceId)) return
      if (file === 'gone' || file === 'unreadable') {
        stuck.add(where.deviceId)
        if (file === 'unreadable') unreadable++
        return
      }
      changes.push(...(file ?? []))
      reached.set(where.deviceId, where.seq)
    })

    const result = ingest.apply(changes, () => {
      for (const [device, seq] of reached) sync.setCursor(device, seq)
    })
    if (result.applied > 0 || result.removed.length > 0) {
      this.#logger.info('applied changes from other devices', {
        changes: result.applied,
        removed: result.removed.length,
      })
      await this.onIngested?.(result)
    }
    return unreadable
  }

  /**
   * One log file's changes. `gone` when it went between the listing and now —
   * a device tidies its files away once a snapshot has them, so the next pass
   * simply lists again — and `unreadable`, with the reason kept, when it
   * cannot be used.
   */
  async #readLog(store: CloudStore, key: string): Promise<Change[] | 'gone' | 'unreadable'> {
    const where = parseLogKey(key)
    if (!where) return 'unreadable'
    const data = await store.get(key)
    if (!data) return 'gone'
    const read = readLogFile(parseJson(data))
    if (!read.ok || read.file.device !== where.deviceId || read.file.seq !== where.seq) {
      this.#lastError =
        read.ok || read.reason === 'unreadable'
          ? `A change log from ${where.deviceId} could not be read (${key}).`
          : `${where.deviceId} is writing changes this version of self.mp3 cannot read. Update this Mac.`
      this.#logger.warn('could not use a log file', { key, reason: this.#lastError })
      return 'unreadable'
    }
    if (read.skipped > 0) {
      this.#lastError = `${where.deviceId} is writing changes this version of self.mp3 cannot read. Update this Mac.`
      this.#logger.warn('a log file has changes this build does not know', {
        key,
        skipped: read.skipped,
      })
      return 'unreadable'
    }
    return [...read.file.changes]
  }

  /**
   * While the Mac sits idle, another device may write to its log. A look at
   * the log folder every few minutes; a pass only when there is something new.
   */
  #startLogPoll(): void {
    if (!this.#deps.sync || !this.#deps.ingest) return
    this.#logPoll = setInterval(() => void this.#pollLogs(), this.#logPollMs)
    this.#logPoll.unref()
  }

  async #pollLogs(): Promise<void> {
    const store = this.#store
    const sync = this.#deps.sync
    if (!store || !sync || this.#running || this.#stopped) return
    try {
      const own = this.#deviceId()
      const keys = (await store.list(LOG_FOLDER)).map(object => object.key)
      const fresh = unfoldedLogKeys(keys, sync.cursors()).some(
        key => parseLogKey(key)?.deviceId !== own,
      )
      if (fresh) void this.#pass()
      // A new Wi-Fi network is a new address, with nothing else about the
      // library to say: the snapshot goes up again so a device can still find
      // this Mac.
      else if (this.#serverNow() !== this.#publishedServer) void this.#publish(store)
    } catch (error) {
      // The next look, or the next pass, will say what is wrong.
      this.#logger.debug('could not look for changes from other devices', {
        message: message(error),
      })
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

    let lyrics: UploadedLyrics | null
    let lyricsSig = signatures.lyrics
    if (state && state.lyricsSig === signatures.lyrics) {
      lyrics =
        state.lyricsKey !== null && state.lyricsKind !== null
          ? {
              key: state.lyricsKey,
              size: state.lyricsSize ?? 0,
              kind: state.lyricsKind,
              romanized: state.romanizedKey,
            }
          : null
    } else {
      const uploaded = await this.#uploadLyrics(store, file)
      lyrics = uploaded?.lyrics ?? null
      // Chinese or Japanese words that got no romaji this time are not done:
      // an empty signature never matches, so the next pass tries again.
      if (uploaded?.romanizedMissing) lyricsSig = ''
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
      romanizedKey: lyrics?.romanized ?? null,
      lyricsSig,
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

  /**
   * The words — the sidecar if there is one, else the audio file's own tags —
   * and their romanized lines beside them, as the Mac's own lyrics answer
   * carries them. `romanizedMissing` says the words are Chinese or Japanese
   * and no romaji could be made this time.
   */
  async #uploadLyrics(
    store: CloudStore,
    file: SongFileInfo,
  ): Promise<{ lyrics: UploadedLyrics; romanizedMissing: boolean } | null> {
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

    const romanize = this.#deps.romanize
    const lines = romanize ? await romanize(file.id, text).catch(() => null) : null
    let romanized: string | null = null
    if (lines) {
      const json = Buffer.from(JSON.stringify(lines), 'utf8')
      romanized = romanizedKey(sha256(json))
      await this.#putOnce(store, romanized, json, 'application/json')
    }
    return {
      lyrics: { key, size: data.length, kind, romanized },
      romanizedMissing: romanize !== undefined && lines === null && wantsRomanized(text),
    }
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

  /**
   * Read the newest snapshot and decide whether publishing would destroy it.
   *
   * The one place this Mac reads a snapshot rather than only writing them. It
   * asks a single question — how many songs does the bucket think there are —
   * and nothing else, so a snapshot written by a newer build it cannot fully
   * parse still protects the library.
   *
   * Returns why to refuse, or null to go ahead. A bucket that cannot be read,
   * or holds no snapshot yet, is not a reason to refuse: a first publish into
   * an empty bucket is exactly what is supposed to happen.
   */
  async #refuseToLoseLibrary(store: CloudStore, songsHere: number): Promise<string | null> {
    if (process.env['SELFMP3_PUBLISH_ANYWAY'] === '1') return null
    try {
      const keys = (await store.list(SNAPSHOTS_FOLDER)).map(object => object.key)
      const newest = newestSnapshotKey(keys)
      if (!newest) return null

      const body = await store.get(newest)
      if (!body) return null
      const parsed: unknown = JSON.parse(gunzipSync(body).toString('utf8'))
      const songs = (parsed as { songs?: unknown }).songs
      if (!Array.isArray(songs)) return null

      return publishWouldLoseLibrary(songs.length, songsHere)
        ? publishRefusedMessage(songs.length, songsHere)
        : null
    } catch (error) {
      // Could not read it. Publishing is still the right default — refusing
      // here would mean an unreadable bucket stops a healthy Mac syncing.
      this.#logger.debug('could not check the bucket before publishing', {
        message: message(error),
      })
      return null
    }
  }

  /** The addresses as the snapshot would carry them now, or null with none to carry. */
  #serverNow(): string | null {
    const server = this.#deps.server?.()
    return server === undefined ? null : JSON.stringify(server)
  }

  #publish(store: CloudStore): Promise<void> {
    const run = this.#publishing.then(() => this.#publishNow(store))
    this.#publishing = run.catch(() => undefined)
    return run
  }

  /** Write a snapshot, unless it would say exactly what the last one did. */
  async #publishNow(store: CloudStore): Promise<void> {
    const { cloud, songs, tags, playlists, sync, importRequests } = this.#deps
    const deviceId = this.#deviceId()
    const writtenAt = this.#now()
    // A request whose songs have all finished says so from now on.
    importRequests?.settle()

    const server = this.#deps.server?.()
    this.#publishedServer = server === undefined ? null : JSON.stringify(server)
    const snapshot = buildSnapshot({
      stamps: sync?.allStamps() ?? [],
      aliases: sync?.aliases() ?? new Map(),
      upTo: sync?.cursors() ?? {},
      imports: importRequests?.recent() ?? [],
      ...(server ? { server } : {}),
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

    // Once per run, before this device's first snapshot replaces whatever is
    // there: is this Mac about to throw away somebody's library?
    if (!this.#checkedAgainstBucket) {
      const refusal = await this.#refuseToLoseLibrary(store, snapshot.songs.length)
      this.#checkedAgainstBucket = true
      if (refusal) {
        this.#lastError = refusal
        this.#state = 'error'
        this.#logger.error(refusal)
        return
      }
    }

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

  #useDirect(connection: CloudConnection, store?: CloudStore): void {
    this.#use(store ?? this.#openStore(connection), {
      endpoint: connection.endpoint,
      region: connection.region,
      bucket: connection.bucket,
      prefix: connection.prefix,
      keyIdHint: `${connection.keyId.slice(0, 6)}…`,
    })
  }

  #useDoorman(session: DoormanSession): void {
    const storage = session.storage
    if (!storage || !this.#doorman) return
    this.#deps.cloud.adoptTarget(storage)
    const host = storage.endpoint.replace(/^https?:\/\//, '')
    const folder = storage.prefix ? `${storage.bucket}/${storage.prefix}` : storage.bucket
    this.#use(this.#doorman.store(session.token, `${host} · ${folder} (via the doorman)`), {
      ...storage,
    })
  }

  #use(store: CloudStore, target: NonNullable<CloudStatus['target']>): void {
    this.#generation++
    this.#clearTimers()
    this.#store = store
    this.#target = target
    this.#formatChecked = false
    this.#verified = false
    this.#lastSnapshotHash = null
    this.#lastError = null
    this.#retryIndex = 0
    this.#state = 'idle'
    this.#startLogPoll()
  }

  /** No bucket in use any more; a pass for the old one stops at its next step. */
  #drop(): void {
    this.#generation++
    this.#store = null
    this.#target = null
    this.#clearTimers()
    this.#state = 'off'
    this.#progress = null
    this.#lastError = null
    this.#lastSnapshotHash = null
  }

  #deviceId(): string {
    return this.#deps.cloud.deviceId(os.platform() === 'darwin' ? 'mac' : os.platform())
  }

  #clearTimers(): void {
    this.#kickDebounce.cancel()
    if (this.#retry) clearTimeout(this.#retry)
    if (this.#logPoll) clearInterval(this.#logPoll)
    this.#retry = null
    this.#logPoll = null
  }
}

/** `work` over every item, `limit` at a time, answers in the items' order. */
async function inBatches<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (let start = 0; start < items.length; start += limit) {
    results.push(...(await Promise.all(items.slice(start, start + limit).map(work))))
  }
  return results
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

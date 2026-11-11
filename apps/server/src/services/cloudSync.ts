import fsp from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  bucketPlace,
  HASH_NAMED_FOLDERS,
  messageOf,
  CLOUD_FORMAT_UNREADABLE,
  cloudFormatProblem,
  isCloudFormat,
  newCloudFormatText,
  FORMAT_KEY,
  LOG_FOLDER,
  SNAPSHOTS_FOLDER,
  audioKey,
  coverKey,
  isReplacedWholeKey,
  foldedLogKeys,
  detectLyricsLanguage,
  isSynced,
  motionKey,
  newestSnapshotKey,
  othersSnapshotsToPrune,
  parseEndpoint,
  parseLogKey,
  parseSnapshotKey,
  lyricTextLines,
  parseLyrics,
  readLogFile,
  snapshotFileKeys,
  snapshotKey,
  snapshotsToPrune,
  parseCloudWords,
  wordsKey,
  unfoldedLogKeys,
  type Change,
  type CloudConnect,
  type CloudLyrics,
  type CloudSnapshot,
  type CloudWords,
  type CloudStatus,
  type DoormanMe,
  type CloudServer,
  SIGN_IN_TTL_MS,
} from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { StorageDriver } from '../storage/index.js'
import { CloudError, S3CloudStore, type CloudStore } from '../bucket/store.js'
import { LocalCloudStore } from '../bucket/local.js'
import { DoormanClient } from '../bucket/doorman.js'
import type { KeptCloudFiles } from '../bucket/kept.js'
import { debounce, type Debounced } from './debounce.js'
import { importPacer, type ImportPacer } from './importPacing.js'
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
import type { ArtistBackdropService } from './artistBackdrops.js'
import type { ArtistNameLookup } from './artistNames.js'
import type { SpellingService } from './spellings.js'
import type { NamesRepository } from '../repositories/names.js'
import { removeFolderIfEmpty } from './libraryLayout.js'
import { CloudPictures } from './cloudPictures.js'
import { audioSignature, NO_FILE_SIGNATURE, tagsLyricsSignature } from './cloudSignatures.js'
import type { LyricsService } from './lyrics.js'
import type { MetadataService } from './metadata.js'
import type { MotionStore } from './motionStore.js'
import type { SoundMapService } from '../sound/soundMap.js'
import type { SoundService } from '../sound/sound.js'
import type { PlaysArchive } from './playsArchive.js'
import { CloudLibraryFiles } from './cloudLibraryFiles.js'
import {
  buildSnapshot,
  parseSnapshot,
  publishRefusedMessage,
  publishUncheckableMessage,
  publishWouldLoseLibrary,
  snapshotContentHash,
  snapshotCoreHash,
  snapshotSongCount,
  storedSnapshotContentHash,
  storedSnapshotCoreHash,
} from './cloudSnapshot.js'
import type { AdoptionResult, CloudAdopt } from './cloudAdopt.js'
import { sha256 } from '../util/hash.js'

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
 * database query and a few stats per song, a batch of songs at a time.
 *
 * The bucket is the library and this server keeps no copy of it. So a pass
 * ends by letting go: the audio of every song that is wholly in the bucket,
 * analysed, and in the snapshot just written is deleted from this disk; and
 * the files of songs removed since the last pass, waiting in `cloud_trash`,
 * are deleted from the bucket once no song names them.
 */

/** How long after a change a pass starts, so a burst of changes is one pass. */
const DEFAULT_DEBOUNCE_MS = 4_000

/** After a pass fails outright — offline, or the key refused — try again after these. */
const FIRST_RETRY_MS = 60_000
const RETRY_DELAYS_MS = [FIRST_RETRY_MS, 120_000, 300_000, 900_000, 1_800_000]

/**
 * How long a copy here has to have been left alone before a pass sends it,
 * and before it lets it go. Something may still be writing it: an encoder
 * fed slowly, a copy over a slow link. Sent too soon, the bucket has part of
 * the song; let go too soon, the writer goes on into a file nothing names,
 * and the rest of the song is lost (bug bash R4 NEW). Until it is sent, a
 * change to the copy is the song changing (scanner.ts); after, it is
 * another song beside it, but nothing is lost while the copy is here. An
 * import's own download is sent at once (`uploadSong`): this server wrote it.
 */
const SEND_WHEN_STILL_MS = 60_000
const LET_GO_WHEN_STILL_MS = 10 * 60_000

/** Snapshots this server keeps in the bucket; older ones are deleted. */
const SNAPSHOTS_KEPT = 3
/** Passes in a row a log file is found broken before the server goes past it (`#givenUpOn`). */
const BROKEN_LOG_PASSES = 3

/**
 * How often to look for changes other devices have written. One listing of
 * the log folder; a pass only follows when there is something new. Every
 * three minutes was 480 listings a day with nothing happening, a fifth of
 * the bucket's free allowance; devices write logs rarely, and the server
 * also reads them at its next pass, so a tag edited on a phone reaches the
 * server's own library within ten minutes at the latest.
 */
const LOG_POLL_MS = 10 * 60_000

/**
 * With a change counter (the doorman's `/v1/changes`), a listing of the log
 * folder that the counter says would find what the last one did is not made
 * — for at most this long, after which the folder is listed anyway. The
 * counter only sees what goes through the doorman; a device given the
 * bucket's key directly could write a log it never counts.
 */
const LOG_LISTING_TRUSTED_MS = 30 * 60_000

/**
 * Log files a snapshot of this server's has folded in are deleted once it has
 * been up this long, so a device that listed the log folder just before it
 * went up has read what it listed, and this many at a time. This server is
 * the only one that deletes a log file (docs/SYNC.md, "Tidying up"): it alone
 * knows when nothing needs one any more.
 */
const LOGS_TIDIED_AFTER_MS = 10 * 60_000
const LOGS_TIDIED_AT_ONCE = 100

/**
 * Another server's snapshots, read by nobody once any newer one is up, are
 * deleted once they are this old: a server that moved to another computer
 * left its last three behind for good.
 */
const OTHERS_SNAPSHOTS_KEPT_MS = 30 * 24 * 60 * 60_000

/**
 * Audio and words in the bucket that nothing names and nothing put in the
 * trash go once this server has known of them this long: what an import that
 * failed halfway uploaded, or a server that lost its database left behind.
 */
const ORPHANS_KEPT_MS = 30 * 24 * 60 * 60_000

/**
 * A snapshot that changes nothing but what arrives after a song does — its
 * cover's colour, its motion curve and analysis, the sound vectors' pointer,
 * artists' pictures (`snapshotCoreHash`) — waits this long to be published,
 * and goes up then with all of them. Each of those used to be a snapshot of
 * its own: after an import, a cover's colour for each song, then the motion
 * curves, then the vectors, every one a download for every device. Anything
 * else that changes publishes at once, and takes them with it.
 */
const ENRICHMENT_DEFER_MS = 10 * 60_000

/** How long a listing the idle poll made is good for the pass it starts. */
const POLLED_LISTING_KEPT_MS = 60_000

const LOG_READS_AT_ONCE = 6

/** Songs whose files are looked at together while a pass works out what changed. */
const SIGNATURES_AT_ONCE = 16

/** How often to ask the doorman whether Google has finished: for as long as a sign-in lasts (`SIGN_IN_TTL_MS`). */
const SIGN_IN_POLL_MS = 2_000

/** The part of the doorman the sync uses. Tests hand in a fake. */
export type Doorman = Pick<
  DoormanClient,
  'url' | 'claim' | 'me' | 'connectStorage' | 'signOut' | 'store'
>

interface Signatures {
  readonly audio: string
  readonly cover: string
  readonly lyrics: string
  /** The motion curve file's size and time, or `none` before analysis has made one. */
  readonly motion: string
  /** Whether the audio is on this disk: what a changed audio signature needs to be sent from. */
  readonly audioHere: boolean
  /** Whether a lyric sidecar is on this disk beside it. */
  readonly sidecarHere: boolean
}

/** A song wholly in the bucket as it is here, and what of it this disk still holds. */
interface Settled {
  readonly file: SongFileInfo
  readonly audioHere: boolean
  readonly sidecarHere: boolean
}

/** A song's words file in the bucket: the text and its romanized lines (`wordsKey`). */
interface UploadedLyrics {
  readonly key: string
  readonly size: number
  readonly kind: CloudLyrics['kind']
}

/** Whether a lyric text is Chinese or Japanese: words that should have romanized lines. */
function wantsRomanized(text: string): boolean {
  const parsed = parseLyrics(text)
  const lines = lyricTextLines(parsed)
  return detectLyricsLanguage(lines) !== 'none'
}

interface CloudSyncDeps {
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
   * (services/romanizedLines.ts), uploaded in the words' own file. Null when the
   * words need none or the dictionary would not load. Absent where romaji is
   * not what is being tested, which then uploads none.
   */
  readonly romanize?: (songId: number, text: string) => Promise<string[] | null>
  /**
   * Each song's motion curve (services/motionStore.ts), uploaded beside the
   * words. Analysis usually finishes after a song's first upload, so the
   * curve's own signature is what brings a song back into a later pass.
   * Absent where curves are not what is being tested, which then uploads none.
   */
  readonly motion?: Pick<MotionStore, 'stat' | 'bytes'>
  /**
   * Artists' pictures (services/artistBackdrops.ts): looked for after each
   * pass, and put in the bucket beside the covers by the next, so every device
   * keeps them as it keeps a cover. Absent where pictures are not what is
   * being tested, which then publishes none.
   */
  readonly artists?: Pick<ArtistBackdropService, 'artists' | 'keptPair' | 'fill'>
  /**
   * What search finds things by (packages/shared/src/searchNames.ts): the names
   * artists also go by, looked up after each pass as pictures are, and every
   * Chinese and Japanese name spelt in Latin letters before each snapshot, so
   * a new song goes up spelt. Absent where names are not what is being tested,
   * which then publishes none.
   */
  readonly names?: {
    readonly repo: Pick<NamesRepository, 'artistNames'>
    readonly spellings: Pick<SpellingService, 'fill' | 'current'>
    readonly lookup: Pick<ArtistNameLookup, 'fill'>
  }
  /**
   * Every song's sound vector (sound/sound.ts), as one file in the bucket
   * beside the words, so the vectors outlive this server's database. Absent
   * where vectors are not what is being tested, which then sends none.
   */
  readonly sound?: Pick<SoundService, 'model' | 'hearing' | 'packSignature' | 'pack' | 'restore'>
  /**
   * Where every heard song sits on the sound map (sound/soundMap.ts), as one
   * small file beside the vectors, for devices to draw. Absent where the map
   * is not what is being tested, which then sends none.
   */
  readonly soundMap?: Pick<SoundMapService, 'file' | 'refresh' | 'adopt'>
  /**
   * When each song was played, a file a month beside the words
   * (services/playsArchive.ts), so the history outlives this server's
   * database. Absent where plays are not what is being tested.
   */
  readonly plays?: PlaysArchive
  /**
   * The bucket's words, kept on this disk once sent or read (bucket/kept.ts),
   * so the server's own reads of them — the search index and romaji at every
   * start, a device asking for a song's lyrics — cost the bucket nothing after
   * the first. Absent where that is not what is being tested.
   */
  readonly kept?: KeptCloudFiles
  /** Other devices' changes: where this server keeps how far it has read, and what applies them. */
  readonly sync?: SyncRepository
  readonly ingest?: CloudIngest
  /**
   * What takes on the library already in the bucket before this server
   * publishes over it (services/cloudAdopt.ts). Absent where adoption is not
   * what is being tested, which then publishes only what this server holds.
   */
  readonly adopt?: CloudAdopt
  /**
   * Whether analysis is done with a song (repositories/audioFeatures.ts): the
   * last thing that needs its audio on this disk, so the last thing asked
   * before the copy here is let go. Absent, no copy is ever let go — for tests
   * of everything else, which read the files back.
   */
  readonly analysed?: (songId: number) => boolean
  /**
   * Whether a song's cover is still to be read out of its copy here, having
   * failed to be kept the first time (`SongRepository.coverToRead`): the copy
   * is the only place it is, so it stays till then.
   */
  readonly coverToRead?: (songId: number) => boolean
  /**
   * A folder to use as the bucket instead of an account (bucket/local.ts).
   * Connected from the start and never saved; signing in and connecting are
   * refused while it is set.
   */
  readonly cloudDir?: string
  /** Links other devices asked to import: how each is going goes in every snapshot. */
  readonly importRequests?: ImportRequestRepository
  /**
   * Where this server listens right now, for the snapshot, so a device near it
   * can import through it. Asked each time, since an address can change
   * while the library does not; the poll republishes when one has.
   */
  readonly server?: () => CloudServer
  /** How a bucket client is made for a connection. Tests hand in a memory bucket. */
  readonly openStore?: (connection: CloudConnection) => CloudStore
  /** The doorman to sign in through; empty or absent for none. */
  readonly doormanUrl?: string
  /**
   * The doorman stopped taking this server's session: it was signed out, or
   * the account took its grant back (docs/features/shared-server.md). A server
   * working for several accounts lets that account's library go.
   */
  readonly sessionEnded?: () => void
  readonly openDoorman?: (url: string) => Doorman
  readonly debounceMs?: number
  /**
   * How soon a run of imports publishes its first snapshot, and how far apart
   * the ones after it are (services/importPacing.ts). Tests make them short.
   */
  readonly importPacing?: Parameters<typeof importPacer>[1]
  /**
   * Publish this server's library as it stands (`SELFMP3_PUBLISH_ANYWAY`):
   * no adoption first, and no refusing to replace a bigger library.
   */
  readonly publishAnyway?: boolean
  readonly now?: () => Date
  readonly signInPollMs?: number
  readonly logPollMs?: number
  /** How long a pass that did not get everything up waits before the next: a step per failure. */
  readonly retryDelaysMs?: readonly number[]
  /** How long a snapshot of nothing but enrichment waits (`ENRICHMENT_DEFER_MS`); a test's own. */
  readonly enrichmentDeferMs?: number
  /** `SEND_WHEN_STILL_MS` and `LET_GO_WHEN_STILL_MS`; tests that write a copy and send it at once make them 0. */
  readonly stillMs?: { readonly send: number; readonly letGo: number }
}

/**
 * What became of a publish: a snapshot written, none needed (it would say what
 * the last did), or held back because all it adds is enrichment.
 */
type PublishOutcome = 'published' | 'unchanged' | 'deferred'

export class CloudSyncService {
  readonly #deps: CloudSyncDeps
  readonly #logger: Logger
  readonly #openStore: (connection: CloudConnection) => CloudStore
  readonly #doorman: Doorman | null
  readonly #now: () => Date
  readonly #signInPollMs: number
  readonly #logPollMs: number
  readonly #retryDelaysMs: readonly number[]
  readonly #enrichmentDeferMs: number
  readonly #stillMs: { readonly send: number; readonly letGo: number }

  /**
   * Called after a pass has applied other devices' changes, so the library
   * version moves and the files of songs removed elsewhere go too.
   */
  onIngested: ((result: IngestResult) => void | Promise<void>) | null = null
  /**
   * A copy here was found written to since the sweep read it. What was read
   * is not sent or let go; the sweep reads it again (`ScannerService.lookAgain`).
   */
  onCopyChanged: (() => void) | null = null

  /** Where uploads go, for display and for the bookkeeping's sake. */
  #target: CloudStatus['target'] = null
  #store: CloudStore | null = null
  /** Signed in through the doorman: the session, and what it last said about the account. */
  #session: DoormanSession | null = null
  /** A sign-in started from this server that Google has not finished yet. */
  #signIn: { attempt: string; until: number; needsCode: boolean } | null = null
  #signInTimer: NodeJS.Timeout | null = null
  /** Bumped on every connect and disconnect, so a pass for an old bucket stops. */
  #generation = 0
  #formatChecked = false
  /** Whether the bookkeeping has been checked against the bucket's own listing. */
  #verified = false
  /**
   * Whether the library already in this bucket has been taken on. Once per
   * bucket, before anything this server writes can replace it; a pass in
   * flight and a publish arriving from an import share the one attempt.
   */
  #adopted = false
  /** Whether covers nothing names have been put in the trash, once per bucket listing. */
  #coversSwept = false
  /**
   * Audio and words nothing names are to be looked for, once per bucket
   * listing, by the first pass that reads every log (`#trashOrphans`).
   */
  #orphansDue = false
  /**
   * How far into each device's log every play this server has read is in the
   * bucket's months of plays (`CloudLibraryFiles.uploadPlays`), or null before that is known.
   * A log file whose plays are only in this database is not deleted: a
   * database lost before this month's file went up would lose them for good.
   */
  #playsCovered: Readonly<Record<string, number>> | null = null
  /** How many passes in a row found each broken log file broken (`#givenUpOn`). */
  readonly #brokenLogs = new Map<string, number>()
  /**
   * The files each snapshot in the bucket names, by its key: a snapshot never
   * changes once written, so asking again which files the kept ones name is
   * a listing, not a read of each (`#namedBySnapshots`).
   */
  readonly #snapshotFiles = new Map<string, Set<string>>()
  /** The sound vectors, the sound map and the months of plays in the bucket. */
  readonly #libraryFiles: CloudLibraryFiles
  /** Artists' pictures and the packs of covers in the bucket. */
  readonly #pictures: CloudPictures
  /** The pass for copies here not yet still for long enough to send or let go, and when it is due. */
  #stillTimer: NodeJS.Timeout | null = null
  #stillAt = 0
  #adopting: Promise<void> | null = null
  #preparing: Promise<void> | null = null

  #running: Promise<void> | null = null
  #again = false
  readonly #kickDebounce: Debounced
  /** The snapshots of a run of imports, paced (services/importPacing.ts). */
  readonly #publishLater: ImportPacer
  /**
   * The snapshot folder as last listed, kept up to date with what this
   * device writes and deletes, so pruning needs no listing of its own after
   * the first: one counted call per snapshot, gone.
   */
  #snapshotKeys: string[] | null = null
  /**
   * The change counter as it stood before the last listing of the log folder
   * whose every new file was read, and when that listing was made. A counter
   * that has not moved since — but for this server's own writes — means the
   * folder holds nothing more to read.
   */
  #logsListed: { changes: string; at: number } | null = null
  /** A listing of the log folder the idle poll made, for the pass it starts, and when. */
  #logListing: { keys: string[]; changes: string | null; at: number } | null = null
  /**
   * The bucket's newest snapshot as the pass `pass` read it: adoption reads
   * it, and the guard before this run's first snapshot and the pruning after
   * it use the same listing and bytes rather than asking again.
   */
  #newestRead: {
    pass: number
    keys: string[]
    newest: { key: string; body: Buffer } | null
  } | null = null
  #passes = 0
  /**
   * The bucket's newest snapshot when it is this server's own — read at
   * adoption, or just published — with what it folded in: what other
   * devices' logs are tidied by.
   */
  #ownNewest: {
    key: string
    writtenAt: number
    upTo: Readonly<Record<string, number>>
    /** How far its months of plays reach into each log (`#playsCovered` when it went up). */
    playsUpTo: Readonly<Record<string, number>> | null
  } | null = null
  #retry: NodeJS.Timeout | null = null
  #retryIndex = 0
  #logPoll: NodeJS.Timeout | null = null
  #stopped = false

  /** Publishing is one at a time: the import step and a pass can both ask. */
  #publishing: Promise<unknown> = Promise.resolve()
  /**
   * Bucket deletions in flight, by key. An upload of the same bytes during one
   * waits for it, so a file is never taken for present because it was about
   * to be gone (`#putOnce`).
   */
  readonly #deleting = new Map<string, Promise<void>>()
  #lastSnapshotHash: string | null = null
  /** `snapshotCoreHash` of the last snapshot published. */
  #lastCoreHash: string | null = null
  /** Set when held-back enrichment is due: the next publish writes it. */
  #enrichmentDue = false
  #enrichmentTimer: NodeJS.Timeout | null = null
  /** The addresses the last snapshot carried, to notice when the server has moved. */
  #publishedServer: string | null = null

  #state: CloudStatus['state'] = 'off'
  #progress: CloudStatus['progress'] = null
  #lastSyncAt: string | null = null
  #lastSnapshotAt: string | null = null
  #lastError: string | null = null
  /**
   * Whether this library has been checked against the one in the bucket. Once
   * per bucket: after a snapshot from here goes up, the bucket's newest is this
   * device's own, and comparing it with itself proves nothing. A refusal leaves
   * it unset, so every pass asks again until the bucket agrees.
   */
  #checkedAgainstBucket = false

  constructor(deps: CloudSyncDeps) {
    this.#deps = deps
    this.#logger = deps.logger.child('cloud')
    this.#openStore = deps.openStore ?? (connection => new S3CloudStore(connection))
    const openDoorman = deps.openDoorman ?? ((url: string) => new DoormanClient(url))
    this.#doorman = deps.doormanUrl ? openDoorman(deps.doormanUrl) : null
    // The shared debounce, for its ceiling: a steady drip of edits — a big
    // import tagging as it goes — still gets a pass during the burst rather
    // than only once it ends.
    this.#kickDebounce = debounce(() => void this.#pass(), deps.debounceMs ?? DEFAULT_DEBOUNCE_MS)
    this.#publishLater = importPacer(() => {
      const store = this.#store
      if (store && !this.#stopped) {
        this.#publish(store).catch(error => {
          this.#logger.warn('could not publish the imports’ snapshot', {
            message: messageOf(error),
          })
        })
      }
    }, deps.importPacing)
    this.#now = deps.now ?? (() => new Date())
    this.#signInPollMs = deps.signInPollMs ?? SIGN_IN_POLL_MS
    this.#logPollMs = deps.logPollMs ?? LOG_POLL_MS
    this.#retryDelaysMs = deps.retryDelaysMs ?? RETRY_DELAYS_MS
    this.#enrichmentDeferMs = deps.enrichmentDeferMs ?? ENRICHMENT_DEFER_MS
    this.#stillMs = deps.stillMs ?? { send: SEND_WHEN_STILL_MS, letGo: LET_GO_WHEN_STILL_MS }
    this.#libraryFiles = new CloudLibraryFiles({
      cloud: deps.cloud,
      logger: this.#logger,
      now: this.#now,
      putOnce: (store, key, data, contentType) => this.#putOnce(store, key, data, contentType),
      kick: () => this.kick(),
      stopped: () => this.#stopped,
      ...(deps.sound ? { sound: deps.sound } : {}),
      ...(deps.soundMap ? { soundMap: deps.soundMap } : {}),
      ...(deps.plays ? { plays: deps.plays } : {}),
    })
    this.#pictures = new CloudPictures({
      cloud: deps.cloud,
      covers: deps.covers,
      logger: this.#logger,
      putOnce: (store, key, data, contentType) => this.#putOnce(store, key, data, contentType),
      stopped: () => this.#stopped,
      ...(deps.artists ? { artists: deps.artists } : {}),
    })
    if (deps.cloudDir) this.#useFolder(deps.cloudDir)
  }

  get connected(): boolean {
    return this.#store !== null
  }

  /**
   * At boot: pick up where things were — signed in through the doorman, or
   * connected directly — and run a first pass.
   */
  start(): void {
    if (this.#deps.cloudDir) {
      this.#logger.info('publishing to a folder standing in for the bucket', {
        folder: this.#deps.cloudDir,
      })
      void this.#pass()
      return
    }
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
   * A song was heard (or given up on, or forgotten). Its vector goes up with
   * the next pass that may send the vectors: now, once every song has been
   * heard, or else when the hour since the last time is up.
   */
  soundChanged(): void {
    if (!this.#store || this.#stopped) return
    this.#libraryFiles.soundChanged()
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
      this.#adopted = false
      this.#coversSwept = false
      this.#libraryFiles.takeOn(null)
      this.#forgetBucketReads()
    }
    return this.#pass()
  }

  /** Resolves once no pass is running or waiting to follow one. */
  async whenIdle(): Promise<void> {
    while (this.#running) await this.#running
  }

  /** The bucket in use, for streaming a song this server holds no copy of. */
  bucket(): CloudStore | null {
    return this.#store
  }

  /**
   * A song's audio from the bucket: for analysis, once the copy here has gone.
   * Null with no bucket, or a song whose audio is not up yet.
   */
  async fetchAudio(songId: number): Promise<Buffer | null> {
    const store = this.#store
    const state = this.#deps.cloud.state(songId)
    if (!store || !state) return null
    return store.get(state.audioKey)
  }

  /**
   * A song's words from the bucket, once the sidecar here has gone: what the
   * lyrics routes, the search index and the romanization pass read. With the
   * romanized lines the words file carries beside them, so a server that did
   * not make them need not make them again (`keepRomanizedFromBucket`). Null
   * with no bucket, or a song the bucket holds no words for.
   */
  async fetchLyrics(
    songId: number,
  ): Promise<{ text: string; synced: boolean; romanized: string[] | null } | null> {
    const store = this.#store
    const state = this.#deps.cloud.state(songId)
    if (!store || !state?.lyricsKey) return null
    const key = state.lyricsKey
    const kept = this.#deps.kept
    let body = (await kept?.read(key)) ?? null
    if (!body) {
      body = await store.get(key)
      if (body) await kept?.keep(key, body)
    }
    const words = body ? parseCloudWords(body.toString('utf8')) : null
    return words
      ? { text: words.text, synced: state.lyricsKind === 'synced', romanized: words.romanized }
      : null
  }

  /**
   * Connect to a bucket. The key is tried before anything is saved — listed,
   * written, read back — so a mistake is reported while the form is still
   * open, as a message that says whether it was the key, the address or the
   * bucket. Throws `CloudError`.
   */
  async connect(input: CloudConnect): Promise<CloudStatus> {
    this.#refuseWithFolder()
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
    this.#refuseWithFolder()
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
    this.#refuseWithFolder()
    if (!this.#doorman) {
      throw new CloudError('other', 'No doorman is set up for this server to sign in through.')
    }
    this.#stopSignIn()
    this.#signIn = {
      attempt,
      until: this.#now().getTime() + SIGN_IN_TTL_MS,
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
      // Asked without a code, the doorman only ever says whether one is waiting.
      const result = await this.#doorman.claim(signIn.attempt)
      if (this.#signIn !== signIn) return
      if (result.status === 'code') this.#signIn = { ...signIn, needsCode: true }
    } catch (error) {
      // Google takes its time and networks drop: keep asking until the deadline.
      this.#logger.debug('sign-in not claimed yet', { message: messageOf(error) })
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
      this.#logger.warn('could not refresh the cloud account', { message: messageOf(error) })
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
    this.#deps.sessionEnded?.()
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
      songs: {
        total: totals.songs,
        inCloud: store ? totals.songsInCloud : 0,
      },
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
   *
   * With `more` imports still to come, the snapshot waits (`#publishLater`):
   * a run of songs is one snapshot every so often, further apart the longer
   * the run goes on, not one each. The last song of a run is published now.
   */
  async uploadSong(songId: number, { more = false }: { more?: boolean } = {}): Promise<void> {
    const store = this.#store
    if (!store) return
    const file = this.#deps.cloud.songFile(songId)
    if (!file) throw new Error('the song is no longer in the library')

    await this.#prepareBucket(store)
    await this.#uploadSongFiles(store, file, this.#deps.cloud.state(songId))
    if (more) {
      this.#publishLater.trigger()
      return
    }
    this.#publishLater.cancel()
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
    this.#passes++
    let failed = 0

    try {
      await this.#prepareBucket(store)
      if (generation !== this.#generation || this.#stopped) return

      // Other devices' changes next: a song removed elsewhere is not worth
      // uploading, and the snapshot at the end should say they are folded in.
      const logs = await this.#readLogs(store, generation)
      if (generation !== this.#generation || this.#stopped) return

      // Only by a pass that read every log there is to read: what nothing
      // names is decided against the whole library, never part of it.
      if (this.#orphansDue && logs.complete) {
        this.#orphansDue = false
        await this.#trashOrphans(store)
        if (generation !== this.#generation || this.#stopped) return
      }

      // Work out what changed first, so progress counts real work.
      const states = cloud.states()
      const files = cloud.songFiles()
      const signed = await inBatches(files, SIGNATURES_AT_ONCE, file =>
        this.#signatures(file, states.get(file.id) ?? null),
      )
      const changed: Array<{ file: SongFileInfo; signatures: Signatures }> = []
      /** Songs wholly in the bucket as they are here: what may be let go of below. */
      const settled: Settled[] = []
      let withoutCopy = 0
      let stillWriting = 0
      for (const [index, file] of files.entries()) {
        const state = states.get(file.id)
        const signatures = signed[index] as Signatures
        const { audioHere, sidecarHere } = signatures
        if (
          state &&
          state.audioSig === signatures.audio &&
          state.coverSig === signatures.cover &&
          state.lyricsSig === signatures.lyrics &&
          state.motionSig === signatures.motion
        ) {
          settled.push({ file, audioHere, sidecarHere })
          continue
        }
        // New audio has to be read from a copy here. A cover, a curve or the
        // words can go up without it; a song whose audio changed and whose
        // copy has already gone is published as the bucket has it, and what
        // could not be sent for it is said once.
        if ((!state || state.audioSig !== signatures.audio) && !signatures.audioHere) {
          withoutCopy++
          continue
        }
        // A copy something may still be writing is sent once it has been
        // left alone a while, and a pass comes back for it then.
        if (!state || state.audioSig !== signatures.audio) {
          const wait = stillIn(file.mtimeMs, this.#stillMs.send)
          if (wait > 0) {
            stillWriting++
            this.#passOnceStill(wait)
            continue
          }
        }
        changed.push({ file, signatures })
      }
      if (withoutCopy > 0) {
        this.#logger.debug('songs with something to send and no copy here to send it from', {
          songs: withoutCopy,
        })
      }
      if (stillWriting > 0) {
        this.#logger.debug('songs whose copies changed a moment ago, sent once left alone', {
          songs: stillWriting,
        })
      }

      const total = changed.length
      let done = 0
      /** Copies found written to since the sweep read them: not sent, and not failures either. */
      let notAsRead = 0
      this.#progress = { done, total, current: null }
      for (const { file, signatures } of changed) {
        if (generation !== this.#generation || this.#stopped) return
        this.#progress = { done, total, current: file.title }
        try {
          await this.#uploadSongFiles(store, file, states.get(file.id) ?? null, signatures)
          settled.push({
            file,
            audioHere: signatures.audioHere,
            sidecarHere: signatures.sidecarHere,
          })
        } catch (error) {
          // Offline, a refused key, no bucket, a used-up cap, a bucket asking
          // for fewer requests: nothing else will work either, and every try
          // against a cap or a busy bucket is one more call.
          if (error instanceof CloudError && error.kind !== 'other') throw error
          // Written to since the sweep read it: not sent, and not a failure.
          // The sweep reads it again once it is still, and that sends it.
          if (error instanceof CopyChanged) {
            this.#logger.info('a copy changed since it was read; it goes up once read again', {
              path: file.path,
            })
            this.onCopyChanged?.()
            notAsRead++
            done++
            this.#progress = { done, total, current: null }
            continue
          }
          // Removed while the pass was sending it, its copy with it: what was
          // asked, not a failure to try again over.
          if (this.#deps.cloud.songFile(file.id)) {
            failed++
            this.#lastError = `${file.title}: ${messageOf(error)}`
            this.#logger.warn('could not upload a song', {
              songId: file.id,
              message: messageOf(error),
            })
          }
        }
        done++
        this.#progress = { done, total, current: null }
      }

      if (generation !== this.#generation || this.#stopped) return
      await this.#pictures.uploadArtists(store)
      if (generation !== this.#generation || this.#stopped) return
      await this.#pictures.uploadCoverPacks(store)
      if (generation !== this.#generation || this.#stopped) return
      await this.#libraryFiles.uploadSound(store)
      if (generation !== this.#generation || this.#stopped) return
      await this.#libraryFiles.uploadSoundMap(store)
      if (generation !== this.#generation || this.#stopped) return
      if (await this.#libraryFiles.uploadPlays(store))
        this.#playsCovered = this.#deps.sync?.cursors() ?? {}

      if (generation !== this.#generation) return
      const outcome = await this.#publish(store)

      // Held back, the snapshot in the bucket is still the one before: a file
      // this pass replaced is still named there, so nothing is let go or
      // deleted until the held snapshot goes up, with a pass of its own.
      if (outcome !== 'deferred') {
        const finished = this.#deps.imports.finishUploaded()
        if (finished > 0)
          this.#logger.info('finished imports that were waiting to upload', { count: finished })

        // Only now, with the snapshot up: what this disk holds of the library
        // is no longer needed here, what the library no longer names is no
        // longer needed in the bucket, and nothing can take a removed song back.
        cloud.forgetRemoved()
        await this.#letGo(store, settled)
        if (generation !== this.#generation || this.#stopped) return
        await this.#emptyTrash(store)
        if (generation !== this.#generation || this.#stopped) return
        await this.#tidyLogs(store, logs.keys)
      }

      if (changed.length > notAsRead) {
        this.#logger.info('cloud pass complete', {
          uploaded: changed.length - notAsRead - failed,
          failed,
        })
      }
      // The names artists also go by, for any nobody has named: found ones go
      // up with the pass this starts.
      void this.#deps.names?.lookup
        .fill()
        .then(found => {
          if (found > 0 && !this.#stopped) this.kick()
        })
        .catch((error: unknown) => {
          this.#logger.warn('could not look up artists’ names', { message: messageOf(error) })
        })
      // Pictures for artists that have none yet, in the background: one found
      // is put in the bucket by the pass this starts.
      void this.#deps.artists
        ?.fill()
        .then(found => {
          if (found > 0 && !this.#stopped) this.kick()
        })
        .catch((error: unknown) => {
          this.#logger.warn('could not look for artists’ pictures', { message: messageOf(error) })
        })
      this.#lastSyncAt = this.#now().toISOString()
      if (failed === 0 && logs.unreadable === 0) {
        this.#retryIndex = 0
        this.#state = 'idle'
        this.#lastError = null
      } else if (failed === 0) {
        // A device's log this server cannot use, said for what it is
        // (`#readLog` kept the words) rather than as songs that would not go
        // up. Nothing here is waited out: the next look at the log folder
        // reads it again, and a server that is updated reads it at last.
        this.#retryIndex = 0
        this.#state = 'error'
      } else {
        // The bucket refused some songs and took the rest: a full bucket, or
        // a doorman past its day's quota. Nothing about the library will
        // change that, so no kick is coming; the pass comes back by itself,
        // as it would had the whole bucket been out of reach.
        this.#state = 'error'
        this.#tryAgainLater('some songs could not be uploaded')
      }
    } catch (error) {
      if (generation !== this.#generation) return
      if (error instanceof CloudError && error.kind === 'auth' && this.#session) {
        // Trying again will not bring a dead session back; signing in will.
        this.#sessionEnded(error)
        return
      }
      this.#state = 'error'
      this.#lastError = messageOf(error)
      this.#tryAgainLater(this.#lastError)
    } finally {
      if (generation === this.#generation) this.#progress = null
    }
  }

  /** A pass that did not get everything up runs again, later each time it happens. */
  #tryAgainLater(why: string): void {
    if (this.#stopped) return
    const delays = this.#retryDelaysMs
    const delay = delays[Math.min(this.#retryIndex, delays.length - 1)] ?? FIRST_RETRY_MS
    this.#retryIndex++
    this.#logger.warn('cloud pass failed, will try again', {
      message: why,
      inSeconds: delay / 1000,
    })
    if (this.#retry) clearTimeout(this.#retry)
    this.#retry = setTimeout(() => {
      this.#retry = null
      void this.#pass()
    }, delay)
    this.#retry.unref()
  }

  /**
   * Fold in the log files other devices have written since the last pass,
   * all in one transaction with the cursors that say they have been. Says
   * how many devices' logs could not be read to the end — a file this build
   * does not understand stops that device's log there, rather than skipping
   * a change for good, until this server is updated — and the folder's keys,
   * when it was listed rather than known unchanged.
   */
  async #readLogs(
    store: CloudStore,
    generation: number,
  ): Promise<{ unreadable: number; keys: string[] | null; complete: boolean }> {
    const { sync, ingest } = this.#deps
    if (!sync || !ingest) return { unreadable: 0, keys: null, complete: true }
    const listing = await this.#listLogs(store)
    if (!listing) return { unreadable: 0, keys: null, complete: true }
    const { keys } = listing
    const own = this.#deviceId()
    const pending = unfoldedLogKeys(keys, sync.cursors()).filter(
      key => parseLogKey(key)?.deviceId !== own,
    )
    if (pending.length === 0) {
      this.#readAllLogs(listing)
      return { unreadable: 0, keys, complete: true }
    }

    const read = await inBatches(pending, LOG_READS_AT_ONCE, key => this.#readLog(store, key))
    if (generation !== this.#generation) return { unreadable: 0, keys: null, complete: false }

    const changes: Change[] = []
    const reached = new Map<string, number>()
    const stuck = new Set<string>()
    let unreadable = 0
    // In each device's order: past a file that cannot be used, nothing of that device's counts.
    pending.forEach((key, index) => {
      const where = parseLogKey(key)
      const file = read[index]
      if (!where || stuck.has(where.deviceId)) return
      if (file === 'broken' && this.#givenUpOn(key)) {
        // Read as nothing: its changes are lost, and the device's later ones count.
        reached.set(where.deviceId, where.seq)
        return
      }
      if (file === 'gone' || file === 'broken' || file === 'newer') {
        stuck.add(where.deviceId)
        if (file !== 'gone') unreadable++
        return
      }
      this.#brokenLogs.delete(key)
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
    // A file gone since the listing means a newer snapshot has it: list again next time.
    if (stuck.size === 0) this.#readAllLogs(listing)
    return { unreadable, keys, complete: stuck.size === 0 }
  }

  /**
   * The log folder's keys — or null when the change counter says it holds
   * nothing that was not there at the last listing, every new file of which
   * was read. A listing is a counted call on the bucket; asking the counter
   * is not. A counter that cannot be asked is no answer, and the folder is
   * listed as it always was.
   */
  async #listLogs(
    store: CloudStore,
  ): Promise<{ keys: string[]; changes: string | null; at: number } | null> {
    const at = this.#now().getTime()
    const polled = this.#logListing
    this.#logListing = null
    if (polled && at - polled.at < POLLED_LISTING_KEPT_MS) return polled

    const changes = await store.changes().catch((error: unknown) => {
      this.#logger.debug('could not ask the change counter', { message: messageOf(error) })
      return null
    })
    const listed = this.#logsListed
    if (
      changes !== null &&
      listed !== null &&
      store.followOwn(listed.changes) === changes &&
      at - listed.at < LOG_LISTING_TRUSTED_MS
    ) {
      return null
    }
    // Asked before the listing, so a log written while it runs moves the
    // counter past the one kept here, and the next pass lists again.
    const keys = (await store.list(LOG_FOLDER)).map(object => object.key)
    return { keys, changes, at }
  }

  /** Every new file of this listing was read: until the counter moves, there is nothing more. */
  #readAllLogs(listing: { changes: string | null; at: number }): void {
    this.#logsListed =
      listing.changes === null ? null : { changes: listing.changes, at: listing.at }
  }

  /**
   * Delete the log files this server's snapshot has folded in, once it has
   * been up long enough, and once every play in them is in the months of
   * plays that snapshot names. Only while that snapshot is still the bucket's
   * newest — another server's could fold in less — so the snapshots folder is
   * listed first, and only when there is something to do. Best effort: a file
   * left behind costs a line in a listing.
   *
   * A device's unsent changes are never in a file this deletes: they are in
   * its outbox, on the device, and go up under numbers past anything a
   * snapshot has folded in (docs/SYNC.md, "Tidying up").
   */
  async #tidyLogs(store: CloudStore, keys: string[] | null): Promise<void> {
    const own = this.#ownNewest
    if (!keys || !own || this.#now().getTime() - own.writtenAt < LOGS_TIDIED_AFTER_MS) return
    const covered = this.#deps.plays ? own.playsUpTo : own.upTo
    if (!covered) return
    const folded = foldedLogKeys(keys, lowest(own.upTo, covered)).slice(0, LOGS_TIDIED_AT_ONCE)
    if (folded.length === 0) return
    try {
      const newest = newestSnapshotKey(
        (await store.list(SNAPSHOTS_FOLDER)).map(object => object.key),
      )
      if (newest !== own.key) return
      for (const key of folded) await store.delete(key)
      this.#logger.info('tidied away log files a snapshot has folded in', {
        files: folded.length,
      })
    } catch (error) {
      this.#logger.debug('could not tidy away old log files', { message: messageOf(error) })
    }
  }

  /**
   * One log file's changes. `gone` when it went between the listing and now —
   * a device tidies its files away once a snapshot has them, so the next pass
   * simply lists again; `newer` when a newer build wrote it, which updating
   * this server fixes; and `broken` when it is not a log file at all — cut
   * short, or not the file its name says — which nothing will ever fix, since
   * a file once written never changes (`#givenUpOn`). Either way the reason
   * is kept.
   */
  async #readLog(store: CloudStore, key: string): Promise<Change[] | 'gone' | 'broken' | 'newer'> {
    const where = parseLogKey(key)
    if (!where) return 'broken'
    const data = await store.get(key)
    if (!data) return 'gone'
    const read = readLogFile(parseJson(data))
    if (!read.ok || read.file.device !== where.deviceId || read.file.seq !== where.seq) {
      const broken = read.ok || read.reason === 'unreadable'
      this.#lastError = broken
        ? `A change log from ${where.deviceId} could not be read (${key}).`
        : `${where.deviceId} is writing changes this version of self.mp3 cannot read. Update this server.`
      this.#logger.warn('could not use a log file', { key, reason: this.#lastError })
      return broken ? 'broken' : 'newer'
    }
    if (read.skipped > 0) {
      this.#lastError = `${where.deviceId} is writing changes this version of self.mp3 cannot read. Update this server.`
      this.#logger.warn('a log file has changes this build does not know', {
        key,
        skipped: read.skipped,
      })
      return 'newer'
    }
    return [...read.file.changes]
  }

  /**
   * Whether to go past a broken log file (`#readLog`), and so lose what it
   * held, rather than hold back everything that device writes after it for
   * good. Not at the first sight of one: a read cut short by the network
   * looks the same once. A file broken on `BROKEN_LOG_PASSES` passes in a row
   * is broken for good.
   */
  #givenUpOn(key: string): boolean {
    const seen = (this.#brokenLogs.get(key) ?? 0) + 1
    if (seen < BROKEN_LOG_PASSES) {
      this.#brokenLogs.set(key, seen)
      return false
    }
    this.#brokenLogs.delete(key)
    this.#logger.warn('went past a change log that cannot be read; its changes are lost', { key })
    return true
  }

  /**
   * While the server sits idle, another device may write to its log. A look at
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
    // A pass is already coming back on its own: a look now is a listing
    // spent against a bucket that has just refused one.
    if (this.#retry) return
    try {
      const own = this.#deviceId()
      const listing = await this.#listLogs(store)
      if (listing) {
        const fresh = unfoldedLogKeys(listing.keys, sync.cursors()).some(
          key => parseLogKey(key)?.deviceId !== own,
        )
        if (fresh) {
          // The pass reads this listing rather than making its own.
          this.#logListing = listing
          void this.#pass()
          return
        }
        this.#readAllLogs(listing)
      }
      // A new Wi-Fi network is a new address, with nothing else about the
      // library to say: the snapshot goes up again so a device can still find
      // this server.
      if (this.#serverKey(this.#deps.server?.()) !== this.#publishedServer) {
        void this.#publish(store)
      }
    } catch (error) {
      // A session refused is not something to wait out: on a server working
      // for several accounts this look is how an idle library hears that its
      // account took the grant back, and lets the library go.
      if (error instanceof CloudError && error.kind === 'auth' && this.#session) {
        this.#sessionEnded(error)
        return
      }
      // The next look, or the next pass, will say what is wrong.
      this.#logger.debug('could not look for changes from other devices', {
        message: messageOf(error),
      })
    }
  }

  // --- Taking on the library that is already there -----------------------------

  /**
   * Everything that has to be true of the bucket before this server writes a
   * word to it, in the order it has to be true in: the format is one this
   * build may write; the bookkeeping matches what the bucket really holds; and
   * the library already in it has been taken on.
   *
   * Each step remembers it has run, so this costs one listing per bucket and
   * nothing thereafter. Adoption comes last because it needs the second step's
   * answer — which of the files the snapshot names the bucket still has.
   *
   * One flight at a time: a pass and a finishing import both come through
   * here, and a flag tested before an await and set after it would let the
   * second do the whole listing again while the first was still on it. So a
   * caller that finds a preparation under way waits for that one instead.
   */
  #prepareBucket(store: CloudStore): Promise<void> {
    return (this.#preparing ??= this.#prepareNow(store).finally(() => {
      this.#preparing = null
    }))
  }

  async #prepareNow(store: CloudStore): Promise<void> {
    await this.#ensureFormat(store)
    if (!this.#verified) {
      await this.#verify(store)
      this.#verified = true
      this.#orphansDue = true
    }
    await this.#adoptLibrary(store)
    if (!this.#coversSwept) {
      this.#coversSwept = true
      const trashed = this.#deps.cloud.trashUnnamedCovers()
      if (trashed > 0) {
        this.#logger.info('covers in the bucket that nothing names go once the snapshot is up', {
          covers: trashed,
        })
      }
    }
  }

  /**
   * Take on the bucket's library, once per bucket, before publishing to it.
   *
   * Without it, a server that holds nothing and signs in to a bucket that
   * holds fifty-two songs would publish its nothing as the whole library, and
   * every device would follow it. The guard (`#refuseToLoseLibrary`) stops
   * that, but stopping leaves "set this up on a new Mac and get my library
   * back" with nowhere to go.
   *
   * Everything here fails closed. "I could not read the bucket's library" must
   * never come out the far side as "the bucket has no library": that is the
   * reading that publishes over it. So a listing that will not answer, a
   * snapshot that has gone, one that will not parse — each throws, the pass
   * fails and retries, and nothing is published in the meantime.
   */
  async #adoptLibrary(store: CloudStore): Promise<void> {
    if (this.#adopted) return
    // Held in a local as well as the field: the field is cleared when the
    // attempt settles, and awaiting a field that a failure has already emptied
    // would read as "adopted, carry on" — which is the one answer this must
    // never give by accident.
    const attempt = (this.#adopting ??= this.#adoptNow(store).finally(() => {
      this.#adopting = null
    }))
    await attempt
  }

  async #adoptNow(store: CloudStore): Promise<void> {
    const adopt = this.#deps.adopt
    // The escape hatch is total: it is how you say "this server's library is
    // the one I want everywhere", and merging the bucket's into it first would
    // be the opposite of that.
    if (!adopt || this.#deps.publishAnyway) {
      this.#adopted = true
      return
    }

    const newest = await this.#newestSnapshot(store)
    if (!newest) {
      this.#libraryFiles.takeOn(null)
      this.#adopted = true
      return
    }

    let snapshot: CloudSnapshot
    let hash: string
    let coreHash: string
    try {
      snapshot = parseSnapshot(newest.body)
      hash = storedSnapshotContentHash(newest.body)
      coreHash = storedSnapshotCoreHash(newest.body)
    } catch (error) {
      throw new CloudError(
        'other',
        publishUncheckableMessage(`its newest snapshot would not read: ${messageOf(error)}`),
      )
    }
    this.#libraryFiles.takeOn({
      sound: snapshot.sound,
      soundMap: snapshot.soundMap ?? null,
      plays: snapshot.plays ?? [],
    })
    this.#pictures.takeOnCoverPacks(snapshot.coverPacks)
    if (snapshot.writtenBy === this.#deviceId()) {
      // This server's own, from before it last stopped. Said again word for
      // word, it would be one more download for every device and nothing new
      // in it: the next snapshot goes up when the library has moved on.
      this.#lastSnapshotHash = hash
      this.#lastCoreHash = coreHash
      this.#lastSnapshotAt = snapshot.writtenAt
      this.#ownNewest = {
        key: newest.key,
        writtenAt: Date.parse(snapshot.writtenAt),
        upTo: snapshot.upTo,
        // Not known from before this start: its logs wait for the next snapshot.
        playsUpTo: null,
      }
    }

    const result: AdoptionResult = await adopt.adopt(snapshot)
    const reclaimed = await this.#reclaimLetGo(snapshot)
    this.#adopted = true
    if (reclaimed > 0) {
      this.#logger.info('found songs already in the bucket that this server had lost track of', {
        from: newest.key,
        songs: reclaimed,
      })
    }
    if (result.logsFrom > 0) {
      this.#logger.info('reads each device’s log from where the bucket’s snapshot left off', {
        from: newest.key,
        devices: result.logsFrom,
      })
    }
    if (result.songs === 0 && result.tags === 0 && result.playlists === 0) return

    this.#logger.info('took on the library already in the bucket', {
      from: newest.key,
      songs: result.songs,
      tags: result.tags,
      playlists: result.playlists,
      ...(result.withoutAudio > 0 ? { withoutAudioInBucket: result.withoutAudio } : {}),
    })
    if (result.withoutAudio > 0) {
      this.#logger.warn('some songs in the bucket’s library have no audio in the bucket', {
        songs: result.withoutAudio,
      })
    }
  }

  /**
   * Songs this server has, whose copy here was let go, and that it has no
   * record of having sent: the bucket's snapshot says where their files are.
   *
   * What the pass knows about a bucket is forgotten when the bucket looks like
   * another one (`adoptTarget`) — a folder moved, an endpoint spelt another
   * way. Adoption leaves a song it already has alone, and with its copy here
   * gone the pass had nothing to send for it either, so it left every snapshot
   * and the guard refused to publish for good. The bucket still holds its
   * files, under the keys the snapshot gives, so they are this song's again,
   * with the signatures the pass works out for it here: unchanged to the pass.
   * A song whose copy is still here is sent the ordinary way.
   */
  async #reclaimLetGo(snapshot: CloudSnapshot): Promise<number> {
    const { cloud, storage, sync } = this.#deps
    if (!sync) return 0
    let reclaimed = 0
    for (const song of snapshot.songs) {
      const songId = sync.songId(song.uid)
      if (songId === null || cloud.wasRemoved(song.uid) || cloud.state(songId)) continue
      if (!cloud.hasFile(song.audio.key)) continue
      const file = cloud.songFile(songId)
      if (!file || (await storage.exists(file.path))) continue
      // Words kept nowhere here read as whatever was last sent (`#signatures`):
      // the bucket's, as the snapshot names them. A cover or curve here that
      // the snapshot has none of goes up (an empty signature matches nothing).
      const signatures = await this.#signatures(file)
      cloud.saveState({
        songId,
        audioKey: song.audio.key,
        audioSize: song.audio.size,
        audioSig: signatures.audio,
        coverKey: song.cover?.key ?? null,
        coverSize: song.cover?.size ?? null,
        coverSig: song.cover || !file.hasArt ? signatures.cover : '',
        lyricsKey: song.lyrics?.key ?? null,
        lyricsSize: song.lyrics?.size ?? null,
        lyricsKind: song.lyrics?.kind ?? null,
        lyricsSig: signatures.lyrics,
        motionKey: song.motion,
        motionSig: song.motion || signatures.motion === NO_FILE_SIGNATURE ? signatures.motion : '',
      })
      reclaimed++
    }
    return reclaimed
  }

  /**
   * Check the bookkeeping against the bucket's own listing: a thousand files
   * to a request, so a few requests for a whole library. Files can go from a
   * bucket without this server knowing — deleted by hand, or the bucket made
   * again under the same name — and a song that pointed at one goes up again.
   */
  async #verify(store: CloudStore): Promise<void> {
    const present = new Map<string, number>()
    for (const folder of HASH_NAMED_FOLDERS) {
      for (const object of await store.list(`${folder}/`)) present.set(object.key, object.size)
    }
    const again = this.#deps.cloud.reconcileFiles(present, this.#now())
    if (again > 0) {
      this.#logger.warn('files missing from the bucket, uploading those songs again', {
        songs: again,
      })
    }
  }

  /**
   * What a song's files look like now, in terms that change exactly when a
   * file does: the audio file's size and mtime (from its row — no disk access),
   * the cover's revision, the lyric sidecar's size and mtime, and the motion
   * curve's. Lyrics kept in the audio file's own tags change when the audio
   * file does. The curve is compared by a stat rather than by hashing it, as
   * the sidecar is: it is written whole and renamed into place, so a new curve
   * is always a new time, and a pass over an unchanged library reads no file.
   *
   * With neither a sidecar nor the audio here — the ordinary state, once the
   * pass has let both go — nothing here can have changed the words, and their
   * signature is whatever was sent: the bucket's words stand. The one thing
   * that can still change them is the row saying there are none (the words
   * were cleared by hand), which is `none`, and sends the song up without them.
   */
  async #signatures(file: SongFileInfo, state: CloudSongState | null = null): Promise<Signatures> {
    const audio = audioSignature(file.sizeBytes, file.mtimeMs)
    const cover = file.hasArt ? `art-${file.artRev}` : NO_FILE_SIGNATURE
    const curve = (await this.#deps.motion?.stat(file.id)) ?? null
    const motion = curve ? `motion-${curve.size}-${Math.round(curve.mtimeMs)}` : NO_FILE_SIGNATURE
    const audioHere = await this.#deps.storage.exists(file.path)
    const sidecar = await this.#deps.lyrics.findSidecar(file.path)
    if (!sidecar) {
      const lyrics = audioHere
        ? tagsLyricsSignature(audio)
        : file.lyricsKind === 'none'
          ? NO_FILE_SIGNATURE
          : (state?.lyricsSig ?? NO_FILE_SIGNATURE)
      return { audio, cover, lyrics, motion, audioHere, sidecarHere: false }
    }
    const stat = await this.#deps.storage.stat(sidecar.key)
    const lyrics = stat
      ? `sidecar${sidecar.extension}-${stat.sizeBytes}-${stat.modifiedAt.getTime()}`
      : tagsLyricsSignature(audio)
    return { audio, cover, lyrics, motion, audioHere, sidecarHere: true }
  }

  /** Upload whatever of one song's files the bucket does not have yet. */
  async #uploadSongFiles(
    store: CloudStore,
    file: SongFileInfo,
    state: CloudSongState | null,
    known?: Signatures,
  ): Promise<void> {
    const signatures = known ?? (await this.#signatures(file, state))

    let audio: { key: string; size: number }
    if (state && state.audioSig === signatures.audio) {
      audio = { key: state.audioKey, size: state.audioSize }
    } else {
      const data = await this.#deps.storage.read(file.path)
      // What was read is the song as the sweep read it, or it is not sent:
      // the row's size and time are what every later look compares with.
      const after = await this.#deps.storage.stat(file.path)
      if (
        data.length !== file.sizeBytes ||
        !after ||
        after.sizeBytes !== file.sizeBytes ||
        Math.floor(after.modifiedAt.getTime()) !== file.mtimeMs
      ) {
        throw new CopyChanged(file.path)
      }
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
          ? { key: state.lyricsKey, size: state.lyricsSize ?? 0, kind: state.lyricsKind }
          : null
    } else {
      const uploaded = await this.#uploadLyrics(store, file)
      lyrics = uploaded?.lyrics ?? null
      // Chinese or Japanese words that got no romaji this time are not done:
      // an empty signature never matches, so the next pass tries again.
      if (uploaded?.romanizedMissing) lyricsSig = ''
    }

    let motion: string | null
    if (state && state.motionSig === signatures.motion) {
      motion = state.motionKey
    } else {
      motion = await this.#uploadMotion(store, file)
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
      lyricsSig,
      motionKey: motion,
      motionSig: signatures.motion,
    })
  }

  async #uploadCover(
    store: CloudStore,
    file: SongFileInfo,
  ): Promise<{ key: string; size: number } | null> {
    if (!file.hasArt) return null
    const found = await this.#deps.covers.find(file.id)
    if (!found) return null
    const data = await fsp.readFile(found.path)
    const key = coverKey(sha256(data), path.extname(found.path))
    await this.#putOnce(store, key, data, found.contentType)
    return { key, size: data.length }
  }

  /** A pass in `wait` ms, or sooner if one is already due sooner. */
  #passOnceStill(wait: number): void {
    const at = Date.now() + wait
    if (this.#stopped || (this.#stillTimer && this.#stillAt <= at)) return
    if (this.#stillTimer) clearTimeout(this.#stillTimer)
    this.#stillAt = at
    this.#stillTimer = setTimeout(
      () => {
        this.#stillTimer = null
        this.kick()
      },
      Math.max(0, at - Date.now()),
    )
    this.#stillTimer.unref()
  }

  /**
   * The words — the sidecar if there is one, else the audio file's own tags —
   * put up with their romanized lines, as the server's own lyrics answer
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

    // One file, the text and its romanized lines together, so a device reads
    // both with one call to the bucket.
    const romanize = this.#deps.romanize
    const romanized = romanize ? await romanize(file.id, text).catch(() => null) : null
    const words: CloudWords = { text, romanized }
    const data = Buffer.from(JSON.stringify(words), 'utf8')
    const key = wordsKey(sha256(data))
    await this.#putOnce(store, key, data, 'application/json')
    // Read from here once the sidecar is let go, rather than from the bucket.
    await this.#deps.kept?.keep(key, data)
    return {
      lyrics: { key, size: data.length, kind },
      romanizedMissing: romanize !== undefined && romanized === null && wantsRomanized(text),
    }
  }

  /**
   * The song's motion curve, as the server's own motion answer carries it, in
   * `lyrics/` under the hash of its JSON: the doorman already lets devices read
   * that folder, so no doorman has to be redeployed for it. Null before
   * analysis has made one.
   */
  async #uploadMotion(store: CloudStore, file: SongFileInfo): Promise<string | null> {
    const data = (await this.#deps.motion?.bytes(file.id)) ?? null
    if (!data || data.length === 0) return null
    const key = motionKey(sha256(data))
    await this.#putOnce(store, key, data, 'application/json')
    return key
  }

  /**
   * Let go of the copies on this disk: the audio, the words beside it, and
   * the folder they were in.
   *
   * Every song here is wholly in the bucket as it stands, and the snapshot
   * naming it is up; what the copy is still for is analysis, so a song analysis
   * has not reached yet keeps it a while longer — as does one whose cover could
   * not be kept and is still to be read out of it. From here on the words are
   * read from the bucket (`fetchLyrics`), and the pass knows they are current
   * because nothing here can have changed them (`#signatures`).
   *
   * What is here is what `#signatures` saw at the start of the pass, so a
   * library already let go costs no second look. A sidecar written since then
   * has not been sent yet, and stays for the next pass to send.
   *
   * The last copy is not deleted on the word of what this server remembers
   * sending: the bucket is asked, once a song, for the audio every device
   * will play from now on. A song whose audio is not there — a bucket emptied
   * by hand, a folder standing in for one that went away — keeps its copy,
   * and the next pass checks the whole bucket and sends what it lost.
   *
   * Nor while something may still be writing it: the copy is let go only as
   * it was sent — its size and time unchanged — and once it has been left
   * alone `LET_GO_WHEN_STILL_MS`, with a pass coming back for it then. A
   * writer that went on into a deleted file lost the rest of the song.
   */
  async #letGo(store: CloudStore, settled: readonly Settled[]): Promise<void> {
    const analysed = this.#deps.analysed
    if (!analysed) return
    const { storage, lyrics, cloud } = this.#deps
    let released = 0
    let notThere = 0
    let changed = 0
    for (const { file, audioHere, sidecarHere } of settled) {
      if (this.#stopped) return
      if (!audioHere && !sidecarHere) continue
      if (!analysed(file.id)) continue
      if (this.#deps.coverToRead?.(file.id)) continue
      try {
        if (audioHere) {
          const copy = await storage.stat(file.path)
          if (
            !copy ||
            copy.sizeBytes !== file.sizeBytes ||
            Math.floor(copy.modifiedAt.getTime()) !== file.mtimeMs
          ) {
            changed++
            continue
          }
          const wait = stillIn(file.mtimeMs, this.#stillMs.letGo)
          if (wait > 0) {
            this.#passOnceStill(wait)
            continue
          }
          const state = cloud.state(file.id)
          const object = state ? await store.head(state.audioKey) : null
          if (!state || object?.size !== state.audioSize) {
            notThere++
            continue
          }
          await storage.delete(file.path)
        }
        await lyrics.deleteSidecar(file.path)
        await removeFolderIfEmpty(storage, file.path)
        released++
      } catch (error) {
        this.#logger.warn('could not let go of a copy', {
          path: file.path,
          message: messageOf(error),
        })
      }
    }
    if (released > 0) this.#logger.info('let go of copies now in the bucket', { songs: released })
    if (changed > 0) {
      this.#logger.warn('kept copies written to since they were sent; reading them again', {
        songs: changed,
      })
      this.onCopyChanged?.()
    }
    if (notThere > 0) {
      this.#logger.warn('kept copies whose audio the bucket does not have; checking it next pass', {
        songs: notThere,
      })
      this.#verified = false
    }
  }

  /**
   * Delete from the bucket the files of removed songs, now that the snapshot
   * without them is up. Only files no song names: two songs can share a cover,
   * and a song imported twice shares everything.
   *
   * A file's listing goes before its bytes do, so an upload of the same bytes
   * that lands meanwhile finds it absent and sends it again, rather than
   * finding it present and pointing every device at a file about to vanish.
   * One that fails stays in the trash for the next pass.
   *
   * A file replaced whole — a pack of covers, the sound vectors, the sound
   * map — waits longer: until no snapshot in the bucket names it. A device
   * reads the snapshot it listed, or the one it kept from its last look,
   * which may be one of the older ones still kept. A pack deleted under it
   * left that device fetching every cover one by one — what the packs are
   * there to save — and a map deleted under it left a phone's Home with no
   * map at all. Other files go as they did: an older snapshot naming a
   * removed song's audio names a song the logs since have taken away.
   */
  async #emptyTrash(store: CloudStore): Promise<void> {
    const { cloud } = this.#deps
    let trashed = cloud.trashedKeys()
    if (trashed.some(isReplacedWholeKey)) {
      const named = await this.#namedBySnapshots(store).catch((error: unknown) => {
        this.#logger.warn('could not read every snapshot; replaced packs and maps stay for now', {
          message: messageOf(error),
        })
        return null
      })
      trashed = trashed.filter(
        key => !isReplacedWholeKey(key) || (named !== null && !named.has(key)),
      )
    }
    let deleted = 0
    const audio: string[] = []
    for (const key of trashed) {
      if (this.#stopped) return
      const inflight = store.delete(key).finally(() => this.#deleting.delete(key))
      this.#deleting.set(key, inflight)
      try {
        await inflight
        cloud.forgetFile(key)
        await this.#deps.kept?.forget(key)
        deleted++
        if (key.startsWith('audio/')) audio.push(key)
      } catch (error) {
        if (error instanceof CloudError && error.kind !== 'other') throw error
        this.#logger.warn('could not delete a removed song’s file from the bucket', {
          key,
          message: messageOf(error),
        })
      }
    }
    if (deleted > 0) this.#logger.info('deleted removed songs’ files from the bucket', { deleted })
    await this.#unlend(store, audio)
  }

  /**
   * A removed song's audio is gone from the bucket: the share links that lend
   * it end now, not when a friend next presses Play and the doorman finds it
   * missing (docs/features/share-links.md, "At the edges"). That play is still
   * how a link finds out when this word does not get through, so a refusal
   * here is only a warning.
   */
  async #unlend(store: CloudStore, keys: readonly string[]): Promise<void> {
    if (keys.length === 0 || !store.unlend) return
    try {
      await store.unlend(keys)
    } catch (error) {
      this.#logger.warn('could not tell share links their songs were removed', {
        count: keys.length,
        message: messageOf(error),
      })
    }
  }

  /**
   * Put in the trash the audio and words in the bucket that nothing names,
   * that nothing put there, and that this server has known of for
   * `ORPHANS_KEPT_MS` (docs/SYNC.md, "Tidying up"): an upload whose import
   * failed halfway, or what a server that lost its database left. Once per
   * bucket listing, like the covers (`trashUnnamedCovers`), and only from a
   * pass that read every log; from the trash they go once the next snapshot
   * is up, if nothing names them then.
   *
   * Every snapshot in the bucket is read first, and a file any of them names
   * stays: so is the one every device is reading, and another server's. That
   * is a listing and a read a snapshot, and only when there is something to
   * delete. A snapshot that cannot be read leaves everything where it is.
   * Words go no more than audio does while a song here names no audio of a
   * size the bucket holds unnamed: that file may be its own.
   */
  async #trashOrphans(store: CloudStore): Promise<void> {
    const { cloud } = this.#deps
    const before = new Date(this.#now().getTime() - ORPHANS_KEPT_MS)
    const candidates = cloud.unnamedFiles(before)
    if (candidates.length === 0) return

    const unplaced = cloud.unplacedSongSizes()
    const maybeOwned = candidates.filter(
      file => file.key.startsWith('audio/') && unplaced.has(file.size),
    )
    if (maybeOwned.length > 0) {
      this.#logger.warn('leaving unnamed audio and words in the bucket: a song here may own them', {
        files: maybeOwned.map(file => file.key),
      })
      return
    }

    let named: Set<string>
    try {
      named = await this.#namedBySnapshots(store)
    } catch (error) {
      this.#logger.warn('could not read every snapshot; nothing unnamed goes this time', {
        message: messageOf(error),
      })
      return
    }
    const orphans = candidates.filter(file => !named.has(file.key)).map(file => file.key)
    if (orphans.length === 0) return
    cloud.trashKeys(orphans)
    this.#logger.info('audio and words nothing has named for a month go once the snapshot is up', {
      files: orphans.length,
    })
  }

  /** Every file any snapshot in the bucket names. Throws when one cannot be read. */
  async #namedBySnapshots(store: CloudStore): Promise<Set<string>> {
    const named = new Set<string>()
    const keys = (await store.list(SNAPSHOTS_FOLDER)).map(object => object.key)
    const listed = new Set(keys)
    for (const key of this.#snapshotFiles.keys())
      if (!listed.has(key)) this.#snapshotFiles.delete(key)
    for (const key of keys) {
      if (!parseSnapshotKey(key)) continue
      let files = this.#snapshotFiles.get(key)
      if (!files) {
        const kept = this.#newestRead?.newest
        const body = kept?.key === key ? kept.body : await store.get(key)
        if (!body) throw new Error(`${key} went while it was being read`)
        files = snapshotFileKeys(parseSnapshot(body))
        this.#snapshotFiles.set(key, files)
      }
      for (const file of files) named.add(file)
    }
    return named
  }

  /**
   * Put a file the bucket may already have. Files are named by their hash, so
   * one that is there is the right file: remembered once, never sent again.
   * Not asked about first: a put of the same bytes is free, where the asking
   * was a counted call per file. What this server remembers sending is
   * checked against the bucket's listing at every start (`#verify`), so the
   * only file sent twice is one it could not have known was there.
   */
  async #putOnce(store: CloudStore, key: string, data: Buffer, contentType: string): Promise<void> {
    // Not while the trash is deleting the very same bytes: wait, then look.
    const inflight = this.#deleting.get(key)
    if (inflight) await inflight.catch(() => undefined)
    if (this.#deps.cloud.hasFile(key)) return
    await store.put(key, data, { contentType })
    this.#deps.cloud.recordFile(key, data.length, this.#now())
  }

  // --- Snapshots -------------------------------------------------------------

  /**
   * Read the newest snapshot and decide whether publishing would destroy it.
   *
   * Asked after adoption has already read that snapshot and taken the library
   * on, so the counts usually agree by now and this says yes. It stays because
   * it asks a single question — how many songs does the bucket think there are
   * — where adoption asks the whole schema: a snapshot from a newer build that
   * adoption could not fully parse is still counted here, and still protects
   * the library.
   *
   * Returns why to refuse, or null to go ahead. A bucket that holds no snapshot
   * yet is not a reason to refuse: a first publish into an empty bucket is
   * exactly what is supposed to happen. A bucket that cannot be read is.
   */
  async #refuseToLoseLibrary(store: CloudStore, songsHere: number): Promise<string | null> {
    if (this.#deps.publishAnyway) return null

    // Every failure here means "there is a library and I cannot see it",
    // which is the one situation this guard exists for: none of them may be
    // taken as leave to publish.
    let inBucket: number
    try {
      // Adoption read it moments ago in this same pass: those bytes, not a second download.
      const read = this.#newestRead
      const newest =
        read && read.pass === this.#passes && this.#running
          ? read.newest
          : await this.#newestSnapshot(store)
      if (!newest) return null
      inBucket = snapshotSongCount(newest.body, uid => this.#deps.cloud.wasRemoved(uid))
    } catch (error) {
      return error instanceof CloudError
        ? error.message
        : publishUncheckableMessage(`its newest snapshot would not read: ${messageOf(error)}`)
    }

    return publishWouldLoseLibrary(inBucket, songsHere)
      ? publishRefusedMessage(inBucket, songsHere)
      : null
  }

  /**
   * The bucket's newest snapshot, or null when it holds none: what adoption
   * takes on and what the guard counts.
   *
   * Listing is separate from reading on purpose. An empty snapshots folder is
   * a fact — the bucket has no library — and the ordinary first run. Failing
   * to list is not that fact, and must not be mistaken for it, so every
   * failure here throws the message that says publishing was refused.
   */
  async #newestSnapshot(store: CloudStore): Promise<{ key: string; body: Buffer } | null> {
    const pass = this.#passes
    let keys: string[]
    let key: string | null
    try {
      keys = (await store.list(SNAPSHOTS_FOLDER)).map(object => object.key)
      key = newestSnapshotKey(keys)
    } catch (error) {
      throw new CloudError(
        'other',
        publishUncheckableMessage(`the bucket would not list: ${messageOf(error)}`),
      )
    }
    if (!key) {
      this.#newestRead = { pass, keys, newest: null }
      return null
    }

    let body: Buffer | null
    try {
      body = await store.get(key)
    } catch (error) {
      throw new CloudError(
        'other',
        publishUncheckableMessage(`its newest snapshot would not read: ${messageOf(error)}`),
      )
    }
    if (!body)
      throw new CloudError('other', publishUncheckableMessage('its newest snapshot has gone'))
    this.#newestRead = { pass, keys, newest: { key, body } }
    return { key, body }
  }

  /** The addresses as a snapshot carries them, to notice when they have changed. */
  #serverKey(server: CloudServer | undefined): string | null {
    return server === undefined ? null : JSON.stringify(server)
  }

  #publish(store: CloudStore): Promise<PublishOutcome> {
    const run = this.#publishing.then(() => this.#publishNow(store))
    this.#publishing = run.catch(() => undefined)
    return run
  }

  /**
   * Write a snapshot, unless it would say exactly what the last one did — or
   * all it adds is enrichment, which waits (`ENRICHMENT_DEFER_MS`).
   */
  async #publishNow(store: CloudStore): Promise<PublishOutcome> {
    const { cloud, songs, tags, playlists, sync, importRequests } = this.#deps

    // Never before the bucket's own library has been taken on. A pass reaches
    // this having adopted already; an import finishing during the first pass
    // reaches it through `uploadSong`, and would otherwise publish a library
    // that is still half this server's — which is the bug this whole path
    // exists to close, wearing a hat. Failing to adopt throws from here, so
    // that publish does not happen either.
    await this.#prepareBucket(store)

    const deviceId = this.#deviceId()
    // A request whose songs have all finished says so from now on.
    importRequests?.settle()

    const server = this.#deps.server?.()
    this.#publishedServer = this.#serverKey(server)
    // New names go up spelt. A dictionary that will not load costs only the
    // spellings, which the next snapshot brings.
    const names = this.#deps.names
    await names?.spellings.fill().catch((error: unknown) => {
      this.#logger.warn('could not spell names', { message: messageOf(error) })
    })
    // After the spelling, which can take a while on a new library: the time
    // names the snapshot and starts the window logs are tidied against, so it
    // is the time the snapshot was really written.
    const writtenAt = this.#now()
    const everySong = songs.all()
    const artistNames = names?.repo.artistNames() ?? new Map()
    const snapshot = buildSnapshot({
      stamps: sync?.allStamps() ?? [],
      aliases: sync?.aliases() ?? new Map(),
      emptiedTags: sync?.emptiedTags() ?? [],
      emptiedPlaylists: playlists.allEmptied(),
      merged: sync?.merges() ?? new Map(),
      upTo: sync?.cursors() ?? {},
      imports: importRequests?.recent() ?? [],
      ...(server ? { server } : {}),
      songs: everySong,
      cameWith: songs.allCameWith(),
      songUids: new Map(cloud.songFiles().map(file => [file.id, file.uid])),
      states: cloud.states(),
      artists: [...cloud.artistStates().values()],
      artistNames,
      spellings: names?.spellings.current(everySong, artistNames) ?? {},
      coverPacks: cloud.coverPacks(),
      ...this.#libraryFiles.forSnapshot(),
      tags: tags.all(),
      tagUids: cloud.tagUids(),
      playlists: playlists.all(),
      playlistUids: cloud.playlistUids(),
      playlistSongIds: playlist => playlists.songIds(playlist),
      deviceId,
      writtenAt,
    })

    const hash = snapshotContentHash(snapshot)
    if (hash === this.#lastSnapshotHash) {
      // The one up there says just this, months of plays and all: they now
      // hold every play its logs brought, if this pass found them all up.
      if (this.#ownNewest && this.#playsCovered) {
        this.#ownNewest = { ...this.#ownNewest, playsUpTo: this.#playsCovered }
      }
      return 'unchanged'
    }
    const coreHash = snapshotCoreHash(snapshot)
    if (
      this.#lastSnapshotHash !== null &&
      coreHash === this.#lastCoreHash &&
      !this.#enrichmentDue
    ) {
      this.#holdEnrichment()
      return 'deferred'
    }

    // Once per run, before this device's first snapshot replaces whatever is
    // there: is this server about to throw away somebody's library?
    if (!this.#checkedAgainstBucket) {
      const refusal = await this.#refuseToLoseLibrary(store, snapshot.songs.length)
      // Thrown, not returned: returned, the pass that asked would carry on as
      // though the snapshot were up — letting go of copies, emptying the
      // trash — and call itself idle with the error cleared.
      if (refusal) {
        this.#logger.error(refusal)
        throw new CloudError('other', refusal)
      }
    }

    const key = snapshotKey(writtenAt, deviceId)
    await store.put(key, gzipSync(Buffer.from(JSON.stringify(snapshot))), {
      contentType: 'application/json',
      contentEncoding: 'gzip',
    })
    // Only now is the bucket's newest snapshot this device's own.
    this.#checkedAgainstBucket = true
    this.#lastSnapshotHash = hash
    this.#lastCoreHash = coreHash
    this.#lastSnapshotAt = snapshot.writtenAt
    // What was held back went up with this one.
    this.#enrichmentDue = false
    if (this.#enrichmentTimer) clearTimeout(this.#enrichmentTimer)
    this.#enrichmentTimer = null
    this.#ownNewest = {
      key,
      writtenAt: writtenAt.getTime(),
      upTo: snapshot.upTo,
      playsUpTo: this.#playsCovered,
    }

    try {
      // The listing adoption made will do: what is pruned is this server's
      // own, which nothing but this server adds to, or another's a month old,
      // which a snapshot written since that listing cannot be.
      const keys =
        this.#snapshotKeys ??
        this.#newestRead?.keys.slice() ??
        (await store.list(SNAPSHOTS_FOLDER)).map(object => object.key)
      if (!keys.includes(key)) keys.push(key)
      this.#snapshotKeys = keys
      const stale = new Date(writtenAt.getTime() - OTHERS_SNAPSHOTS_KEPT_MS)
      for (const old of [
        ...snapshotsToPrune(keys, deviceId, SNAPSHOTS_KEPT),
        ...othersSnapshotsToPrune(keys, deviceId, stale),
      ]) {
        await store.delete(old)
        keys.splice(keys.indexOf(old), 1)
      }
    } catch (error) {
      // An old snapshot left behind costs a few kilobytes; it is not worth
      // failing over. The next publish lists the folder afresh: adoption's
      // listing is older than every snapshot this server has written since.
      this.#snapshotKeys = null
      this.#newestRead = null
      this.#logger.debug('could not delete old snapshots', { message: messageOf(error) })
    }
    return 'published'
  }

  /**
   * A snapshot of nothing but enrichment is waiting: it goes up after
   * `ENRICHMENT_DEFER_MS`, by a pass of its own (so the files it replaced are
   * let go after it), unless something else publishes it first.
   */
  #holdEnrichment(): void {
    if (this.#enrichmentTimer || this.#stopped) return
    this.#enrichmentTimer = setTimeout(() => {
      this.#enrichmentTimer = null
      this.#enrichmentDue = true
      this.kick()
    }, this.#enrichmentDeferMs)
    this.#enrichmentTimer.unref()
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
      const problem = cloudFormatProblem(parseJson(existing), 'this server')
      if (problem) throw new CloudError('other', problem)
      return
    }

    const text = newCloudFormatText(this.#now().toISOString(), this.#deviceId())
    await store.put(FORMAT_KEY, Buffer.from(text), { contentType: 'application/json' })
    const readBack = await store.get(FORMAT_KEY)
    if (!readBack || !isCloudFormat(parseJson(readBack))) {
      throw new CloudError('auth', CLOUD_FORMAT_UNREADABLE)
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

  /** A folder standing in for the bucket (bucket/local.ts). */
  #useFolder(dir: string): void {
    const target = { endpoint: 'file://', bucket: dir, prefix: '' }
    this.#deps.cloud.adoptTarget(target)
    const published = () => this.#deps.cloud.totals().songsInCloud > 0
    this.#use(new LocalCloudStore(dir, { published }), {
      ...target,
      region: '',
      keyIdHint: 'folder',
    })
  }

  /** With a folder as the bucket there is no account to sign in to or out of. */
  #refuseWithFolder(): void {
    if (!this.#deps.cloudDir) return
    throw new CloudError(
      'other',
      `This server’s bucket is the folder ${this.#deps.cloudDir} (SELFMP3_CLOUD_DIR). ` +
        'Unset that to sign in to an account instead.',
    )
  }

  #useDoorman(session: DoormanSession): void {
    const storage = session.storage
    if (!storage || !this.#doorman) return
    this.#deps.cloud.adoptTarget(storage)
    const { host, folder } = bucketPlace(storage)
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
    this.#adopted = false
    this.#coversSwept = false
    this.#libraryFiles.takeOn(null)
    this.#adopting = null
    this.#checkedAgainstBucket = false
    this.#forgetBucketReads()
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
    this.#forgetBucketReads()
  }

  /** Everything remembered of what the bucket held, for a bucket that is new or not trusted. */
  #forgetBucketReads(): void {
    this.#lastSnapshotHash = null
    this.#lastCoreHash = null
    this.#enrichmentDue = false
    if (this.#enrichmentTimer) clearTimeout(this.#enrichmentTimer)
    this.#enrichmentTimer = null
    this.#snapshotKeys = null
    this.#logsListed = null
    this.#logListing = null
    this.#newestRead = null
    this.#ownNewest = null
  }

  #deviceId(): string {
    return this.#deps.cloud.deviceId()
  }

  #clearTimers(): void {
    this.#kickDebounce.cancel()
    this.#publishLater.cancel()
    if (this.#retry) clearTimeout(this.#retry)
    if (this.#logPoll) clearInterval(this.#logPoll)
    this.#libraryFiles.clearTimers()
    if (this.#stillTimer) clearTimeout(this.#stillTimer)
    if (this.#enrichmentTimer) clearTimeout(this.#enrichmentTimer)
    this.#retry = null
    this.#logPoll = null
    this.#stillTimer = null
    this.#enrichmentTimer = null
  }
}

/**
 * How long until a copy last written at `mtimeMs` has been left alone for
 * `forMs`; 0 once it has. Either way of now, as the sweep counts it
 * (scanner.ts): a time far ahead of this clock is a clock that is wrong, not
 * a writer, and waiting for it would be waiting for ever.
 */
function stillIn(mtimeMs: number, forMs: number): number {
  const since = Math.abs(Date.now() - mtimeMs)
  return since < forMs ? forMs - since : 0
}

/** A copy here written to since the sweep read it: what was read is not the song any more. */
class CopyChanged extends Error {
  constructor(key: string) {
    super(`changed since it was read: ${key}`)
    this.name = 'CopyChanged'
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

function parseJson(data: Buffer): unknown {
  try {
    return JSON.parse(data.toString('utf8'))
  } catch {
    return null
  }
}

/** For each device, the lower of how far two snapshots' worth of reading reaches. */
function lowest(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [device, seq] of Object.entries(a)) out[device] = Math.min(seq, b[device] ?? 0)
  return out
}

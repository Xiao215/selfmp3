import path from 'node:path'
import { ANALYSIS_VERSION, joinedNames } from '@selfmp3/shared'
import type { Config, ServingConfig } from './config.js'
import { createLogger, type Logger } from './logger.js'
import { createShared, type SharedServices } from './shared.js'
import { openDatabase, type Db } from './db/index.js'
import { createStorage, type StorageDriver } from './storage/index.js'
import { SongRepository } from './repositories/songs.js'
import { TagRepository } from './repositories/tags.js'
import { PlaylistRepository } from './repositories/playlists.js'
import { SettingsRepository } from './repositories/settings.js'
import { StatsRepository } from './repositories/stats.js'
import { WrappedRepository } from './repositories/wrapped.js'
import { ImportRepository } from './repositories/imports.js'
import { AudioFeaturesRepository } from './repositories/audioFeatures.js'
import { SoundVectorsRepository } from './repositories/soundVectors.js'
import { BucketDownloadsRepository } from './repositories/bucketDownloads.js'
import { MetadataService } from './services/metadata.js'
import { LyricsService } from './services/lyrics.js'
import { YouTubeMusicLyrics } from './services/youtubeMusic.js'
import { YouTubeMusicArtists } from './services/youtubeMusicArtist.js'
import { ArtistBackdropService } from './services/artistBackdrops.js'
import { ArtistNameLookup } from './services/artistNames.js'
import { SpellingService } from './services/spellings.js'
import { YouTubeMusicLists } from './services/youtubeMusicLists.js'
import { NeteaseMusic } from './services/netease.js'
import { SpotifyLists } from './services/spotify.js'
import { YouTubeMatcher } from './services/youtubeMatch.js'
import { ListenService } from './services/listen.js'
import { CoverService } from './services/covers.js'
import { ScannerService } from './services/scanner.js'
import { YtDlpService } from './services/ytdlp.js'
import { YtThrottleService } from './services/ytThrottle.js'
import { ThrottleRepository } from './repositories/throttle.js'
import { ImportQueueService } from './services/importQueue.js'
import { LibraryWatcherService } from './services/libraryWatcher.js'
import type { MetadataLookupService } from './services/lookup.js'
import { smartFeaturesFor, type SmartFeatures } from './ai/smart.js'
import { FixCoversService } from './services/fixCovers.js'
import { LyricsSearchRepository } from './repositories/lyricsSearch.js'
import type { KeepAwakeService } from './services/keepAwake.js'
import { LyricsCache } from './services/lyricsCache.js'
import { MotionStore } from './services/motionStore.js'
import type { RomanizationService } from './services/romanization.js'
import { keepRomanizedFromBucket, romanizedLines } from './services/romanizedLines.js'
import { publishedAddresses } from './services/addresses.js'
import { LyricsIndexService } from './services/lyricsIndex.js'
import { AnalysisService } from './services/analysis.js'
import { SoundService } from './sound/sound.js'
import { CoverToneService } from './services/coverTones.js'
import { PreviewCoverTones } from './services/previewCoverTone.js'
import { DeviceRepository } from './repositories/devices.js'
import { AuthRepository } from './repositories/auth.js'
import { EventHub } from './services/events.js'
import { DeviceService } from './services/devices.js'
import { CloudRepository } from './repositories/cloud.js'
import { SyncRepository } from './repositories/sync.js'
import { NamesRepository } from './repositories/names.js'
import { CloudSyncService } from './services/cloudSync.js'
import { KeptCloudFiles } from './bucket/kept.js'
import { CloudAdopt } from './services/cloudAdopt.js'
import { CloudIngest } from './services/cloudIngest.js'
import { CloudImportService } from './services/cloudImports.js'
import { ImportRequestRepository } from './repositories/importRequests.js'
import { previewFound } from './services/importPreview.js'
import { LocalEdits, SyncClock } from './services/localEdits.js'
import { SongRemovalService } from './services/songRemoval.js'
import { SongMerge } from './services/songMerge.js'
import { TagRemoval } from './services/tagRemoval.js'
import { PlaysArchive } from './services/playsArchive.js'
import type { ServerMetrics } from './services/metrics.js'

/**
 * Composition root.
 *
 * Every dependency is constructed once, here, and passed explicitly to whoever
 * needs it. No module reaches out for a global. The immediate payoff is that
 * routes are trivially testable — hand them a container built on an in-memory
 * database and they work — and the ordering of construction is visible in one
 * place rather than implied by import side effects.
 */
export interface Container {
  /**
   * The configuration as loaded, with one thing settled that could not be
   * settled before the database was open: `authToken` is never null here. Read
   * this rather than what was handed to `createContainer`.
   */
  readonly config: ServingConfig
  /** Which server this library is on (shared.ts `serverIdOf`): its snapshot and health say it. */
  readonly serverId: string
  /** The server's counts for its owner's admin page, shared by every library here (services/metrics.ts). */
  readonly metrics: ServerMetrics
  readonly logger: Logger
  readonly db: Db
  readonly storage: StorageDriver

  readonly songs: SongRepository
  readonly tags: TagRepository
  readonly playlists: PlaylistRepository
  readonly settings: SettingsRepository
  readonly stats: StatsRepository
  readonly wrapped: WrappedRepository
  readonly imports: ImportRepository
  readonly audioFeatures: AudioFeaturesRepository
  readonly cloudRepo: CloudRepository

  readonly metadata: MetadataService
  readonly lyrics: LyricsService
  readonly covers: CoverService
  readonly scanner: ScannerService
  readonly ytdlp: YtDlpService
  readonly throttle: YtThrottleService
  readonly youtubeMusicArtists: YouTubeMusicArtists
  readonly artistBackdrops: ArtistBackdropService
  readonly youtubeMusicLists: YouTubeMusicLists
  readonly netease: NeteaseMusic
  readonly spotify: SpotifyLists
  readonly youtubeMatcher: YouTubeMatcher
  readonly listen: ListenService
  /** The colour of a review song's cover, read on request (services/previewCoverTone.ts). */
  readonly previewCoverTones: PreviewCoverTones
  readonly importQueue: ImportQueueService
  readonly libraryWatcher: LibraryWatcherService
  readonly lookup: MetadataLookupService
  readonly smart: SmartFeatures
  readonly fixCovers: FixCoversService
  readonly keepAwake: KeepAwakeService
  readonly lyricsCache: LyricsCache
  /** Each song's motion curve, written by analysis (services/motionStore.ts). */
  readonly motion: MotionStore
  readonly romanization: RomanizationService
  readonly lyricsIndex: LyricsIndexService
  /** The one way a song leaves the library, whatever asked for it. */
  readonly songRemoval: SongRemovalService
  /** A song held twice folded into the copy kept, before the copy is removed. */
  readonly songMerge: SongMerge
  /** A tag deleted, and the playlists that follow it let go of it. */
  readonly tagRemoval: TagRemoval
  /** What this server stamps its own edits with (docs/SYNC.md). */
  readonly clock: SyncClock
  readonly analysis: AnalysisService
  /** How songs sound, as the listening model hears them (sound/sound.ts). */
  readonly sound: SoundService
  readonly devices: DeviceService
  readonly cloudSync: CloudSyncService
  /** The names artists also go by, and names spelt in Latin letters: what search finds things by. */
  readonly names: NamesRepository
  /** Chinese and Japanese names spelt in Latin letters (services/spellings.ts). */
  readonly spellings: SpellingService
  /** Stamps edits made here, so they combine with other devices' (docs/SYNC.md). */
  readonly edits: LocalEdits
  /** Links other devices asked this server to import. */
  readonly cloudImports: CloudImportService

  /**
   * Incremented on every mutation. Clients compare it against their own copy
   * to decide whether a refetch is worth doing — which is what lets the phone
   * poll cheaply while it is awake without re-downloading the library. Every
   * bump also tells the cloud sync that there may be something to publish.
   */
  libraryVersion(): number
  bumpLibraryVersion(): void

  /** Whether `stop()` has been called: work started before it lets go when it next looks. */
  stopped(): boolean

  /**
   * Stop every background worker: timers, watchers, downloads in flight, the
   * event streams held open for each connected tab. The database stays open,
   * so anything still finishing a request can still read.
   */
  stop(): void

  /** `stop()`, and then the database. Safe to call twice. */
  close(): void
}

interface ContainerOptions {
  /**
   * What this library shares with others on the same machine (shared.ts).
   * Absent, it makes its own, and lets go of it when it closes.
   */
  readonly shared?: SharedServices
  /** Where it logs; the configured level's own when absent. */
  readonly logger?: Logger
  /** The doorman stopped taking the library's session (services/cloudSync.ts). */
  readonly sessionEnded?: () => void
}

export function createContainer(configured: Config, options: ContainerOptions = {}): Container {
  const logger = options.logger ?? createLogger(configured.logLevel)
  const db = openDatabase(configured, logger)
  const ownsShared = options.shared === undefined
  const shared = options.shared ?? createShared(configured, logger)

  /*
   * The API's key, before anything that could answer a request exists.
   *
   * `loadConfig` cannot settle this: the token is kept in the database, and the
   * database is opened from the configuration. So the environment's answer is
   * taken if there is one, and otherwise the stored one — made here on a first
   * boot — and from this line down `config.authToken` is a string, never null.
   * Everything below is handed this config rather than the one passed in, so
   * nothing can end up reading the unsettled copy.
   */
  const config: ServingConfig = Object.freeze({
    ...configured,
    authToken: configured.authToken ?? new AuthRepository(db).token(),
  })

  const storage = createStorage(config, logger)

  const songs = new SongRepository(db)
  const tags = new TagRepository(db)
  const playlists = new PlaylistRepository(db)
  const settings = new SettingsRepository(db)
  const names = new NamesRepository(db)
  const shownAs = (): ReadonlyMap<string, string> => joinedNames(songs.all(), names.joinNames())
  const stats = new StatsRepository(db, shownAs)
  const wrapped = new WrappedRepository(db, shownAs)
  const imports = new ImportRepository(db)
  const lyricsSearch = new LyricsSearchRepository(db)
  const audioFeatures = new AudioFeaturesRepository(db)
  const sound = new SoundService({
    config,
    vectors: new SoundVectorsRepository(db),
    logger,
    host: shared.soundModel,
    // Each song heard goes to the bucket's copy of the vectors; the sync is built below.
    changed: () => cloudSync.soundChanged(),
  })
  const deviceRepo = new DeviceRepository(db)
  const cloudRepo = new CloudRepository(db)
  const syncRepo = new SyncRepository(db)
  const importRequests = new ImportRequestRepository(db)

  const metadata = new MetadataService(storage, logger)
  const netease = new NeteaseMusic(logger)
  // The words come from the bucket once the sidecar has gone up and been let
  // go, and their romaji with them; the sync and the cache are built below,
  // so both are reached lazily.
  const lyrics: LyricsService = new LyricsService(
    storage,
    logger,
    fetch,
    new YouTubeMusicLyrics(logger),
    async songId => {
      const words = await cloudSync.fetchLyrics(songId)
      if (words?.romanized) {
        await keepRomanizedFromBucket({ lyricsCache }, songId, words.text, words.romanized)
      }
      return words
    },
    netease,
  )
  const covers = new CoverService(config, songs, logger)

  // One clock for everything this server stamps, named as it is in the bucket.
  const clock = new SyncClock({
    deviceId: () => cloudRepo.deviceId(),
    // An artist's names keep their stamp beside them, not among the others.
    latest: () => latestStamp(syncRepo.latestStamp(), names.latestStamp()),
  })
  const edits = new LocalEdits({ db, sync: syncRepo, clock })
  const tagRemoval = new TagRemoval({ db, tags, playlists, edits })
  // A song held twice, folded into the copy kept: when this server is asked
  // (`POST /api/songs/merge`), and when another device's log says so.
  const songMerge = new SongMerge({
    db,
    sync: syncRepo,
    copyCover: (fromId, intoId) => covers.copy(fromId, intoId),
  })
  const ingest = new CloudIngest({
    db,
    songs,
    tags,
    playlists,
    stats,
    sync: syncRepo,
    cloud: cloudRepo,
    requests: importRequests,
    names,
    clock,
    logger,
    merge: songMerge,
  })

  // Signing in to a bucket that already holds a library: take it on before
  // publishing anything over it (services/cloudAdopt.ts).
  const adopt = new CloudAdopt({
    db,
    songs,
    tags,
    playlists,
    features: audioFeatures,
    cloud: cloudRepo,
    sync: syncRepo,
    names,
    storage,
    clock,
    logger,
  })

  // Before the sync, which uploads each song's romaji beside its words.
  const lyricsCache = new LyricsCache(config, logger)
  const motion = new MotionStore(config, logger)
  const romanization = shared.romanization

  // Before the sync, which puts every artist's picture in the bucket.
  const youtubeMusicArtists = new YouTubeMusicArtists(logger)
  const artistBackdrops = new ArtistBackdropService(
    config,
    songs,
    names,
    youtubeMusicArtists,
    logger,
  )
  // Before the sync too: what search finds things by goes in every snapshot.
  const spellings = new SpellingService({ names, songs, romanization, logger })
  const artistNames = new ArtistNameLookup({
    names,
    songs,
    deviceId: () => cloudRepo.deviceId(),
    pace: shared.musicBrainzPace,
    logger,
  })

  const cloudSync = new CloudSyncService({
    cloud: cloudRepo,
    songs,
    tags,
    playlists,
    imports,
    storage,
    covers,
    lyrics,
    metadata,
    logger,
    sync: syncRepo,
    ingest,
    adopt,
    // The bucket's words, read from this disk after the first time.
    kept: new KeptCloudFiles(path.join(config.dataDir, 'cloud-files'), logger),
    // The last thing that needs a song's audio here; once it is done, the
    // copy on this disk may go. Where songs are heard, that includes being
    // heard (loaded or not, the model is let go when idle), so hearing it
    // later does not cost a download.
    analysed: songId =>
      audioFeatures.isAnalysed(songId, ANALYSIS_VERSION) && (!sound.canHear || sound.has(songId)),
    cloudDir: config.cloudDir ?? undefined,
    publishAnyway: config.publishAnyway,
    importRequests,
    doormanUrl: config.doormanUrl,
    ...(options.sessionEnded ? { sessionEnded: options.sessionEnded } : {}),
    romanize: (songId, text) => romanizedLines({ lyricsCache, romanization }, songId, text),
    // Each song's motion curve goes up beside its words, once analysis has made one.
    motion,
    artists: artistBackdrops,
    names: { repo: names, spellings, lookup: artistNames },
    // Every song's sound vector goes up as one file, and comes back to a new server.
    sound,
    // Every play goes up too, a month a file, and comes back to a new server.
    plays: new PlaysArchive({ stats, sync: syncRepo, deviceId: () => cloudRepo.deviceId() }),
    // The token is the bucket's owner's already: whoever reads the snapshot
    // is signed in to their own library. This is how every device gets the
    // key without anyone ever typing it — the server always has one now
    // (repositories/auth.ts), so this is never null.
    server: () => ({
      id: shared.serverId,
      addresses: publishedAddresses(config.host, config.port, config.publicUrl).map(
        address => address.url,
      ),
      token: config.authToken,
    }),
  })

  // Where the version starts: the clock, not 1. It lives in memory, and
  // starting each boot at 1 meant a tab that saw version 3 before a restart,
  // and 3 again after it from two different edits, took the second for
  // nothing new and showed the old library until a reload — and a restored
  // backup could even read as the library it replaced. Milliseconds since the
  // epoch are past any count the last boot reached, unless it bumped more than
  // once a millisecond for its whole life.
  let version = Date.now()
  let stopped = false
  let closed = false
  const bump = (): void => {
    version++
    cloudSync.kick()
  }

  const scanner = new ScannerService({
    storage,
    songs,
    metadata,
    lyrics,
    covers,
    logger,
  })

  // How fast this server may ask YouTube for anything. Signed-in sessions get
  // a much higher ceiling, and the cookie setting is read per call, so turning
  // cookies on widens the budget without a restart (services/ytThrottle.ts).
  const throttle =
    shared.throttle ??
    new YtThrottleService(
      new ThrottleRepository(db),
      () => settings.get().ytCookieSource !== 'none',
    )

  const ytdlp = new YtDlpService(logger, () => settings.get(), throttle)
  const youtubeMusicLists = new YouTubeMusicLists(logger)
  const spotify = new SpotifyLists(logger)
  const youtubeMatcher = new YouTubeMatcher({ lists: youtubeMusicLists, logger })
  const listen = new ListenService(ytdlp)
  const previewCoverTones = new PreviewCoverTones({ logger })

  // Held while a song is streaming or an import is running, so the server does
  // not idle-sleep out from under whoever is listening (services/keepAwake.ts).
  const keepAwake = shared.keepAwake

  const importQueue = new ImportQueueService({
    config,
    storage,
    imports,
    songs,
    tags,
    playlists,
    settings,
    scanner,
    lyrics,
    covers,
    ytdlp,
    throttle,
    cloud: cloudSync,
    keepAwake,
    metrics: shared.metrics,
    logger,
  })

  const cloudImports = new CloudImportService({
    requests: importRequests,
    imports,
    sync: syncRepo,
    resolve: url =>
      previewFound(
        {
          ytdlp,
          songs,
          cloudRepo,
          cloudSync,
          imports,
          youtubeMusicArtists,
          youtubeMusicLists,
          netease,
          spotify,
          youtubeMatcher,
        },
        url,
      ),
    kickQueue: () => importQueue.kick(),
    changed: () => cloudSync.kick(),
    logger,
  })

  const lyricsIndex = new LyricsIndexService({
    songs,
    search: lyricsSearch,
    lyrics,
    metadata,
    logger,
  })
  const songRemoval = new SongRemovalService({
    storage,
    songs,
    tags: { all: () => tags.all(), delete: id => void tagRemoval.remove(id) },
    cloud: cloudRepo,
    lyrics,
    covers,
    lyricsCache,
    motion,
    lyricsIndex,
    onChange: bump,
    logger,
  })

  const libraryWatcher = new LibraryWatcherService({
    config,
    settings,
    scanner,
    onChanged: bump,
    logger,
  })

  const lookup = shared.lookup
  const smart = smartFeaturesFor({
    config,
    logger,
    songs,
    tags,
    names,
    sound,
    stats,
    wrapped,
    playlists,
    lyricsSearch,
    settings,
    netease,
    lookup,
    metrics: shared.metrics,
  })
  const fixCovers = new FixCoversService({
    songs,
    covers,
    lookup,
    logger,
    onChange: bump,
  })
  const analysis = new AnalysisService({
    config,
    storage,
    songs,
    audioFeatures,
    motion,
    scanner,
    importQueue,
    // A song whose copy here has gone is fetched from the bucket to analyse.
    fetchAudio: songId => cloudSync.fetchAudio(songId),
    sound,
    downloads: new BucketDownloadsRepository(db),
    // One song at a time across every library on this machine.
    gate: shared.analysisGate,
    logger,
    // A version bump makes clients refetch; do it in batches, and once at the
    // end, so a long first run does not have every phone re-downloading the
    // library after each song.
    onProgress: (done, finished) => {
      if (finished || done % 25 === 0) bump()
    },
  })

  // The colour of each cover, for devices to draw the playing song in: read
  // once for the covers already here, and again whenever one is saved.
  const coverTones = new CoverToneService({ songs, covers, logger, onChange: bump })
  covers.onSaved = () => coverTones.kick()
  coverTones.kick()

  // Analysis runs after the work that matters: new and changed files are
  // queued as they are ingested, and a finished scan nudges the loop.
  scanner.onIngested = (songId, change) => {
    if (change === 'updated') analysis.invalidate(songId)
    else analysis.kick()
  }

  scanner.onScanComplete = () => analysis.kick()
  scanner.isLeaving = key => songRemoval.isLeaving(key)

  // Other devices' changes, applied during a cloud pass. The pass publishes
  // what they changed itself, so this only moves the version clients watch —
  // and tidies up after songs removed elsewhere: whatever copy was still here
  // goes, so no sweep can make a new song of it.
  cloudSync.onIngested = async ({ removed, requested }) => {
    version++
    if (requested > 0) void cloudImports.process()
    await songRemoval.tidyAfter(removed)
  }

  // Presence and handoff. The version watch reads `version` through the
  // closure, so every bump above reaches the event stream without each caller
  // having to know it exists.
  const events = new EventHub(logger.child('events'))
  const devices = new DeviceService({
    devices: deviceRepo,
    hub: events,
    logger: logger.child('devices'),
    libraryVersion: () => version,
  })

  const container: Container = {
    config,
    serverId: shared.serverId,
    metrics: shared.metrics,
    logger,
    db,
    storage,
    throttle,
    songs,
    tags,
    playlists,
    settings,
    stats,
    wrapped,
    imports,
    audioFeatures,
    cloudRepo,
    metadata,
    lyrics,
    covers,
    scanner,
    ytdlp,
    youtubeMusicArtists,
    artistBackdrops,
    names,
    spellings,
    youtubeMusicLists,
    netease,
    spotify,
    youtubeMatcher,
    listen,
    previewCoverTones,
    importQueue,
    libraryWatcher,
    lookup,
    smart,
    fixCovers,
    keepAwake,
    lyricsCache,
    motion,
    romanization,
    lyricsIndex,
    songRemoval,
    songMerge,
    tagRemoval,
    clock,
    analysis,
    sound,
    devices,
    cloudSync,
    edits,
    cloudImports,
    libraryVersion: () => version,
    bumpLibraryVersion: bump,
    stopped: () => stopped,
    // Every background worker in one place: a shutdown that forgot one would
    // leave a timer or a download holding the process open.
    stop: () => {
      stopped = true
      libraryWatcher.stop()
      devices.stop()
      analysis.stop()
      coverTones.stop()
      importQueue.stop()
      cloudSync.stop()
      // The model, and letting the machine sleep again even if a stream is
      // still winding down — when they are this library's alone. Shared,
      // they are the machine's to let go (hub/hub.ts).
      if (ownsShared) void shared.close()
    },
    // Shutdown can arrive here by either of two paths — the server closing
    // cleanly or the timeout giving up on it — and `db.close()` throws the
    // second time, so only the first call does the work.
    close: () => {
      if (closed) return
      closed = true
      container.stop()
      db.close()
    },
  }

  return container
}

/** The later of two stamps, either of which may be missing. */
function latestStamp(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a > b ? a : b
}

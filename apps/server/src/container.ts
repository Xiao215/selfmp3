import { ANALYSIS_VERSION } from '@selfmp3/shared'
import type { Config } from './config.js'
import { createLogger, type Logger } from './logger.js'
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
import { MetadataService } from './services/metadata.js'
import { LyricsService } from './services/lyrics.js'
import { YouTubeMusicLyrics } from './services/youtubeMusic.js'
import { YouTubeMusicArtists } from './services/youtubeMusicArtist.js'
import { ArtistBackdropService } from './services/artistBackdrops.js'
import { YouTubeMusicLists } from './services/youtubeMusicLists.js'
import { ListenService } from './services/listen.js'
import { CoverService } from './services/covers.js'
import { ScannerService } from './services/scanner.js'
import { YtDlpService } from './services/ytdlp.js'
import { YtThrottleService } from './services/ytThrottle.js'
import { ThrottleRepository } from './repositories/throttle.js'
import { ImportQueueService } from './services/importQueue.js'
import { LibraryWatcherService } from './services/libraryWatcher.js'
import { MigrateService } from './services/migrate.js'
import { MetadataLookupService } from './services/lookup.js'
import { FixCoversService } from './services/fixCovers.js'
import { LyricsSearchRepository } from './repositories/lyricsSearch.js'
import { createKeepAwake, type KeepAwakeService } from './services/keepAwake.js'
import { LyricsCache } from './services/lyricsCache.js'
import { MotionStore } from './services/motionStore.js'
import { RomanizationService } from './services/romanization.js'
import { romanizedLines } from './services/romanizedLines.js'
import { publishedAddresses } from './services/addresses.js'
import { LyricsIndexService } from './services/lyricsIndex.js'
import { AnalysisService } from './services/analysis.js'
import { CoverToneService } from './services/coverTones.js'
import { PreviewCoverTones } from './services/previewCoverTone.js'
import { DeviceRepository } from './repositories/devices.js'
import { AuthRepository } from './repositories/auth.js'
import { EventHub } from './services/events.js'
import { DeviceService } from './services/devices.js'
import { CloudRepository } from './repositories/cloud.js'
import { SyncRepository } from './repositories/sync.js'
import { CloudSyncService } from './services/cloudSync.js'
import { CloudAdopt } from './services/cloudAdopt.js'
import { CloudIngest } from './services/cloudIngest.js'
import { CloudImportService } from './services/cloudImports.js'
import { ImportRequestRepository } from './repositories/importRequests.js'
import { buildImportPreview } from './services/importPreview.js'
import { LocalEdits, SyncClock } from './services/localEdits.js'
import { SongRemovalService } from './services/songRemoval.js'

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
  readonly config: Config
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
  readonly syncRepo: SyncRepository

  readonly metadata: MetadataService
  readonly lyrics: LyricsService
  readonly covers: CoverService
  readonly scanner: ScannerService
  readonly ytdlp: YtDlpService
  readonly throttle: YtThrottleService
  readonly youtubeMusicArtists: YouTubeMusicArtists
  readonly artistBackdrops: ArtistBackdropService
  readonly youtubeMusicLists: YouTubeMusicLists
  readonly listen: ListenService
  /** The colour of a review song's cover, read on request (services/previewCoverTone.ts). */
  readonly previewCoverTones: PreviewCoverTones
  readonly importQueue: ImportQueueService
  readonly libraryWatcher: LibraryWatcherService
  readonly migrate: MigrateService
  readonly lookup: MetadataLookupService
  readonly fixCovers: FixCoversService
  readonly keepAwake: KeepAwakeService
  readonly lyricsCache: LyricsCache
  /** Each song's motion curve, written by analysis (services/motionStore.ts). */
  readonly motion: MotionStore
  readonly romanization: RomanizationService
  readonly lyricsIndex: LyricsIndexService
  /** The one way a song leaves the library, whatever asked for it. */
  readonly songRemoval: SongRemovalService
  readonly analysis: AnalysisService
  readonly devices: DeviceService
  readonly cloudSync: CloudSyncService
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

  /**
   * Stop every background worker: timers, watchers, downloads in flight, the
   * event streams held open for each connected tab. The database stays open,
   * so anything still finishing a request can still read.
   */
  stop(): void

  /** `stop()`, and then the database. Safe to call twice. */
  close(): void
}

export function createContainer(configured: Config): Container {
  const logger = createLogger(configured.logLevel)
  const db = openDatabase(configured, logger)

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
  const config: Config = configured.authToken
    ? configured
    : Object.freeze({ ...configured, authToken: new AuthRepository(db).token() })

  const storage = createStorage(config, logger)

  const songs = new SongRepository(db)
  const tags = new TagRepository(db)
  const playlists = new PlaylistRepository(db)
  const settings = new SettingsRepository(db)
  const stats = new StatsRepository(db)
  const wrapped = new WrappedRepository(db)
  const imports = new ImportRepository(db)
  const lyricsSearch = new LyricsSearchRepository(db)
  const audioFeatures = new AudioFeaturesRepository(db)
  const deviceRepo = new DeviceRepository(db)
  const cloudRepo = new CloudRepository(db)
  const syncRepo = new SyncRepository(db)
  const importRequests = new ImportRequestRepository(db)

  const metadata = new MetadataService(storage, logger)
  // The words come from the bucket once the sidecar has gone up and been let
  // go; the sync is built below, so it is reached lazily.
  const lyrics: LyricsService = new LyricsService(
    storage,
    logger,
    fetch,
    new YouTubeMusicLyrics(logger),
    songId => cloudSync.fetchLyrics(songId),
  )
  const covers = new CoverService(config, songs, logger)

  // One clock for everything this server stamps, named as it is in the bucket.
  const clock = new SyncClock({
    deviceId: () => cloudRepo.deviceId(),
    latest: () => syncRepo.latestStamp(),
  })
  const edits = new LocalEdits({ db, sync: syncRepo, clock })
  const ingest = new CloudIngest({
    db,
    songs,
    tags,
    playlists,
    stats,
    sync: syncRepo,
    cloud: cloudRepo,
    requests: importRequests,
    clock,
    logger,
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
    storage,
    clock,
    logger,
  })

  // Before the sync, which uploads each song's romaji beside its words.
  const lyricsCache = new LyricsCache(config, logger)
  const motion = new MotionStore(config, logger)
  const romanization = new RomanizationService(logger)

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
    // The last thing that needs a song's audio here; once it is done, the
    // copy on this disk may go.
    analysed: songId => audioFeatures.isAnalysed(songId, ANALYSIS_VERSION),
    cloudDir: config.cloudDir ?? undefined,
    importRequests,
    doormanUrl: config.doormanUrl,
    romanize: (songId, text) => romanizedLines({ lyricsCache, romanization }, songId, text),
    // Each song's motion curve goes up beside its words, once analysis has made one.
    motion,
    // The token is the bucket's owner's already: whoever reads the snapshot
    // is signed in to their own library. This is how every device gets the
    // key without anyone ever typing it — the server always has one now
    // (repositories/auth.ts), so this is never null.
    server: () => ({
      addresses: publishedAddresses(config.host, config.port, config.publicUrl).map(
        address => address.url,
      ),
      token: config.authToken,
    }),
  })

  let version = 1
  let closed = false
  const bump = (): void => {
    version++
    cloudSync.kick()
  }

  const scanner = new ScannerService({
    config,
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
  const throttle = new YtThrottleService(
    new ThrottleRepository(db),
    () => settings.get().ytCookieSource !== 'none',
  )

  const ytdlp = new YtDlpService(logger, () => settings.get(), throttle)
  const youtubeMusicArtists = new YouTubeMusicArtists(logger)
  const artistBackdrops = new ArtistBackdropService(config, songs, youtubeMusicArtists, logger)
  const youtubeMusicLists = new YouTubeMusicLists(logger)
  const listen = new ListenService(ytdlp)
  const previewCoverTones = new PreviewCoverTones({ logger })

  // Held while a song is streaming or an import is running, so the server does
  // not idle-sleep out from under whoever is listening (services/keepAwake.ts).
  const keepAwake = createKeepAwake(logger)

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
    logger,
  })

  const cloudImports = new CloudImportService({
    requests: importRequests,
    imports,
    sync: syncRepo,
    resolve: url =>
      buildImportPreview(
        { ytdlp, songs, cloudRepo, cloudSync, imports, youtubeMusicArtists, youtubeMusicLists },
        url,
      ),
    kickQueue: () => importQueue.kick(),
    changed: () => cloudSync.kick(),
    logger,
  })

  const migrate = new MigrateService({ songs, logger, ytdlp })
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
    tags,
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

  const lookup = new MetadataLookupService(logger)
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

  // Other devices' changes, applied during a cloud pass. The pass publishes
  // what they changed itself, so this only moves the version clients watch —
  // and tidies up after songs removed elsewhere: whatever copy was still here
  // goes, so no sweep can make a new song of it.
  cloudSync.onIngested = async ({ removed, requested }) => {
    version++
    if (requested > 0) void cloudImports.process()
    await songRemoval.tidyAfter(removed)
  }

  // Presence and remote control. The version watch reads `version` through the
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
    syncRepo,
    metadata,
    lyrics,
    covers,
    scanner,
    ytdlp,
    youtubeMusicArtists,
    artistBackdrops,
    youtubeMusicLists,
    listen,
    previewCoverTones,
    importQueue,
    libraryWatcher,
    migrate,
    lookup,
    fixCovers,
    keepAwake,
    lyricsCache,
    motion,
    romanization,
    lyricsIndex,
    songRemoval,
    analysis,
    devices,
    cloudSync,
    edits,
    cloudImports,
    libraryVersion: () => version,
    bumpLibraryVersion: bump,
    // Every background worker in one place: a shutdown that forgot one would
    // leave a timer or a download holding the process open.
    stop: () => {
      libraryWatcher.stop()
      devices.stop()
      analysis.stop()
      coverTones.stop()
      importQueue.stop()
      cloudSync.stop()
      migrate.stop()
      // Let the machine sleep again even if a stream is still winding down.
      keepAwake.stop()
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

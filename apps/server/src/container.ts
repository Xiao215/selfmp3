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
import { GemsRepository } from './repositories/gems.js'
import { ImportRepository } from './repositories/imports.js'
import { FeaturesRepository } from './repositories/features.js'
import { MetadataService } from './services/metadata.js'
import { LyricsService } from './services/lyrics.js'
import { YouTubeMusicLyrics } from './services/youtubeMusic.js'
import { YouTubeMusicArtists } from './services/youtubeMusicArtist.js'
import { ListenService } from './services/listen.js'
import { CoverService } from './services/covers.js'
import { ScannerService } from './services/scanner.js'
import { YtDlpService } from './services/ytdlp.js'
import { ImportQueueService } from './services/importQueue.js'
import { LibraryWatcherService } from './services/libraryWatcher.js'
import { MigrateService } from './services/migrate.js'
import { MetadataLookupService } from './services/lookup.js'
import { FixCoversService } from './services/fixCovers.js'
import { LyricsSearchRepository } from './repositories/lyricsSearch.js'
import { LyricsCache } from './services/lyricsCache.js'
import { RomanizationService } from './services/romanization.js'
import { LyricsIndexService } from './services/lyricsIndex.js'
import { AnalysisService } from './services/analysis.js'
import { DeviceRepository } from './repositories/devices.js'
import { EventHub } from './services/events.js'
import { DeviceService } from './services/devices.js'
import { CloudRepository } from './repositories/cloud.js'
import { CloudSyncService } from './services/cloudSync.js'

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
  readonly gems: GemsRepository
  readonly imports: ImportRepository
  readonly lyricsSearch: LyricsSearchRepository
  readonly features: FeaturesRepository
  readonly deviceRepo: DeviceRepository
  readonly cloudRepo: CloudRepository

  readonly metadata: MetadataService
  readonly lyrics: LyricsService
  readonly covers: CoverService
  readonly scanner: ScannerService
  readonly ytdlp: YtDlpService
  readonly youtubeMusicArtists: YouTubeMusicArtists
  readonly listen: ListenService
  readonly importQueue: ImportQueueService
  readonly libraryWatcher: LibraryWatcherService
  readonly migrate: MigrateService
  readonly lookup: MetadataLookupService
  readonly fixCovers: FixCoversService
  readonly lyricsCache: LyricsCache
  readonly romanization: RomanizationService
  readonly lyricsIndex: LyricsIndexService
  readonly analysis: AnalysisService
  readonly events: EventHub
  readonly devices: DeviceService
  readonly cloudSync: CloudSyncService

  /**
   * Incremented on every mutation. Clients compare it against their own copy
   * to decide whether a refetch is worth doing — which is what lets the phone
   * poll cheaply while it is awake without re-downloading the library. Every
   * bump also tells the cloud sync that there may be something to publish.
   */
  libraryVersion(): number
  bumpLibraryVersion(): void

  close(): void
}

export function createContainer(config: Config): Container {
  const logger = createLogger(config.logLevel)
  const db = openDatabase(config, logger)
  const storage = createStorage(config, logger)

  const songs = new SongRepository(db)
  const tags = new TagRepository(db)
  const playlists = new PlaylistRepository(db)
  const settings = new SettingsRepository(db)
  const stats = new StatsRepository(db)
  const wrapped = new WrappedRepository(db)
  const gems = new GemsRepository(db)
  const imports = new ImportRepository(db)
  const lyricsSearch = new LyricsSearchRepository(db)
  const features = new FeaturesRepository(db)
  const deviceRepo = new DeviceRepository(db)
  const cloudRepo = new CloudRepository(db)

  const metadata = new MetadataService(storage, logger)
  const lyrics = new LyricsService(storage, logger, fetch, new YouTubeMusicLyrics(logger))
  const covers = new CoverService(config, songs, logger)

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
  })

  let version = 1
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

  // Cookie settings are read per call, so a change applies without a restart.
  const ytdlp = new YtDlpService(logger, () => settings.get())
  const youtubeMusicArtists = new YouTubeMusicArtists(logger)
  const listen = new ListenService(ytdlp)

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
    cloud: cloudSync,
    logger,
  })

  const migrate = new MigrateService({ songs, logger })
  const lyricsCache = new LyricsCache(config, logger)
  const romanization = new RomanizationService(logger)
  const lyricsIndex = new LyricsIndexService({
    songs,
    search: lyricsSearch,
    lyrics,
    metadata,
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
    features,
    scanner,
    importQueue,
    logger,
    // A version bump makes clients refetch; do it in batches, and once at the
    // end, so a long first run does not have every phone re-downloading the
    // library after each song.
    onProgress: (done, finished) => {
      if (finished || done % 25 === 0) bump()
    },
  })

  // Analysis runs after the work that matters: new and changed files are
  // queued as they are ingested, and a finished scan nudges the loop.
  scanner.onIngested = (songId, change) => {
    if (change === 'updated') analysis.invalidate(songId)
    else analysis.kick()
  }
  scanner.onScanComplete = () => analysis.kick()

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

  return {
    config,
    logger,
    db,
    storage,
    songs,
    tags,
    playlists,
    settings,
    stats,
    wrapped,
    gems,
    imports,
    lyricsSearch,
    features,
    deviceRepo,
    cloudRepo,
    metadata,
    lyrics,
    covers,
    scanner,
    ytdlp,
    youtubeMusicArtists,
    listen,
    importQueue,
    libraryWatcher,
    migrate,
    lookup,
    fixCovers,
    lyricsCache,
    romanization,
    lyricsIndex,
    analysis,
    events,
    devices,
    cloudSync,
    libraryVersion: () => version,
    bumpLibraryVersion: bump,
    close: () => {
      libraryWatcher.stop()
      devices.stop()
      analysis.stop()
      importQueue.stop()
      cloudSync.stop()
      migrate.stop()
      db.close()
    },
  }
}

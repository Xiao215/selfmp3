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
import { createKeepAwake, type KeepAwakeService } from './services/keepAwake.js'
import { LyricsCache } from './services/lyricsCache.js'
import { RomanizationService } from './services/romanization.js'
import { romanizedLines } from './services/romanizedLines.js'
import { LyricsIndexService } from './services/lyricsIndex.js'
import { AnalysisService } from './services/analysis.js'
import { CoverToneService } from './services/coverTones.js'
import { DeviceRepository } from './repositories/devices.js'
import { EventHub } from './services/events.js'
import { DeviceService } from './services/devices.js'
import { CloudRepository } from './repositories/cloud.js'
import { SyncRepository } from './repositories/sync.js'
import { CloudSyncService } from './services/cloudSync.js'
import { CloudIngest } from './services/cloudIngest.js'
import { CloudImportService } from './services/cloudImports.js'
import { ImportRequestRepository } from './repositories/importRequests.js'
import { buildImportPreview } from './services/importPreview.js'
import { LocalEdits, SyncClock } from './services/localEdits.js'
import { removeFolderIfEmpty } from './services/libraryLayout.js'

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
  readonly syncRepo: SyncRepository

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
  readonly keepAwake: KeepAwakeService
  readonly lyricsCache: LyricsCache
  readonly romanization: RomanizationService
  readonly lyricsIndex: LyricsIndexService
  readonly analysis: AnalysisService
  readonly events: EventHub
  readonly devices: DeviceService
  readonly cloudSync: CloudSyncService
  /** Stamps edits made here, so they combine with other devices' (docs/SYNC.md). */
  readonly edits: LocalEdits
  /** Links other devices asked this Mac to import. */
  readonly cloudImports: CloudImportService

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
  const syncRepo = new SyncRepository(db)
  const importRequests = new ImportRequestRepository(db)

  const metadata = new MetadataService(storage, logger)
  const lyrics = new LyricsService(storage, logger, fetch, new YouTubeMusicLyrics(logger))
  const covers = new CoverService(config, songs, logger)

  // One clock for everything this Mac stamps, named as it is in the bucket.
  const clock = new SyncClock({
    deviceId: () => cloudRepo.deviceId(process.platform === 'darwin' ? 'mac' : process.platform),
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
    requests: importRequests,
    clock,
    logger,
  })

  // Before the sync, which uploads each song's romaji beside its words.
  const lyricsCache = new LyricsCache(config, logger)
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
    importRequests,
    doormanUrl: config.doormanUrl,
    romanize: (songId, text) => romanizedLines({ lyricsCache, romanization }, songId, text),
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

  // Cookie settings are read per call, so a change applies without a restart.
  const ytdlp = new YtDlpService(logger, () => settings.get())
  const youtubeMusicArtists = new YouTubeMusicArtists(logger)
  const listen = new ListenService(ytdlp)

  // Held while a song is streaming or an import is running, so the Mac does
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
    cloud: cloudSync,
    keepAwake,
    logger,
  })

  const cloudImports = new CloudImportService({
    requests: importRequests,
    imports,
    sync: syncRepo,
    resolve: url => buildImportPreview({ ytdlp, songs, youtubeMusicArtists }, url),
    kickQueue: () => importQueue.kick(),
    changed: () => cloudSync.kick(),
    logger,
  })

  const migrate = new MigrateService({ songs, logger })
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
  // and tidies up after songs removed elsewhere. A file the person chose to
  // keep is left where it is, and the next scan adds it back as a new song,
  // exactly as it would have had they removed it on this Mac.
  cloudSync.onIngested = async ({ removed, requested }) => {
    version++
    if (requested > 0) void cloudImports.process()
    for (const song of removed) {
      try {
        // The audio goes only if the device that removed it said so; what is
        // derived from the row goes either way, since the row has.
        if (song.deleteFile) {
          await storage.delete(song.path).catch(() => undefined)
          await lyrics.deleteSidecar(song.path)
          await removeFolderIfEmpty(storage, song.path)
        }
        await covers.delete(song.id)
        await lyricsCache.delete(song.id)
        lyricsIndex.remove(song.id)
      } catch (error) {
        logger.warn('could not tidy up a song removed on another device', {
          path: song.path,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
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
    syncRepo,
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
    keepAwake,
    lyricsCache,
    romanization,
    lyricsIndex,
    analysis,
    events,
    devices,
    cloudSync,
    edits,
    cloudImports,
    libraryVersion: () => version,
    bumpLibraryVersion: bump,
    // Shutdown can arrive here by either of two paths — the server closing
    // cleanly or the timeout giving up on it — and `db.close()` throws the
    // second time, so only the first call does the work.
    close: () => {
      if (closed) return
      closed = true
      libraryWatcher.stop()
      devices.stop()
      analysis.stop()
      coverTones.stop()
      importQueue.stop()
      cloudSync.stop()
      migrate.stop()
      db.close()
    },
  }
}

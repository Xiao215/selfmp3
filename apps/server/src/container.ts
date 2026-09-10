import type { Config } from './config.js'
import { createLogger, type Logger } from './logger.js'
import { openDatabase, type Db } from './db/index.js'
import { createStorage, type StorageDriver } from './storage/index.js'
import { SongRepository } from './repositories/songs.js'
import { TagRepository } from './repositories/tags.js'
import { PlaylistRepository } from './repositories/playlists.js'
import { SettingsRepository } from './repositories/settings.js'
import { StatsRepository } from './repositories/stats.js'
import { ImportRepository } from './repositories/imports.js'
import { MetadataService } from './services/metadata.js'
import { LyricsService } from './services/lyrics.js'
import { CoverService } from './services/covers.js'
import { ScannerService } from './services/scanner.js'
import { YtDlpService } from './services/ytdlp.js'
import { ImportQueueService } from './services/importQueue.js'
import { LibraryWatcherService } from './services/libraryWatcher.js'
import { MigrateService } from './services/migrate.js'
import { MetadataLookupService } from './services/lookup.js'
import { FixCoversService } from './services/fixCovers.js'
import { SecretsRepository } from './repositories/secrets.js'
import { LyricsSearchRepository } from './repositories/lyricsSearch.js'
import { LyricsCache } from './services/lyricsCache.js'
import { RomanizationService } from './services/romanization.js'
import { TranslationService } from './services/translation.js'
import { LyricsIndexService } from './services/lyricsIndex.js'

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
  readonly imports: ImportRepository
  readonly secrets: SecretsRepository
  readonly lyricsSearch: LyricsSearchRepository

  readonly metadata: MetadataService
  readonly lyrics: LyricsService
  readonly covers: CoverService
  readonly scanner: ScannerService
  readonly ytdlp: YtDlpService
  readonly importQueue: ImportQueueService
  readonly libraryWatcher: LibraryWatcherService
  readonly migrate: MigrateService
  readonly lookup: MetadataLookupService
  readonly fixCovers: FixCoversService
  readonly lyricsCache: LyricsCache
  readonly romanization: RomanizationService
  readonly translation: TranslationService
  readonly lyricsIndex: LyricsIndexService

  /**
   * Incremented on every mutation. Clients compare it against their own copy
   * to decide whether a refetch is worth doing — which is what lets the phone
   * poll cheaply while it is awake without re-downloading the library.
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
  const imports = new ImportRepository(db)
  const secrets = new SecretsRepository(db)
  const lyricsSearch = new LyricsSearchRepository(db)

  const metadata = new MetadataService(storage, logger)
  const lyrics = new LyricsService(storage, logger)
  const covers = new CoverService(config, songs, logger)

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
    logger,
  })

  const migrate = new MigrateService({ songs, logger })
  const lyricsCache = new LyricsCache(config, logger)
  const romanization = new RomanizationService(logger)
  const translation = new TranslationService(secrets, logger)
  const lyricsIndex = new LyricsIndexService({ songs, search: lyricsSearch, lyrics, metadata, logger })

  let version = 1

  const libraryWatcher = new LibraryWatcherService({
    config,
    settings,
    scanner,
    onChanged: () => {
      version++
    },
    logger,
  })

  const lookup = new MetadataLookupService(logger)
  const fixCovers = new FixCoversService({
    songs,
    covers,
    lookup,
    logger,
    onChange: () => {
      version++
    },
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
    imports,
    secrets,
    lyricsSearch,
    metadata,
    lyrics,
    covers,
    scanner,
    ytdlp,
    importQueue,
    libraryWatcher,
    migrate,
    lookup,
    fixCovers,
    lyricsCache,
    romanization,
    translation,
    lyricsIndex,
    libraryVersion: () => version,
    bumpLibraryVersion: () => {
      version++
    },
    close: () => {
      libraryWatcher.stop()
      importQueue.stop()
      migrate.stop()
      db.close()
    },
  }
}

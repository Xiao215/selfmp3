import { APP_NAME, APP_VERSION, loadConfig } from './config.js'
import { createContainer, type Container } from './container.js'
import { listenAddresses } from './services/addresses.js'
import { organizeLegacyImports } from './services/libraryLayout.js'
import { romanizeLibrary } from './services/romanizedLines.js'
import { createApp } from './app.js'

/**
 * Entry point.
 *
 * Boot order matters: configuration is validated before anything is opened, the
 * HTTP server starts listening *before* the initial library scan so the app is
 * usable immediately on a big library, and shutdown is graceful so an in-flight
 * download is cancelled cleanly rather than leaving a half-written file.
 */

function main(): void {
  const config = loadConfig()
  const container = createContainer(config)
  const logger = container.logger

  const app = createApp(container)
  let shuttingDown = false

  const server = app.listen(config.port, config.host, () => {
    logger.info(`${APP_NAME} ${APP_VERSION}`)
    for (const address of listenAddresses(config.host, config.port)) {
      logger.info(`listening on ${address.url}${address.tailscale ? '  (tailscale)' : ''}`)
    }
    if (config.authToken) logger.info('bearer token auth is enabled')
  })

  // Streaming a track over a slow phone connection can legitimately take a
  // while; the defaults would cut it off.
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 70_000
  server.requestTimeout = 0

  // Presence sweep and library-version watch for the event stream.
  container.devices.start()
  // Lyrics+: the Japanese dictionary takes a second or two; load it now, not on first tap.
  container.romanization.warmUp()

  // Songs imported before each had a folder move into one first: the scan, the
  // watcher and new imports all expect to find them there.
  void organizeLegacyImports(container)
    .then(moved => {
      if (moved > 0) container.bumpLibraryVersion()
    })
    .catch((error: unknown) => {
      logger.error('could not move imported songs into their folders', {
        message: error instanceof Error ? error.message : String(error),
      })
    })
    .finally(() => {
      if (!shuttingDown) startLibrary(container)
    })

  const autoScanMinutes = container.settings.get().autoScanMinutes
  let scanTimer: NodeJS.Timeout | null = null
  if (autoScanMinutes > 0) {
    scanTimer = setInterval(() => {
      void container.scanner
        .scan()
        .then(result => {
          if (result.added || result.updated || result.removed) container.bumpLibraryVersion()
        })
        .catch(() => undefined)
    }, autoScanMinutes * 60_000)
    // Do not hold the process open just for the timer.
    scanTimer.unref()
    logger.info('automatic rescan enabled', { everyMinutes: autoScanMinutes })
  }

  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`received ${signal}, shutting down`)

    if (scanTimer) clearInterval(scanTimer)
    container.libraryWatcher.stop()
    container.importQueue.stop()
    container.cloudSync.stop()
    // Let the machine sleep again even if a stream is still winding down.
    container.keepAwake.stop()

    // An event stream is answered and then held open for the life of the tab,
    // so `server.close` would wait on it forever and never call back — and the
    // database is closed in that callback. End the streams first and what is
    // left to wait for is ordinary requests, which do finish.
    container.devices.stop()

    server.close(() => {
      container.close()
      process.exit(0)
    })
    server.closeIdleConnections()

    // Do not hang forever on a stuck stream. Close the database on the way out
    // of this path too: leaving it open strands the write-ahead log.
    setTimeout(() => {
      logger.warn('forcing shutdown')
      container.close()
      process.exit(1)
    }, 10_000).unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  process.on('unhandledRejection', reason => {
    logger.error('unhandled promise rejection', {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })

  process.on('uncaughtException', error => {
    logger.error('uncaught exception', { message: error.message, stack: error.stack })
    shutdown('uncaughtException')
  })
}

/** The work that reads or writes the library folder, once it is in shape. */
function startLibrary(container: Container): void {
  const { config, logger } = container

  container.importQueue.start()
  // Rescan on folder changes (drag-and-drop into Finder) when the setting is on.
  container.libraryWatcher.apply()
  // Publishing, and any links other devices asked for while this server was off.
  const startCloud = (): void => {
    container.cloudSync.start()
    void container.cloudImports.process()
  }

  // Lyrics+: the search index, then romaji for every song with words, so a
  // phone's first request for a song's lyrics finds both already made.
  const warmLyrics = (): void => {
    void container.lyricsIndex
      .backfill()
      .then(() => romanizeLibrary({ ...container, logger }))
      .catch((error: unknown) => {
        logger.warn('romanizing the library stopped early', {
          message: error instanceof Error ? error.message : String(error),
        })
      })
  }

  if (!config.scanOnBoot) {
    warmLyrics()
    startCloud()
  }

  if (config.scanOnBoot) {
    // Deliberately not awaited: the API is already serving, and a first scan of
    // a large library should not delay that.
    void container.scanner
      .scan()
      .then(result => {
        if (result.added || result.updated || result.removed) container.bumpLibraryVersion()
        // Lyrics+: index lyrics for search once the scan knows which songs have them.
        warmLyrics()
      })
      .catch((error: unknown) => {
        logger.error('initial scan failed', {
          message: error instanceof Error ? error.message : String(error),
        })
      })
      // Publishing reads what the scan found, so it waits for it — however it went.
      .finally(startCloud)
  }
}

// Boot is synchronous — the initial scan is deliberately not awaited so the API
// starts serving immediately — so a plain try/catch is the honest shape here.
try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

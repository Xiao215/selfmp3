import { APP_NAME, APP_VERSION, loadConfig } from './config.js'
import { createContainer, type Container } from './container.js'
import { beyondThisComputer, listenAddresses } from './services/addresses.js'
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
  const configured = loadConfig()
  // Whether the token was chosen by hand, which only this line can still tell:
  // the container settles the rest against the database, so its config is the
  // one to serve from and its `authToken` is never null.
  const chosenByHand = configured.authToken !== null
  const container = createContainer(configured)
  const config = container.config
  const logger = container.logger

  const app = createApp(container)
  let shuttingDown = false

  const server = app.listen(config.port, config.host, () => {
    logger.info(`${APP_NAME} ${APP_VERSION}`)
    const addresses = listenAddresses(config.host, config.port)
    for (const address of addresses) {
      logger.info(`listening on ${address.url}${address.tailscale ? '  (tailscale)' : ''}`)
    }

    /*
     * Say plainly who else can reach this, and what stands in their way.
     *
     * The API is the whole library — reading it, editing it, deleting from it —
     * and the addresses below are load-bearing: a device signed in to the
     * bucket finds this server through them to import
     * (`packages/client/src/connection/reach.ts`), so they cannot simply be
     * closed to localhost. What guards them is the token, which there always is
     * now: every one of those devices is handed it with the sync, and a request
     * from this computer is not asked for one at all (`http/middleware.ts`).
     */
    const open = beyondThisComputer(addresses)
    if (open.length === 0) {
      logger.info('answering this computer only, which needs no token')
      return
    }
    logger.info(
      `a token guards these addresses: ${open.join(', ')} — your devices are given it with ` +
        'the sync, and requests from this computer need none',
    )

    if (chosenByHand) {
      logger.info('the token is the one in SELFMP3_AUTH_TOKEN')
      return
    }
    /*
     * The token itself, for the two cases nothing hands it to: this page opened
     * from another computer, and an extension pointed at a LAN address. It is a
     * secret in a log, which is worth a moment's thought — but this log is on
     * the machine whose data directory holds `selfmp3.db`, and anyone who can
     * read one can read the other. Printing it every boot rather than only the
     * first is what makes it findable at all without a SQLite client.
     */
    logger.info(`its token is ${config.authToken} — set SELFMP3_AUTH_TOKEN to choose your own`)
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

  startLibrary(container)

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

/** The work that reads or writes the library folder. */
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

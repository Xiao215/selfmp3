import { messageOf } from '@selfmp3/shared'
import { APP_NAME, APP_VERSION, loadConfig } from './config.js'
import { createHubApp } from './hub/app.js'
import { Hub } from './hub/hub.js'
import { speakHttp1 } from './http/outgoing.js'
import { createLogger, type Logger } from './logger.js'
import { beyondThisComputer, listenAddresses, publishedAddresses } from './services/addresses.js'

/**
 * Entry point.
 *
 * Boot order matters: configuration is validated before anything is opened, the
 * HTTP server starts listening *before* the initial library scan so the app is
 * usable immediately on a big library, and shutdown is graceful so an in-flight
 * download is cancelled cleanly rather than leaving a half-written file.
 */

function main(): void {
  speakHttp1()
  const config = loadConfig()
  const logger = createLogger(config.logLevel)
  const hub = new Hub(config, logger)

  const app = createHubApp(hub)
  let shuttingDown = false

  const server = app.listen(config.port, config.host, () => {
    logger.info(`${APP_NAME} ${APP_VERSION}`)
    for (const address of listenAddresses(config.host, config.port)) {
      logger.info(`listening on ${address.url}${address.tailscale ? '  (tailscale)' : ''}`)
    }
    // The public address is not one of those: nothing here listens on it, and
    // whatever does forwards to one of the lines above. It is published all the
    // same, so it belongs in the same part of the log.
    const addresses = publishedAddresses(config.host, config.port, config.publicUrl)
    if (config.publicUrl) sayWhatThePublicAddressIs(config.publicUrl, logger)

    /*
     * Say plainly who else can reach this, and what stands in their way.
     *
     * The API is the whole of every library here — reading it, editing it,
     * deleting from it — and the addresses below are load-bearing: a device
     * signed in to its bucket finds this server through them
     * (`packages/client/src/connection/reach.ts`), so they cannot simply be
     * closed to localhost. What guards them is each library's token: every one
     * of its devices is handed it with the sync, and a request from this
     * computer is not asked for one when there is only one library to mean.
     */
    const open = beyondThisComputer(addresses)
    if (open.length === 0) {
      logger.info('answering this computer only, which needs no token')
      return
    }
    logger.info(
      `each library’s token guards these addresses: ${open.join(', ')} — its devices are ` +
        'given it with the sync',
    )
    /*
     * The token itself, for the two cases nothing hands it to: this page opened
     * from another computer, and an extension pointed at a LAN address — on a
     * machine with one library, which is the only one these make sense on. It
     * is a secret in a log, which is worth a moment's thought — but this log is
     * on the machine whose data directory holds every token there is, and
     * anyone who can read one can read the other.
     */
    const only = hub.workspaces()
    if (only.length === 1 && only[0]) {
      logger.info(`its token is ${only[0].container.config.authToken}`)
    }
  })

  /*
   * `listen` fails asynchronously, so the try/catch around `main` never sees a
   * port that is already taken: with no listener the error is re-thrown and
   * lands in the `uncaughtException` handler below, which reports a crash with
   * a stack trace where the truth is one line. Exit non-zero either way: to a
   * supervisor a clean exit means "done", and this is not done.
   */
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(
        `port ${config.port} is already in use — another ${APP_NAME} is running, or set SELFMP3_PORT`,
      )
    } else {
      logger.error('could not listen', { message: error.message, code: error.code })
    }
    hub.close()
    process.exit(1)
  })

  // Streaming a track over a slow phone connection can legitimately take a
  // while; the defaults would cut it off.
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 70_000
  server.requestTimeout = 0

  // Lyrics+: the Japanese dictionary takes a second or two; load it now, not on first tap.
  hub.shared.romanization.warmUp()

  hub.start()

  /*
   * `code` is what the process exits with once everything has closed: 0 for a
   * signal, 1 for a crash. launchd and every other supervisor read that number
   * as "restart me or not", and a crash that walked out with 0 stayed down.
   */
  const shutdown = (signal: string, code = 0): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`received ${signal}, shutting down`)

    // Everything in the background, including the event streams: one is
    // answered and then held open for the life of the tab, so `server.close`
    // would wait on it forever and never call back — and the databases are
    // closed in that callback. Stop first and what is left to wait for is
    // ordinary requests, which do finish.
    hub.stop()

    server.close(() => {
      hub.close()
      process.exit(code)
    })
    server.closeIdleConnections()

    // Do not hang forever on a stuck stream. Close the databases on the way out
    // of this path too: leaving one open strands the write-ahead log.
    setTimeout(() => {
      logger.warn('forcing shutdown')
      hub.close()
      process.exit(1)
    }, 10_000).unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  process.on('unhandledRejection', reason => {
    logger.error('unhandled promise rejection', {
      message: messageOf(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })

  process.on('uncaughtException', error => {
    logger.error('uncaught exception', { message: error.message, stack: error.stack })
    shutdown('uncaughtException', 1)
  })
}

/**
 * What the public address is for, and the one way to get it wrong.
 *
 * An `http://` address here is the mistake worth catching at boot rather than
 * in a browser console days later: the published app is served over HTTPS, and
 * a browser refuses outright to let an HTTPS page call `http://` — so a plain
 * tunnel address is published, tried, and blocked, and the app simply says the
 * server is away. The address a tunnel hands you is already `https://`; typing
 * the port-forward you set up by hand is how you end up with the other kind.
 */
function sayWhatThePublicAddressIs(publicUrl: string, logger: Logger): void {
  logger.info(`published as reachable at ${publicUrl} (SELFMP3_PUBLIC_URL)`)
  if (!publicUrl.startsWith('https://')) {
    logger.warn(
      `${publicUrl} is not https, so the published app cannot call it at all — ` +
        'a browser blocks an http request from an https page. Put a tunnel in front of ' +
        'this server and publish the https address it gives you.',
    )
  }
}

// Boot is synchronous — the initial scan is deliberately not awaited so the API
// starts serving immediately — so a plain try/catch is the honest shape here.
try {
  main()
} catch (error) {
  console.error(messageOf(error))
  process.exit(1)
}

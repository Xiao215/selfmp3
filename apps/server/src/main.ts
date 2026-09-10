import os from 'node:os'
import { APP_NAME, APP_VERSION, loadConfig } from './config.js'
import { createContainer } from './container.js'
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

  const server = app.listen(config.port, config.host, () => {
    logger.info(`${APP_NAME} ${APP_VERSION}`)
    for (const url of localUrls(config.host, config.port)) {
      logger.info(`listening on ${url}`)
    }
    if (config.authToken) logger.info('bearer token auth is enabled')
  })

  // Streaming a track over a slow phone connection can legitimately take a
  // while; the defaults would cut it off.
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 70_000
  server.requestTimeout = 0

  container.importQueue.start()

  if (config.scanOnBoot) {
    // Deliberately not awaited: the API is already serving, and a first scan of
    // a large library should not delay that.
    void container.scanner
      .scan()
      .then(result => {
        if (result.added || result.updated || result.removed) container.bumpLibraryVersion()
      })
      .catch((error: unknown) => {
        logger.error('initial scan failed', {
          message: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const autoScanMinutes = container.settings.get().autoScanMinutes
  let scanTimer: NodeJS.Timeout | null = null
  if (autoScanMinutes > 0) {
    scanTimer = setInterval(
      () => {
        void container.scanner
          .scan()
          .then(result => {
            if (result.added || result.updated || result.removed) container.bumpLibraryVersion()
          })
          .catch(() => undefined)
      },
      autoScanMinutes * 60_000,
    )
    // Do not hold the process open just for the timer.
    scanTimer.unref()
    logger.info('automatic rescan enabled', { everyMinutes: autoScanMinutes })
  }

  let shuttingDown = false
  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`received ${signal}, shutting down`)

    if (scanTimer) clearInterval(scanTimer)
    container.importQueue.stop()

    server.close(() => {
      container.close()
      process.exit(0)
    })

    // Do not hang forever on a stuck stream.
    setTimeout(() => {
      logger.warn('forcing shutdown')
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

/** Every address this server can actually be reached on, for the boot log. */
function localUrls(host: string, port: number): string[] {
  if (host !== '0.0.0.0' && host !== '::') return [`http://${host}:${port}`]

  const urls = [`http://localhost:${port}`]
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue
      // Tailscale hands out addresses in 100.64.0.0/10 — worth calling out,
      // since that is the one that works from your phone anywhere.
      const isTailscale = /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(address.address)
      urls.push(`http://${address.address}:${port}${isTailscale ? '  (tailscale)' : ''}`)
    }
  }
  return urls
}

// Boot is synchronous — the initial scan is deliberately not awaited so the API
// starts serving immediately — so a plain try/catch is the honest shape here.
try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

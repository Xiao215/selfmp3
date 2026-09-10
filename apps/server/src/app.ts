import fs from 'node:fs'
import path from 'node:path'
import express, { type Express } from 'express'
import compression from 'compression'
import type { Container } from './container.js'
import { bearerAuth, cors, requestLogger, securityHeaders } from './http/middleware.js'
import { errorHandler, notFoundHandler } from './http/errors.js'
import { libraryRoutes } from './routes/library.js'
import { songRoutes } from './routes/songs.js'
import { mediaRoutes } from './routes/media.js'
import { tagRoutes } from './routes/tags.js'
import { playlistRoutes } from './routes/playlists.js'
import { importRoutes } from './routes/imports.js'
import { migrateRoutes } from './routes/migrate.js'
import { systemRoutes } from './routes/system.js'
import { metadataRoutes } from './routes/metadata.js'
import { lyricsRoutes } from './routes/lyrics.js'
import { wrappedRoutes } from './routes/wrapped.js'
import { gemsRoutes } from './routes/gems.js'

/**
 * Wire the HTTP layer.
 *
 * Middleware order is not arbitrary: security headers before anything can
 * respond, CORS before auth (so a preflight is not rejected for having no
 * token), auth before any route, and the error handler dead last so it catches
 * everything above it.
 */
export function createApp(container: Container): Express {
  const app = express()

  // Behind `tailscale serve`, so trust exactly one proxy hop for req.ip.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(securityHeaders())
  app.use(cors(container.config))
  app.use(requestLogger(container.logger))

  // Compress JSON, never audio: an m4a is already compressed, and gzipping it
  // would burn CPU while breaking the byte offsets that range requests need.
  app.use(
    compression({
      filter: (req, res) => {
        if (req.path.startsWith('/api/stream/') || req.path.startsWith('/api/art/')) return false
        return compression.filter(req, res)
      },
    }),
  )

  app.use(express.json({ limit: '1mb' }))
  app.use('/api', bearerAuth(container.config))

  const api = express.Router()
  api.use(libraryRoutes(container))
  api.use(songRoutes(container))
  api.use(mediaRoutes(container))
  api.use(tagRoutes(container))
  api.use(playlistRoutes(container))
  api.use(importRoutes(container))
  api.use(migrateRoutes(container))
  api.use(systemRoutes(container))
  api.use(metadataRoutes(container))
  api.use(lyricsRoutes(container))
  api.use(wrappedRoutes(container))
  api.use(gemsRoutes(container))
  app.use('/api', api)

  app.use('/api', notFoundHandler)

  if (container.config.serveWeb) {
    mountWebApp(app, container)
  }

  app.use(errorHandler(container.logger))

  return app
}

/**
 * Serve the built single-page app.
 *
 * Two rules make the PWA work correctly:
 *  - Hashed build assets are immutable and cached for a year.
 *  - `index.html` and the service worker are never cached, or the user would
 *    be stuck on an old build with no way to update.
 */
function mountWebApp(app: Express, container: Container): void {
  const webDir = container.config.webDir

  if (!fs.existsSync(path.join(webDir, 'index.html'))) {
    container.logger.warn('web app not built — run `npm run build`', { webDir })
    return
  }

  app.use(
    express.static(webDir, {
      index: false,
      etag: true,
      setHeaders: (res, filePath) => {
        const base = path.basename(filePath)
        if (base === 'sw.js' || base === 'index.html' || base === 'manifest.webmanifest') {
          res.setHeader('Cache-Control', 'no-cache')
        } else if (/\.[0-9a-f]{8,}\./.test(base)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        } else {
          res.setHeader('Cache-Control', 'public, max-age=3600')
        }
      },
    }),
  )

  // Client-side routing: any non-API path falls through to the app shell.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    // `root` + relative name: with an absolute path, `send` applies its
    // dotfile check to every directory on the way, so a checkout living under
    // a `.something` folder would 404 its own shell.
    res.sendFile('index.html', { root: webDir })
  })

  container.logger.debug('serving web app', { webDir })
}

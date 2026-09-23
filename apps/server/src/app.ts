import express, { type Express } from 'express'
import compression from 'compression'
import type { Container } from './container.js'
import {
  bearerAuth,
  cors,
  requestLogger,
  requireCloud,
  sameOriginWrites,
  securityHeaders,
} from './http/middleware.js'
import { errorHandler, notFoundHandler } from './http/errors.js'
import { mountAdminPage } from './http/admin.js'
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
import { deviceRoutes } from './routes/devices.js'
import { wrappedRoutes } from './routes/wrapped.js'
import { gemsRoutes } from './routes/gems.js'
import { cloudRoutes } from './routes/cloud.js'

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
        // An event stream must reach the client unbuffered, or nothing is live.
        if (req.path === '/api/events') return false
        return compression.filter(req, res)
      },
    }),
  )

  app.use(express.json({ limit: '1mb' }))
  app.use('/api', sameOriginWrites(container.config))
  app.use('/api', bearerAuth(container.config))
  // The library is the bucket's: until one is connected there is none to serve.
  app.use(
    '/api',
    requireCloud(() => container.cloudSync.connected),
  )

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
  api.use(deviceRoutes(container))
  api.use(wrappedRoutes(container))
  api.use(gemsRoutes(container))
  api.use(cloudRoutes(container))
  app.use('/api', api)

  app.use('/api', notFoundHandler)

  mountAdminPage(app)

  app.use(errorHandler(container.logger))

  return app
}

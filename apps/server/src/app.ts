import express, { type Express, type Router } from 'express'
import compression from 'compression'
import type { Config } from './config.js'
import type { Container } from './container.js'
import type { Logger } from './logger.js'
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
import { importDeviceRoutes } from './routes/importDevice.js'
import { systemRoutes } from './routes/system.js'
import { metadataRoutes } from './routes/metadata.js'
import { aiRoutes } from './routes/ai.js'
import { lyricsRoutes } from './routes/lyrics.js'
import { deviceRoutes } from './routes/devices.js'
import { wrappedRoutes } from './routes/wrapped.js'
import { gemsRoutes } from './routes/gems.js'
import { cloudRoutes } from './routes/cloud.js'
import { artistRoutes } from './routes/artists.js'

/**
 * Wire the HTTP layer.
 *
 * Middleware order is not arbitrary: security headers before anything can
 * respond, CORS before auth (so a preflight is not rejected for having no
 * token), auth before any route, and the error handler dead last so it catches
 * everything above it.
 *
 * Two shapes share it. `createApp` serves one library, as a test or a laptop
 * with a folder for a bucket wants. A server working for several accounts
 * serves each library's `libraryApi` behind the hub's own door instead
 * (hub/app.ts), which finds the library a request is for by its token.
 */
export function createApp(container: Container): Express {
  const app = frame(container.config, container.logger)
  app.use('/api', bearerAuth(container.config))
  app.use('/api', libraryApi(container))
  return finish(app, container.logger)
}

/**
 * Everything in front of the API: headers, CORS, the log, compression, JSON
 * bodies, and refusing other sites' writes. The same for one library or many.
 */
export function frame(config: Config, logger: Logger): Express {
  const app = express()

  // Behind `tailscale serve`, so trust exactly one proxy hop for req.ip.
  app.set('trust proxy', 1)

  app.disable('x-powered-by')

  app.use(securityHeaders())
  app.use(cors(config))
  app.use(requestLogger(logger))

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
  app.use('/api', sameOriginWrites(config))
  return app
}

/** The API's own 404, then the server's page, then the one error handler. */
export function finish(app: Express, logger: Logger): Express {
  app.use('/api', notFoundHandler)
  mountAdminPage(app)
  app.use(errorHandler(logger))
  return app
}

/**
 * One library's API, mounted at `/api`, for a request already let in.
 *
 * The library is the bucket's: until one is connected there is none to
 * serve, so everything but connecting one waits for it.
 */
export function libraryApi(container: Container): Router {
  const api = express.Router()
  api.use(requireCloud(() => container.cloudSync.connected))
  api.use(libraryRoutes(container))
  api.use(songRoutes(container))
  api.use(mediaRoutes(container))
  api.use(tagRoutes(container))
  api.use(playlistRoutes(container))
  api.use(importRoutes(container))
  api.use(importDeviceRoutes(container))
  api.use(systemRoutes(container))
  api.use(metadataRoutes(container))
  api.use(aiRoutes(container))
  api.use(lyricsRoutes(container))
  api.use(deviceRoutes(container))
  api.use(wrappedRoutes(container))
  api.use(gemsRoutes(container))
  api.use(cloudRoutes(container))
  api.use(artistRoutes(container))
  return api
}

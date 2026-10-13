import { Router, type Express, type NextFunction, type Request, type Response } from 'express'
import type { CloudServer, Health, HubStatus } from '@selfmp3/shared'
import { finish, frame } from '../app.js'
import { APP_VERSION } from '../config.js'
import { HttpError } from '../http/errors.js'
import { isLocalRequest } from '../http/local.js'
import { tokenOf } from '../http/middleware.js'
import { route } from '../http/route.js'
import type { Hub } from './hub.js'

/**
 * The HTTP door of a server working for several accounts
 * (docs/features/shared-server.md).
 *
 * In front of every library's API is the same frame one library has (app.ts);
 * then the hub's own few routes, which need no library; then the library the
 * request's token belongs to, which answers as a server of its own always did.
 * A request with no token, or one nobody here was given, gets 401 — except the
 * health check, which a monitor asks without one.
 */
export function createHubApp(hub: Hub): Express {
  const app = frame(hub.config, hub.logger)
  app.use('/api', hubRoutes(hub))
  app.use('/api', (req: Request, res: Response, next: NextFunction): void => {
    const workspace = hub.resolve(req)
    if (workspace) {
      workspace.api(req, res, next)
      return
    }
    if (req.path === '/health') {
      const health: Health = {
        ok: true,
        version: APP_VERSION,
        uptimeSeconds: Math.round(process.uptime()),
        appUrl: hub.config.appUrl,
      }
      res.json(health)
      return
    }
    next(tokenOf(req) === null ? HttpError.unauthorized() : HttpError.unauthorized('invalid token'))
  })
  return finish(app, hub.logger)
}

function hubRoutes(hub: Hub): Router {
  const router = Router()

  /**
   * Work for this account: the device's doorman session as the bearer, once.
   * The answer is what the device talks to its library here with.
   */
  router.post(
    '/hub/join',
    route({}, async ({ req }): Promise<CloudServer> => {
      const session = tokenOf(req)
      if (session === null) throw HttpError.unauthorized('send your doorman session')
      // A library's own token is not a session: this account is here already.
      const already = hub.resolve(req)
      if (already?.entry) return { addresses: hub.addresses(), token: already.entry.token }
      return hub.join(session)
    }),
  )

  /** Stop working for this account: the library's own token as the bearer. */
  router.delete(
    '/hub/join',
    route({}, async ({ req }): Promise<{ ok: true }> => {
      const workspace = tokenOf(req) === null ? null : hub.resolve(req)
      if (!workspace) throw HttpError.unauthorized()
      await hub.leave(workspace, 'its account asked')
      return { ok: true }
    }),
  )

  /**
   * Whom this server works for, for its own page. Only from this machine:
   * the list is everyone's addresses, and nobody else's business.
   */
  router.get(
    '/hub',
    route({}, ({ req }): HubStatus => {
      if (!isLocalRequest(req)) throw HttpError.forbidden('only from this computer')
      return {
        workspaces: hub.workspaces().map(({ entry, container }) => ({
          id: entry?.id ?? 'local',
          email: entry?.email ?? null,
          songs: container.songs.count(),
          connected: container.cloudSync.connected,
          joinedAt: entry?.joinedAt ?? null,
        })),
      }
    }),
  )

  return router
}

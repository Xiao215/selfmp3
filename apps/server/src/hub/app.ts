import { Router, type Express, type NextFunction, type Request, type Response } from 'express'
import {
  HUB_CHECK_PATH,
  HUB_LIBRARY_HEADER,
  HubCheckSchema,
  plural,
  type CloudServer,
  type Health,
  type HubStatus,
} from '@selfmp3/shared'
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
  const app = frame(hub.config, hub.logger, hub.shared.metrics)
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
        serverId: hub.shared.serverId,
        uptimeSeconds: Math.round(process.uptime()),
        appUrl: hub.config.appUrl,
      }
      res.json(health)
      return
    }
    next(refusal(hub, req))
  })
  return finish(app, hub.logger)
}

/**
 * Why no library took a request. From this machine it is said plainly: the
 * server's page and the `selfmp3` command show it as it is.
 */
function refusal(hub: Hub, req: Request): HttpError {
  if (tokenOf(req) !== null) return HttpError.unauthorized('invalid token')
  if (!isLocalRequest(req)) return HttpError.unauthorized()
  const named = req.get(HUB_LIBRARY_HEADER)
  if (named) return HttpError.notFound(`no library here is ${named}`)
  const count = hub.workspaces().length
  return HttpError.unauthorized(
    count === 0
      ? 'this server works for no libraries yet'
      : `this server works for ${plural(count, 'library', 'libraries')}; say which`,
  )
}

function hubRoutes(hub: Hub): Router {
  const router = Router()

  /**
   * Work for this account: the device's doorman session as the bearer, once.
   * The answer is what the device talks to its library here with.
   *
   * There is no route to leave by. An account takes its grant back at the
   * doorman (Settings › Account › Computers › Remove), which works while this
   * server is off. The doorman then tells this server (`/hub/check`, below);
   * one that was off, or missed it, lets the library go once its next look at
   * the bucket is refused (`Hub`, `#sessionEnded`).
   */
  router.post(
    '/hub/join',
    route({}, async ({ req }): Promise<CloudServer> => {
      const session = tokenOf(req)
      if (session === null) throw HttpError.unauthorized('send your doorman session')
      // A library's own token is not a session: this account is here already.
      const already = hub.resolve(req)
      if (already?.entry) return hub.answer(already.entry)
      return hub.join(session)
    }),
  )

  /**
   * The doorman saying a grant was taken back. No token: the notice proves
   * nothing and asks for nothing but a look, which the server makes with the
   * grant's own token (`Hub.check`). The answer is the same whatever the grant,
   * so it tells a stranger nothing about which grants are held here.
   */
  router.post(
    HUB_CHECK_PATH.slice('/api'.length),
    route({ body: HubCheckSchema }, ({ body }): undefined => {
      hub.check(body.grant)
      return undefined
    }),
  )

  /**
   * Whom this server works for, for its own page and the `selfmp3` command.
   * Only from this machine: the list is everyone's addresses, and nobody
   * else's business.
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

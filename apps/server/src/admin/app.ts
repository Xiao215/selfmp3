import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import {
  DOORMAN_PATHS,
  SignInAttemptSchema,
  signInStartUrl,
  type AdminData,
  type AdminServer,
  type AdminSignIn,
} from '@selfmp3/shared'
import { APP_VERSION } from '../config.js'
import { errorHandler, HttpError } from '../http/errors.js'
import { route } from '../http/route.js'
import type { Hub } from '../hub/hub.js'
import { utcDay } from '../services/metrics.js'
import { diskOf, memoryOf, SmartProbe } from './status.js'

/**
 * The owner's admin page (docs/features/admin.md): its own listener, on this
 * machine only, which `tailscale serve` puts on the owner's tailnet.
 *
 * Nothing on it names a person or a library: the Data tab is totals, and the
 * Access tab talks to the doorman straight from the browser, signed in as the
 * owner, so this server is not asked to hold anyone's session.
 *
 * The page is plain files with no build step, as the old server page was,
 * read from `apps/server/admin` beside `src` and `dist` alike.
 */
export const ADMIN_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'admin',
)

/** The tabs, each its own address so a bookmark opens it. */
const TABS = ['/', '/data', '/access', '/server']

const DaysSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) })

export function createAdminApp(hub: Hub): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(onlyOwnNames(hub.config.adminUrl))
  app.use(adminHeaders(hub.config.doormanUrl))

  const smart = new SmartProbe(hub.config.ai.baseUrl)

  app.get(
    '/api/admin/server',
    route({}, async (): Promise<AdminServer> => {
      const throttle = hub.shared.throttle
      const pausedUntil = throttle?.status().pausedUntil ?? null
      const lastLimited = throttle?.lastLimitedAt() ?? null
      return {
        version: APP_VERSION,
        uptimeSeconds: Math.round(process.uptime()),
        libraries: hub.workspaces().length,
        disk: diskOf(hub.config.dataDir),
        memory: memoryOf(),
        smart: await smart.state(),
        youtube: {
          heldUntil: pausedUntil === null ? null : new Date(pausedUntil).toISOString(),
          lastHeldAt: lastLimited === null ? null : new Date(lastLimited).toISOString(),
        },
        doorman: hub.config.doormanUrl
          ? {
              url: hub.config.doormanUrl,
              paths: {
                claim: DOORMAN_PATHS.claim,
                me: DOORMAN_PATHS.me,
                access: DOORMAN_PATHS.access,
                accessRequests: DOORMAN_PATHS.accessRequests,
                stats: DOORMAN_PATHS.stats,
              },
            }
          : null,
      }
    }),
  )

  /*
   * Where to send the browser to sign in, brought back to the tab it left.
   * Only to this page's own address: the doorman sends the code there, and it
   * is the one the doorman's APP_ORIGINS lists.
   */
  app.get(
    '/api/admin/signin',
    route(
      {
        query: z.object({
          attempt: SignInAttemptSchema,
          tab: z.enum(['data', 'access', 'server']),
        }),
      },
      ({ query, req }): AdminSignIn => {
        if (!hub.config.doormanUrl) throw HttpError.notFound('this server has no doorman')
        const own = hub.config.adminUrl ?? `http://${req.headers.host ?? 'localhost'}`
        return { url: signInStartUrl(hub.config.doormanUrl, query.attempt, `${own}/${query.tab}`) }
      },
    ),
  )

  app.get(
    '/api/admin/data',
    route({ query: DaysSchema }, ({ query }): AdminData => {
      const from = utcDay(Date.now() - (query.days - 1) * 24 * 60 * 60 * 1000)
      // Every library's plays, added up: the one thing here the libraries keep.
      const plays = new Map<string, number>()
      for (const { container } of hub.workspaces()) {
        for (const [day, count] of container.stats.playsByDay(from)) {
          plays.set(day, (plays.get(day) ?? 0) + count)
        }
      }
      return hub.shared.metrics.summary(query.days, plays)
    }),
  )

  app.use('/api', (_req: Request, _res: Response, next: NextFunction) => {
    next(HttpError.notFound('no such endpoint'))
  })

  app.use(
    express.static(ADMIN_DIR, {
      index: false,
      setHeaders: response => response.setHeader('Cache-Control', 'no-cache'),
    }),
  )
  app.get(TABS, (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache')
    // `root` plus a relative name, as the old page did: an absolute path
    // under a dot-folder (a worktree) would trip `send`'s dotfile rule.
    res.sendFile('index.html', { root: ADMIN_DIR })
  })

  app.use(errorHandler(hub.logger))
  return app
}

/**
 * Only this machine's own names, and the tailnet address `tailscale serve`
 * gives the page. A site elsewhere that points a name of its own at 127.0.0.1
 * (DNS rebinding) is turned away by the name it asked for.
 */
function onlyOwnNames(adminUrl: string | null) {
  const allowed = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (adminUrl) allowed.add(new URL(adminUrl).hostname.toLowerCase())
  return (req: Request, res: Response, next: NextFunction): void => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase()
    if (allowed.has(host)) {
      next()
      return
    }
    res.status(421).type('text').send('This page answers only on its own address.')
  }
}

/**
 * The page's own policy: its own scripts only, its styles, the app's display
 * face from Google Fonts, and the doorman, which the Access tab and the
 * doorman's counts are read from.
 */
function adminHeaders(doormanUrl: string) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    // Inline styles: a bar's width and a swatch's colour are set on the element.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    `connect-src 'self'${doormanUrl ? ` ${doormanUrl}` : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Content-Security-Policy', csp)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()')
    next()
  }
}

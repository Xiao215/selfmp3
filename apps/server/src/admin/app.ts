import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import {
  DOORMAN_PATHS,
  DoormanAccessSchema,
  DoormanAccessUpdateSchema,
  DoormanStatsSchema,
  messageOf,
  type AdminData,
  type DoormanAccess,
  type DoormanStats,
} from '@selfmp3/shared'
import type { Config } from '../config.js'
import { errorHandler, HttpError } from '../http/errors.js'
import { route } from '../http/route.js'
import type { Hub } from '../hub/hub.js'
import { utcDay } from '../services/metrics.js'
import { SmartProbe } from './status.js'

/**
 * The owner's admin page (docs/features/admin.md): its own listener, on this
 * machine only, which `tailscale serve` puts on the owner's tailnet.
 *
 * Reaching it is the proof that it is the owner, so nothing on it signs in.
 * What the doorman keeps — who can sign in, and what it counted — this server
 * asks for with the doorman's admin key (SELFMP3_DOORMAN_ADMIN_TOKEN), and the
 * page asks this server. Nothing on it names a library: the Data tab is totals.
 *
 * The page is plain files with no build step, read from `apps/server/admin`
 * beside `src` and `dist` alike.
 */
export const ADMIN_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'admin',
)

/** The tabs, each its own address so a bookmark opens it. */
const TABS = ['/', '/data', '/people']

const DaysSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) })

/** How long the page waits on the doorman before saying it did not answer. */
const DOORMAN_TIMEOUT_MS = 8_000

export function createAdminApp(hub: Hub): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(onlyOwnNames(hub.config.adminUrl))
  app.use(adminHeaders())
  app.use(express.json({ limit: '64kb' }))

  const smart = new SmartProbe(hub.config.ai.baseUrl)
  const doorman = doormanFor(hub.config)

  app.get(
    '/api/admin/data',
    route({ query: DaysSchema }, async ({ query }): Promise<AdminData> => {
      const from = utcDay(Date.now() - (query.days - 1) * 24 * 60 * 60 * 1000)
      // Every library's plays, added up: the one thing here the libraries keep.
      const plays = new Map<string, number>()
      for (const { container } of hub.workspaces()) {
        for (const [day, count] of container.stats.playsByDay(from)) {
          plays.set(day, (plays.get(day) ?? 0) + count)
        }
      }
      const [counted, smartState] = await Promise.all([
        doorman.stats(query.days).then(
          stats => ({ stats, problem: null }),
          (error: unknown) => ({ stats: null, problem: messageOf(error) }),
        ),
        smart.state(),
      ])
      const pausedUntil = hub.shared.throttle?.status().pausedUntil ?? null
      return {
        ...hub.shared.metrics.summary(query.days, plays),
        doorman: counted.stats,
        doormanProblem: counted.problem,
        status: {
          smart: smartState,
          youtubeHeldUntil: pausedUntil === null ? null : new Date(pausedUntil).toISOString(),
        },
      }
    }),
  )

  app.get(
    '/api/admin/people',
    route({}, (): Promise<DoormanAccess> => doorman.people()),
  )

  // Only a JSON body is read here, which a page elsewhere cannot send
  // without asking first, and this listener answers no such asking (no CORS).
  app.put(
    '/api/admin/people',
    route({ body: DoormanAccessUpdateSchema }, ({ body }): Promise<DoormanAccess> =>
      doorman.setPeople(body),
    ),
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
    // `root` plus a relative name: an absolute path under a dot-folder (a
    // worktree) would trip `send`'s dotfile rule.
    res.sendFile('index.html', { root: ADMIN_DIR })
  })

  app.use(errorHandler(hub.logger))
  return app
}

interface AdminDoorman {
  stats(days: number): Promise<DoormanStats>
  people(): Promise<DoormanAccess>
  setPeople(update: z.infer<typeof DoormanAccessUpdateSchema>): Promise<DoormanAccess>
}

/** The doorman, asked with its admin key; each refusal in words the page can show. */
function doormanFor(config: Pick<Config, 'doormanUrl' | 'doormanAdminToken'>): AdminDoorman {
  const ask = async <T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> => {
    if (!config.doormanUrl) throw HttpError.failedDependency('This server has no doorman.')
    if (!config.doormanAdminToken) {
      throw HttpError.failedDependency(
        'Set SELFMP3_DOORMAN_ADMIN_TOKEN to the doorman’s ADMIN_TOKEN to see this.',
      )
    }
    let response: globalThis.Response
    try {
      response = await fetch(`${config.doormanUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${config.doormanAdminToken}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(DOORMAN_TIMEOUT_MS),
      })
    } catch {
      throw HttpError.failedDependency('The doorman did not answer.')
    }
    if (response.status === 401 || response.status === 403) {
      throw HttpError.failedDependency(
        'The doorman did not take the admin key: check that SELFMP3_DOORMAN_ADMIN_TOKEN matches its ADMIN_TOKEN.',
      )
    }
    if (!response.ok) throw HttpError.failedDependency(`The doorman answered ${response.status}.`)
    return schema.parse(await response.json())
  }
  return {
    stats: days => ask(`${DOORMAN_PATHS.stats}?days=${days}`, DoormanStatsSchema),
    people: () => ask(DOORMAN_PATHS.access, DoormanAccessSchema),
    setPeople: update =>
      ask(DOORMAN_PATHS.access, DoormanAccessSchema, {
        method: 'PUT',
        body: JSON.stringify(update),
      }),
  }
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
 * The page's own policy: its own scripts and requests only, its styles (a
 * bar's width is set on the element), and the app's two faces from Google Fonts.
 */
function adminHeaders() {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
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

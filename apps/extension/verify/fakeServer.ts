import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EXTENSION_ORIGIN, type ImportEnqueue, type ImportJob } from '@selfmp3/shared'
import { fixtureLibrary, previewFor } from './fixtures.js'

export const TOKEN = 'fake-token'

export interface FakeServer {
  readonly url: string
  /** Every request, with the `Origin` it carried. */
  readonly requests: readonly { method: string; path: string; origin: string | null }[]
  /** The body of every enqueue. */
  readonly enqueued: readonly ImportEnqueue[]
  close(): Promise<void>
}

/** Where a job goes each time the queue is read. */
const STEPS: readonly Pick<ImportJob, 'status' | 'step' | 'progress'>[] = [
  { status: 'queued', step: 'waiting', progress: null },
  { status: 'running', step: 'downloading', progress: 30 },
  { status: 'running', step: 'downloading', progress: 70 },
  { status: 'running', step: 'lyrics', progress: null },
  { status: 'done', step: 'finished', progress: 100 },
]

const now = (): string => new Date().toISOString().slice(0, 19).replace('T', ' ')

/**
 * A self.mp3 server with the part of the API the extension uses, and the real
 * server's two rules about who may ask: a write from an origin it does not know
 * is refused (`sameOriginWrites` in apps/server/src/http/middleware.ts), and
 * everything but `/api/health` needs the token. A job moves a step each time the
 * queue is read, so a spec sees it download and finish without waiting on yt-dlp.
 */
export async function startFakeServer(): Promise<FakeServer> {
  const library = fixtureLibrary()
  const requests: { method: string; path: string; origin: string | null }[] = []
  const enqueued: ImportEnqueue[] = []
  const jobs: ImportJob[] = []
  const stage = new Map<string, number>()

  const send = (res: ServerResponse, status: number, body?: unknown): void => {
    res.statusCode = status
    if (body === undefined) {
      res.end()
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }

  const readJson = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') as unknown
  }

  const advance = (job: ImportJob): void => {
    if (job.status === 'cancelled' || job.status === 'done') return
    const next = Math.min((stage.get(job.id) ?? 0) + 1, STEPS.length - 1)
    stage.set(job.id, next)
    Object.assign(
      job,
      STEPS[next],
      { updatedAt: now() },
      next === STEPS.length - 1 ? { songId: 99 } : {},
    )
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', 'http://fake')
    const origin = req.headers.origin ?? null
    requests.push({ method, path: url.pathname, origin })

    if (origin === EXTENSION_ORIGIN) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
    if (method === 'OPTIONS') return send(res, 204)
    if (method !== 'GET' && origin !== null && origin !== EXTENSION_ORIGIN) {
      return send(res, 403, { error: 'that request came from another site', code: 'forbidden' })
    }

    const authorised = req.headers.authorization === `Bearer ${TOKEN}`
    if (url.pathname === '/api/health') {
      return send(res, 200, {
        ok: true,
        version: 'fake',
        uptimeSeconds: 1,
        storageDriver: 'local',
        ...(authorised ? { songCount: library.songs.length } : {}),
      })
    }
    if (!authorised) return send(res, 401, { error: 'invalid token', code: 'unauthorized' })

    switch (`${method} ${url.pathname}`) {
      case 'GET /api/library/version':
        return send(res, 200, { version: library.version, songCount: library.songs.length })
      case 'GET /api/library':
        return send(res, 200, library)
      case 'GET /api/settings':
        return send(res, 200, { defaultImportTagIds: [1] })
      case 'POST /api/import/preview': {
        const body = (await readJson(req)) as { url: string }
        const answer = previewFor(body.url)
        return send(res, answer.status, answer.body)
      }
      case 'POST /api/import/enqueue': {
        const body = (await readJson(req)) as ImportEnqueue
        enqueued.push(body)
        const created = body.items.map((item, index): ImportJob => ({
          id: `00000000-0000-4000-8000-${String(jobs.length + index + 1).padStart(12, '0')}`,
          url: item.url,
          ...STEPS[0],
          title: item.title,
          artist: item.artist,
          album: item.album,
          thumbnail: item.thumbnail,
          duration: item.duration,
          error: null,
          songId: null,
          attempts: 0,
          tagIds: body.tagIds,
          createdAt: now(),
          updatedAt: now(),
        }))
        jobs.unshift(...created)
        return send(res, 200, { jobs: created, skipped: 0, playlistId: body.playlistId })
      }
      case 'GET /api/import/queue': {
        jobs.forEach(advance)
        return send(res, 200, {
          jobs,
          active: jobs.filter(job => job.status === 'running').length,
          queued: jobs.filter(job => job.status === 'queued').length,
        })
      }
    }

    const action = /^\/api\/import\/jobs\/([^/]+)\/(cancel|retry)$/.exec(url.pathname)
    const job = action ? jobs.find(each => each.id === action[1]) : undefined
    if (method === 'POST' && action && job) {
      if (action[2] === 'cancel') Object.assign(job, { status: 'cancelled', updatedAt: now() })
      else {
        stage.set(job.id, 0)
        Object.assign(job, STEPS[0], { error: null, updatedAt: now() })
      }
      return send(res, 200, { ok: true })
    }
    return send(res, 404, { error: 'not found', code: 'not_found' })
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      send(res, 500, {
        error: error instanceof Error ? error.message : String(error),
        code: 'error',
      })
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    enqueued,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

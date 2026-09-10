import { describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { MigrateService, type Searcher } from './migrate.js'

/**
 * The job runner, with YouTube replaced by a fake searcher. What matters here
 * is the shape of the job over time: progress counts up, results land at the
 * right index, at most three searches run at once, and cancel actually stops.
 */

const logger = createLogger('silent')
const tracks = (titles: string[]) =>
  titles.map(title => ({ title, artist: 'Someone', album: '', duration: 200 }))

function makeSearcher(options: { delayMs?: number; failOn?: string } = {}) {
  let inFlight = 0
  let peak = 0
  const searcher: Searcher = async (query, signal) => {
    inFlight++
    peak = Math.max(peak, inFlight)
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, options.delayMs ?? 5)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('aborted'))
        })
      })
      if (options.failOn && query.includes(options.failOn)) throw new Error('search exploded')
      return [
        {
          url: `https://www.youtube.com/watch?v=${query.length}`,
          title: query,
          channel: 'Someone - Topic',
          duration: 200,
          thumbnail: null,
        },
      ]
    } finally {
      inFlight--
    }
  }
  return { searcher, peak: () => peak }
}

async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('MigrateService.startMatch', () => {
  it('reports progress and fills results in order', async () => {
    const { searcher, peak } = makeSearcher({ delayMs: 10 })
    const service = new MigrateService({ songs: { all: () => [] }, logger, search: searcher })

    const job = service.startMatch(tracks(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']))
    expect(job.status).toBe('running')
    expect(job.completed).toBe(0)
    expect(job.items).toHaveLength(7)

    await until(() => service.job(job.id)?.status === 'done')
    const done = service.job(job.id)!
    expect(done.completed).toBe(7)
    expect(done.items.map(item => item?.source.title)).toEqual([
      'One',
      'Two',
      'Three',
      'Four',
      'Five',
      'Six',
      'Seven',
    ])
    expect(done.items[0]?.candidates[0]?.confidence).toBeGreaterThan(0.8)
    expect(peak()).toBe(3)
  })

  it('records a failed search on the item instead of failing the job', async () => {
    const { searcher } = makeSearcher({ failOn: 'Bad' })
    const service = new MigrateService({ songs: { all: () => [] }, logger, search: searcher })
    const job = service.startMatch(tracks(['Good', 'Bad']))
    await until(() => service.job(job.id)?.status === 'done')
    const done = service.job(job.id)!
    expect(done.items[0]?.error).toBeNull()
    expect(done.items[1]?.error).toBe('search exploded')
    expect(done.items[1]?.candidates).toEqual([])
  })

  it('flags tracks that are already in the library', async () => {
    const { searcher } = makeSearcher()
    const songs = { all: () => [{ title: 'One', artist: 'someone' }] as never[] }
    const service = new MigrateService({ songs, logger, search: searcher })
    const job = service.startMatch(tracks(['One', 'Two']))
    await until(() => service.job(job.id)?.status === 'done')
    expect(service.job(job.id)!.items.map(item => item?.alreadyHave)).toEqual([true, false])
  })

  it('can be cancelled and then refuses a second cancel', async () => {
    const { searcher } = makeSearcher({ delayMs: 200 })
    const service = new MigrateService({ songs: { all: () => [] }, logger, search: searcher })
    const job = service.startMatch(tracks(['One', 'Two', 'Three', 'Four']))
    expect(service.cancel(job.id)).toBe(true)
    expect(service.cancel(job.id)).toBe(false)
    expect(service.job(job.id)?.status).toBe('cancelled')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(service.job(job.id)?.completed).toBe(0)
  })

  it('returns null for an unknown job', () => {
    const service = new MigrateService({
      songs: { all: () => [] },
      logger,
      search: makeSearcher().searcher,
    })
    expect(service.job('nope')).toBeNull()
    expect(service.cancel('nope')).toBe(false)
  })
})

describe('MigrateService.parse', () => {
  it('parses pasted text without touching the network', async () => {
    const service = new MigrateService({
      songs: { all: () => [] },
      logger,
      search: makeSearcher().searcher,
    })
    const result = await service.parse('Adele - Hello\nAdele - Skyfall')
    expect(result.kind).toBe('text')
    expect(result.tracks).toHaveLength(2)
  })
})

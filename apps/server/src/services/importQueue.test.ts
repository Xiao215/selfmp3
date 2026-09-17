import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { ImportRepository } from '../repositories/imports.js'
import { SettingsRepository } from '../repositories/settings.js'
import { ThrottleRepository } from '../repositories/throttle.js'
import { ImportQueueService } from './importQueue.js'
import { YtThrottleService } from './ytThrottle.js'

/**
 * What the worker does with a download that did not work.
 *
 * Two answers, and telling them apart is the whole point: a song that cannot
 * be downloaded is a failure a person should see and decide about, while
 * YouTube refusing the address for rate says nothing about the song and must
 * not consume it. Everything below drives the real queue against a real
 * SQLite; only the things that would touch the network or the disk are stood
 * in for.
 */

/** Waits for the worker to settle, which it does across a few microtasks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

describe('ImportQueueService, when a download fails', () => {
  let imports: ImportRepository
  let throttle: YtThrottleService
  let queue: ImportQueueService
  let download: ReturnType<typeof vi.fn>
  let db: Database.Database
  let now: number

  beforeEach(() => {
    now = 1_700_000_000_000
    db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    imports = new ImportRepository(db)
    const settings = new SettingsRepository(db)
    throttle = new YtThrottleService(
      new ThrottleRepository(db),
      () => false,
      () => now,
    )

    download = vi.fn()
    /** Stands in for a step no test here reaches; reaching one is the bug. */
    const nothing = (): never => {
      throw new Error('the test should not have got this far')
    }

    queue = new ImportQueueService({
      config: { dataDir: '/tmp/selfmp3-test' },
      storage: { write: nothing, exists: async () => false },
      imports,
      songs: { byId: () => null },
      tags: { exists: () => [] },
      playlists: { byId: () => null },
      settings,
      scanner: { ingest: nothing },
      lyrics: { fetchRemote: async () => null },
      covers: { saveFromUrl: nothing },
      ytdlp: {
        status: async () => ({ ytdlp: true, ffmpeg: true, ytdlpVersion: '2026.08.19' }),
        download,
        probe: nothing,
        probeDuration: async () => 0,
      },
      cloud: { connected: false, uploadSong: nothing, kick: () => undefined },
      keepAwake: { hold: () => () => undefined },
      throttle,
      logger: createLogger('silent'),
    })
  })

  /** One job, already named so the worker does not have to probe for a title. */
  function enqueueOne(): string {
    const [job] = imports.enqueue(
      [
        {
          url: 'https://www.youtube.com/watch?v=6I1SNW0tVYk',
          title: 'Where Mercy Endures',
          artist: 'HOYO-MiX',
          album: '',
          thumbnail: null,
          duration: 0,
        },
      ],
      [],
      null,
    )
    if (!job) throw new Error('nothing was queued')
    return job.id
  }

  it('leaves a broken song failed, and does not try it again', async () => {
    download.mockRejectedValue(new Error('Private video. Sign in if you have been granted access'))
    const id = enqueueOne()

    queue.kick()
    await settle()

    const job = imports.byId(id)
    expect(job?.status).toBe('error')
    expect(job?.error).toMatch(/Private video/)
    // Tried once. A second attempt would mean the queue retried by itself.
    expect(download).toHaveBeenCalledTimes(1)
    expect(job?.attempts).toBe(1)
  })

  it('puts a rate-limited song back in the queue instead of failing it', async () => {
    download.mockRejectedValue(new Error('Sign in to confirm you’re not a bot'))
    const id = enqueueOne()

    queue.kick()
    await settle()

    const job = imports.byId(id)
    // Nothing is wrong with this song, so nothing about it is marked wrong.
    expect(job?.status).toBe('queued')
    expect(job?.error).toBeNull()
  })

  it('stops the whole queue after a rate limit, rather than burning through it', async () => {
    download.mockRejectedValue(new Error('HTTP Error 429: Too Many Requests'))
    for (let i = 0; i < 5; i++) enqueueOne()

    queue.kick()
    await settle()

    // The songs already in flight when the answer came back cannot be
    // un-asked, so the ceiling is the concurrency limit and not one — but the
    // queue stops there rather than working through all five.
    const limit = new SettingsRepository(db).get().importConcurrency
    expect(download.mock.calls.length).toBeLessThanOrEqual(limit)
    expect(throttle.status().pausedUntil).not.toBeNull()
    // Nothing was consumed: every song is still waiting to be tried.
    expect(imports.counts().queued).toBe(5)
  })

  it('starts again by itself once the pause is over', async () => {
    download.mockRejectedValue(new Error('Sign in to confirm you’re not a bot'))
    const id = enqueueOne()
    queue.kick()
    await settle()
    expect(download).toHaveBeenCalledTimes(1)

    // Still paused a minute later.
    now += 60_000
    queue.kick()
    await settle()
    expect(download).toHaveBeenCalledTimes(1)

    // Past the pause it picks the job up again, with no one having clicked.
    download.mockRejectedValue(new Error('Video unavailable'))
    now += 20 * 60_000
    queue.kick()
    await settle()
    expect(download).toHaveBeenCalledTimes(2)
    expect(imports.byId(id)?.status).toBe('error')
  })

  it('halves the budget for a rate limit, and does not restore it on its own', async () => {
    const before = throttle.status().budgetPerHour
    download.mockRejectedValue(new Error('Sign in to confirm you’re not a bot'))
    enqueueOne()
    queue.kick()
    await settle()

    expect(throttle.status().budgetPerHour).toBe(before / 2)
    now += 24 * 60 * 60_000
    expect(throttle.status().budgetPerHour).toBe(before / 2)
  })
})

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { Request, Response } from 'express'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { requestLogger, routeOf } from '../http/middleware.js'
import { METRIC, ServerMetrics, failureOf, sourceOf, type FinishedImport } from './metrics.js'

/**
 * The admin page's numbers (metrics.ts): totals a day at a time, and the
 * import log read back as the page draws it.
 */

const NOW = Date.parse('2026-10-23T12:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

function finished(changes: Partial<FinishedImport> = {}): FinishedImport {
  return {
    finishedAt: new Date(NOW),
    url: 'https://www.youtube.com/watch?v=abc',
    worked: true,
    failure: null,
    steps: { waiting: 5_000, downloading: 30_000, converting: 10_000 },
    attempts: 1,
    ...changes,
  }
}

describe('the import log', () => {
  it('draws worked and failed imports by day, by band, by step, by source and by why', () => {
    let now = NOW
    const metrics = new ServerMetrics(null, () => now)
    metrics.recordImport(finished())
    metrics.recordImport(finished({ steps: { downloading: 200_000 } }))
    metrics.recordImport(
      finished({ url: 'https://music.163.com/song?id=1', steps: { downloading: 20_000 } }),
    )
    metrics.recordImport(
      finished({ worked: false, failure: 'unavailable', steps: { resolving: 2_000 } }),
    )
    metrics.recordImport(finished({ attempts: 2, finishedAt: new Date(NOW - DAY_MS) }))
    // Before the window: only in "the days before".
    metrics.recordImport(finished({ finishedAt: new Date(NOW - 9 * DAY_MS) }))

    const { imports } = metrics.summary(7, new Map())
    expect(imports.byDay.at(-1)).toEqual({ day: '2026-10-23', done: 3, failed: 1 })
    expect(imports.byDay.at(-2)).toEqual({ day: '2026-10-22', done: 1, failed: 0 })
    expect(imports.before).toEqual({ done: 1, failed: 0 })
    // 45 s, 45 s (retried), 20 s and 200 s: bands < 30 s, 30 s–1 m, …, 3–5 m.
    expect(imports.bands).toEqual([1, 2, 0, 0, 1, 0, 0])
    expect(imports.medianMs).toBe(45_000)
    expect(imports.p90Ms).toBe(200_000)
    expect(imports.steps).toEqual([
      { step: 'waiting', medianMs: 5_000 },
      { step: 'downloading', medianMs: 30_000 },
      { step: 'converting', medianMs: 10_000 },
    ])
    expect(imports.failures).toEqual([{ kind: 'unavailable', count: 1 }])
    expect(imports.sources).toEqual([
      { source: 'youtube', done: 3, failed: 1, medianMs: 45_000 },
      { source: 'netease', done: 1, failed: 0, medianMs: 20_000 },
    ])
    expect(imports.youtube.at(-1)).toEqual({ day: '2026-10-23', done: 2, failed: 1 })
    expect(imports.retried).toBe(1)

    // A year on, the log has let it all go.
    now += 401 * DAY_MS
    metrics.count(METRIC.youtubeHeld)
    expect(metrics.summary(400, new Map()).imports.byDay.every(day => day.done === 0)).toBe(true)
  })
})

describe('daily totals', () => {
  it('adds Smart requests up by feature, with failures and the average time', () => {
    const metrics = new ServerMetrics(null, () => NOW)
    metrics.count(METRIC.smart('ask'))
    metrics.count(METRIC.smart('ask'))
    metrics.count(METRIC.smart('tidy'))
    metrics.count(METRIC.smartFailed)
    metrics.count(METRIC.smartMs, 9_000)
    expect(metrics.summary(7, new Map()).smart).toEqual({
      byFeature: [
        { feature: 'ask', count: 2 },
        { feature: 'tidy', count: 1 },
      ],
      failed: 1,
      averageMs: 3_000,
    })
  })

  it('keeps a device’s report only for a day it could really be', () => {
    const metrics = new ServerMetrics(null, () => NOW)
    expect(metrics.addReport({ day: '2026-10-22', uses: { search: 2 }, errors: {} })).toBe(true)
    expect(metrics.addReport({ day: '2026-10-24', uses: { search: 9 }, errors: {} })).toBe(false)
    expect(metrics.addReport({ day: '2026-10-01', uses: { search: 9 }, errors: {} })).toBe(false)
    expect(metrics.summary(7, new Map()).usage).toEqual([{ feature: 'search', count: 2 }])
  })

  it('groups 500s by route, so a hundred songs failing alike are one line', () => {
    const metrics = new ServerMetrics(null, () => NOW)
    for (const id of ['12', '40']) {
      metrics.count(
        METRIC.serverError(routeOf({ method: 'GET', originalUrl: `/api/songs/${id}?x=1` }, 500)),
      )
    }
    expect(metrics.summary(1, new Map()).errors).toEqual([
      { from: 'server', name: 'GET /api/songs/:id → 500', count: 2, lastDay: '2026-10-23' },
    ])
  })

  it('carries every library’s plays through, day by day', () => {
    const metrics = new ServerMetrics(null, () => NOW)
    const plays = metrics.summary(3, new Map([['2026-10-22', 7]])).plays
    expect(plays).toEqual([
      { day: '2026-10-21', count: 0 },
      { day: '2026-10-22', count: 7 },
      { day: '2026-10-23', count: 0 },
    ])
  })
})

describe('reading an import', () => {
  it('knows where it came from by its address', () => {
    expect(sourceOf('https://youtu.be/abc')).toBe('youtube')
    expect(sourceOf('https://m.youtube.com/watch?v=abc')).toBe('youtube')
    expect(sourceOf('https://music.youtube.com/watch?v=abc')).toBe('youtube-music')
    expect(sourceOf('https://y.music.163.com/m/song?id=1')).toBe('netease')
    expect(sourceOf('https://open.spotify.com/track/1')).toBe('spotify')
    expect(sourceOf('https://example.com/a.mp3')).toBe('other')
    expect(sourceOf('not a url')).toBe('other')
  })

  it('groups why it failed from the words a person was shown', () => {
    expect(failureOf('Sign in to confirm you’re not a bot')).toBe('youtube-blocked')
    expect(failureOf('Video unavailable. This video has been removed')).toBe('unavailable')
    expect(
      failureOf(
        'YouTube only shows that to a signed-in account, and your library’s computer isn’t',
      ),
    ).toBe('unavailable')
    expect(failureOf('No match found on YouTube for this Spotify song')).toBe('no-match')
    expect(failureOf('The download timed out')).toBe('timeout')
    expect(failureOf('ffmpeg exited with code 1')).toBe('other')
  })
})

/**
 * A count that cannot be written — the disk full, the file held — is said
 * and dropped. The 500s are counted from a response's `finish` event, where
 * a throw is uncaught: a full disk's first 500 took the server down (R3-M9).
 */
describe('a count that cannot be written', () => {
  function heldMetrics(): { metrics: ServerMetrics; failures: unknown[]; release: () => void } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-metrics-'))
    const failures: unknown[] = []
    const metrics = new ServerMetrics(
      dir,
      () => NOW,
      error => failures.push(error),
    )
    const other = new Database(path.join(dir, 'metrics.db'))
    other.exec('BEGIN EXCLUSIVE')
    return {
      metrics,
      failures,
      release: () => {
        other.exec('ROLLBACK')
        other.close()
        metrics.close()
        fs.rmSync(dir, { recursive: true, force: true })
      },
    }
  }

  it('is said and dropped, never thrown', () => {
    const { metrics, failures, release } = heldMetrics()
    try {
      expect(() => metrics.count(METRIC.smartFailed)).not.toThrow()
      expect(() => metrics.recordImport(finished())).not.toThrow()
      expect(failures).toHaveLength(2)
    } finally {
      release()
    }
  })

  it('leaves a 500 counted from its finish event without an uncaught throw', () => {
    const { metrics, failures, release } = heldMetrics()
    try {
      const res = Object.assign(new EventEmitter(), { statusCode: 500 }) as unknown as Response
      const req = { method: 'POST', path: '/api/tags', originalUrl: '/api/tags' } as Request
      requestLogger(createLogger('silent'), metrics)(req, res, () => undefined)
      expect(() => res.emit('finish')).not.toThrow()
      expect(failures).toHaveLength(1)
    } finally {
      release()
    }
  })
})

import { describe, expect, it } from 'vitest'
import type { ImportJob, ThrottleState } from '@selfmp3/shared'
import {
  DeviceImports,
  type DeviceDownloader,
  type DeviceFile,
  type DeviceImportsApi,
} from './deviceImports.model'

function job(id: string): ImportJob {
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id.padEnd(11, 'x')}`,
    status: 'queued',
    step: 'waiting',
    progress: null,
    title: `Song ${id}`,
    artist: 'Aurora Lane',
    album: '',
    thumbnail: null,
    duration: 180,
    error: null,
    songId: null,
    attempts: 0,
    tagIds: [],
    createdAt: '2026-10-14 00:00:00',
    updatedAt: '2026-10-14 00:00:00',
  }
}

const FILE: DeviceFile = {
  bytes: new Uint8Array([1, 2, 3]),
  sha256: 'ab'.repeat(32),
  meta: { description: '', title: 'Song', author: 'Aurora Lane', durationSeconds: 180 },
}

/**
 * A server that holds what it was told to, a downloader that does what each
 * test says, and a clock that moves only when something waits on it.
 */
function harness(options: {
  ids: string[]
  download?: (url: string, signal: AbortSignal) => Promise<DeviceFile>
  uploadStatus?: number
  downloader?: boolean
  budget?: ThrottleState | null
  /** Songs downloaded already, by id: heard in the review. */
  cached?: string[]
}) {
  const calls: string[] = []
  let held = new Set(options.ids)
  let now = 1_700_000_000_000
  let budget = options.budget ?? null
  let tick: () => void = () => undefined
  const slept: number[] = []

  const api: DeviceImportsApi = {
    importDeviceRenew: (lease, progress) => {
      calls.push(`renew ${progress.map(each => `${each.id}@${each.percent}`).join(',')}`)
      return Promise.resolve({ held: [...held] })
    },
    importDeviceStart: (lease, id) => {
      calls.push(`start ${id}`)
      return held.has(id) ? Promise.resolve({ ok: true }) : Promise.reject(new Error('409'))
    },
    importDeviceRelease: (lease, id, reason) => {
      calls.push(`release ${id}: ${reason}`)
      held.delete(id)
      return Promise.resolve({ ok: true })
    },
    importDeviceFileTarget: id => ({ url: `https://server/${id}`, headers: {} }),
  }
  const downloader: DeviceDownloader = {
    has: url => options.cached?.includes(url.slice(-11, -10)) ?? false,
    download: (url, { signal, onProgress }) => {
      calls.push(`download ${url.slice(-11, -10)}`)
      onProgress(50)
      return options.download ? options.download(url, signal) : Promise.resolve(FILE)
    },
  }
  const imports = new DeviceImports({
    downloader: () => Promise.resolve(options.downloader === false ? null : downloader),
    upload: target => {
      calls.push(`upload ${target.url.slice('https://server/'.length)}`)
      held.delete(target.url.slice('https://server/'.length))
      return Promise.resolve({ status: options.uploadStatus ?? 202, message: 'no' })
    },
    budget: { get: () => budget, save: state => (budget = state) },
    now: () => now,
    sleep: ms => {
      slept.push(ms)
      now += ms
      return Promise.resolve()
    },
    every: (_ms, fn) => {
      tick = fn
      return () => {
        tick = () => undefined
      }
    },
    log: () => undefined,
  })

  return {
    imports,
    calls,
    slept,
    budget: () => budget,
    renew: () => tick(),
    drop: (id: string) => held.delete(id),
    holdNothing: () => (held = new Set()),
    take: () =>
      imports.take(
        api,
        { lease: 'lease', jobIds: options.ids, seconds: 300 },
        options.ids.map(job),
      ),
  }
}

describe('DeviceImports', () => {
  it('downloads each song it holds, in order, and sends the server the file', async () => {
    const h = harness({ ids: ['a', 'b'] })
    h.take()
    await h.imports.settled()
    expect(h.calls).toEqual([
      'start a',
      'download a',
      'upload a',
      'start b',
      'download b',
      'upload b',
    ])
    expect(h.imports.busy).toBe(false)
  })

  it('lets the server have a song it could not download, and goes on', async () => {
    const h = harness({
      ids: ['a', 'b'],
      download: url =>
        url.includes('watch?v=a')
          ? Promise.reject(new Error('no client could download a'))
          : Promise.resolve(FILE),
    })
    h.take()
    await h.imports.settled()
    expect(h.calls).toEqual([
      'start a',
      'download a',
      'release a: no client could download a',
      'start b',
      'download b',
      'upload b',
    ])
  })

  it('lets the server have a file it would not take', async () => {
    const h = harness({ ids: ['a'], uploadStatus: 422 })
    h.take()
    await h.imports.settled()
    expect(h.calls.at(-1)).toBe('release a: the server did not take the file (422): no')
  })

  it('hands everything left to the server when YouTube refuses this device for rate', async () => {
    const h = harness({
      ids: ['a', 'b', 'c'],
      download: () => Promise.reject(new Error("Sign in to confirm you're not a bot")),
    })
    h.take()
    await h.imports.settled()
    expect(
      h.calls.filter(call => call.startsWith('release')).map(call => call.slice(8, 9)),
    ).toEqual(['a', 'b', 'c'])
    expect(h.calls.filter(call => call.startsWith('download'))).toHaveLength(1)
    // And keeps clear of YouTube for a while.
    expect(h.budget()?.pausedUntil).toBeGreaterThan(1_700_000_000_000)
  })

  it('hands everything to the server when this device cannot download at all', async () => {
    const h = harness({ ids: ['a', 'b'], downloader: false })
    h.take()
    await h.imports.settled()
    expect(h.calls).toEqual([
      'release a: this device can no longer download from YouTube',
      'release b: this device can no longer download from YouTube',
    ])
  })

  it('drops what the server no longer holds for it, and stops the song it took mid-download', async () => {
    let started: () => void = () => undefined
    const begun = new Promise<void>(resolve => (started = resolve))
    const h = harness({
      ids: ['a', 'b'],
      download: (_url, signal) =>
        new Promise((_resolve, reject) => {
          started()
          signal.addEventListener('abort', () => reject(new Error('stopped')))
        }),
    })
    h.take()
    await begun
    h.holdNothing()
    h.renew()
    await h.imports.settled()
    expect(h.calls).toEqual(['start a', 'download a', 'renew a@50'])
    expect(h.imports.busy).toBe(false)
  })

  it('waits its turn at YouTube once the bucket is spent', async () => {
    // Spent, and borrowed to the limit: the next song waits for the bucket to refill.
    const h = harness({
      ids: ['a'],
      budget: {
        tokens: -5,
        ratchet: 1,
        updatedAt: 1_700_000_000_000,
        pausedUntil: 0,
        limitedAt: 0,
      },
    })
    h.take()
    await h.imports.settled()
    expect(h.slept.length).toBeGreaterThan(0)
    expect(h.calls).toEqual(['start a', 'download a', 'upload a'])
  })

  it('does not wait for a turn at YouTube for a song it has already', async () => {
    const h = harness({
      ids: ['a'],
      cached: ['a'],
      budget: {
        tokens: -5,
        ratchet: 1,
        updatedAt: 1_700_000_000_000,
        pausedUntil: 0,
        limitedAt: 0,
      },
    })
    h.take()
    await h.imports.settled()
    expect(h.slept).toEqual([])
    expect(h.calls).toEqual(['start a', 'download a', 'upload a'])
  })
})

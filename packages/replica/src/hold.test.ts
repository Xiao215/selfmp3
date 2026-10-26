import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUCKET_HOLD_MS } from '@selfmp3/shared'
import type { DeviceStore } from './platform.js'

/*
 * A hold kept across a reload. 2026-10-25: reloading with the bucket refusing
 * for the day brought back "All saved" and no notice at all, until the next
 * song played was refused all over again.
 */

function memoryStore(seed: Record<string, unknown> = {}): DeviceStore & {
  seen: Map<string, unknown>
} {
  const seen = new Map<string, unknown>(Object.entries(seed))
  return {
    seen,
    read: key => Promise.resolve(seen.get(key) ?? null),
    write: (key, value) => {
      seen.set(key, JSON.parse(JSON.stringify(value)))
      return Promise.resolve()
    },
    remove: key => {
      seen.delete(key)
      return Promise.resolve()
    },
    update: async (key, change) => {
      const next = change(seen.get(key) ?? null)
      seen.set(key, next)
      return next
    },
  }
}

/** The module afresh, as a reloaded page has it. */
async function freshHold() {
  vi.resetModules()
  return import('./hold.js')
}

afterEach(() => vi.resetModules())

describe('keepHolds', () => {
  it('writes a hold down as it starts, and its end as it ends', async () => {
    const { holdBucket, keepHolds, releaseBucket } = await freshHold()
    const store = memoryStore()
    keepHolds(store)
    holdBucket('used up', 'read')
    await vi.waitFor(() =>
      expect(store.seen.get('bucket-holds')).toMatchObject({ read: { message: 'used up' } }),
    )
    releaseBucket()
    await vi.waitFor(() =>
      expect(store.seen.get('bucket-holds')).toEqual({ read: null, list: null }),
    )
  })

  it('brings back what is left of a hold after a reload', async () => {
    const now = Date.now()
    const store = memoryStore({
      'bucket-holds': { read: { message: 'used up', until: now + 60_000 }, list: null },
    })
    const { bucketHold, keepHolds } = await freshHold()
    keepHolds(store, now)
    await vi.waitFor(() =>
      expect(bucketHold('read')).toEqual({ message: 'used up', until: now + 60_000 }),
    )
    expect(bucketHold('list')).toBeNull()
  })

  it('lets a hold that ran out while the app was closed go', async () => {
    const now = Date.now()
    const store = memoryStore({
      'bucket-holds': { read: { message: 'used up', until: now - 1 }, list: null },
    })
    const { bucketHold, keepHolds } = await freshHold()
    keepHolds(store, now)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(bucketHold()).toBeNull()
  })

  it('never holds longer than a hold lasts, whatever was written', async () => {
    const now = Date.now()
    const store = memoryStore({
      'bucket-holds': { read: { message: 'used up', until: now + 365 * 86_400_000 }, list: 'junk' },
    })
    const { bucketHold, keepHolds } = await freshHold()
    keepHolds(store, now)
    await vi.waitFor(() => expect(bucketHold('read')?.until).toBe(now + BUCKET_HOLD_MS))
    expect(bucketHold('list')).toBeNull()
  })
})

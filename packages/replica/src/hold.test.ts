import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUCKET_HOLD_MS } from '@selfmp3/shared'
import { FIRST_BUCKET_HOLD_MS } from './hold.js'
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
    const kept = { message: 'used up', until: now + 60_000, heardAt: now - 60_000, refusals: 2 }
    const store = memoryStore({ 'bucket-holds': { read: kept, list: null } })
    const { bucketHold, bucketRefusals, keepHolds } = await freshHold()
    keepHolds(store, now)
    await vi.waitFor(() => expect(bucketHold('read')).toEqual(kept))
    expect(bucketHold('list')).toBeNull()
    expect(bucketRefusals('read')).toBe(2)
  })

  it('lets a hold that ran out while the app was closed go', async () => {
    const now = Date.now()
    const store = memoryStore({
      'bucket-holds': {
        read: { message: 'used up', until: now - 1, heardAt: now - 60_000, refusals: 1 },
        list: null,
      },
    })
    const { bucketHold, keepHolds } = await freshHold()
    keepHolds(store, now)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(bucketHold()).toBeNull()
  })

  it('never holds longer than a hold lasts, whatever was written', async () => {
    const now = Date.now()
    const store = memoryStore({
      'bucket-holds': {
        read: { message: 'used up', until: now + 365 * 86_400_000, heardAt: now, refusals: 9 },
        list: 'junk',
      },
    })
    const { bucketHold, keepHolds } = await freshHold()
    keepHolds(store, now)
    await vi.waitFor(() => expect(bucketHold('read')?.until).toBe(now + BUCKET_HOLD_MS))
    expect(bucketHold('list')).toBeNull()
  })
})

/*
 * R2-M9: a cap raised at backblaze.com went unnoticed for the whole ten-minute
 * hold. The first hold is short, and each refusal in a row holds for longer.
 */
describe('how long a refusal is believed', () => {
  it('holds briefly at first, then twice as long for each refusal in a row', async () => {
    const { bucketHold, holdBucket } = await freshHold()
    let now = 1_000_000
    const lengths: number[] = []
    for (let i = 0; i < 7; i++) {
      const hold = holdBucket('used up', 'read', now)
      lengths.push(hold.until - now)
      now = hold.until
      expect(bucketHold('read', now)).toBeNull()
    }
    const first = FIRST_BUCKET_HOLD_MS
    expect(lengths).toEqual([
      first,
      2 * first,
      4 * first,
      8 * first,
      16 * first,
      BUCKET_HOLD_MS,
      BUCKET_HOLD_MS,
    ])
  })

  it('counts refusals heard together, within one hold, as one', async () => {
    const { holdBucket } = await freshHold()
    holdBucket('used up', 'read', 1_000)
    const again = holdBucket('used up', 'read', 1_500)
    expect(again).toMatchObject({
      refusals: 1,
      until: 1_500 + FIRST_BUCKET_HOLD_MS,
      heardAt: 1_500,
    })
    // Unless it was sent through the hold to find out: that is another ask.
    expect(holdBucket('used up', 'read', 2_000, true).refusals).toBe(2)
  })

  it('keeps counting through a hold let go to ask early, and starts over once answered', async () => {
    const { bucketRefusals, holdBucket, lapseBucketHold, releaseBucket } = await freshHold()
    holdBucket('used up', 'read', 1_000)
    lapseBucketHold()
    expect(bucketRefusals()).toBe(1)
    expect(holdBucket('used up', 'read', 2_000).refusals).toBe(2)

    releaseBucket('read')
    expect(bucketRefusals()).toBe(0)
    expect(holdBucket('used up', 'read', 3_000).refusals).toBe(1)
  })

  it('counts reads and listings apart', async () => {
    const { bucketRefusals, holdBucket, releaseBucket } = await freshHold()
    holdBucket('used up', 'read', 1_000)
    holdBucket('used up', 'list', 1_000)
    releaseBucket('list')
    expect(bucketRefusals('list')).toBe(0)
    expect(bucketRefusals('read')).toBe(1)
    expect(bucketRefusals()).toBe(1)
  })
})

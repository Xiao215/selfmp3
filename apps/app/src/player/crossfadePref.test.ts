import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceStore } from '@selfmp3/replica'

/*
 * A cloud library used to keep every setting on the device, crossfade among
 * them, in one record (`selfmp3.cloud.settings`). Crossfade is now a
 * preference of its own; a device that had one set keeps it, once.
 */

const mocks = vi.hoisted(() => ({ prefs: new Map<string, string>() }))

vi.mock('../ports/prefs', () => ({
  prefs: {
    get: (key: string) => mocks.prefs.get(key) ?? null,
    set: (key: string, value: string) => mocks.prefs.set(key, value),
  },
}))

const { moveOldCrossfade } = await import('./crossfadePref')

function memoryStore(
  entries: Record<string, unknown>,
): DeviceStore & { kept: Map<string, unknown> } {
  const kept = new Map(Object.entries(entries))
  return {
    kept,
    read: async key => kept.get(key),
    write: async (key, value) => void kept.set(key, value),
    remove: async key => void kept.delete(key),
    update: async (key, change) => {
      const next = change(kept.get(key))
      kept.set(key, next)
      return next
    },
  }
}

describe('moveOldCrossfade', () => {
  beforeEach(() => mocks.prefs.clear())

  it('keeps the crossfade the old record had, and drops the record', async () => {
    const store = memoryStore({ 'selfmp3.cloud.settings': { crossfadeSeconds: 6, smartAsk: true } })
    await moveOldCrossfade(store)
    expect(mocks.prefs.get('crossfadeSeconds')).toBe('6')
    expect(store.kept.has('selfmp3.cloud.settings')).toBe(false)
  })

  it('never writes over a crossfade already chosen the new way', async () => {
    mocks.prefs.set('crossfadeSeconds', '2')
    const store = memoryStore({ 'selfmp3.cloud.settings': { crossfadeSeconds: 9 } })
    await moveOldCrossfade(store)
    expect(mocks.prefs.get('crossfadeSeconds')).toBe('2')
    expect(store.kept.has('selfmp3.cloud.settings')).toBe(false)
  })

  it('does nothing on a device that never had the old record', async () => {
    await moveOldCrossfade(memoryStore({}))
    expect(mocks.prefs.has('crossfadeSeconds')).toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LINGER_MS, createKeepAwake, type Caffeinator } from './keepAwake.js'
import { createLogger } from '../logger.js'

const silent = createLogger('silent')

/** A stand-in for `caffeinate`, so no process is spawned and nothing sleeps. */
function fakeCaffeinate(): { spawn: () => Caffeinator; spawned: number; killed: number } {
  const state = { spawned: 0, killed: 0, spawn: () => ({}) as Caffeinator }
  state.spawn = (): Caffeinator => {
    state.spawned += 1
    return {
      kill: () => {
        state.killed += 1
      },
      once: () => undefined,
    }
  }
  return state
}

describe('keepAwake', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('holds one assertion however many things are in flight', () => {
    const fake = fakeCaffeinate()
    const keep = createKeepAwake(silent, { platform: 'darwin', spawnCaffeinate: fake.spawn })

    const first = keep.hold()
    const second = keep.hold()
    expect(fake.spawned).toBe(1)
    expect(keep.active).toBe(true)

    // One of two finishing is not the machine going idle.
    first()
    vi.advanceTimersByTime(LINGER_MS * 2)
    expect(keep.active).toBe(true)

    second()
    vi.advanceTimersByTime(LINGER_MS + 1)
    expect(keep.active).toBe(false)
    expect(fake.killed).toBe(1)
  })

  it('rides out the gap between two songs without a second process', () => {
    const fake = fakeCaffeinate()
    const keep = createKeepAwake(silent, { platform: 'darwin', spawnCaffeinate: fake.spawn })

    keep.hold()()
    // The next track starts well inside the grace period.
    vi.advanceTimersByTime(LINGER_MS / 2)
    const next = keep.hold()
    vi.advanceTimersByTime(LINGER_MS * 2)

    expect(keep.active).toBe(true)
    expect(fake.spawned).toBe(1)
    expect(fake.killed).toBe(0)

    next()
    vi.advanceTimersByTime(LINGER_MS + 1)
    expect(keep.active).toBe(false)
  })

  it('ignores a release called twice, rather than dropping another hold with it', () => {
    const fake = fakeCaffeinate()
    const keep = createKeepAwake(silent, { platform: 'darwin', spawnCaffeinate: fake.spawn })

    const first = keep.hold()
    keep.hold()

    // A stream can end as 'finish' and again as 'close'.
    first()
    first()
    vi.advanceTimersByTime(LINGER_MS + 1)

    // The second hold is still outstanding, so the machine stays awake.
    expect(keep.active).toBe(true)
  })

  it('lets go at once when the server is shutting down', () => {
    const fake = fakeCaffeinate()
    const keep = createKeepAwake(silent, { platform: 'darwin', spawnCaffeinate: fake.spawn })

    keep.hold()
    keep.stop()

    expect(keep.active).toBe(false)
    expect(fake.killed).toBe(1)
  })

  it('does nothing at all off macOS', () => {
    const fake = fakeCaffeinate()
    const keep = createKeepAwake(silent, { platform: 'linux', spawnCaffeinate: fake.spawn })

    const release = keep.hold()
    expect(fake.spawned).toBe(0)
    expect(keep.active).toBe(false)

    // And releasing a hold that was never taken is not an error.
    expect(() => release()).not.toThrow()
  })
})

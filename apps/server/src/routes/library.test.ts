import { describe, expect, it } from 'vitest'
import { answeredAt } from './library.js'

/**
 * The library answer's `generatedAt` names a library, not a request: clients
 * key work on it (the phone's keep-alongside pass), so a refetch of an
 * unchanged library must not look new.
 */

function clock() {
  let ms = Date.parse('2026-09-14T10:00:00.000Z')
  return {
    now: () => new Date(ms),
    tick: () => {
      ms += 1_000
    },
  }
}

describe('answeredAt', () => {
  it('stays the same while the library has not changed', () => {
    const time = clock()
    const stamp = answeredAt(() => 4, time.now)

    const first = stamp()
    time.tick()
    expect(stamp()).toBe(first)
  })

  it('moves on when the library version does', () => {
    const time = clock()
    let version = 4
    const stamp = answeredAt(() => version, time.now)

    const first = stamp()
    time.tick()
    version = 5
    const second = stamp()

    expect(second).not.toBe(first)
    time.tick()
    expect(stamp()).toBe(second)
  })
})

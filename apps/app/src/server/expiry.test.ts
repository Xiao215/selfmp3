import { beforeEach, describe, expect, it, vi } from 'vitest'

import { onSessionExpired, sessionExpired } from './expiry'

/**
 * The signal that carries a 401 from wherever it happened to the one place
 * that can ask you to sign in again.
 *
 * Worth its own test because the two ends are deliberately far apart — a
 * download failing in a background task, and a React provider — and nothing
 * else would notice the wire being cut.
 */
describe('being told the server refused this phone', () => {
  beforeEach(() => {
    // Leave nothing registered for the next test to hear.
    onSessionExpired(() => undefined)()
  })

  it('tells the listener', () => {
    const heard = vi.fn()
    onSessionExpired(heard)
    sessionExpired()
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('says nothing when no one is listening', () => {
    expect(() => sessionExpired()).not.toThrow()
  })

  it('stops telling a listener that unsubscribed', () => {
    const heard = vi.fn()
    const stop = onSessionExpired(heard)
    stop()
    sessionExpired()
    expect(heard).not.toHaveBeenCalled()
  })

  it('keeps only the newest listener, so a remount does not double up', () => {
    const first = vi.fn()
    const second = vi.fn()
    onSessionExpired(first)
    onSessionExpired(second)
    sessionExpired()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('lets a stale unsubscribe run without silencing the listener that replaced it', () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = onSessionExpired(first)
    onSessionExpired(second)
    // React tears the old effect down after the new one has run.
    stopFirst()
    sessionExpired()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

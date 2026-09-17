import { describe, expect, it } from 'vitest'

import { RELOAD_ONCE_WITHIN_MS, shouldReloadForControl } from './serviceWorkerControl.model'

/**
 * A hard reload leaves the page without its worker, and with it without any
 * way to fetch a cloud library's songs or covers. One ordinary reload mends
 * it; what is pinned here is that it is only ever one.
 */
describe('a page its service worker is not answering for', () => {
  it('reloads, the first time', () => {
    expect(shouldReloadForControl({ controlled: false, lastReloadAt: null, now: 1_000 })).toBe(true)
  })

  it('leaves a page that has its worker alone', () => {
    expect(shouldReloadForControl({ controlled: true, lastReloadAt: null, now: 1_000 })).toBe(false)
  })

  it('does not reload again when the reload did not help', () => {
    // A browser that refuses workers outright would otherwise spin forever.
    const lastReloadAt = 10_000
    expect(
      shouldReloadForControl({ controlled: false, lastReloadAt, now: lastReloadAt + 1_500 }),
    ).toBe(false)
  })

  it('treats a hard reload later on as a new one', () => {
    const lastReloadAt = 10_000
    const now = lastReloadAt + RELOAD_ONCE_WITHIN_MS + 1
    expect(shouldReloadForControl({ controlled: false, lastReloadAt, now })).toBe(true)
  })

  it('reloads when what it wrote down last time is unreadable', () => {
    expect(
      shouldReloadForControl({ controlled: false, lastReloadAt: Number.NaN, now: 1_000 }),
    ).toBe(true)
  })
})

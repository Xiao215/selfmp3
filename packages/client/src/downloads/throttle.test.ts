import { describe, expect, it } from 'vitest'

import { createThrottle } from './throttle.js'

describe('createThrottle', () => {
  it('delivers the first request at once', () => {
    let delivered = 0
    const throttle = createThrottle(
      () => (delivered += 1),
      250,
      () => 0,
    )
    throttle.request()
    expect(delivered).toBe(1)
  })

  it('holds a burst to one delivery per interval', () => {
    let now = 0
    let delivered = 0
    const throttle = createThrottle(
      () => (delivered += 1),
      250,
      () => now,
    )
    for (let chunk = 0; chunk < 1000; chunk += 1) {
      throttle.request()
      now += 1
    }
    // A second of chunks, one a millisecond: four deliveries, not a thousand.
    expect(delivered).toBe(4)
  })

  it('delivers again as soon as the interval is up', () => {
    let now = 0
    let delivered = 0
    const throttle = createThrottle(
      () => (delivered += 1),
      250,
      () => now,
    )
    throttle.request()
    now = 249
    throttle.request()
    expect(delivered).toBe(1)
    now = 250
    throttle.request()
    expect(delivered).toBe(2)
  })

  it('counts a delivery made some other way', () => {
    let now = 0
    let delivered = 0
    const throttle = createThrottle(
      () => (delivered += 1),
      250,
      () => now,
    )
    now = 1000
    throttle.settle()
    now = 1100
    throttle.request()
    expect(delivered).toBe(0)
    now = 1250
    throttle.request()
    expect(delivered).toBe(1)
  })
})

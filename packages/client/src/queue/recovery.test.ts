import { describe, expect, it } from 'vitest'
import { MAX_BUSY_TRIES, MAX_SKIPS_IN_A_ROW, busyRetryDelay, recoverPlayback } from './recovery.js'

describe('recovering from a song that failed', () => {
  const failed = {
    songId: 7,
    wantsSound: true,
    retriedSongId: null,
    skippedInARow: 0,
    hasNext: true,
    unreachable: false,
    busy: false,
    busyTries: 0,
  }

  it('tries a song once more before anything else', () => {
    expect(recoverPlayback(failed)).toBe('retry')
    // Another song having been retried says nothing about this one.
    expect(recoverPlayback({ ...failed, retriedSongId: 6 })).toBe('retry')
  })

  it('skips a song that failed again, when something after it can play', () => {
    expect(recoverPlayback({ ...failed, retriedSongId: 7 })).toBe('skip')
  })

  it('stops when nothing after it can play', () => {
    expect(recoverPlayback({ ...failed, retriedSongId: 7, hasNext: false })).toBe('stop')
  })

  it('stops rather than running through a queue where nothing plays', () => {
    const again = { ...failed, retriedSongId: 7 }
    expect(recoverPlayback({ ...again, skippedInARow: MAX_SKIPS_IN_A_ROW - 1 })).toBe('skip')
    expect(recoverPlayback({ ...again, skippedInARow: MAX_SKIPS_IN_A_ROW })).toBe('stop')
  })

  it('leaves a song nobody asked to hear alone: put back paused at launch, or paused since', () => {
    expect(recoverPlayback({ ...failed, wantsSound: false })).toBe('wait')
    expect(recoverPlayback({ ...failed, wantsSound: false, retriedSongId: 7 })).toBe('wait')
  })

  it('stops after the retry when nothing answered, rather than trying the next song the same way', () => {
    expect(recoverPlayback({ ...failed, unreachable: true })).toBe('retry')
    expect(recoverPlayback({ ...failed, unreachable: true, retriedSongId: 7 })).toBe('stop')
  })
})

/*
 * Bug bash R3-M2: a bucket asking for fewer requests (Backblaze's SlowDown)
 * was a broken song, so one Next walked three good songs in a second and
 * stopped on "Couldn't play".
 */
describe('a song the storage was too busy to send', () => {
  const busy = {
    songId: 7,
    wantsSound: true,
    retriedSongId: null,
    skippedInARow: 0,
    hasNext: true,
    unreachable: false,
    busy: true,
    busyTries: 0,
  }

  it('waits and asks for the same song again, never the next one', () => {
    expect(recoverPlayback(busy)).toBe('retry-later')
    expect(recoverPlayback({ ...busy, retriedSongId: 7, busyTries: 3 })).toBe('retry-later')
  })

  it('waits longer each time, up to a ceiling', () => {
    const waits = Array.from({ length: MAX_BUSY_TRIES }, (_, tries) => busyRetryDelay(tries))
    expect(waits[0]).toBe(2_000)
    for (let at = 1; at < waits.length; at++)
      expect(waits[at]).toBeGreaterThanOrEqual(waits[at - 1]!)
    expect(Math.max(...waits)).toBe(30_000)
  })

  it('stops after a few minutes of it, rather than asking all night', () => {
    expect(recoverPlayback({ ...busy, busyTries: MAX_BUSY_TRIES })).toBe('stop')
    const waited = Array.from({ length: MAX_BUSY_TRIES }, (_, tries) => busyRetryDelay(tries))
    const total = waited.reduce((sum, wait) => sum + wait, 0)
    expect(total).toBeGreaterThanOrEqual(3 * 60_000)
    expect(total).toBeLessThanOrEqual(6 * 60_000)
  })

  it('leaves a song nobody asked to hear alone, busy or not', () => {
    expect(recoverPlayback({ ...busy, wantsSound: false })).toBe('wait')
  })
})

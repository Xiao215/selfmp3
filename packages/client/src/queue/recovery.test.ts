import { describe, expect, it } from 'vitest'
import { MAX_SKIPS_IN_A_ROW, recoverPlayback } from './recovery.js'

describe('recovering from a song that failed', () => {
  const failed = {
    songId: 7,
    wantsSound: true,
    retriedSongId: null,
    skippedInARow: 0,
    hasNext: true,
    unreachable: false,
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

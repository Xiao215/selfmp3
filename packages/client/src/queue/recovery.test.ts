import { describe, expect, it } from 'vitest'
import { MAX_SKIPS_IN_A_ROW, recoverPlayback } from './recovery.js'

describe('recovering from a song that failed', () => {
  const failed = { songId: 7, retriedSongId: null, skippedInARow: 0, hasNext: true }

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
})

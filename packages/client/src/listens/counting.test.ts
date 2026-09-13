import { describe, expect, it } from 'vitest'

import { listenedDelta, secondsToCount, PLAY_COUNT_SECONDS } from './counting.js'

/**
 * These two decide play counts, and play counts are what stats and Wrapped are
 * made of. They had no tests while they were two copies of a magic number in
 * two player files.
 */
describe('listenedDelta', () => {
  it('adds an ordinary tick', () => {
    // A quarter-second poll while the song plays.
    expect(listenedDelta(10.25, 10)).toBeCloseTo(0.25)
  })

  it('adds nothing for a rewind', () => {
    expect(listenedDelta(4, 30)).toBe(0)
  })

  it('adds nothing for a jump forward', () => {
    // Dragging the scrubber ahead is not listening, however far it goes.
    expect(listenedDelta(90, 30)).toBe(0)
  })

  it('adds nothing when the playhead has not moved', () => {
    // Paused, and the position still being reported.
    expect(listenedDelta(30, 30)).toBe(0)
  })

  it('draws the line at two seconds', () => {
    // A tab left in the background can come back with a gap this size; below
    // the line it is listening, at it and above it is a seek.
    expect(listenedDelta(31.99, 30)).toBeCloseTo(1.99)
    expect(listenedDelta(32, 30)).toBe(0)
  })
})

describe('secondsToCount', () => {
  it('is a minute, however long the song', () => {
    expect(secondsToCount(200)).toBe(PLAY_COUNT_SECONDS)
    // An hour-long mix counts after the same minute.
    expect(secondsToCount(3600)).toBe(60)
  })

  it('is the whole of a song shorter than a minute', () => {
    expect(secondsToCount(42)).toBe(42)
  })

  it('is zero for a song of unknown length', () => {
    // Duration is 0 until the metadata loads; the callers check for it, and
    // this must not be the thing that makes an unplayed song count.
    expect(secondsToCount(0)).toBe(0)
  })
})

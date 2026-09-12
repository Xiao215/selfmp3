import { describe, expect, it } from 'vitest'

import {
  listenedDelta,
  secondsToCount,
  skipToRecord,
  PLAY_THRESHOLD_CAP_SECONDS,
} from './counting.js'

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
  it('is the configured fraction of the song', () => {
    expect(secondsToCount(200, 0.5)).toBe(100)
  })

  it('caps a long song at four minutes', () => {
    // An hour-long mix at half would otherwise need thirty minutes before the
    // play registered, by which point you have moved on.
    expect(secondsToCount(3600, 0.5)).toBe(PLAY_THRESHOLD_CAP_SECONDS)
  })

  it('is zero for a song of unknown length', () => {
    // Duration is 0 until the metadata loads; the callers check for it, and
    // this must not be the thing that makes an unplayed song count.
    expect(secondsToCount(0, 0.5)).toBe(0)
  })
})

describe('whether Next was a skip', () => {
  it('is a skip when the song had not counted as a play yet', () => {
    expect(skipToRecord(7, false, 4.5)).toEqual({ songId: 7, atSeconds: 4.5 })
  })

  it('is not a skip once the play has counted', () => {
    expect(skipToRecord(7, true, 120)).toBeNull()
  })

  it('is nothing at all when no song is playing', () => {
    expect(skipToRecord(undefined, false, 4.5)).toBeNull()
  })

  it('records a skip before the first progress tick at the start', () => {
    expect(skipToRecord(7, false, 0)).toEqual({ songId: 7, atSeconds: 0 })
    expect(skipToRecord(7, false, -1)).toEqual({ songId: 7, atSeconds: 0 })
    expect(skipToRecord(7, false, Number.NaN)).toEqual({ songId: 7, atSeconds: 0 })
  })
})

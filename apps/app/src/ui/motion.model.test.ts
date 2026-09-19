import { describe, expect, it } from 'vitest'

import {
  backOut,
  OVERSHOOT_PEAK,
  OVERSHOOT_S,
  overshootRange,
  peakOf,
  roomShift,
  sessionMemory,
  staggerDelay,
  STAGGER_MS,
} from './motion.model'

describe('the stagger', () => {
  it('puts each tile 60 ms after the one before', () => {
    expect([0, 1, 2, 3].map(index => staggerDelay(index))).toEqual([0, 60, 120, 180])
    expect(staggerDelay(1)).toBe(STAGGER_MS)
  })

  it('stops growing after the cap, so the last of a long grid does not wait', () => {
    expect(staggerDelay(20, 60, 8)).toBe(480)
    expect(staggerDelay(-3)).toBe(0)
  })
})

describe('the overshoot', () => {
  const curve = backOut(OVERSHOOT_S)

  it('starts at 0 and lands at exactly 1', () => {
    expect(curve(0)).toBeCloseTo(0, 10)
    expect(curve(1)).toBeCloseTo(1, 10)
  })

  it('goes a little past its end on the way, about five per cent', () => {
    expect(OVERSHOOT_PEAK).toBeGreaterThan(1.04)
    expect(OVERSHOOT_PEAK).toBeLessThan(1.07)
    expect(peakOf(t => t)).toBe(1)
  })

  it('maps the part past the end onto a few points, whatever the distance', () => {
    const range = overshootRange(400, 4)
    expect(range.inputRange).toEqual([0, 1, OVERSHOOT_PEAK])
    expect(range.outputRange).toEqual([400, 0, -4])
  })
})

describe('what a session remembers', () => {
  it('answers true once for a key and false after', () => {
    const memory = sessionMemory()
    expect(memory.seen('tiles')).toBe(false)
    expect(memory.first('tiles')).toBe(true)
    expect(memory.first('tiles')).toBe(false)
    expect(memory.seen('tiles')).toBe(true)
    expect(memory.first('rise')).toBe(true)
  })

  it('plays a forgotten key again', () => {
    const memory = sessionMemory()
    memory.first('rise')
    memory.forget('rise')
    expect(memory.first('rise')).toBe(true)
  })
})

describe('making room for a row being moved', () => {
  it('steps the rows it passed on the way down up by one', () => {
    // Row 1 carried down over row 3: rows 2 and 3 go up, 0 and 4 stay.
    expect([0, 1, 2, 3, 4].map(index => roomShift(index, 1, 3))).toEqual([0, 0, -1, -1, 0])
  })

  it('steps the rows it passed on the way up down by one', () => {
    expect([0, 1, 2, 3, 4].map(index => roomShift(index, 3, 1))).toEqual([0, 1, 1, 0, 0])
  })

  it('moves nothing while it is over its own place', () => {
    expect([0, 1, 2].map(index => roomShift(index, 1, 1))).toEqual([0, 0, 0])
  })
})

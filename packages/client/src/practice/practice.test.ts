import { describe, expect, it } from 'vitest'
import { countInMs, loopRegionPercent, tapLoop } from './practice.js'

describe('countInMs', () => {
  it('is one beat at the tempo, or half a second without one', () => {
    expect(countInMs(120)).toBe(500)
    expect(countInMs(90)).toBe(667)
    expect(countInMs(null)).toBe(500)
    expect(countInMs(0)).toBe(500)
  })
})

describe('loopRegionPercent', () => {
  it('draws nothing without A or a duration', () => {
    expect(loopRegionPercent(null, 10, 100)).toBeNull()
    expect(loopRegionPercent(5, 10, 0)).toBeNull()
  })

  it('draws a hairline at A while B is unset', () => {
    expect(loopRegionPercent(25, null, 100)).toEqual({ left: 25, width: 0 })
  })

  it('orders the bounds and clamps to the bar', () => {
    expect(loopRegionPercent(10, 30, 100)).toEqual({ left: 10, width: 20 })
    expect(loopRegionPercent(30, 10, 100)).toEqual({ left: 10, width: 20 })
    expect(loopRegionPercent(90, 150, 100)).toEqual({ left: 90, width: 10 })
  })
})

describe('tapLoop', () => {
  it('sets A, then B', () => {
    const afterA = tapLoop('A', 12, { a: null, b: null })
    expect(afterA).toEqual({ a: 12, b: null })
    expect(tapLoop('B', 20, afterA)).toEqual({ a: 12, b: 20 })
  })

  it('treats B before A as A', () => {
    expect(tapLoop('B', 8, { a: null, b: null })).toEqual({ a: 8, b: null })
  })

  it('moves A without losing B', () => {
    expect(tapLoop('A', 5, { a: 12, b: 20 })).toEqual({ a: 5, b: 20 })
  })

  it('never goes negative', () => {
    expect(tapLoop('A', -1, { a: null, b: null })).toEqual({ a: 0, b: null })
  })
})

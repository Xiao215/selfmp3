import { describe, expect, it } from 'vitest'
import { filledTenths, valueAlong } from './scrubber.model'

describe('filledTenths', () => {
  it('fills to where the value is, in tenths of a per cent, and nothing before the end is known', () => {
    expect(filledTenths(62, 248)).toBe(250)
    expect(filledTenths(300, 248)).toBe(1000)
    expect(filledTenths(-1, 248)).toBe(0)
    expect(filledTenths(10, 0)).toBe(0)
    expect(filledTenths(10, NaN)).toBe(0)
    expect(filledTenths(NaN, 248)).toBe(0)
  })

  it('rounds, so a ticking position reuses a thousand shares rather than making new ones', () => {
    expect(filledTenths(1.2345, 100)).toBe(12)
    expect(filledTenths(1.2655, 100)).toBe(13)
  })
})

describe('valueAlong', () => {
  it('lands where the track is dragged, kept within the end', () => {
    expect(valueAlong(50, 200, 248)).toBe(62)
    expect(valueAlong(-20, 200, 248)).toBe(0)
    expect(valueAlong(260, 200, 248)).toBe(248)
  })

  it('gives nothing for a track not measured, or with no end', () => {
    expect(valueAlong(50, 0, 248)).toBeNull()
    expect(valueAlong(50, 200, 0)).toBeNull()
  })
})

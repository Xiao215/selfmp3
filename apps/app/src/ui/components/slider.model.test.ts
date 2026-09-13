import { describe, expect, it } from 'vitest'

import { fractionOf, valueAt } from './slider.model'

describe('slider', () => {
  it('snaps a point on the track to the step', () => {
    expect(valueAt(0.5, { min: 0, max: 12, step: 1 })).toBe(6)
    expect(valueAt(0.54, { min: 0, max: 12, step: 1 })).toBe(6)
    expect(valueAt(0.26, { min: 0.1, max: 1, step: 0.05 })).toBe(0.35)
  })

  it('never leaves the range', () => {
    expect(valueAt(-1, { min: 0, max: 359, step: 1 })).toBe(0)
    expect(valueAt(2, { min: 0, max: 359, step: 1 })).toBe(359)
  })

  it('places a value along the track', () => {
    expect(fractionOf(0.5, { min: 0.1, max: 1, step: 0.05 })).toBeCloseTo(0.444, 3)
    expect(fractionOf(20, { min: 0, max: 12, step: 1 })).toBe(1)
    expect(fractionOf(3, { min: 5, max: 5, step: 1 })).toBe(0)
  })
})

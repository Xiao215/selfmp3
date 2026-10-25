import { describe, expect, it } from 'vitest'

import { TAP_SLOP, stillATap } from './useTouchTravel'

describe('a press under a swipe', () => {
  const from = { x: 100, y: 300 }

  it('is a tap while the finger stays within a few points', () => {
    expect(stillATap(from, from)).toBe(true)
    expect(stillATap(from, { x: 100 + TAP_SLOP, y: 300 })).toBe(true)
    expect(stillATap(from, { x: 106, y: 306 })).toBe(true)
  })

  it('is not a tap once the finger has gone sideways or along', () => {
    // A row swiped left that the swipe never took, a cover swiped across.
    expect(stillATap(from, { x: 40, y: 302 })).toBe(false)
    expect(stillATap(from, { x: 100, y: 300 + TAP_SLOP + 1 })).toBe(false)
  })
})

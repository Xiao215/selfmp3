import { describe, expect, it } from 'vitest'
import { mousePoints, NOTCH_POINTS, wheelSource } from './wheel.model'

const at = 10_000

describe('telling a mouse from a trackpad', () => {
  it('takes lines and pages for a mouse (Firefox)', () => {
    expect(wheelSource({ deltaX: 0, deltaY: 3, deltaMode: 1, at }, null)).toBe('mouse')
  })

  it('takes a Mac notch for a mouse, and a Windows notch', () => {
    expect(wheelSource({ deltaX: 0, deltaY: 4.000244140625, deltaMode: 0, at }, null)).toBe('mouse')
    expect(wheelSource({ deltaX: 0, deltaY: -100, deltaMode: 0, wheelDeltaY: 120, at }, null)).toBe(
      'mouse',
    )
  })

  it('takes small steps, sideways ones, and Chrome’s three-times field for a trackpad', () => {
    expect(wheelSource({ deltaX: 0, deltaY: 2.5, deltaMode: 0, at }, null)).toBe('trackpad')
    expect(wheelSource({ deltaX: 4, deltaY: 120, deltaMode: 0, at }, null)).toBe('trackpad')
    expect(wheelSource({ deltaX: 0, deltaY: 120, deltaMode: 0, wheelDeltaY: -360, at }, null)).toBe(
      'trackpad',
    )
  })

  it('keeps a gesture’s source, so a trackpad flick never becomes a zoom halfway', () => {
    const last = { source: 'trackpad' as const, at: at - 16 }
    expect(wheelSource({ deltaX: 0, deltaY: 100, deltaMode: 0, at }, last)).toBe('trackpad')
    // A pause long enough is a new gesture.
    expect(wheelSource({ deltaX: 0, deltaY: 100, deltaMode: 0, at: at + 1000 }, last)).toBe('mouse')
  })

  it('counts a notch as the same zoom however it arrives', () => {
    expect(mousePoints({ deltaY: 4.000244140625, deltaMode: 0 })).toBeCloseTo(NOTCH_POINTS)
    expect(mousePoints({ deltaY: 3, deltaMode: 1 })).toBeCloseTo(NOTCH_POINTS)
    expect(mousePoints({ deltaY: -100, deltaMode: 0 })).toBe(-100)
  })
})

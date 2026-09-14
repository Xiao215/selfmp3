import { describe, expect, it } from 'vitest'
import { blurReach, lineTone, lyricBlur } from './stageLyrics.model'

describe('lineTone', () => {
  it('reads unsynced words all alike', () => {
    expect(lineTone(3, -1, 3, false)).toBe('plain')
  })

  it('lights the sung line over the mouse, and the mouse over the rest', () => {
    expect(lineTone(4, 4, 4, true)).toBe('active')
    expect(lineTone(2, 4, 2, true)).toBe('hovered')
    expect(lineTone(2, 4, null, true)).toBe('past')
    expect(lineTone(6, 4, null, true)).toBe('future')
  })

  it('has every line still to come before the first one is sung', () => {
    expect(lineTone(0, -1, null, true)).toBe('future')
  })
})

describe('lyricBlur', () => {
  it('leaves the sung line sharp and blurs more by distance, up to three lines', () => {
    expect(lyricBlur(5, 5, 10)).toBe(0)
    expect(lyricBlur(4, 5, 10)).toBeCloseTo(0.7)
    expect(lyricBlur(7, 5, 10)).toBeCloseTo(1.4)
    expect(lyricBlur(8, 5, 10)).toBeCloseTo(2.1)
    expect(lyricBlur(9, 5, 10)).toBeCloseTo(2.1)
  })

  it('blurs nothing out of reach of the screen', () => {
    expect(lyricBlur(16, 5, 10)).toBe(0)
    expect(lyricBlur(15, 5, 10)).toBeCloseTo(2.1)
  })

  it('blurs from the first line before the song reaches it', () => {
    expect(lyricBlur(0, -1, 10)).toBeCloseTo(0.7)
  })
})

describe('blurReach', () => {
  it('covers every line the box could hold at their shortest', () => {
    // 54px type: lines of at least 97.74px, so a 900px box holds ten.
    expect(blurReach(900, 54)).toBe(11)
    // Smaller type holds more.
    expect(blurReach(900, 30)).toBeGreaterThan(blurReach(900, 54))
  })
})

import { describe, expect, it } from 'vitest'
import { glideToLine } from './lyricFollow.model'

describe('glideToLine', () => {
  it('glides as the song moves on a line, or stays put', () => {
    expect(glideToLine(4, 5)).toBe(true)
    expect(glideToLine(5, 5)).toBe(true)
    expect(glideToLine(5, 4)).toBe(true)
  })

  it('jumps for a seek either way, and for the first line shown', () => {
    expect(glideToLine(4, 30)).toBe(false)
    expect(glideToLine(30, 2)).toBe(false)
    expect(glideToLine(-1, 0)).toBe(false)
  })
})

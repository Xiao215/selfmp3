import { describe, expect, it } from 'vitest'

import { hueName, isolated } from './hueNames.model'

describe('a tag colour’s name', () => {
  it('names each swatch', () => {
    expect(hueName(0)).toBe('Red')
    expect(hueName(140)).toBe('Green')
    expect(hueName(235)).toBe('Blue')
  })

  it('gives any other hue the nearest name, round the wheel', () => {
    expect(hueName(138)).toBe('Green')
    expect(hueName(355)).toBe('Red')
    expect(hueName(-10)).toBe('Red')
  })
})

describe('a name inside other words', () => {
  it('is wrapped in a first-strong isolate', () => {
    expect(isolated('موسيقى 123')).toBe('⁨موسيقى 123⁩')
  })
})

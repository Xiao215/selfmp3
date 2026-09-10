import { describe, expect, it } from 'vitest'
import {
  formatSemitones,
  parseKeyName,
  rateToSemitones,
  transposeCamelot,
  transposeKey,
} from './transpose.js'

describe('parseKeyName', () => {
  it('reads the analyser spelling and ASCII variants', () => {
    expect(parseKeyName('A minor')).toEqual({ pitchClass: 9, mode: 'minor' })
    expect(parseKeyName('F♯ major')).toEqual({ pitchClass: 6, mode: 'major' })
    expect(parseKeyName('Bb')).toEqual({ pitchClass: 10, mode: 'major' })
    expect(parseKeyName('c#m')).toEqual({ pitchClass: 1, mode: 'minor' })
    expect(parseKeyName('Cb major')).toEqual({ pitchClass: 11, mode: 'major' })
  })

  it('rejects nonsense', () => {
    expect(parseKeyName('')).toBeNull()
    expect(parseKeyName('H major')).toBeNull()
    expect(parseKeyName('8A')).toBeNull()
  })
})

describe('transposeKey', () => {
  it('moves by semitones and wraps around the octave', () => {
    expect(transposeKey('A minor', 2)).toBe('B minor')
    expect(transposeKey('A minor', -2)).toBe('G minor')
    expect(transposeKey('B major', 1)).toBe('C major')
    expect(transposeKey('C major', -1)).toBe('B major')
    expect(transposeKey('C major', 12)).toBe('C major')
  })

  it('keeps the Camelot wheel consistent with the key', () => {
    // A minor is 8A; up a fifth (7 semitones) is E minor, 9A.
    expect(transposeCamelot('A minor', 7)).toBe('9A')
    expect(transposeCamelot('C major', 0)).toBe('8B')
    expect(transposeCamelot('nope', 1)).toBeNull()
  })
})

describe('formatting', () => {
  it('formats semitone offsets with a proper minus sign', () => {
    expect(formatSemitones(0)).toBe('0')
    expect(formatSemitones(3)).toBe('+3')
    expect(formatSemitones(-1)).toBe('−1')
  })

  it('converts playback rate to a pitch shift', () => {
    expect(rateToSemitones(1)).toBe(0)
    expect(rateToSemitones(0.5)).toBe(-12)
    expect(rateToSemitones(2)).toBe(12)
    expect(rateToSemitones(1.25)).toBe(3.9)
    expect(rateToSemitones(0)).toBe(0)
  })
})

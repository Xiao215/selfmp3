import { describe, expect, it } from 'vitest'
import { parseIntegratedLoudness } from './analysis.js'

/** A trimmed copy of what ffmpeg prints after `-af ebur128` finishes. */
const SUMMARY = `
[Parsed_ebur128_0 @ 0x55] Summary:

  Integrated loudness:
    I:         -14.2 LUFS
    Threshold: -24.6 LUFS

  Loudness range:
    LRA:         6.1 LU
    Threshold: -34.7 LUFS
    LRA low:   -18.9 LUFS
    LRA high:  -12.8 LUFS
`

describe('parseIntegratedLoudness', () => {
  it('reads the integrated value from the summary block', () => {
    expect(parseIntegratedLoudness(SUMMARY)).toBe(-14.2)
  })

  it('treats the -70 floor as "no signal"', () => {
    expect(parseIntegratedLoudness('    I:         -70.0 LUFS\n')).toBeNull()
  })

  it('returns null when the summary is missing', () => {
    expect(parseIntegratedLoudness('')).toBeNull()
    expect(parseIntegratedLoudness('LRA low:   -18.9 LUFS')).toBeNull()
  })
})

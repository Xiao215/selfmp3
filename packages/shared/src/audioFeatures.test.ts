import { describe, expect, it } from 'vitest'
import type { Song, AudioFeatures } from './index.js'
import {
  bpmDistance,
  camelotDistance,
  camelotFromKey,
  compatibleCamelot,
  featureDistance,
  keyName,
  parseCamelot,
  songDistance,
  transitionCrossfade,
} from './audioFeatures.js'

const feat = (patch: Partial<AudioFeatures> = {}): AudioFeatures => ({
  bpm: 120,
  energy: 0.5,
  loudnessLufs: -14,
  key: 'C major',
  camelot: '8B',
  danceability: 0.5,
  analyzedAt: '2026-01-01 00:00:00',
  version: 1,
  ...patch,
})

const song = (id: number, patch: Partial<Song> = {}): Song => ({
  id,
  path: `${id}.m4a`,
  title: `Song ${id}`,
  artist: '',
  album: '',
  albumArtist: '',
  trackNo: null,
  year: null,
  duration: 200,
  sizeBytes: 0,
  mime: 'audio/mp4',
  hasArt: false,
  lyricsKind: 'none',
  instrumental: false,
  playCount: 0,
  skipCount: 0,
  loved: false,
  sourceUrl: null,
  lastPlayedAt: null,
  addedAt: '2026-01-01',
  missing: false,
  tagIds: [],
  audioFeatures: null,
  ...patch,
})

describe('Camelot wheel', () => {
  it('maps the standard keys', () => {
    expect(camelotFromKey(0, 'major')).toBe('8B') // C
    expect(camelotFromKey(9, 'minor')).toBe('8A') // A minor
    expect(camelotFromKey(7, 'major')).toBe('9B') // G
    expect(camelotFromKey(11, 'major')).toBe('1B') // B
    expect(camelotFromKey(6, 'major')).toBe('2B') // F#
    expect(camelotFromKey(5, 'major')).toBe('7B') // F
    expect(camelotFromKey(8, 'minor')).toBe('1A') // G# minor
    expect(camelotFromKey(2, 'minor')).toBe('7A') // D minor
    expect(camelotFromKey(3, 'major')).toBe('5B') // Eb
  })

  it('names keys', () => {
    expect(keyName(9, 'minor')).toBe('A minor')
    expect(keyName(6, 'major')).toBe('F♯ major')
    expect(keyName(-1, 'major')).toBe('B major')
  })

  it('parses codes leniently and rejects junk', () => {
    expect(parseCamelot('8a')).toEqual({ number: 8, letter: 'A' })
    expect(parseCamelot(' 12B ')).toEqual({ number: 12, letter: 'B' })
    expect(parseCamelot('13A')).toBeNull()
    expect(parseCamelot('0B')).toBeNull()
    expect(parseCamelot('C major')).toBeNull()
  })

  it('measures distance around the wheel, wrapping at 12', () => {
    expect(camelotDistance('8A', '8A')).toBe(0)
    expect(camelotDistance('8A', '8B')).toBe(1)
    expect(camelotDistance('8A', '9A')).toBe(1)
    expect(camelotDistance('12A', '1A')).toBe(1)
    expect(camelotDistance('1B', '12A')).toBe(2)
    expect(camelotDistance('8A', '2A')).toBe(6)
    expect(camelotDistance('8A', '2B')).toBe(7)
    expect(camelotDistance('8A', 'nope')).toBe(7)
  })

  it('knows the compatible set', () => {
    expect(compatibleCamelot('8A').sort()).toEqual(['7A', '8A', '8B', '9A'])
    expect(compatibleCamelot('12B').sort()).toEqual(['11B', '12A', '12B', '1B'])
    expect(compatibleCamelot('1A').sort()).toEqual(['12A', '1A', '1B', '2A'])
    expect(compatibleCamelot('bad')).toEqual([])
  })
})

describe('bpmDistance', () => {
  it('is zero within tolerance, including double and half time', () => {
    expect(bpmDistance(120, 124)).toBe(0)
    expect(bpmDistance(70, 140)).toBe(0)
    expect(bpmDistance(140, 70)).toBe(0)
    expect(bpmDistance(128, 65)).toBe(0)
  })

  it('grows with the gap outside tolerance', () => {
    expect(bpmDistance(100, 120)).toBeCloseTo(1 / 6, 3)
    expect(bpmDistance(90, 120)).toBeGreaterThan(bpmDistance(100, 120))
    expect(bpmDistance(0, 120)).toBe(1)
  })
})

describe('featureDistance', () => {
  it('is zero for identical features', () => {
    expect(featureDistance(feat(), feat())).toBe(0)
  })

  it('ranks a close song under a far one', () => {
    const seed = feat()
    const close = feat({ bpm: 122, camelot: '9B', energy: 0.55 })
    const far = feat({ bpm: 80, camelot: '2A', energy: 0.95, loudnessLufs: -25 })
    expect(featureDistance(seed, close)).toBeLessThan(featureDistance(seed, far))
  })

  it('treats missing features as a middling mismatch', () => {
    const seed = feat()
    expect(featureDistance(seed, null)).toBeGreaterThan(featureDistance(seed, feat({ bpm: 126 })))
    expect(featureDistance(seed, null)).toBeLessThan(
      featureDistance(seed, feat({ bpm: 70, camelot: '2A', energy: 1, loudnessLufs: -30 })),
    )
  })
})

describe('songDistance', () => {
  it('rewards shared tags and the same artist', () => {
    const seed = song(1, { artist: 'Aurora Lane', tagIds: [1, 2], audioFeatures: feat() })
    const plain = song(2, { audioFeatures: feat() })
    const tagged = song(3, { tagIds: [1, 2], audioFeatures: feat() })
    const sameArtist = song(4, { artist: 'aurora lane', audioFeatures: feat() })
    expect(songDistance(seed, tagged)).toBeLessThan(songDistance(seed, plain))
    expect(songDistance(seed, sameArtist)).toBeLessThan(songDistance(seed, plain))
    expect(songDistance(seed, tagged)).toBeLessThan(songDistance(seed, sameArtist))
  })

  it('caps the tag bonus', () => {
    const seed = song(1, { tagIds: [1, 2, 3, 4, 5, 6], audioFeatures: feat() })
    const three = song(2, { tagIds: [1, 2, 3], audioFeatures: feat() })
    const six = song(3, { tagIds: [1, 2, 3, 4, 5, 6], audioFeatures: feat() })
    expect(songDistance(seed, six)).toBe(songDistance(seed, three))
  })
})

describe('transitionCrossfade', () => {
  it('never exceeds the ceiling and is zero when crossfade is off', () => {
    expect(transitionCrossfade(feat(), feat(), 0)).toBe(0)
    expect(transitionCrossfade(feat(), feat(), 12)).toBe(12)
    expect(transitionCrossfade(feat(), feat(), 6)).toBe(6)
  })

  it('is longer for a compatible pair than a clashing one', () => {
    const from = feat()
    const smooth = feat({ bpm: 123, camelot: '9B' })
    const clash = feat({ bpm: 90, camelot: '2A' })
    expect(transitionCrossfade(from, smooth, 12)).toBeGreaterThan(
      transitionCrossfade(from, clash, 12),
    )
    expect(transitionCrossfade(from, clash, 12)).toBeGreaterThanOrEqual(1)
  })

  it('falls back to a middle value without features', () => {
    expect(transitionCrossfade(null, feat(), 8)).toBe(4)
    expect(transitionCrossfade(null, null, 2)).toBe(2)
  })
})

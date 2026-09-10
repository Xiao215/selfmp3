import { describe, expect, it } from 'vitest'
import {
  durationCloseness,
  normalizeText,
  rankCandidates,
  scoreCandidate,
  similarity,
} from './lookupScore.js'

describe('normalizeText', () => {
  it('lowercases, strips accents and punctuation', () => {
    expect(normalizeText('Café  Déjà-Vu!')).toBe('cafe deja vu')
  })

  it('drops bracketed download-tool noise and remaster suffixes', () => {
    expect(normalizeText('Song Name (Official Video)')).toBe('song name')
    expect(normalizeText('Song Name [HD]')).toBe('song name')
    expect(normalizeText('Song Name - Remastered 2011')).toBe('song name')
    expect(normalizeText('Song Name (feat. Someone)')).toBe('song name')
    expect(normalizeText('Song Name feat. Someone')).toBe('song name')
  })

  it('keeps brackets that carry meaning', () => {
    expect(normalizeText('Nocturne (Study in E)')).toBe('nocturne study in e')
  })

  it('keeps non-latin scripts', () => {
    expect(normalizeText('桜の風')).toBe('桜の風')
  })
})

describe('similarity', () => {
  it('is 1 for equal text after normalisation', () => {
    expect(similarity('Bohemian Rhapsody', 'bohemian rhapsody (Official Video)')).toBe(1)
  })

  it('is high for a typo and low for a different song', () => {
    expect(similarity('Bohemian Rhapsody', 'Bohemian Rapsody')).toBeGreaterThan(0.8)
    expect(similarity('Bohemian Rhapsody', 'Under Pressure')).toBeLessThan(0.3)
  })

  it('rewards containment proportionally', () => {
    const contained = similarity('Nocturne', 'Nocturne Study in E')
    expect(contained).toBeGreaterThan(0.4)
    expect(contained).toBeLessThan(1)
  })

  it('is 0 when either side is empty', () => {
    expect(similarity('', 'anything')).toBe(0)
  })
})

describe('durationCloseness', () => {
  it('is null when either duration is unknown', () => {
    expect(durationCloseness(undefined, 200)).toBeNull()
    expect(durationCloseness(200, 0)).toBeNull()
  })

  it('is 1 within two seconds and decays to 0 at twenty', () => {
    expect(durationCloseness(200, 201.6)).toBe(1)
    expect(durationCloseness(200, 211)).toBeCloseTo(0.5, 1)
    expect(durationCloseness(200, 230)).toBe(0)
  })
})

describe('scoreCandidate', () => {
  const query = { title: 'Bohemian Rhapsody', artist: 'Queen', album: '', duration: 355 }

  it('gives a full score to an exact match with matching duration', () => {
    expect(
      scoreCandidate({ title: 'Bohemian Rhapsody', artist: 'Queen', durationSec: 354 }, query),
    ).toBe(1)
  })

  it('ranks the studio version above a live one with a longer duration', () => {
    const studio = scoreCandidate(
      { title: 'Bohemian Rhapsody', artist: 'Queen', durationSec: 354 },
      query,
    )
    const live = scoreCandidate(
      { title: 'Bohemian Rhapsody (Live at Wembley)', artist: 'Queen', durationSec: 401 },
      query,
    )
    expect(studio).toBeGreaterThan(live)
  })

  it('moves the artist weight to the title when the song has no artist', () => {
    const noArtist = { ...query, artist: '' }
    expect(scoreCandidate({ title: 'Bohemian Rhapsody', artist: 'Queen' }, noArtist)).toBe(1)
  })

  it('penalises a wrong artist', () => {
    const score = scoreCandidate(
      { title: 'Bohemian Rhapsody', artist: 'Panic! at the Disco' },
      query,
    )
    expect(score).toBeLessThan(0.85)
  })
})

describe('rankCandidates', () => {
  it('sorts best first and removes duplicates within a source', () => {
    const ranked = rankCandidates([
      { source: 'itunes', title: 'A', artist: 'X', album: 'B', score: 0.5 },
      { source: 'itunes', title: 'a', artist: 'x', album: 'b', score: 0.4 },
      { source: 'musicbrainz', title: 'A', artist: 'X', album: 'B', score: 0.9 },
    ])
    expect(ranked.map(c => `${c.source}:${c.score}`)).toEqual(['musicbrainz:0.9', 'itunes:0.5'])
  })
})

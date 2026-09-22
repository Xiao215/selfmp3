import { describe, expect, it } from 'vitest'
import {
  durationScore,
  normalizeForMatch,
  rankCandidates,
  scoreHit,
  searchQuery,
  similarity,
} from './migrateScore.js'
import type { SearchHit } from './ytdlp.js'

const hit = (partial: Partial<SearchHit> & { title: string }): SearchHit => ({
  url: `https://www.youtube.com/watch?v=${partial.title.replace(/\W/g, '').slice(0, 11)}`,
  channel: '',
  duration: 0,
  thumbnail: null,
  ...partial,
})

const getLucky = {
  title: 'Get Lucky',
  artist: 'Daft Punk',
  album: 'Random Access Memories',
  duration: 248,
}

describe('normalizeForMatch / similarity', () => {
  it('ignores case, accents, punctuation and ampersands', () => {
    expect(normalizeForMatch('Déjà Vu!')).toBe('deja vu')
    expect(normalizeForMatch('Earth, Wind & Fire')).toBe('earth wind and fire')
    expect(similarity('Beyoncé - Déjà Vu', 'beyonce deja vu')).toBe(1)
  })

  it('scores containment highly and unrelated text low', () => {
    expect(similarity('Get Lucky', 'Daft Punk Get Lucky Official Audio')).toBeGreaterThan(0.8)
    expect(similarity('Get Lucky', 'Around the World')).toBeLessThan(0.4)
    expect(similarity('', 'x')).toBe(0)
  })
})

describe('durationScore', () => {
  it('is null when a length is unknown and decays with the gap', () => {
    expect(durationScore(0, 200)).toBeNull()
    expect(durationScore(200, 0)).toBeNull()
    expect(durationScore(200, 202)).toBe(1)
    expect(durationScore(200, 245)).toBe(0)
    expect(durationScore(200, 224)).toBeCloseTo(0.5, 1)
  })
})

describe('scoreHit', () => {
  it('rates an official upload of the right song green', () => {
    const topic = scoreHit(
      getLucky,
      hit({ title: 'Get Lucky', channel: 'Daft Punk - Topic', duration: 248 }),
    )
    const official = scoreHit(
      getLucky,
      hit({
        title: 'Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams, Nile Rodgers',
        channel: 'DaftPunkVEVO',
        duration: 249,
      }),
    )
    expect(topic).toBeGreaterThanOrEqual(0.9)
    expect(official).toBeGreaterThanOrEqual(0.8)
  })

  it('marks live, cover, remix, 8D, sped up and reaction videos down', () => {
    const studio = hit({ title: 'Daft Punk - Get Lucky', channel: 'Daft Punk', duration: 248 })
    const studioScore = scoreHit(getLucky, studio)
    for (const title of [
      'Daft Punk - Get Lucky (Live at Coachella)',
      'Get Lucky - Daft Punk (cover)',
      'Daft Punk - Get Lucky (Some DJ Remix)',
      'Daft Punk - Get Lucky (8D Audio)',
      'Daft Punk - Get Lucky (sped up)',
      'Daft Punk - Get Lucky (slowed + reverb)',
      'Producer REACTS to Daft Punk - Get Lucky',
      'Daft Punk - Get Lucky 1 hour loop',
    ]) {
      const score = scoreHit(getLucky, hit({ title, channel: 'Someone', duration: 248 }))
      expect(score, title).toBeLessThan(studioScore - 0.15)
    }
  })

  it('does not punish a lyrics video much', () => {
    const plain = scoreHit(
      getLucky,
      hit({ title: 'Daft Punk - Get Lucky', channel: 'Someone', duration: 248 }),
    )
    const lyrics = scoreHit(
      getLucky,
      hit({ title: 'Daft Punk - Get Lucky (Lyrics)', channel: 'Someone', duration: 248 }),
    )
    expect(plain - lyrics).toBeLessThan(0.06)
  })

  it('does not punish "live" or "remix" when the source title asks for it', () => {
    const source = { title: 'Get Lucky (Live)', artist: 'Daft Punk', album: '', duration: 0 }
    const score = scoreHit(
      source,
      hit({ title: 'Daft Punk - Get Lucky (Live)', channel: 'Daft Punk' }),
    )
    expect(score).toBeGreaterThanOrEqual(0.8)
  })

  it('uses duration to separate versions', () => {
    const close = scoreHit(
      getLucky,
      hit({ title: 'Daft Punk - Get Lucky', channel: 'x', duration: 250 }),
    )
    const far = scoreHit(
      getLucky,
      hit({ title: 'Daft Punk - Get Lucky', channel: 'x', duration: 369 }),
    )
    expect(close).toBeGreaterThan(far + 0.15)
  })

  it('punishes a compilation-length result', () => {
    const score = scoreHit(
      getLucky,
      hit({ title: 'Daft Punk - Get Lucky', channel: 'x', duration: 3600 }),
    )
    expect(score).toBeLessThan(0.5)
  })

  it('is red for the wrong song by the same artist', () => {
    const score = scoreHit(
      getLucky,
      hit({ title: 'Daft Punk - Around the World', channel: 'Daft Punk - Topic', duration: 248 }),
    )
    expect(score).toBeLessThan(0.5)
  })

  it('copes with a missing artist and an unknown length', () => {
    const source = { title: 'Bohemian Rhapsody', artist: '', album: '', duration: 0 }
    const good = scoreHit(
      source,
      hit({
        title: 'Queen – Bohemian Rhapsody (Official Video Remastered)',
        channel: 'Queen Official',
      }),
    )
    const bad = scoreHit(source, hit({ title: 'Top 10 rock songs', channel: 'Lists' }))
    expect(good).toBeGreaterThan(0.6)
    expect(bad).toBeLessThan(0.3)
  })

  it('finds the artist in the channel when the title omits it', () => {
    const source = { title: 'Hello', artist: 'Adele', album: '', duration: 295 }
    const score = scoreHit(source, hit({ title: 'Hello', channel: 'Adele - Topic', duration: 296 }))
    expect(score).toBeGreaterThanOrEqual(0.9)
  })
})

describe('rankCandidates', () => {
  it('returns the best three, best first, with rounded confidence', () => {
    const ranked = rankCandidates(getLucky, [
      hit({ title: 'Daft Punk - Get Lucky (cover)', channel: 'a', duration: 248 }),
      hit({ title: 'Get Lucky', channel: 'Daft Punk - Topic', duration: 248 }),
      hit({
        title: 'Daft Punk - Get Lucky (Official Audio)',
        channel: 'DaftPunkVEVO',
        duration: 248,
      }),
      hit({ title: 'Daft Punk - Get Lucky (8D)', channel: 'b', duration: 248 }),
      hit({ title: 'Daft Punk - Get Lucky Reaction', channel: 'c', duration: 900 }),
    ])
    expect(ranked).toHaveLength(3)
    expect(ranked[0]?.channel).toBe('Daft Punk - Topic')
    expect(ranked[1]?.channel).toBe('DaftPunkVEVO')
    expect(ranked.every(c => c.confidence === Math.round(c.confidence * 100) / 100)).toBe(true)
    expect(ranked[0]!.confidence).toBeGreaterThanOrEqual(ranked[2]!.confidence)
  })

  it('handles no results', () => {
    expect(rankCandidates(getLucky, [])).toEqual([])
  })
})

describe('searchQuery', () => {
  it('puts the artist first and drops noise', () => {
    expect(searchQuery(getLucky)).toBe('Daft Punk Get Lucky')
    expect(
      searchQuery({ title: 'Creep (Remastered 2009)', artist: '', album: '', duration: 0 }),
    ).toBe('Creep')
  })
})

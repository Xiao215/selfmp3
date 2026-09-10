import { describe, expect, it } from 'vitest'
import { editDistance, fuzzyRank, isSubsequence, scoreMatch } from './fuzzy.js'

describe('editDistance', () => {
  it('measures small edits', () => {
    expect(editDistance('chill', 'chill')).toBe(0)
    expect(editDistance('chill', 'chil')).toBe(1)
    expect(editDistance('chill', 'chlil')).toBe(2)
  })

  it('bails out beyond the cutoff instead of doing the full matrix', () => {
    expect(editDistance('a', 'a'.repeat(50), 2)).toBe(3)
  })

  it('handles empty strings', () => {
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('abc', '')).toBe(3)
  })
})

describe('isSubsequence', () => {
  it('matches in-order characters', () => {
    expect(isSubsequence('mdr', 'midnight drive')).toBe(true)
    expect(isSubsequence('rdm', 'midnight drive')).toBe(false)
    expect(isSubsequence('', 'anything')).toBe(true)
  })
})

describe('scoreMatch', () => {
  it('ranks an exact match above a prefix above a substring', () => {
    const exact = scoreMatch('chill', 'chill')
    const prefix = scoreMatch('chi', 'chill')
    const substring = scoreMatch('ill', 'chill')
    expect(exact).not.toBeNull()
    expect(prefix).not.toBeNull()
    expect(substring).not.toBeNull()
    expect(exact!).toBeGreaterThan(prefix!)
    expect(prefix!).toBeGreaterThan(substring!)
  })

  it('matches word boundaries inside a phrase', () => {
    expect(scoreMatch('drive', 'midnight drive')).not.toBeNull()
  })

  it('matches acronyms', () => {
    expect(scoreMatch('md', 'midnight drive')).not.toBeNull()
  })

  it('tolerates a typo in a long query but not a short one', () => {
    expect(scoreMatch('chilll', 'chill')).not.toBeNull()
    expect(scoreMatch('xy', 'ab')).toBeNull()
  })

  it('returns null for a genuine non-match', () => {
    expect(scoreMatch('jazz', 'chill')).toBeNull()
  })

  it('treats an empty query as neutral', () => {
    expect(scoreMatch('', 'anything')).toBe(0)
  })
})

describe('fuzzyRank', () => {
  const tags = [{ name: 'chinese' }, { name: 'chill' }, { name: 'classical' }, { name: 'jazz' }]

  it('returns everything untouched for an empty query', () => {
    const ranked = fuzzyRank('', tags, t => t.name)
    expect(ranked.map(r => r.item.name)).toEqual(['chinese', 'chill', 'classical', 'jazz'])
  })

  it('puts the best match first', () => {
    const ranked = fuzzyRank('chi', tags, t => t.name)
    expect(ranked[0]?.item.name).toBe('chill')
    expect(ranked.map(r => r.item.name)).not.toContain('jazz')
  })

  it('flags exact matches', () => {
    const ranked = fuzzyRank('jazz', tags, t => t.name)
    expect(ranked[0]?.exact).toBe(true)
  })

  it('is case insensitive', () => {
    expect(fuzzyRank('JAZZ', tags, t => t.name)[0]?.item.name).toBe('jazz')
  })
})

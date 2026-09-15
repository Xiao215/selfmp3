import { describe, expect, it } from 'vitest'
import {
  editDistance,
  fuzzyRank,
  fuzzyRankPrepared,
  fuzzyTopPrepared,
  isSubsequence,
  preparedTextFor,
} from './fuzzy.js'

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

/**
 * The matcher as it was before the query was compiled once and each song's
 * text prepared once: a regex and a lowercase copy per candidate per keystroke,
 * and the text rebuilt inside the sort. Kept here as the reference the faster
 * paths must agree with, result for result and in the same order.
 */
function legacyRank<T>(query: string, items: readonly T[], toText: (item: T) => string) {
  const acronymOf = (text: string) =>
    text
      .split(/[\s\-_/]+/)
      .map(word => word[0] ?? '')
      .join('')
  const score = (rawQuery: string, candidate: string): number | null => {
    const q = rawQuery.trim().toLowerCase()
    const c = candidate.toLowerCase()
    if (q.length === 0) return 0
    if (c === q) return 1000
    if (c.startsWith(q)) return 800 - c.length
    if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(c)) return 700 - c.length
    if (c.includes(q)) return 600 - c.length
    if (acronymOf(c).startsWith(q)) return 500 - c.length
    if (isSubsequence(q, c)) return 300 - c.length
    const tolerance = q.length >= 6 ? 2 : q.length >= 4 ? 1 : 0
    if (tolerance > 0) {
      const distance = editDistance(q, c, tolerance)
      if (distance <= tolerance) return 200 - distance * 50 - c.length
    }
    return null
  }
  const q = query.trim().toLowerCase()
  if (q.length === 0) return items.map(item => ({ item, score: 0, exact: false }))
  const matches: { item: T; score: number; exact: boolean }[] = []
  for (const item of items) {
    const text = toText(item)
    const s = score(q, text)
    if (s === null) continue
    matches.push({ item, score: s, exact: text.toLowerCase() === q })
  }
  matches.sort((a, b) => b.score - a.score || toText(a.item).localeCompare(toText(b.item)))
  return matches
}

describe('the prepared paths', () => {
  interface Song {
    id: number
    title: string
    artist: string
    album: string
  }
  const songs: Song[] = [
    ['Midnight Drive', 'Kavinsky', 'Outrun'],
    ['Drive', 'Incubus', 'Make Yourself'],
    ['Nightcall', 'Kavinsky', 'Drive (Original Soundtrack)'],
    ['アイドル', 'YOASOBI', 'アイドル'],
    ['Racing into the Night', 'YOASOBI', 'The Book'],
    ['Monster', 'YOASOBI', 'The Book 2'],
    ['Chill', 'Various', ''],
    ['chill', 'Various', ''],
    ['Chilled Out', 'Various', 'Chill-out / Vol. 1'],
    ['Mr. Blue Sky', 'Electric Light Orchestra', 'Out of the Blue'],
    ['C++ (live)', 'The [Brackets]', 'a.b*c?'],
    ['Same', 'Same', 'Same'],
    ['Same', 'Same', 'Same'],
  ].map(([title, artist, album], id) => ({ id, title, artist, album }) as Song)
  const text = (song: Song) => `${song.title} ${song.artist} ${song.album}`
  const prepared = preparedTextFor(text)
  const queries = [
    '',
    '  ',
    'd',
    'drive',
    'DRIVE ',
    'kav',
    'md',
    'mdk',
    'yoasobi',
    'the book',
    'nite',
    'chil',
    'chill',
    'chilld',
    'blue',
    'elo',
    'c++',
    '[brackets]',
    'a.b*c?',
    'same same same',
    'アイ',
    'o',
    'zzzz',
  ]

  it('ranks exactly as the matcher did before', () => {
    for (const query of queries) {
      const before = legacyRank(query, songs, text)
      expect(fuzzyRank(query, songs, text), query).toEqual(before)
      expect(fuzzyRankPrepared(query, songs, prepared), query).toEqual(before)
    }
  })

  it('keeps the top few in the order the full ranking gives them', () => {
    for (const query of queries) {
      for (const count of [0, 1, 2, 3, 8, 100]) {
        expect(fuzzyTopPrepared(query, songs, prepared, count), `${query} × ${count}`).toEqual(
          legacyRank(query, songs, text).slice(0, count),
        )
      }
    }
  })

  it('remembers prepared text per object, so a second keystroke reuses it', () => {
    const first = songs[0] as Song
    expect(prepared(first)).toBe(prepared(first))
    expect(prepared(first).lower).toBe('midnight drive kavinsky outrun')
    expect(prepared(first).initials).toBe('mdko')
  })
})

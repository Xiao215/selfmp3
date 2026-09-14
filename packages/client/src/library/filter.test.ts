import { fuzzyRank, type Song } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FILTER,
  clearTagFilter,
  excludeTag,
  filterHeading,
  filterSongs,
  includeTag,
  searchSongs,
  tagFilterState,
  tagFiltered,
  topSongs,
  type LibraryFilter,
} from './filter.js'

const CHILL = 1
const CHINESE = 2
const INSTRUMENTAL = 3
const TAGS = [
  { id: CHILL, name: 'chill' },
  { id: CHINESE, name: 'chinese' },
  { id: INSTRUMENTAL, name: 'instrumental' },
]

const song = (id: number, title: string, tagIds: number[]): Song =>
  ({
    id,
    title,
    artist: '',
    album: '',
    tagIds,
    missing: false,
    addedAt: `2026-01-${String(10 + id)}`,
  }) as unknown as Song

const SONGS = [
  song(1, 'a', [CHILL]),
  song(2, 'b', [CHILL, CHINESE]),
  song(3, 'c', [CHILL, INSTRUMENTAL]),
  song(4, 'd', [CHINESE]),
  song(5, 'e', []),
]

const byTitle: LibraryFilter = { ...DEFAULT_FILTER, sort: 'title', descending: false }
const titles = (filter: LibraryFilter) =>
  filterSongs(SONGS, filter, () => false).map(item => item.title)

describe('tag filtering', () => {
  it('shows everything with no tag chosen', () => {
    expect(titles(byTitle)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(tagFiltered(byTitle)).toBe(false)
  })

  it('combines included tags with AND, not OR', () => {
    const both = includeTag(includeTag(byTitle, CHILL), CHINESE)
    expect(titles(both)).toEqual(['b'])
  })

  it('hides any song carrying an excluded tag', () => {
    const chillNotInstrumental = excludeTag(includeTag(byTitle, CHILL), INSTRUMENTAL)
    expect(titles(chillNotInstrumental)).toEqual(['a', 'b'])
  })

  it('can exclude with nothing included', () => {
    expect(titles(excludeTag(byTitle, CHILL))).toEqual(['d', 'e'])
  })

  it('toggles a tag off again', () => {
    expect(includeTag(includeTag(byTitle, CHILL), CHILL).includedTagIds).toEqual([])
    expect(excludeTag(excludeTag(byTitle, CHILL), CHILL).excludedTagIds).toEqual([])
  })

  it('never shows and hides the same tag: each side takes it from the other', () => {
    const hidden = excludeTag(byTitle, CHILL)
    const shown = includeTag(hidden, CHILL)
    expect(tagFilterState(shown, CHILL)).toBe('include')
    expect(shown.excludedTagIds).toEqual([])
    const hiddenAgain = excludeTag(shown, CHILL)
    expect(tagFilterState(hiddenAgain, CHILL)).toBe('exclude')
    expect(hiddenAgain.includedTagIds).toEqual([])
  })

  it('clears both sides at once, and is a no-op when there is nothing to clear', () => {
    const busy = excludeTag(includeTag(byTitle, CHILL), INSTRUMENTAL)
    expect(tagFiltered(clearTagFilter(busy))).toBe(false)
    expect(clearTagFilter(byTitle)).toBe(byTitle)
  })

  it('names the filter in the order the tags were chosen', () => {
    expect(filterHeading(byTitle, TAGS)).toBe('Library')
    const filter = excludeTag(includeTag(includeTag(byTitle, CHINESE), CHILL), INSTRUMENTAL)
    expect(filterHeading(filter, TAGS)).toBe('chinese · chill · not instrumental')
  })

  it('says "Library" first when only exclusions are on', () => {
    expect(filterHeading(excludeTag(byTitle, INSTRUMENTAL), TAGS)).toBe('Library · not instrumental')
  })

  it('searches with prepared text in the order the plain ranking gives', () => {
    const library = [
      song(1, 'Midnight Drive', []),
      song(2, 'Drive', []),
      song(3, 'Nightcall', []),
      song(4, 'drive', []),
      song(5, 'Dr. Ive', []),
    ]
    const text = (item: Song) => `${item.title} ${item.artist} ${item.album}`
    for (const query of ['', 'drive', 'dri', 'night', 'md', 'drvie', 'nothing']) {
      const plain = fuzzyRank(query, library, text)
      expect(searchSongs(query, library), query).toEqual(plain)
      expect(topSongs(query, library, 2), query).toEqual(plain.slice(0, 2).map(m => m.item))
      if (query) {
        const filter = { ...byTitle, query }
        expect(filterSongs(library, filter, () => false), query).toEqual(plain.map(m => m.item))
      }
    }
  })

  it('leaves out a tag that no longer exists', () => {
    expect(filterHeading(includeTag(byTitle, 99), TAGS)).toBe('Library')
    expect(filterHeading(includeTag(includeTag(byTitle, 99), CHILL), TAGS)).toBe('chill')
  })
})

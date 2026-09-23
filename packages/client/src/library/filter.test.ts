import { fuzzyRank, type Song } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FILTER,
  bothTagsCount,
  clearTagFilter,
  filterHeading,
  filterSongs,
  searchSongs,
  tagFiltered,
  tagMatchCount,
  toggleTag,
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

  it('shows songs carrying any of the chosen tags, not only songs carrying all', () => {
    const both = toggleTag(toggleTag(byTitle, CHILL), CHINESE)
    // b is the only song with both; a and c are chill, d is chinese. All four
    // are here — a second tag adds music, it does not take any away.
    expect(titles(both).toSorted()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('puts the songs carrying the most of the chosen tags first', () => {
    const both = toggleTag(toggleTag(byTitle, CHILL), CHINESE)
    // b carries both, so it leads; the one-tag songs keep their title order.
    expect(titles(both)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('ranks by matches however the list is sorted, and reverses with it', () => {
    const both = toggleTag(toggleTag(byTitle, CHILL), CHINESE)
    expect(titles({ ...both, descending: true })).toEqual(['b', 'd', 'c', 'a'])
  })

  it('leaves a single tag in the chosen order: there is nothing to rank', () => {
    expect(titles(toggleTag(byTitle, CHILL))).toEqual(['a', 'b', 'c'])
  })

  it('can never empty the list by adding a tag', () => {
    const chill = toggleTag(byTitle, CHILL)
    const andInstrumental = toggleTag(chill, INSTRUMENTAL)
    expect(titles(andInstrumental).length).toBeGreaterThanOrEqual(titles(chill).length)
  })

  it('counts how many of the chosen tags a song carries', () => {
    const ids = [CHILL, CHINESE]
    expect(tagMatchCount(SONGS[1]!, ids)).toBe(2)
    expect(tagMatchCount(SONGS[0]!, ids)).toBe(1)
    expect(tagMatchCount(SONGS[4]!, ids)).toBe(0)
  })

  it('says how many songs carry every chosen tag, and nothing for one tag', () => {
    expect(bothTagsCount(SONGS, [CHILL, CHINESE])).toBe(1)
    expect(bothTagsCount(SONGS, [CHILL])).toBe(0)
    expect(bothTagsCount(SONGS, [])).toBe(0)
  })

  it('clears the tags, and is a no-op when there is nothing to clear', () => {
    const busy = toggleTag(toggleTag(byTitle, CHILL), INSTRUMENTAL)
    expect(tagFiltered(clearTagFilter(busy))).toBe(false)
    expect(clearTagFilter(byTitle)).toBe(byTitle)
  })

  it('names the filter in the order the tags were chosen', () => {
    expect(filterHeading(byTitle, TAGS)).toBe('Library')
    const filter = toggleTag(toggleTag(byTitle, CHINESE), CHILL)
    expect(filterHeading(filter, TAGS)).toBe('chinese · chill')
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
        expect(
          filterSongs(library, filter, () => false),
          query,
        ).toEqual(plain.map(m => m.item))
      }
    }
  })

  it('leaves out a tag that no longer exists', () => {
    expect(filterHeading(toggleTag(byTitle, 99), TAGS)).toBe('Library')
    expect(filterHeading(toggleTag(toggleTag(byTitle, 99), CHILL), TAGS)).toBe('chill')
  })
})

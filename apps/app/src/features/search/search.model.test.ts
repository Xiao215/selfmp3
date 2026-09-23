import { describe, expect, it } from 'vitest'

import {
  allResults,
  beforeTyping,
  lyricsQueryFor,
  parseScope,
  recentItems,
  scopeCounts,
  searchLibrary,
  type RecentItem,
} from './search.model'

const song = (id: number, title: string, artist = 'YOASOBI', extra: object = {}) =>
  ({ id, title, artist, album: '', tagIds: [7], ...extra }) as never

const library = {
  songs: [
    song(1, 'アイドル'),
    song(2, 'Racing into the Night'),
    song(3, 'Monster'),
    song(4, 'ノーチラス', 'Yorushika'),
  ],
  playlists: [] as never,
  tags: [
    { id: 7, name: 'yoasobi', hue: 1, songCount: 3 },
    { id: 8, name: 'yorushika', hue: 2, songCount: 1 },
    { id: 9, name: 'empty', hue: 3, songCount: 0 },
  ] as never,
}

describe('where a search starts', () => {
  it('starts on the scope the door asks for, and on All for anything else', () => {
    expect(parseScope('songs')).toBe('songs')
    expect(parseScope('tags')).toBe('tags')
    expect(parseScope('nope')).toBe('all')
    expect(parseScope(undefined)).toBe('all')
  })
})

describe('before anything is typed', () => {
  it('offers your tags, fullest first, and what you played last', () => {
    const dated = {
      ...library,
      songs: [
        song(1, 'a', 'x', { lastPlayedAt: '2026-09-10 10:00:00' }),
        song(2, 'b', 'x', { lastPlayedAt: '2026-09-12 10:00:00' }),
      ],
    }
    const empty = beforeTyping(dated, null)
    expect(empty.tags.map(tag => tag.name)).toEqual(['yoasobi', 'yorushika'])
    expect(empty.recent.map(item => (item as { id: number }).id)).toEqual([2, 1])
  })

  it('has nothing to offer before the library arrives', () => {
    expect(beforeTyping(undefined, null)).toEqual({ tags: [], recent: [] })
  })
})

describe('searchLibrary', () => {
  it('finds songs, tags and artists', () => {
    const found = searchLibrary('yorushika', library)
    expect(found.songs.map(item => (item as { id: number }).id)).toEqual([4])
    expect(found.tags.map(tag => tag.name)).toEqual(['yorushika'])
    expect(found.artists.map(artist => artist.name)).toEqual(['Yorushika'])
    expect(found.artists[0]?.songIds).toEqual([4])
  })

  it('finds nothing for nothing typed', () => {
    expect(searchLibrary('  ', library)).toEqual({ songs: [], tags: [], artists: [] })
  })

  it('counts every scope, lyrics included', () => {
    const found = searchLibrary('yorushika', library)
    expect(scopeCounts(found, 2)).toEqual({ all: 5, songs: 1, tags: 1, artists: 1, lyrics: 2 })
  })
})

describe('All', () => {
  it('puts the artist before a tag of the same name, then songs', () => {
    const { places, songs } = allResults(searchLibrary('yoasobi', library))
    expect(places.map(place => place.kind)).toEqual(['artist', 'tag'])
    expect(songs.length).toBeGreaterThan(0)
  })

  it('shows a few of each and leaves the rest to the scope', () => {
    const many = {
      ...library,
      songs: Array.from({ length: 20 }, (_, id) => song(id, `Night ${id}`)),
    }
    expect(allResults(searchLibrary('night', many)).songs).toHaveLength(5)
  })
})

describe('recentItems', () => {
  it('lists what was played lately, the loaded song first', () => {
    const dated = {
      ...library,
      songs: [
        song(1, 'アイドル', 'x', { lastPlayedAt: '2026-09-10T10:00:00Z' }),
        song(2, 'Racing', 'x', { lastPlayedAt: '2026-09-12T10:00:00Z' }),
        song(3, 'Monster', 'x', { lastPlayedAt: null }),
      ],
      playlists: [{ id: 9, name: 'evening', lastPlayedAt: '2026-09-11T10:00:00Z' }] as never,
    }
    const keys = (items: readonly RecentItem[]) =>
      items.map(item =>
        item.kind === 'song' ? `song-${item.song.id}` : `playlist-${item.playlist.id}`,
      )
    expect(keys(recentItems(dated))).toEqual(['song-2', 'playlist-9', 'song-1'])
    expect(keys(recentItems(dated, 3))).toEqual(['song-3', 'song-2', 'playlist-9', 'song-1'])
    expect(keys(recentItems(dated, 1, 2))).toEqual(['song-1', 'song-2'])
    expect(recentItems(undefined)).toEqual([])
  })
})

describe('lyricsQueryFor', () => {
  it('searches lyrics only once the query means something', () => {
    expect(lyricsQueryFor('ab')).toBe('')
    expect(lyricsQueryFor(' abc ')).toBe('abc')
    expect(lyricsQueryFor('無敵')).toBe('無敵')
    expect(lyricsQueryFor('無')).toBe('')
  })
})

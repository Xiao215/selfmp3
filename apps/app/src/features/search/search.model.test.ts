import { describe, expect, it } from 'vitest'

import {
  allResults,
  beforeTyping,
  isSearchSection,
  lyricHitsHere,
  lyricsQueryFor,
  placesOf,
  recentItems,
  sectionCounts,
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
  artistNames: {},
  artistNamesFound: [],
  spellings: {},
  tags: [
    { id: 7, name: 'yoasobi', hue: 1, songCount: 3 },
    { id: 8, name: 'yorushika', hue: 2, songCount: 1 },
    { id: 9, name: 'empty', hue: 3, songCount: 0 },
  ] as never,
}

describe('a section named in the address', () => {
  it('is one of the three, or none', () => {
    expect(isSearchSection('songs')).toBe(true)
    expect(isSearchSection('lyrics')).toBe(true)
    expect(isSearchSection('all')).toBe(false)
    expect(isSearchSection(undefined)).toBe(false)
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

  it('finds an artist, and their songs, by the names they also go by and by spelling', () => {
    const named = {
      ...library,
      songs: [...library.songs, song(5, 'ロマンスの約束', '幾田りら')],
      artistNames: { 幾田りら: ['ikura', 'Lilas Ikuta'] },
      spellings: { 幾田りら: ['iku ta ri ra'] },
    }
    const byStageName = searchLibrary('ikura', named)
    expect(byStageName.artists[0]?.name).toBe('幾田りら')
    expect(byStageName.songs.map(found => found.id)).toEqual([5])
    expect(searchLibrary('ikuta', named).artists.map(artist => artist.name)).toEqual(['幾田りら'])
  })

  it('shows an artist under two spellings as one row, found by either', () => {
    const joined = {
      ...library,
      songs: [...library.songs, song(5, 'ただ君に晴れ', 'ヨルシカ')],
      artistNames: { ヨルシカ: ['Yorushika'] },
    }
    // Only the smaller naming the bigger: two rows until somebody joins them.
    expect(searchLibrary('yorushika', joined).artists).toHaveLength(2)
    const both = { ...joined, artistNames: { yorushika: ['ヨルシカ'] } }
    for (const typed of ['ヨルシカ', 'yorushika']) {
      const found = searchLibrary(typed, both).artists
      expect(found.map(artist => [artist.name, artist.songIds.length])).toEqual([['Yorushika', 2]])
    }
  })

  it('finds nothing for nothing typed', () => {
    expect(searchLibrary('  ', library)).toEqual({ songs: [], tags: [], artists: [] })
  })

  it('counts every section, lyrics included', () => {
    const found = searchLibrary('yorushika', library)
    expect(sectionCounts(found, 2)).toEqual({ all: 5, places: 2, songs: 1, lyrics: 2 })
  })
})

describe('All', () => {
  it('puts the artist before a tag of the same name, then songs', () => {
    const { places, songs } = allResults(searchLibrary('yoasobi', library))
    expect(places.map(place => place.kind)).toEqual(['artist', 'tag'])
    expect(songs.length).toBeGreaterThan(0)
  })

  it('shows a few of each and leaves the rest to "See all"', () => {
    const many = {
      ...library,
      songs: Array.from({ length: 20 }, (_, id) => song(id, `Night ${id}`, `Night ${id}`)),
    }
    const found = searchLibrary('night', many)
    expect(allResults(found).songs).toHaveLength(5)
    expect(allResults(found).places).toHaveLength(4)
    expect(placesOf(found)).toHaveLength(20)
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

  it('orders a server stamp and an ISO one by the time they say, not as text', () => {
    // The server writes `YYYY-MM-DD HH:MM:SS`; a playlist this device just
    // started is stamped with an ISO time.
    const mixed = {
      ...library,
      songs: [song(1, 'アイドル', 'x', { lastPlayedAt: '2026-09-12 10:00:00' })],
      playlists: [{ id: 9, name: 'evening', lastPlayedAt: '2026-09-12T09:00:00.000Z' }] as never,
    }
    expect(recentItems(mixed).map(item => item.kind)).toEqual(['song', 'playlist'])
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

describe('lyricHitsHere', () => {
  const hit = (songId: number, line: string) => ({
    songId,
    title: 'Song',
    artist: 'Artist',
    hasArt: false,
    line,
    before: '',
    match: line,
    after: '',
  })

  it('renumbers each line as this device numbers its song, and leaves out songs it lacks', () => {
    const onDevice = (serverId: number) => ({ 812: 47, 813: 48 })[serverId]
    expect(lyricHitsHere([hit(813, 'b'), hit(900, 'not here'), hit(812, 'a')], onDevice)).toEqual([
      hit(48, 'b'),
      hit(47, 'a'),
    ])
  })
})

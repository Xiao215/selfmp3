import { describe, expect, it } from 'vitest'
import type { Song, Tag } from '@selfmp3/shared'
import { libraryArtists } from '@selfmp3/client'

import {
  addSheetRows,
  albumsOf,
  artistNamed,
  artistSummary,
  existingTag,
  placeSongs,
  placeSummary,
  tagLine,
  tagsMostPlayed,
  togglePlace,
  untaggedCardTitle,
  untaggedSongs,
  type Place,
} from './tag.model'

const song = (id: number, extra: Partial<Song> = {}): Song =>
  ({
    id,
    title: `Song ${id}`,
    artist: 'Someone',
    album: '',
    year: null,
    trackNo: null,
    duration: 60,
    playCount: 0,
    tagIds: [],
    missing: false,
    addedAt: `2026-09-${String(10 + id).padStart(2, '0')} 00:00:00`,
    ...extra,
  }) as Song

const tag = (id: number, name: string, songCount = 1): Tag => ({ id, name, hue: 10, songCount })

describe('a place’s songs', () => {
  const songs = [
    song(1, { tagIds: [1] }),
    song(2, { tagIds: [2] }),
    song(3, { artist: 'Yorushika' }),
    song(4, { tagIds: [1], artist: 'yorushika' }),
  ]
  const yorushika = libraryArtists(songs).find(artist => artist.key === 'yorushika')!

  it('is every song a tag carries, newest first', () => {
    const places: Place[] = [{ kind: 'tag', tag: tag(1, 'chill') }]
    expect(placeSongs(places, songs).map(item => item.id)).toEqual([4, 1])
  })

  it('adds, never narrows: a second place brings its own songs in, each once', () => {
    const places: Place[] = [
      { kind: 'tag', tag: tag(1, 'chill') },
      { kind: 'artist', artist: yorushika },
    ]
    expect(placeSongs(places, songs).map(item => item.id)).toEqual([4, 3, 1])
  })

  it('is nothing with no place chosen', () => {
    expect(placeSongs([], songs)).toEqual([])
  })

  it('says how many and how long', () => {
    expect(placeSummary([song(1), song(2)])).toBe('2 songs · 2 min')
    expect(placeSummary([])).toBe('0 songs')
  })

  it('turns a place on and off, keeping the order they were chosen in', () => {
    const a: Place = { kind: 'tag', tag: tag(1, 'a') }
    const b: Place = { kind: 'artist', artist: yorushika }
    expect(togglePlace(togglePlace([], a), b)).toEqual([a, b])
    expect(togglePlace([a, b], a)).toEqual([b])
  })
})

describe('All tags', () => {
  it('lists the most played first, then the biggest, then by name', () => {
    const tags = [tag(1, 'b'), tag(2, 'a'), tag(3, 'c')]
    const songs = [
      song(1, { tagIds: [1], playCount: 3 }),
      song(2, { tagIds: [2, 3], playCount: 1 }),
      song(3, { tagIds: [3] }),
    ]
    expect(tagsMostPlayed(tags, songs).map(entry => entry.tag.name)).toEqual(['b', 'c', 'a'])
  })

  it('keeps a tag with no songs, at the end', () => {
    const standings = tagsMostPlayed([tag(1, 'empty'), tag(2, 'full')], [song(1, { tagIds: [2] })])
    expect(standings.map(entry => entry.tag.name)).toEqual(['full', 'empty'])
    expect(tagLine(standings[1]!)).toBe('0 songs')
    expect(tagLine(standings[0]!)).toBe('1 song · 1 min')
  })

  it('counts the untagged songs for the card, newest first', () => {
    const songs = [song(1), song(2, { tagIds: [1] }), song(3)]
    expect(untaggedSongs(songs).map(item => item.id)).toEqual([3, 1])
    expect(untaggedCardTitle(2)).toBe('2 songs have no tag yet')
    expect(untaggedCardTitle(1)).toBe('1 song has no tag yet')
  })
})

describe('a new tag', () => {
  it('finds the tag a name already is, whatever the case', () => {
    expect(existingTag([tag(1, 'Chill')], ' chill ')?.id).toBe(1)
    expect(existingTag([tag(1, 'Chill')], 'calm')).toBeNull()
  })

  it('finds the artist a new tag would shadow (P11)', () => {
    const songs = [song(1, { artist: 'Yorushika' }), song(2, { artist: 'A feat. B' })]
    expect(artistNamed(songs, 'yorushika')?.name).toBe('Yorushika')
    expect(artistNamed(songs, 'B')?.name).toBe('B')
    expect(artistNamed(songs, 'night drive')).toBeNull()
    expect(artistNamed(songs, '  ')).toBeNull()
  })
})

describe('the Add sheet', () => {
  const tags = [tag(1, 'study'), tag(2, 'chill'), tag(3, 'anime')]
  const artists = libraryArtists([song(1, { artist: 'Yorushika' }), song(2, { artist: 'Ayase' })])

  it('puts the tags used lately first, then the rest A to Z', () => {
    const rows = addSheetRows({ query: '', tags, artists, recentTagIds: [1], list: 'tags' })
    expect(
      rows.map(row =>
        row.kind === 'heading'
          ? `# ${row.title}`
          : row.place.kind === 'tag'
            ? row.place.tag.name
            : '',
      ),
    ).toEqual(['# Used lately', 'study', '# A to Z', 'anime', 'chill'])
  })

  it('has no headings with nothing used lately, or with something typed', () => {
    expect(
      addSheetRows({ query: '', tags, artists, recentTagIds: [], list: 'tags' }).every(
        row => row.kind === 'place',
      ),
    ).toBe(true)
    const typed = addSheetRows({ query: 'chi', tags, artists, recentTagIds: [1], list: 'tags' })
    expect(typed).toHaveLength(1)
  })

  it('lists artists A to Z, and filters them as it does tags', () => {
    const names = (query: string) =>
      addSheetRows({ query, tags, artists, recentTagIds: [], list: 'artists' }).map(row =>
        row.kind === 'place' && row.place.kind === 'artist' ? row.place.artist.name : '',
      )
    expect(names('')).toEqual(['Ayase', 'Yorushika'])
    expect(names('yoru')).toEqual(['Yorushika'])
  })
})

describe('an artist’s page', () => {
  it('groups songs by album, newest first, in track order, the album-less last', () => {
    const songs = [
      song(1, { album: 'Elma', year: 2019, trackNo: 2 }),
      song(2, { album: 'Elma', year: 2019, trackNo: 1 }),
      song(3, { album: 'Hitchcock', year: 2018 }),
      song(4, { album: '' }),
    ]
    const albums = albumsOf(songs)
    expect(albums.map(group => group.album)).toEqual(['Elma', 'Hitchcock', ''])
    expect(albums[0]?.songs.map(item => item.id)).toEqual([2, 1])
    expect(albums[0]?.year).toBe(2019)
    expect(artistSummary(songs)).toBe('4 songs · 2 albums')
  })
})

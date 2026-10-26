import { describe, expect, it } from 'vitest'
import type { Song } from './schemas/song.js'
import { findArtist } from './artists.js'
import {
  joinedArtists,
  joinedKeys,
  joinedNames,
  namesFound,
  sameArtistAsk,
  type ArtistJoinNames,
} from './artistJoins.js'
import { formatHlc } from './hlc.js'

const song = (id: number, artist: string): Song => ({ id, artist }) as unknown as Song

/** Yorushika 3 songs, ヨルシカ 1, a song credited to both, and YOASOBI. */
const songs = [
  song(1, 'Yorushika'),
  song(2, 'Yorushika'),
  song(3, 'Yorushika, ヨルシカ'),
  song(4, 'ヨルシカ'),
  song(5, 'YOASOBI'),
]

const names = (
  artistNames: Record<string, string[]>,
  artistNamesFound: string[] = [],
): ArtistJoinNames => ({ artistNames, artistNamesFound })

describe('joinedArtists', () => {
  it('leaves two spellings apart while nothing joins them', () => {
    expect(joinedArtists(songs, names({})).map(artist => artist.name)).toEqual([
      'Yorushika',
      'ヨルシカ',
      'YOASOBI',
    ])
  })

  it('joins the smaller artist to the bigger one whose names hold it', () => {
    const joined = joinedArtists(songs, names({ yorushika: ['ヨルシカ'] }))
    expect(joined.map(artist => artist.name)).toEqual(['Yorushika', 'YOASOBI'])
    expect(joined[0]).toMatchObject({
      key: 'yorushika',
      songIds: [1, 2, 3, 4],
      keys: ['yorushika', 'ヨルシカ'],
      joined: ['ヨルシカ'],
    })
  })

  it('finds the joined artist by either spelling', () => {
    const joined = joinedArtists(songs, names({ yorushika: ['ヨルシカ'] }))
    expect(findArtist(joined, 'ヨルシカ')?.name).toBe('Yorushika')
    expect(joinedKeys(songs, names({ yorushika: ['ヨルシカ'] }), 'ヨルシカ')).toEqual([
      'yorushika',
      'ヨルシカ',
    ])
  })

  it('does not join when only the smaller artist names the bigger one', () => {
    expect(joinedArtists(songs, names({ ヨルシカ: ['Yorushika'] }))).toHaveLength(3)
  })

  it('does not join on names MusicBrainz found until somebody saves them', () => {
    expect(joinedArtists(songs, names({ yorushika: ['ヨルシカ'] }, ['yorushika']))).toHaveLength(3)
  })

  it('maps each joined key to the name shown, for counting plays', () => {
    expect([...joinedNames(songs, names({ yorushika: ['ヨルシカ'] }))]).toEqual([
      ['ヨルシカ', 'Yorushika'],
    ])
  })

  it('joins a chain under the biggest', () => {
    const chain = [...songs, song(6, 'yorushika (official)')]
    const joined = joinedArtists(
      chain,
      names({ ヨルシカ: ['yorushika (official)'], yorushika: ['ヨルシカ'] }),
    )
    expect(joined[0]?.keys).toEqual(['yorushika', 'ヨルシカ', 'yorushika (official)'])
  })
})

describe('sameArtistAsk', () => {
  const smaller = (joins: ArtistJoinNames) => findArtist(joinedArtists(songs, joins), 'ヨルシカ')!

  it('asks on the smaller page when its names hold the bigger artist', () => {
    const joins = names({ ヨルシカ: ['Yorushika', 'yoru'] })
    const ask = sameArtistAsk(songs, joins, smaller(joins))
    expect(ask?.other.name).toBe('Yorushika')
    expect(ask?.join).toEqual({ artist: 'Yorushika', names: ['ヨルシカ'] })
    expect(ask?.apart).toEqual([{ artist: 'ヨルシカ', names: ['yoru'] }])
  })

  it('asks when MusicBrainz found the smaller name among the bigger artist’s', () => {
    const joins = names({ yorushika: ['ヨルシカ', 'ヨル'] }, ['yorushika'])
    const ask = sameArtistAsk(songs, joins, smaller(joins))
    expect(ask?.join).toEqual({ artist: 'Yorushika', names: ['ヨルシカ', 'ヨル'] })
    expect(ask?.apart).toEqual([{ artist: 'Yorushika', names: ['ヨル'] }])
  })

  it('does not ask once they are joined, nor on the bigger page, nor with no link', () => {
    const joined = names({ yorushika: ['ヨルシカ'] })
    expect(
      sameArtistAsk(songs, joined, findArtist(joinedArtists(songs, joined), 'Yorushika')!),
    ).toBeNull()
    const linked = names({ ヨルシカ: ['Yorushika'] })
    expect(
      sameArtistAsk(songs, linked, findArtist(joinedArtists(songs, linked), 'Yorushika')!),
    ).toBeNull()
    expect(sameArtistAsk(songs, names({}), smaller(names({})))).toBeNull()
  })

  it('stops asking after "Not the same" takes the link out', () => {
    const joins = names({ ヨルシカ: ['Yorushika'] })
    const ask = sameArtistAsk(songs, joins, smaller(joins))!
    const after = names(Object.fromEntries(ask.apart.map(list => [list.artist, list.names])))
    expect(sameArtistAsk(songs, after, smaller(after))).toBeNull()
  })
})

describe('namesFound', () => {
  it('reads the earliest stamp as MusicBrainz’s, and any other as somebody’s', () => {
    expect(namesFound(formatHlc({ ms: 0, counter: 0, device: 'server-1' }))).toBe(true)
    expect(namesFound(formatHlc({ ms: 5_000, counter: 0, device: 'web-1' }))).toBe(false)
    expect(namesFound(undefined)).toBe(false)
  })
})

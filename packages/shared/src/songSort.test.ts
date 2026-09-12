import { describe, expect, it } from 'vitest'
import type { Song } from './schemas/song.js'
import { sortSongs } from './songSort.js'

/**
 * One order for both clients.
 *
 * These are the four places the phone's copy and the web app's had drifted, so
 * the same library read differently depending on which device was in your hand.
 */

function song(id: number, overrides: Partial<Song> = {}): Song {
  return {
    id,
    uid: `song-${id}`,
    path: `${id}.m4a`,
    title: `Song ${id}`,
    artist: '',
    album: '',
    albumArtist: '',
    trackNo: null,
    year: null,
    duration: 100,
    sizeBytes: 0,
    mime: 'audio/mp4',
    hasArt: false,
    lyricsKind: 'none',
    playCount: 0,
    skipCount: 0,
    lastPlayedAt: null,
    addedAt: '2026-01-01 00:00:00',
    missing: false,
    loved: false,
    instrumental: false,
    rating: 0,
    tagIds: [],
    features: null,
    sourceUrl: null,
    ...overrides,
  } as unknown as Song
}

const titles = (songs: readonly Song[]): string[] => songs.map(s => s.title)

describe('sortSongs', () => {
  it('breaks an artist tie by title, not by album', () => {
    const sorted = sortSongs(
      [
        song(1, { title: 'Zebra', artist: 'Aurora', album: 'A-side' }),
        song(2, { title: 'Apple', artist: 'Aurora', album: 'Z-side' }),
      ],
      'artist',
    )
    expect(titles(sorted)).toEqual(['Apple', 'Zebra'])
  })

  it('keeps tied songs in the same order whichever way the arrow points', () => {
    // Reversing the finished list, rather than the comparison, flipped the
    // order inside every run of equal songs.
    const songs = [
      song(1, { title: 'Aa', playCount: 5 }),
      song(2, { title: 'Bb', playCount: 5 }),
      song(3, { title: 'Cc', playCount: 9 }),
    ]
    expect(titles(sortSongs(songs, 'playCount', true))).toEqual(['Cc', 'Aa', 'Bb'])
  })

  it('sorts never-played songs last whichever way the arrow points', () => {
    const songs = [
      song(1, { title: 'Never' }),
      song(2, { title: 'Older', lastPlayedAt: '2026-01-01 00:00:00' }),
      song(3, { title: 'Newer', lastPlayedAt: '2026-06-01 00:00:00' }),
    ]
    expect(titles(sortSongs(songs, 'lastPlayedAt', true))).toEqual(['Newer', 'Older', 'Never'])
    expect(titles(sortSongs(songs, 'lastPlayedAt', false))).toEqual(['Older', 'Newer', 'Never'])
  })

  it('is total, so sorting the same list twice does not move anything', () => {
    const songs = [song(3), song(1), song(2)].map(s => ({ ...s, addedAt: '2026-01-01 00:00:00' }))
    const once = sortSongs(songs, 'addedAt')
    expect(titles(sortSongs(once, 'addedAt'))).toEqual(titles(once))
  })

  it('leaves a random-ordered list alone rather than re-rolling it', () => {
    const songs = [song(1), song(2), song(3)]
    expect(titles(sortSongs(songs, 'random'))).toEqual(titles(sortSongs(songs, 'random')))
  })

  it('does not mutate what it was given', () => {
    const songs = [song(2, { title: 'Bb' }), song(1, { title: 'Aa' })]
    sortSongs(songs, 'title')
    expect(titles(songs)).toEqual(['Bb', 'Aa'])
  })
})

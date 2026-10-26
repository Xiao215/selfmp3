import { describe, expect, it } from 'vitest'
import { topArtists } from './listening.js'

describe('topArtists', () => {
  it('splits collaborations so an artist counts for every song naming them', () => {
    const top = topArtists(
      [
        { artist: 'yorushika', plays: 6, ms: 81 * 60_000 },
        { artist: 'YOASOBI', plays: 5, ms: 108 * 60_000 },
        { artist: 'Yorushika feat. suis', plays: 4, ms: 100 * 60_000 },
        { artist: '', plays: 1, ms: 3 * 60_000 },
      ],
      10,
    )
    expect(top).toEqual([
      { key: 'yorushika', plays: 10, minutes: 181 },
      { key: 'YOASOBI', plays: 5, minutes: 108 },
      { key: 'suis', plays: 4, minutes: 100 },
      { key: 'Unknown artist', plays: 1, minutes: 3 },
    ])
  })

  it('ranks after splitting, so an artist spread over many credits is not cut off', () => {
    // As written, "A & B" and "A feat. C" are each played less than D; A is played most.
    const top = topArtists(
      [
        { artist: 'D', plays: 5, ms: null },
        { artist: 'A & B', plays: 3, ms: null },
        { artist: 'A feat. C', plays: 3, ms: null },
      ],
      1,
    )
    expect(top.map(entry => entry.key)).toEqual(['A'])
  })
})

describe('topArtists with joined artists', () => {
  it('counts a joined spelling under the name shown, and a song naming both once', () => {
    const top = topArtists(
      [
        { artist: 'Yorushika', plays: 5, ms: null },
        { artist: 'ヨルシカ', plays: 2, ms: null },
        { artist: 'Yorushika, ヨルシカ', plays: 1, ms: null },
      ],
      10,
      new Map([['ヨルシカ', 'Yorushika']]),
    )
    expect(top.map(entry => [entry.key, entry.plays])).toEqual([['Yorushika', 8]])
  })
})

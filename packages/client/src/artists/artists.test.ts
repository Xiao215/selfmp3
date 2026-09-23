import { describe, expect, it } from 'vitest'
import type { Song } from '@selfmp3/shared'
import { artistKey, findArtist, libraryArtists, songArtistKeys, splitArtists } from './artists.js'

const song = (id: number, artist: string): Song => ({ id, artist }) as unknown as Song

describe('splitArtists', () => {
  it('leaves one name whole', () => {
    expect(splitArtists('Yorushika')).toEqual(['Yorushika'])
    expect(splitArtists('  Yorushika  ')).toEqual(['Yorushika'])
  })

  it('splits every separator that was agreed', () => {
    expect(splitArtists('Yu-Peng Chen, HOYO-MiX')).toEqual(['Yu-Peng Chen', 'HOYO-MiX'])
    expect(splitArtists('A & B')).toEqual(['A', 'B'])
    expect(splitArtists('A × B')).toEqual(['A', 'B'])
    expect(splitArtists('A x B')).toEqual(['A', 'B'])
    expect(splitArtists('A feat. B')).toEqual(['A', 'B'])
    expect(splitArtists('A ft. B')).toEqual(['A', 'B'])
    expect(splitArtists('A featuring B, C')).toEqual(['A', 'B', 'C'])
  })

  it('takes a guest out of brackets', () => {
    expect(splitArtists('YOASOBI (feat. Ayase)')).toEqual(['YOASOBI', 'Ayase'])
    expect(splitArtists('A [ft. B & C]')).toEqual(['A', 'B', 'C'])
  })

  it('leaves an x inside a name alone', () => {
    expect(splitArtists('Xiao')).toEqual(['Xiao'])
    expect(splitArtists('Sixx')).toEqual(['Sixx'])
    expect(splitArtists('HOYO-MiX')).toEqual(['HOYO-MiX'])
  })

  it('names nobody for an empty string, and each name once', () => {
    expect(splitArtists('')).toEqual([])
    expect(splitArtists('A & a')).toEqual(['A'])
  })
})

describe('artistKey', () => {
  it('ignores case and spacing, and nothing else', () => {
    expect(artistKey(' YOASOBI ')).toBe(artistKey('yoasobi'))
    expect(artistKey('Yoru  shika')).toBe(artistKey('yoru shika'))
    expect(artistKey('ヨルシカ')).not.toBe(artistKey('Yorushika'))
  })
})

describe('libraryArtists', () => {
  const songs = [
    song(1, 'Yorushika'),
    song(2, 'yorushika'),
    song(3, 'Yorushika'),
    song(4, 'ヨルシカ'),
    song(5, 'YOASOBI feat. Yorushika'),
  ]

  it('groups by name however it is cased, most songs first', () => {
    const artists = libraryArtists(songs)
    expect(artists[0]).toEqual({ key: 'yorushika', name: 'Yorushika', songIds: [1, 2, 3, 5] })
    expect(artists.map(artist => artist.name)).toEqual(['Yorushika', 'YOASOBI', 'ヨルシカ'])
  })

  it('keeps two spellings in two scripts apart', () => {
    expect(findArtist(songs, 'ヨルシカ')?.songIds).toEqual([4])
  })

  it('works once per library', () => {
    expect(libraryArtists(songs)).toBe(libraryArtists(songs))
  })

  it('gives a song every artist it names', () => {
    expect(songArtistKeys(song(9, 'A feat. B'))).toEqual(['a', 'b'])
  })
})

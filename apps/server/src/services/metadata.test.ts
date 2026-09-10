import { describe, expect, it } from 'vitest'
import { cleanArtist, parseFilename } from './metadata.js'

describe('parseFilename', () => {
  it('splits Artist - Title', () => {
    expect(parseFilename('Aurora Lane - Midnight Drive.m4a')).toEqual({
      artist: 'Aurora Lane',
      title: 'Midnight Drive',
    })
  })

  it('splits on the first separator only', () => {
    // "Artist - Song - Live" is a song called "Song - Live", not an artist
    // called "Artist - Song".
    expect(parseFilename('Klara Feld - Nocturne - Live.m4a')).toEqual({
      artist: 'Klara Feld',
      title: 'Nocturne - Live',
    })
  })

  it('accepts en and em dashes', () => {
    expect(parseFilename('Artist – Title.mp3').artist).toBe('Artist')
    expect(parseFilename('Artist — Title.mp3').artist).toBe('Artist')
  })

  it('leaves hyphenated names alone when there is no spaced separator', () => {
    expect(parseFilename('Jean-Luc.m4a')).toEqual({ artist: '', title: 'Jean-Luc' })
  })

  it('strips download-tool noise', () => {
    expect(parseFilename('Aurora Lane - Sunrise (Official Video).m4a')).toEqual({
      artist: 'Aurora Lane',
      title: 'Sunrise',
    })
    expect(parseFilename('Artist - Song [HD].m4a').title).toBe('Song')
    expect(parseFilename('Artist - Song (Lyrics).m4a').title).toBe('Song')
  })

  it('keeps meaningful parentheses', () => {
    expect(parseFilename('Artist - Song (Acoustic).m4a').title).toBe('Song (Acoustic)')
  })

  it('handles non-latin scripts', () => {
    expect(parseFilename('李晨曦 - 夜空.m4a')).toEqual({ artist: '李晨曦', title: '夜空' })
  })

  it('falls back to the whole basename when there is no separator', () => {
    expect(parseFilename('untitled recording.wav')).toEqual({
      artist: '',
      title: 'untitled recording',
    })
  })

  it('handles files inside subfolders', () => {
    expect(parseFilename('albums/Night/Aurora Lane - Sunrise.m4a').title).toBe('Sunrise')
  })
})

describe('cleanArtist', () => {
  it('strips the YouTube auto-channel suffix', () => {
    expect(cleanArtist('Aurora Lane - Topic')).toBe('Aurora Lane')
  })

  it('strips a VEVO suffix', () => {
    expect(cleanArtist('AuroraLaneVEVO')).toBe('AuroraLane')
  })

  it('leaves a normal name alone', () => {
    expect(cleanArtist('Klara Feld')).toBe('Klara Feld')
  })
})

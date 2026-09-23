import { describe, expect, it } from 'vitest'
import { similarSongs } from './audioFeatures.js'
import type { Song, AudioFeatures } from './index.js'

const feat = (patch: Partial<AudioFeatures> = {}): AudioFeatures => ({
  bpm: 120,
  energy: 0.5,
  loudnessLufs: -14,
  key: 'C major',
  camelot: '8B',
  danceability: 0.5,
  analyzedAt: '2026-01-01 00:00:00',
  version: 1,
  ...patch,
})

const song = (id: number, patch: Partial<Song> = {}): Song => ({
  id,
  path: `${id}.m4a`,
  title: `Song ${id}`,
  artist: '',
  album: '',
  albumArtist: '',
  trackNo: null,
  year: null,
  duration: 200,
  sizeBytes: 0,
  mime: 'audio/mp4',
  hasArt: false,
  lyricsKind: 'none',
  instrumental: false,
  playCount: 0,
  skipCount: 0,
  loved: false,
  sourceUrl: null,
  lastPlayedAt: null,
  addedAt: '2026-01-01',
  tagIds: [],
  audioFeatures: null,
  ...patch,
})

describe('similarSongs', () => {
  const seed = song(1, { artist: 'Aurora Lane', tagIds: [1], audioFeatures: feat() })
  const library = [
    seed,
    song(2, { audioFeatures: feat({ bpm: 122, camelot: '9B' }) }), // very close
    song(3, { audioFeatures: feat({ bpm: 61, camelot: '8A' }) }), // half time, relative key
    song(4, { audioFeatures: feat({ bpm: 90, camelot: '2A', energy: 0.95 }) }), // far
    song(5, { audioFeatures: null }), // not analysed
    song(7, {
      artist: 'Aurora Lane',
      audioFeatures: feat({ bpm: 90, camelot: '2A', energy: 0.95 }),
    }),
  ]

  it('never returns the seed', () => {
    const ids = similarSongs(seed, library, 10).map(s => s.id)
    expect(ids).not.toContain(1)
  })

  it('orders by distance and honours the limit', () => {
    const ids = similarSongs(seed, library, 3).map(s => s.id)
    expect(ids).toHaveLength(3)
    expect(ids[0]).toBe(2)
    expect(ids[1]).toBe(3)
  })

  it('lets the same artist pull a distant song ahead of an identical stranger', () => {
    const ids = similarSongs(seed, library, 10).map(s => s.id)
    expect(ids.indexOf(7)).toBeLessThan(ids.indexOf(4))
  })

  it('ranks an un-analysed song between close and far matches', () => {
    const ids = similarSongs(seed, library, 10).map(s => s.id)
    expect(ids.indexOf(5)).toBeGreaterThan(ids.indexOf(2))
    expect(ids.indexOf(5)).toBeLessThan(ids.indexOf(4))
  })

  it('still works when the seed has no features', () => {
    const bare = song(9, { tagIds: [42] })
    const ids = similarSongs(bare, [...library, song(10, { tagIds: [42] })], 2).map(s => s.id)
    // The only signal is the shared tag, so the tagged song comes first.
    expect(ids[0]).toBe(10)
  })
})

import { describe, expect, it } from 'vitest'
import type { AudioFeatures, Song } from '@selfmp3/shared'
import {
  nearestSongs,
  pathName,
  placeName,
  songsAlongPath,
  tagRegions,
  type PlacedSong,
} from './soundMap.js'

const feat = (bpm: number, energy: number): AudioFeatures => ({
  bpm,
  energy,
  loudnessLufs: -14,
  key: 'C major',
  camelot: '8B',
  danceability: 0.5,
  analyzedAt: '2026-01-01 00:00:00',
  version: 1,
})

const song = (id: number, fields: Partial<Song> = {}): Song =>
  ({
    id,
    title: `Song ${id}`,
    duration: 200,
    tagIds: [],
    audioFeatures: null,
    ...fields,
  }) as Song

const byId = (songs: Song[]): Map<number, Song> => new Map(songs.map(s => [s.id, s]))

describe('nearestSongs', () => {
  it('plays the songs nearest the spot, nearest first', () => {
    const places: PlacedSong[] = [
      { id: 1, x: 0.9, y: 0.9 },
      { id: 2, x: 0.5, y: 0.52 },
      { id: 3, x: 0.1, y: 0.1 },
      { id: 4, x: 0.55, y: 0.5 },
    ]
    expect(nearestSongs(places, { x: 0.5, y: 0.5 }, 3)).toEqual([2, 4, 1])
  })
})

describe('songsAlongPath', () => {
  // A row of songs across the middle, and one far off the line.
  const row: PlacedSong[] = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    x: 0.05 + index * 0.1,
    y: 0.5 + (index % 2 === 0 ? 0.01 : -0.01),
  }))
  const places = [...row, { id: 99, x: 0.5, y: 0.9 }]

  it('takes the songs near the line, in the order the line passes them', () => {
    const songs = byId(places.map(place => song(place.id)))
    const ids = songsAlongPath(places, [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], 0.05, songs)
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const back = songsAlongPath(places, [{ x: 1, y: 0.5 }, { x: 0, y: 0.5 }], 0.05, songs)
    expect(back).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('follows a bend', () => {
    const corner: PlacedSong[] = [
      { id: 1, x: 0.1, y: 0.1 },
      { id: 2, x: 0.5, y: 0.1 },
      { id: 3, x: 0.9, y: 0.1 },
      { id: 4, x: 0.9, y: 0.5 },
      { id: 5, x: 0.9, y: 0.9 },
    ]
    const ids = songsAlongPath(
      corner,
      [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
      ],
      0.05,
      byId(corner.map(place => song(place.id))),
    )
    expect(ids).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps at most so many, spread along the whole line', () => {
    const songs = byId(places.map(place => song(place.id)))
    const ids = songsAlongPath(places, [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], 0.05, songs, 4)
    expect(ids).toHaveLength(4)
    expect(ids[0]).toBeLessThanOrEqual(3)
    expect(ids[3]).toBeGreaterThanOrEqual(8)
  })

  it('smooths each few songs in auto-mix order, without losing the drift', () => {
    // Five songs from slow to fast, then five faster still, but placed so the
    // line meets them out of tempo order within each group of five.
    const tempos = [100, 140, 110, 130, 120, 180, 150, 170, 160, 190]
    const songs = byId(row.map((place, index) => song(place.id, { audioFeatures: feat(tempos[index]!, 0.5) })))
    const ids = songsAlongPath(row, [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], 0.05, songs)
    const first = ids.slice(0, 5).map(id => tempos[id - 1]!)
    const second = ids.slice(5).map(id => tempos[id - 1]!)
    // Each group stays together, the slower first...
    expect(Math.max(...first)).toBeLessThan(Math.min(...second))
    // ...and within each, every step is to the closest tempo left.
    expect(first).toEqual([100, 110, 120, 130, 140])
    expect(second).toEqual([150, 160, 170, 180, 190])
  })
})

describe('tagRegions and names', () => {
  // Two gatherings: "night" songs top left, "calm" songs bottom right.
  const night = { id: 1, name: 'night', hue: 230 }
  const calm = { id: 2, name: 'calm', hue: 20 }
  const places: PlacedSong[] = []
  const songs: Song[] = []
  for (let index = 0; index < 12; index++) {
    places.push({ id: index + 1, x: 0.2 + (index % 4) * 0.02, y: 0.2 + Math.floor(index / 4) * 0.02 })
    songs.push(song(index + 1, { tagIds: [night.id], title: `Night ${index + 1}` }))
    places.push({ id: index + 101, x: 0.8 - (index % 4) * 0.02, y: 0.8 - Math.floor(index / 4) * 0.02 })
    songs.push(song(index + 101, { tagIds: [calm.id], title: `Calm ${index + 1}` }))
  }
  const all = byId(songs)

  it('finds where each tag gathers', () => {
    const regions = tagRegions(places, all, [night, calm])
    expect(regions.map(region => region.name).sort()).toEqual(['calm', 'night'])
    const nightRegion = regions.find(region => region.name === 'night')!
    expect(nightRegion.x).toBeCloseTo(0.23, 1)
    expect(nightRegion.y).toBeCloseTo(0.22, 1)
    expect(nightRegion.hue).toBe(230)
  })

  it('names a spot by the tag around it, and a path by its two ends', () => {
    expect(placeName(places, { x: 0.21, y: 0.21 }, all, [night, calm])).toBe('night')
    expect(pathName(places, [{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.8 }], all, [night, calm])).toBe(
      'night → calm',
    )
    // No tag holds the spot: the nearest song's title.
    const untagged = byId(songs.map(s => ({ ...s, tagIds: [] })))
    expect(placeName(places, { x: 0.2, y: 0.2 }, untagged, [])).toBe('Night 1')
  })
})

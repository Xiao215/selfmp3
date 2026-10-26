import { describe, expect, it } from 'vitest'
import type { Song } from '@selfmp3/shared'
import {
  brightness,
  chainAlong,
  dustSpecks,
  lensTags,
  playTop,
  skyPoints,
  skyRegions,
  songUnder,
  starAlpha,
  starRadius,
  starTones,
} from './sky.model'

const song = (id: number, fields: Partial<Song> = {}): Song =>
  ({ id, title: `Song ${id}`, playCount: 0, tagIds: [], coverTone: null, ...fields }) as Song

describe('the night sky', () => {
  it('lights a song by its plays against the library’s most played, so one favourite does not dim the rest', () => {
    const counts = [...Array.from({ length: 99 }, () => 4), 400]
    expect(playTop(counts)).toBe(4)
    expect(brightness(0, 4)).toBe(0)
    expect(brightness(4, 4)).toBe(1)
    expect(brightness(400, 4)).toBe(1)
    expect(brightness(1, 4)).toBeGreaterThan(0.3)
    expect(playTop([])).toBe(1)
  })

  it('colours a star by its cover, lifted off the dark, and rounds the colours so few glows serve all', () => {
    const black = starTones(
      song(1, { coverTone: { palette: [{ l: 0.05, c: 0.01, h: 40 }] } as Song['coverTone'] }),
    )
    const grey = starTones(
      song(2, { coverTone: { palette: [{ l: 0.2, c: 0.02, h: 200 }] } as Song['coverTone'] }),
    )
    // Both colourless covers are the same pale star, not a hole in the sky.
    expect(black).toEqual(grey)
    const a = starTones(
      song(3, { coverTone: { palette: [{ l: 0.6, c: 0.15, h: 101 }] } as Song['coverTone'] }),
    )
    const b = starTones(
      song(4, { coverTone: { palette: [{ l: 0.62, c: 0.16, h: 98 }] } as Song['coverTone'] }),
    )
    expect(a).toEqual(b)
    // No cover: its letter tile's hue, the same every time.
    expect(starTones(song(5))).toEqual(starTones(song(5)))
  })

  it('grows stars as the map is zoomed, the played ones most, and dims the rest under a lens', () => {
    expect(starRadius(1, 1)).toBeGreaterThan(starRadius(1, 0))
    expect(starRadius(8, 0)).toBeGreaterThan(starRadius(1, 0))
    // Zoomed out past the fit, never smaller than at it.
    expect(starRadius(0.5, 0)).toBe(starRadius(1, 0))
    const [point] = skyPoints([{ id: 1, x: 0.5, y: 0.5 }], new Map([[1, song(1, { tagIds: [7] })]]))
    expect(starAlpha(point!, 7)).toBe(starAlpha(point!, null))
    expect(starAlpha(point!, 8)).toBeLessThan(starAlpha(point!, null) / 4)
  })

  it('offers a lens for each tag with songs on the map, most first, and names its region alone', () => {
    const songs = new Map([
      [1, song(1, { tagIds: [7] })],
      [2, song(2, { tagIds: [7, 8] })],
      [3, song(3, { tagIds: [8] })],
      [4, song(4, { tagIds: [8] })],
    ])
    const points = skyPoints(
      [1, 2, 3, 4].map(id => ({ id, x: id / 10, y: 0.5 })),
      songs,
    )
    const tags = [
      { id: 7, name: 'night' },
      { id: 8, name: 'calm' },
      { id: 9, name: 'empty' },
    ]
    expect(lensTags(tags, points).map(tag => [tag.name, tag.count])).toEqual([
      ['calm', 3],
      ['night', 2],
    ])
    const regions = [
      { tagId: 7, name: 'night', hue: 230, x: 0.2, y: 0.5, r: 0.1 },
      { tagId: 8, name: 'calm', hue: 120, x: 0.35, y: 0.5, r: 0.1 },
    ]
    expect(skyRegions(regions, points, null).map(region => region.count)).toEqual([2, 3])
    expect(skyRegions(regions, points, 8).map(region => region.name)).toEqual(['calm'])
  })

  it('draws a line’s songs in the order the line passes them', () => {
    const places = [
      { id: 1, x: 0.8, y: 0.5 },
      { id: 2, x: 0.2, y: 0.52 },
      { id: 3, x: 0.5, y: 0.48 },
    ]
    const path = [
      { x: 0.1, y: 0.5 },
      { x: 0.9, y: 0.5 },
    ]
    expect(chainAlong(places, path, [1, 2, 3])).toEqual([2, 3, 1])
  })

  it('finds the star under the pointer within reach, and the same dust for a size', () => {
    const points = skyPoints(
      [
        { id: 1, x: 0.1, y: 0.1 },
        { id: 2, x: 0.5, y: 0.5 },
      ],
      new Map([
        [1, song(1)],
        [2, song(2)],
      ]),
    )
    const at = (place: { x: number; y: number }) => ({ x: place.x * 100, y: place.y * 100 })
    expect(songUnder(points, at, { x: 52, y: 49 }, 5)?.id).toBe(2)
    expect(songUnder(points, at, { x: 30, y: 30 }, 5)).toBeNull()
    expect(dustSpecks({ width: 300, height: 600 }, 50)).toEqual(
      dustSpecks({ width: 300, height: 600 }, 50),
    )
    expect(dustSpecks({ width: 300, height: 600 }, 50)).toHaveLength(50)
  })
})

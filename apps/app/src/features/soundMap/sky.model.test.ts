import { describe, expect, it } from 'vitest'
import type { Song } from '@selfmp3/shared'
import {
  brightness,
  chainAlong,
  coverShare,
  deepPlaces,
  deepSince,
  deepStars,
  deepTwinkle,
  dustSpecks,
  flareReach,
  glowReach,
  lensTags,
  playTop,
  skyPoints,
  skyRegions,
  songUnder,
  ringRadius,
  starAlpha,
  starLook,
  starRadius,
  starTones,
} from './sky.model'
import { tileSide } from './soundMapView.model'

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

  it('offers a lens for each tag with songs on the map, most first, and keeps only its glow', () => {
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
    expect(skyRegions(regions, null)).toHaveLength(2)
    expect(skyRegions(regions, 8).map(region => region.name)).toEqual(['calm'])
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

  it('keeps a crowded star’s glow to the room its neighbours leave', () => {
    const crowd = skyPoints(
      Array.from({ length: 30 }, (_, id) => ({
        id,
        x: 0.5 + (id % 6) * 0.002,
        y: 0.5 + Math.floor(id / 6) * 0.002,
      })),
      new Map(Array.from({ length: 30 }, (_, id) => [id, song(id)])),
    )
    const [alone] = skyPoints(
      [
        { id: 1, x: 0.1, y: 0.1 },
        { id: 2, x: 0.9, y: 0.9 },
      ],
      new Map([
        [1, song(1)],
        [2, song(2)],
      ]),
    )
    // Inside the grid, its three nearest are all a step away.
    expect(crowd[14]!.room).toBeCloseTo(0.002, 6)
    // Alone, the whole glow; crowded, only twice its size.
    expect(glowReach(alone!, 2, 1, 500)).toBe(10)
    expect(glowReach(crowd[14]!, 2, 1, 500)).toBe(4)
  })

  it('gives a flare to the few most played, and none in a library never played', () => {
    const many = (plays: (id: number) => number) =>
      skyPoints(
        Array.from({ length: 100 }, (_, id) => ({
          id,
          x: (id % 10) / 10,
          y: Math.floor(id / 10) / 10,
        })),
        new Map(Array.from({ length: 100 }, (_, id) => [id, song(id, { playCount: plays(id) })])),
      )
    const flared = many(id => id)
      .filter(point => point.flare)
      .map(point => point.id)
    expect(flared).toEqual([97, 98, 99])
    expect(many(() => 0).some(point => point.flare)).toBe(false)
    const [star] = many(id => id)
    // Its arms reach past its glow where there is room, never across a crowd.
    expect(flareReach(star!, 2, 1, 500)).toBeLessThanOrEqual(12)
  })

  it('opens the most played stars into covers first, each over a stretch of zooming', () => {
    // Far out, every star a star.
    expect(coverShare(1, tileSide(1))).toBe(0)
    expect(coverShare(0, tileSide(1))).toBe(0)
    // Somewhere between, the favourite is open while the never played is still a star.
    const middle = 24
    expect(coverShare(1, middle)).toBe(1)
    expect(coverShare(0, middle)).toBe(0)
    // Close in, every one open.
    expect(coverShare(0, 40)).toBe(1)
    // No step: a little more zoom opens a star a little more.
    const steps = Array.from({ length: 40 }, (_, at) => coverShare(0.5, 10 + at))
    for (let at = 1; at < steps.length; at++) {
      expect(steps[at]! - steps[at - 1]!).toBeLessThan(0.2)
    }
  })

  it('crossfades a star into its cover so a place never dims halfway, and keeps its plays as brightness', () => {
    const scaleFor = (side: number) => Math.pow(side / 8, 1 / 0.6)
    for (let side = 10; side <= 45; side += 0.5) {
      const look = starLook({ bright: 0.5 }, scaleFor(side))
      expect(Math.max(look.star, look.cover)).toBeGreaterThan(0.95)
    }
    const star = starLook({ bright: 1 }, 1)
    // A star: the dot alone, round.
    expect(star).toMatchObject({ share: 0, star: 1, cover: 0 })
    expect(star.corner).toBe(star.side / 2)
    const open = starLook({ bright: 1 }, scaleFor(40))
    expect(open.side).toBeCloseTo(40, 5)
    expect(open.corner).toBeCloseTo(40 * 0.16, 5)
    expect(open.veil).toBe(0)
    expect(starLook({ bright: 0 }, scaleFor(48)).veil).toBeGreaterThan(0.3)
    // A ring is round the star, then round the cover.
    expect(ringRadius({ bright: 1 }, 1, 5.5)).toBe(5.5)
    expect(ringRadius({ bright: 1 }, scaleFor(40), 5.5)).toBeCloseTo(28, 5)
  })

  it('lays a deep sky behind that follows the map only a little, the same stars every time', () => {
    const [far, near] = deepStars()
    expect(deepStars()[0]).toEqual(far)
    const field = { width: 400, height: 800 }
    const view = { scale: 1, x: 0, y: 0 }
    const moved = { scale: 1, x: 100, y: 0 }
    const before = new Map(deepPlaces(near!, 0.3, view, field).map(p => [p.star, p.x]))
    const shifts = deepPlaces(near!, 0.3, moved, field)
      .filter(p => before.has(p.star))
      .map(p => p.x - before.get(p.star)!)
      .filter(shift => Math.abs(shift) < 100)
    // The map moved 100 points; its deep sky, a part of that, the same way.
    expect(shifts.length).toBeGreaterThan(10)
    for (const shift of shifts) expect(shift).toBeCloseTo(18, 5)
    // While a finger moves it, the drawn layer goes where it would be drawn.
    expect(deepSince(moved, view, 0.3)).toEqual({ x: 18, y: 0, scale: 1 })
    // Every star stays on the field, and twinkles between dim and its own brightness.
    for (const p of deepPlaces(far!, 0.12, view, field)) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(400)
      expect(deepTwinkle(p.star, 0) + deepTwinkle(p.star, 1)).toBeCloseTo(p.star.opacity * 1.45, 5)
    }
  })
})

import { hueFromString, type MapPlace, type Song } from '@selfmp3/shared'
import { oklchToHex, type PlacedSong, type TagRegion } from '@selfmp3/client'
import type { FieldSize, MapView } from './soundMapView.model'

/**
 * The sound map drawn as a night sky (C2, docs/features/sound-map.md): each
 * song a star in its cover's colour, brighter the more it has been played;
 * each tag a faint nebula where its songs gather. Pure, so the phone's SVG
 * (`SkyLayer.tsx`) and the browser's canvas (`SkyLayer.web.tsx`) draw the
 * same sky from the same numbers.
 */

/** A placed song as the sky draws it: where, in what colour, how bright. */
export interface SkyPoint extends PlacedSong {
  /** The glow's colour, rounded so a few gradients serve every star (`glowKey`). */
  readonly glow: string
  /** The star's bright middle: the glow's colour, paler. */
  readonly core: string
  /** 0–1: how much the song has been played, against the library's most played. */
  readonly bright: number
  readonly tagIds: readonly number[]
}

/** A tag's region, with how many of its songs are on the map. */
export interface SkyRegion extends TagRegion {
  readonly count: number
}

/** What a stroke took: the songs along a line or inside a loop, and what to call them. */
export interface MapTake {
  readonly kind: 'line' | 'loop'
  readonly name: string
  readonly ids: readonly number[]
  /** A line's songs in the order the line passes them, which is how its constellation is drawn. */
  readonly chain: readonly number[]
  /** The stroke as drawn, 0–1: a loop's outline is drawn back over the map. */
  readonly path: readonly MapPlace[]
}

/** What the sky is drawn from, the same for the phone's layer and the browser's. */
export interface SkyLayerProps {
  readonly field: FieldSize
  /** Where the map is this frame. */
  readonly view: MapView
  /** Where it last held still: what the phone draws its stars for, moving them as a whole between. */
  readonly settled: MapView
  readonly base: number
  readonly points: readonly SkyPoint[]
  readonly regions: readonly SkyRegion[]
  readonly lens: number | null
  /** What the tray holds: lines drawn as constellations, loops as their outlines. */
  readonly takes: readonly MapTake[]
  /** The stroke being drawn now. */
  readonly stroke: readonly MapPlace[]
  readonly playing: number | null
  /** Where the map was just pressed, for a moment. */
  readonly pulse: { x: number; y: number } | null
  readonly songs: ReadonlyMap<number, Song>
}

/** A glow is this many times as wide as the star's middle. */
export const GLOW = 4.5

/**
 * A glow's falloff, from the middle out, as offset and opacity: a solid pale
 * middle, then the colour fading to nothing. The middle is the star.
 */
export const GLOW_STOPS: readonly (readonly [offset: number, opacity: number, middle: boolean])[] =
  [
    [0, 1, true],
    [0.15, 1, true],
    [0.22, 0.8, false],
    [0.4, 0.28, false],
    [1, 0, false],
  ]

/** The ground, from its middle out: the same in either theme, since the sky is the point. */
export const SKY_TOP = '#0e1328'
export const SKY_EDGE = '#04050b'
/** The ink on the sky: names, counts, the line a drift draws. */
export const SKY_INK = '#f4f5f9'

/**
 * The play count a star is at its brightest: the library's 95th percentile,
 * so one song played four hundred times does not leave every other one dim.
 */
export function playTop(counts: readonly number[]): number {
  if (counts.length === 0) return 1
  const sorted = [...counts].sort((a, b) => a - b)
  return Math.max(1, sorted[Math.floor((sorted.length - 1) * 0.95)]!)
}

/** How bright a song's star is, 0–1, on a log scale: the first few plays count most. */
export function brightness(plays: number, top: number): number {
  return Math.min(1, Math.log1p(Math.max(0, plays)) / Math.log1p(Math.max(1, top)))
}

const round = (value: number, step: number): number => Math.round(value / step) * step

/**
 * A star's colours: its cover's main colour, lifted so it shines on the dark
 * (a black cover is a grey-white star, not a hole), or a song without a cover
 * its letter tile's hue. Rounded to steps of hue, tone and strength, so the
 * whole sky needs a few dozen glows rather than one a song.
 */
export function starTones(song: Pick<Song, 'coverTone' | 'title'>): {
  glow: string
  core: string
} {
  const swatch = song.coverTone?.palette[0]
  const h = swatch ? swatch.h : hueFromString(song.title)
  const c = swatch ? swatch.c : 0.12
  const strength = c < 0.03 ? 0 : Math.min(0.2, round(c, 0.04))
  const hue = strength === 0 ? 0 : round(((h % 360) + 360) % 360, 20)
  const tone = Math.min(0.88, Math.max(0.66, round(swatch?.l ?? 0.72, 0.1)))
  return {
    glow: oklchToHex(tone, strength, hue),
    core: oklchToHex(Math.min(0.95, tone + 0.1), strength * 0.8, hue),
  }
}

/** Every placed song with its colours and brightness, worked out once per library. */
export function skyPoints(
  places: readonly PlacedSong[],
  songs: ReadonlyMap<number, Song>,
): SkyPoint[] {
  const top = playTop(places.map(place => songs.get(place.id)?.playCount ?? 0))
  const out: SkyPoint[] = []
  for (const place of places) {
    const song = songs.get(place.id)
    if (!song) continue
    out.push({
      ...place,
      ...starTones(song),
      bright: brightness(song.playCount, top),
      tagIds: song.tagIds,
    })
  }
  return out
}

/**
 * A star's size, in points: from 1.6 for a song never played to 3.8 for the
 * most played, growing as the map is zoomed in, more slowly than the songs
 * spread apart, so stars part as you come closer.
 */
export function starRadius(scale: number, bright: number): number {
  return (1.6 + 2.2 * bright) * Math.min(3, Math.max(1, Math.pow(scale, 0.4)))
}

/** How opaque a star is: a dim one still there, a bright one whole. A tag lens dims the rest. */
export function starAlpha(point: SkyPoint, lens: number | null): number {
  const own = 0.5 + 0.5 * point.bright
  return lens !== null && !point.tagIds.includes(lens) ? own * 0.12 : own
}

/** The regions to draw, with how many of each tag's songs are on the map, under a lens only its own. */
export function skyRegions(
  regions: readonly TagRegion[],
  points: readonly SkyPoint[],
  lens: number | null,
): SkyRegion[] {
  return regions
    .filter(region => lens === null || region.tagId === lens)
    .map(region => ({
      ...region,
      count: points.filter(point => point.tagIds.includes(region.tagId)).length,
    }))
}

/** The tags worth a lens chip: those with songs on the map, most first. */
export function lensTags<T extends { id: number }>(
  tags: readonly T[],
  points: readonly SkyPoint[],
): (T & { count: number })[] {
  const counts = new Map<number, number>()
  for (const point of points) {
    for (const id of point.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return tags
    .map(tag => ({ ...tag, count: counts.get(tag.id) ?? 0 }))
    .filter(tag => tag.count > 0)
    .sort((a, b) => b.count - a.count || a.id - b.id)
}

/**
 * Faint specks of dust on the ground, the same ones every time for a field's
 * size: about one for each 1,800 square points, at most `most`.
 */
export function dustSpecks(
  field: FieldSize,
  most: number,
): { x: number; y: number; side: number; opacity: number }[] {
  let seed = 7
  const next = (): number => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const count = Math.min(most, Math.round((field.width * field.height) / 1800))
  return Array.from({ length: count }, () => ({
    x: next() * field.width,
    y: next() * field.height,
    side: next() * 0.9 + 0.3,
    opacity: next() * 0.28,
  }))
}

/** Songs in the order a drawn line passes them: each by where its nearest point on the line is. */
export function chainAlong(
  places: readonly PlacedSong[],
  path: readonly MapPlace[],
  ids: readonly number[],
): number[] {
  const byId = new Map(places.map(place => [place.id, place]))
  const along: number[] = [0]
  for (let at = 1; at < path.length; at++) {
    along.push(
      along[at - 1]! + Math.hypot(path[at]!.x - path[at - 1]!.x, path[at]!.y - path[at - 1]!.y),
    )
  }
  const where = (id: number): number => {
    const place = byId.get(id)
    if (!place) return 0
    let best = Infinity
    let bestT = 0
    for (let at = 1; at < path.length; at++) {
      const a = path[at - 1]!
      const b = path[at]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const length2 = dx * dx + dy * dy
      const share =
        length2 === 0
          ? 0
          : Math.max(0, Math.min(1, ((place.x - a.x) * dx + (place.y - a.y) * dy) / length2))
      const d = (place.x - a.x - dx * share) ** 2 + (place.y - a.y - dy * share) ** 2
      if (d < best) {
        best = d
        bestT = along[at - 1]! + share * Math.sqrt(length2)
      }
    }
    return bestT
  }
  return [...ids].sort((a, b) => where(a) - where(b) || a - b)
}

/** The nearest song to a point of the field within `reach` points, for a pointer over the map. */
export function songUnder(
  points: readonly SkyPoint[],
  at: (place: MapPlace) => { x: number; y: number },
  pointer: { x: number; y: number },
  reach: number,
): SkyPoint | null {
  let best: SkyPoint | null = null
  let bestD = reach * reach
  for (const point of points) {
    const spot = at(point)
    const d = (spot.x - pointer.x) ** 2 + (spot.y - pointer.y) ** 2
    if (d <= bestD) {
      bestD = d
      best = point
    }
  }
  return best
}

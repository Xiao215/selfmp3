import { hueFromString, type MapPlace, type Song } from '@selfmp3/shared'
import { oklchToHex, type PlacedSong, type TagRegion } from '@selfmp3/client'
import type { FieldSize, MapView } from './soundMapView.model'

/**
 * The sound map drawn as a night sky (C2, docs/features/sound-map.md): each
 * song a star in its cover's colour, brighter the more it has been played;
 * each tag a faint unnamed glow where most of its songs gather. Pure, so the phone's SVG
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
  /**
   * How much room the star has, 0–1: the mean distance to its three nearest
   * neighbours. Its glow never reaches much past it, so a crowded place is a
   * cluster of coloured stars rather than one white blur.
   */
  readonly room: number
  /** Among the most played (`FLARE_SHARE`): drawn with a four-pointed flare, as a bright star is. */
  readonly flare: boolean
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
  readonly regions: readonly TagRegion[]
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

/** A glow reaches at most this many times a star's size, where it has the room. */
const GLOW = 5

/**
 * A glow's falloff, from the middle out, as offset and opacity: the star's
 * colour, faint, fading to nothing. The star itself is a small sharp dot over
 * it (`CORE`), so the sky reads as points of light rather than soft blobs, and
 * a glow cut short by its neighbours still has its star.
 */
export const GLOW_STOPS: readonly (readonly [offset: number, opacity: number])[] = [
  [0, 0.42],
  [0.22, 0.16],
  [1, 0],
]

/** The star's dot, as a share of its size. */
export const CORE = 0.42

/** The share of the most played songs that wear a flare, and only those played at all. */
const FLARE_SHARE = 0.03

/**
 * A flare's arms, in points, from the star's middle: about six times its
 * size, kept within twice the room its neighbours leave so a crowd is not
 * scratched over.
 */
export function flareReach(point: SkyPoint, size: number, scale: number, base: number): number {
  return Math.min(size * 6, Math.max(size * 2.5, point.room * base * scale * 2))
}

/** The ground, from its middle out: the same in either theme, since the sky is the point. */
export const SKY_TOP = '#0e1328'
export const SKY_EDGE = '#04050b'
/** The ink on the sky: covers' names, the line a drift draws. */
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
    core: oklchToHex(Math.min(0.97, tone + 0.14), strength * 0.6, hue),
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
      room: 0,
      flare: false,
    })
  }
  const rooms = roomOf(out)
  // By plays, not brightness, which every song past the 95th percentile shares.
  const plays = (id: number): number => songs.get(id)?.playCount ?? 0
  const played = out
    .filter(point => plays(point.id) > 0)
    .sort((a, b) => plays(b.id) - plays(a.id) || a.id - b.id)
  const flares = new Set(
    played.slice(0, Math.ceil(out.length * FLARE_SHARE)).map(point => point.id),
  )
  return out.map((point, index) => ({
    ...point,
    room: rooms[index]!,
    flare: flares.has(point.id),
  }))
}

/** Each point's mean distance to its three nearest, by a grid so a big library stays quick. */
function roomOf(points: readonly MapPlace[]): number[] {
  const cell = 0.02
  const grid = new Map<string, number[]>()
  const key = (x: number, y: number): string => `${Math.floor(x / cell)},${Math.floor(y / cell)}`
  points.forEach((point, index) => {
    const k = key(point.x, point.y)
    const list = grid.get(k)
    if (list) list.push(index)
    else grid.set(k, [index])
  })
  return points.map((point, index) => {
    const cx = Math.floor(point.x / cell)
    const cy = Math.floor(point.y / cell)
    // Out a ring at a time until three neighbours are found and no nearer one can be further out.
    for (let ring = 1; ring <= 50; ring++) {
      const near: number[] = []
      for (let gx = cx - ring; gx <= cx + ring; gx++) {
        for (let gy = cy - ring; gy <= cy + ring; gy++) {
          for (const other of grid.get(`${gx},${gy}`) ?? []) {
            if (other === index) continue
            const o = points[other]!
            near.push(Math.hypot(o.x - point.x, o.y - point.y))
          }
        }
      }
      near.sort((a, b) => a - b)
      if (near.length >= 3 && near[2]! <= ring * cell) return (near[0]! + near[1]! + near[2]!) / 3
      if (ring === 50 && near.length > 0) {
        const three = near.slice(0, 3)
        return three.reduce((sum, d) => sum + d, 0) / three.length
      }
    }
    return 1
  })
}

/**
 * How far a star's glow reaches, in points: five times its size where it has
 * the room, less in a crowd (most of the way to its neighbours), and never
 * less than twice its size.
 */
export function glowReach(point: SkyPoint, size: number, scale: number, base: number): number {
  return Math.max(size * 2, Math.min(size * GLOW, point.room * base * scale * 0.8))
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

/**
 * The tags' glows to draw: every one, or under a lens only its own. They are
 * drawn without names, since a tag's songs are not all where it gathers.
 */
export function skyRegions(regions: readonly TagRegion[], lens: number | null): TagRegion[] {
  return regions.filter(region => lens === null || region.tagId === lens)
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

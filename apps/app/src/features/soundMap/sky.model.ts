import { hueFromString, type MapPlace, type Song } from '@selfmp3/shared'
import { oklchToHex, type PlacedSong, type TagRegion } from '@selfmp3/client'
import { tileSide, type FieldSize, type MapView } from './soundMapView.model'

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
  /** Which stroke it is, while the tray holds it: what its section and its drop are keyed by. */
  readonly id: number
  readonly kind: 'line' | 'loop'
  /** Its colour, the same on the map and on its section in the tray (`takeTone`). */
  readonly tone: string
  readonly name: string
  readonly ids: readonly number[]
  /** A line's songs in the order the line passes them, which is how its constellation is drawn. */
  readonly chain: readonly number[]
  /** The stroke as drawn, 0–1: a loop's outline is drawn back over the map. */
  readonly path: readonly MapPlace[]
}

/**
 * The strokes' colours, told apart by lightness as well as hue, all bright
 * enough to read on the night sky: amber, teal, pink, violet, green.
 */
export const TAKE_TONES = ['#f2b65a', '#5fd3c6', '#f28fb5', '#a99cff', '#9ad66b'] as const

/** A new stroke's colour: the first one no stroke in the tray wears, or round again. */
export function takeTone(takes: readonly MapTake[]): string {
  const worn = new Set(takes.map(take => take.tone))
  return TAKE_TONES.find(tone => !worn.has(tone)) ?? TAKE_TONES[takes.length % TAKE_TONES.length]!
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
  /** The song the pointer is on in the tray's list: ringed and named on the map. */
  readonly lit: number | null
  /** How much of the field's right the tray's panel covers: a song's card keeps clear of it. */
  readonly panel: number
  /** Where the map was just pressed, for a moment. */
  readonly pulse: { x: number; y: number } | null
  readonly songs: ReadonlyMap<number, Song>
  /** A still picture, as Home's card is: no deep sky drifting or twinkling behind. */
  readonly still?: boolean
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

/**
 * Close in, stars open into their covers (T1 + T2, chosen by Xiao on
 * 2026-10-26 from <https://claude.ai/artifact/N3rnaLedMvnnCuKUQU3pSH>): not all
 * at one zoom, but each over a stretch of zooming, and the most played first,
 * so halfway in the covers of the songs played most sit among stars. A tile
 * this wide is where the most played star starts to open, and the least
 * played starts `COVER_SPREAD` later; each takes `COVER_OPENS` to open.
 */
const COVER_EARLIEST = 11
const COVER_SPREAD = 14
const COVER_OPENS = 10
/** How dark the least played song's cover is laid over, so plays still read as brightness (K1). */
const COVER_VEIL = 0.4

const smooth = (value: number): number => {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** How far a star has opened into its cover at a tile's side, 0 (a star) to 1 (its cover). */
export function coverShare(bright: number, side: number): number {
  return smooth((side - COVER_EARLIEST - (1 - bright) * COVER_SPREAD) / COVER_OPENS)
}

/** How a song is drawn at a scale: its star, its cover, or a moment between. */
export interface StarLook {
  /** 0–1, `coverShare`. */
  readonly share: number
  /** The star's size, in points: it swells a little as it opens. */
  readonly r: number
  /** The dot's and the flare's opacity, out as the cover comes in, overlapping so a place never dims halfway. */
  readonly star: number
  /** The cover's opacity. */
  readonly cover: number
  /** The cover's side, in points: from the star's dot to the whole tile. */
  readonly side: number
  /** Its corners' radius: round as the star while it opens, the tile's rounded square once open. */
  readonly corner: number
  /** Black laid over the cover, 0–`COVER_VEIL`: the less played, the dimmer. */
  readonly veil: number
}

export function starLook(point: Pick<SkyPoint, 'bright'>, scale: number): StarLook {
  const tile = tileSide(scale)
  const share = coverShare(point.bright, tile)
  const open = smooth(share)
  const r = starRadius(scale, point.bright) * (1 + 0.8 * share)
  const side = lerp(r * CORE * 2, tile, open)
  return {
    share,
    r,
    star: 1 - smooth((share - 0.35) / 0.65),
    cover: smooth(share / 0.45),
    side,
    corner: lerp(side / 2, side * 0.16, open),
    veil: COVER_VEIL * (1 - point.bright),
  }
}

/**
 * The glow behind an open cover, in points from its middle: past the cover's
 * edge where there is room, held to most of the way to its neighbours where
 * there is not, so a crowd of covers is not fogged over.
 */
export function haloReach(point: SkyPoint, side: number, scale: number, base: number): number {
  return Math.max(side * 0.55, Math.min(side * 1.2, point.room * base * scale * 0.75))
}

/**
 * A flared star's flare once it is a cover: a small glint on the cover's top
 * right corner, so the most played still shine close in.
 */
export function glint(side: number): { dx: number; dy: number; reach: number } {
  return { dx: side * 0.41, dy: -side * 0.41, reach: Math.max(8, side * 0.42) }
}

/** How far a ring round a song reaches: round its cover once it has opened, else its star. */
export function ringRadius(point: Pick<SkyPoint, 'bright'>, scale: number, least: number): number {
  return Math.max(least, starLook(point, scale).side * 0.7)
}

/**
 * The deep sky (K3): faint stars that are not songs, in two layers behind the
 * map, each moving and growing more slowly than the map does, so it has depth
 * close in when covers fill the screen. Each twinkles, slowly.
 */
export interface DeepStar {
  /** Where in its layer's tile, 0–1. */
  readonly u: number
  readonly v: number
  readonly size: number
  readonly opacity: number
  readonly tint: string
  /** Which of three twinkles it follows, so a few timers serve every star. */
  readonly beat: 0 | 1 | 2
  /** Brightest where its twinkle is lowest, so the stars of one beat do not all pulse together. */
  readonly flip: boolean
}

/** Each layer: how much of the map's movement it follows, and how many stars it holds. */
export const DEEP_LAYERS = [
  { parallax: 0.12, count: 240 },
  { parallax: 0.3, count: 140 },
] as const

/** The deep sky's stars, the same every time. */
export function deepStars(): DeepStar[][] {
  let seed = 5
  const next = (): number => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  return DEEP_LAYERS.map(({ count }, layer) =>
    Array.from({ length: count }, () => {
      const tint = next()
      return {
        u: next(),
        v: next(),
        size: (layer === 0 ? 0.5 : 0.8) + next() * (layer === 0 ? 0.7 : 1.1),
        opacity: 0.15 + next() * (layer === 0 ? 0.3 : 0.45),
        tint: tint < 0.2 ? '#ffd9b0' : tint < 0.4 ? '#b9c8ff' : '#eef1ff',
        beat: Math.floor(next() * 3) as 0 | 1 | 2,
        flip: next() < 0.5,
      }
    }),
  )
}

/**
 * Where a layer's stars are on the field for a view, with `margin` (a share
 * of the field) around it: the layer is a tile that repeats, moved by a part
 * of how far the map has moved from its middle and scaled by a root of its
 * scale, and drawn about the field's middle.
 */
export function deepPlaces(
  stars: readonly DeepStar[],
  parallax: number,
  view: MapView,
  field: FieldSize,
  margin = 0,
): { star: DeepStar; x: number; y: number; size: number }[] {
  const tile = Math.max(field.width, field.height) * 1.2
  const zoom = Math.pow(view.scale, parallax)
  const shiftX = (field.width / 2 - view.x) * parallax * 0.6
  const shiftY = (field.height / 2 - view.y) * parallax * 0.6
  const wrap = (value: number): number => (((value % tile) + tile) % tile) - tile / 2
  const grow = Math.min(2, Math.sqrt(zoom))
  const out: { star: DeepStar; x: number; y: number; size: number }[] = []
  const padX = field.width * margin
  const padY = field.height * margin
  for (const star of stars) {
    const x = field.width / 2 + wrap(star.u * tile - shiftX) * zoom
    const y = field.height / 2 + wrap(star.v * tile - shiftY) * zoom
    if (x < -padX || y < -padY || x > field.width + padX || y > field.height + padY) continue
    out.push({ star, x, y, size: star.size * grow })
  }
  return out
}

/** A deep star's opacity at a moment of its beat (0–1). */
export function deepTwinkle(star: DeepStar, beat: number): number {
  const level = star.flip ? 1 - beat : beat
  return star.opacity * (0.45 + 0.55 * level)
}

/** The three twinkles' lengths, a rise and a fall each, apart so they never line up. */
export const DEEP_BEATS_MS = [3100, 4300, 5700] as const

/** Where a twinkle is at a moment, 0–1. */
export function deepBeat(beat: 0 | 1 | 2, ms: number): number {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * ms) / DEEP_BEATS_MS[beat])
}

/**
 * How far a deep layer drawn at the `settled` view has to move and grow, about
 * the field's middle, to stand where it would be drawn for `view`: what a
 * phone does to it while a finger moves the map, until it is drawn again.
 */
export function deepSince(
  view: MapView,
  settled: MapView,
  parallax: number,
): { x: number; y: number; scale: number } {
  const zoom = Math.pow(view.scale, parallax)
  return {
    x: (view.x - settled.x) * parallax * 0.6 * zoom,
    y: (view.y - settled.y) * parallax * 0.6 * zoom,
    scale: zoom / Math.pow(settled.scale, parallax),
  }
}

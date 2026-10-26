import type { MapPlace, Song, Tag } from '@selfmp3/shared'
import { orderPath } from '../queue/autoMix.js'

/**
 * The sound map's questions (docs/features/sound-map.md): which songs are
 * near a spot, which lie along a drawn path and in what order, and where the
 * library's tags gather. Pure, over places 0–1 across and down
 * (`/api/sound-map`); the page draws and asks.
 */

/** A placed song. */
export interface PlacedSong extends MapPlace {
  readonly id: number
}

/** How many songs a press plays: about an hour and a half. */
export const NEAR_COUNT = 25
/** The most songs a drawn path lines up. */
export const PATH_MOST = 40
/** The most songs a loop takes: the ones nearest its middle, when more are inside. */
export const LOOP_MOST = 100
/** A path's songs are smoothed this many at a time, so the drift keeps its direction. */
const PATH_STRETCH = 5

const distance2 = (a: MapPlace, b: MapPlace): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2

/** The songs nearest a spot, nearest first. */
export function nearestSongs(
  places: readonly PlacedSong[],
  spot: MapPlace,
  count = NEAR_COUNT,
): number[] {
  return places
    .map(place => ({ id: place.id, d: distance2(place, spot) }))
    .sort((a, b) => a.d - b.d || a.id - b.id)
    .slice(0, count)
    .map(entry => entry.id)
}

/**
 * The songs along a drawn path, as Up next: every song within `reach` of the
 * line, taken in the order the line passes them, at most `most` of them
 * spread evenly along it, and then, a few at a time, put in auto-mix order
 * (queue/autoMix.ts) from the song before, so each step is gentle and the
 * whole still drifts from where the path starts to where it ends.
 */
export function songsAlongPath(
  places: readonly PlacedSong[],
  path: readonly MapPlace[],
  reach: number,
  byId: ReadonlyMap<number, Song>,
  most = PATH_MOST,
): number[] {
  if (path.length === 0) return []
  if (path.length === 1) return nearestSongs(places, path[0]!, Math.min(most, NEAR_COUNT))
  // How far along the line each point of it is.
  const along: number[] = [0]
  for (let at = 1; at < path.length; at++) {
    along.push(along[at - 1]! + Math.sqrt(distance2(path[at - 1]!, path[at]!)))
  }
  const reach2 = reach * reach
  const passed: { id: number; t: number; d: number }[] = []
  for (const place of places) {
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
      const d = distance2(place, { x: a.x + dx * share, y: a.y + dy * share })
      if (d < best) {
        best = d
        bestT = along[at - 1]! + share * Math.sqrt(length2)
      }
    }
    if (best <= reach2) passed.push({ id: place.id, t: bestT, d: best })
  }
  passed.sort((a, b) => a.t - b.t || a.id - b.id)

  // Too many: the closest to the line in each of `most` equal stretches of it.
  let kept = passed
  if (passed.length > most) {
    const total = along[along.length - 1]! || 1
    const stretches = Array.from({ length: most }, () => [] as typeof passed)
    for (const entry of passed) {
      stretches[Math.min(most - 1, Math.floor((entry.t / total) * most))]!.push(entry)
    }
    kept = []
    for (const stretch of stretches) {
      const closest = stretch.reduce<(typeof passed)[number] | null>(
        (best, entry) => (best === null || entry.d < best.d ? entry : best),
        null,
      )
      if (closest) kept.push(closest)
    }
    // Stretches with nobody in them leave room: fill it with the next closest.
    const chosen = new Set(kept.map(entry => entry.id))
    for (const entry of [...passed].sort((a, b) => a.d - b.d)) {
      if (kept.length >= most) break
      if (!chosen.has(entry.id)) {
        kept.push(entry)
        chosen.add(entry.id)
      }
    }
    kept.sort((a, b) => a.t - b.t || a.id - b.id)
  }

  const ordered: number[] = []
  for (let at = 0; at < kept.length; at += PATH_STRETCH) {
    const stretch = kept.slice(at, at + PATH_STRETCH).map(entry => entry.id)
    ordered.push(...orderPath(ordered[ordered.length - 1], stretch, byId))
  }
  return ordered
}

/**
 * Whether a stroke closes on itself: it ends within `closeWithin` of where it
 * began, having gone well round (four times that), so a short scribble that
 * comes back is still a line.
 */
export function isLoop(path: readonly MapPlace[], closeWithin: number): boolean {
  if (path.length < 4) return false
  let length = 0
  for (let at = 1; at < path.length; at++) length += Math.sqrt(distance2(path[at - 1]!, path[at]!))
  return length > closeWithin * 4 && distance2(path[0]!, path[path.length - 1]!) <= closeWithin ** 2
}

/** Inside a closed shape, by the even–odd rule (its last point joins its first). */
function inside(loop: readonly MapPlace[], place: MapPlace): boolean {
  let within = false
  for (let at = 0, before = loop.length - 1; at < loop.length; before = at++) {
    const a = loop[at]!
    const b = loop[before]!
    if (
      a.y > place.y !== b.y > place.y &&
      place.x < ((b.x - a.x) * (place.y - a.y)) / (b.y - a.y) + a.x
    ) {
      within = !within
    }
  }
  return within
}

const middleOf = (points: readonly MapPlace[]): MapPlace => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
})

/**
 * The songs inside a loop, as Up next: at most `most` of them, the ones
 * nearest its middle when more are inside, in auto-mix order
 * (queue/autoMix.ts) from the one nearest the middle, so each step is gentle.
 */
export function songsInside(
  places: readonly PlacedSong[],
  loop: readonly MapPlace[],
  byId: ReadonlyMap<number, Song>,
  most = LOOP_MOST,
): number[] {
  if (loop.length < 3) return []
  const middle = middleOf(loop)
  const kept = places
    .filter(place => inside(loop, place))
    .map(place => ({ id: place.id, d: distance2(place, middle) }))
    .sort((a, b) => a.d - b.d || a.id - b.id)
    .slice(0, most)
    .map(entry => entry.id)
  return orderPath(undefined, kept, byId)
}

/**
 * A loop's name: the tag most of the songs inside share, when at least half
 * of them do ("jpop"), or else the title of the song nearest its middle.
 */
export function loopName(
  places: readonly PlacedSong[],
  ids: readonly number[],
  songs: ReadonlyMap<number, Pick<Song, 'title' | 'tagIds'>>,
  tags: readonly Pick<Tag, 'id' | 'name'>[],
): string {
  if (ids.length === 0) return ''
  const counts = new Map<number, number>()
  for (const id of ids) {
    for (const tagId of songs.get(id)?.tagIds ?? []) counts.set(tagId, (counts.get(tagId) ?? 0) + 1)
  }
  let best: [number, number] | null = null
  for (const entry of counts) {
    if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0] < best[0])) best = entry
  }
  const tag = best && best[1] >= ids.length / 2 ? tags.find(t => t.id === best[0]) : undefined
  if (tag) return tag.name
  const taken = new Set(ids)
  const own = places.filter(place => taken.has(place.id))
  const nearest = own.length > 0 ? nearestSongs(own, middleOf(own), 1)[0] : ids[0]
  return songs.get(nearest ?? -1)?.title ?? ''
}

/** Where a tag's songs gather on the map: a soft circle, and the tag. */
export interface TagRegion {
  readonly tagId: number
  readonly name: string
  readonly hue: number
  readonly x: number
  readonly y: number
  readonly r: number
}

const GRID = 24
/** A region is drawn where at least this share of the songs around are the tag's. */
const REGION_SHARE = 0.35
const REGION_MOST = 8

/**
 * Where tags gather, one region a tag, the strongest few: for each tag, the
 * cell of a coarse grid where most of its songs are and they are a good part
 * of what is there, and around it a circle as wide as those songs spread. A
 * region too close to a stronger one is left out, so labels never pile up.
 */
export function tagRegions(
  places: readonly PlacedSong[],
  songs: ReadonlyMap<number, Pick<Song, 'tagIds'>>,
  tags: readonly Pick<Tag, 'id' | 'name' | 'hue'>[],
): TagRegion[] {
  const cellOf = (place: MapPlace): number =>
    Math.min(GRID - 1, Math.floor(place.y * GRID)) * GRID +
    Math.min(GRID - 1, Math.floor(place.x * GRID))
  const all = smooth(countCells(places.map(cellOf)))
  const found: (TagRegion & { score: number })[] = []
  for (const tag of tags) {
    const own = places.filter(place => songs.get(place.id)?.tagIds.includes(tag.id))
    if (own.length < 3) continue
    const counts = smooth(countCells(own.map(cellOf)))
    let bestCell = -1
    let bestCount = 0
    for (let cell = 0; cell < counts.length; cell++) {
      const count = counts[cell]!
      if (count > bestCount && count / (all[cell] || 1) >= REGION_SHARE) {
        bestCount = count
        bestCell = cell
      }
    }
    if (bestCell < 0) continue
    const centre = {
      x: ((bestCell % GRID) + 0.5) / GRID,
      y: (Math.floor(bestCell / GRID) + 0.5) / GRID,
    }
    const members = own.filter(place => distance2(place, centre) <= 0.12 ** 2)
    if (members.length < 3) continue
    const x = members.reduce((sum, place) => sum + place.x, 0) / members.length
    const y = members.reduce((sum, place) => sum + place.y, 0) / members.length
    const spread = Math.sqrt(
      members.reduce((sum, place) => sum + distance2(place, { x, y }), 0) / members.length,
    )
    found.push({
      tagId: tag.id,
      name: tag.name,
      hue: tag.hue,
      x,
      y,
      r: Math.min(0.2, Math.max(0.05, spread * 2)),
      score: members.length * (bestCount / (all[bestCell] || 1)),
    })
  }
  found.sort((a, b) => b.score - a.score || a.tagId - b.tagId)
  const kept: TagRegion[] = []
  for (const { score: _score, ...region } of found) {
    if (kept.length >= REGION_MOST) break
    if (kept.some(other => distance2(other, region) < 0.08 ** 2)) continue
    kept.push(region)
  }
  return kept
}

function countCells(cells: readonly number[]): Float64Array {
  const counts = new Float64Array(GRID * GRID)
  for (const cell of cells) counts[cell]! += 1
  return counts
}

/** Each cell with its eight neighbours, so a gathering split by a grid line still counts as one. */
function smooth(counts: Float64Array): Float64Array {
  const out = new Float64Array(counts.length)
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      let sum = 0
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = row + dr
          const c = col + dc
          if (r >= 0 && r < GRID && c >= 0 && c < GRID) sum += counts[r * GRID + c]!
        }
      }
      out[row * GRID + col] = sum
    }
  }
  return out
}

/**
 * What to call a spot on the map: the tag most of the songs around it share,
 * when one clearly does, or else the nearest song's title.
 */
export function placeName(
  places: readonly PlacedSong[],
  spot: MapPlace,
  songs: ReadonlyMap<number, Pick<Song, 'title' | 'tagIds'>>,
  tags: readonly Pick<Tag, 'id' | 'name'>[],
): string {
  const near = nearestSongs(places, spot, 8)
  const counts = new Map<number, number>()
  for (const id of near) {
    for (const tagId of songs.get(id)?.tagIds ?? []) counts.set(tagId, (counts.get(tagId) ?? 0) + 1)
  }
  let best: [number, number] | null = null
  for (const entry of counts) {
    if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0] < best[0])) best = entry
  }
  const tag =
    best && best[1] >= Math.max(3, near.length / 2) ? tags.find(t => t.id === best[0]) : undefined
  return tag?.name ?? songs.get(near[0] ?? -1)?.title ?? ''
}

/** A drawn path's name: where it starts → where it ends ("night → calm"). */
export function pathName(
  places: readonly PlacedSong[],
  path: readonly MapPlace[],
  songs: ReadonlyMap<number, Pick<Song, 'title' | 'tagIds'>>,
  tags: readonly Pick<Tag, 'id' | 'name'>[],
): string {
  if (path.length === 0) return ''
  const from = placeName(places, path[0]!, songs, tags)
  const to = placeName(places, path[path.length - 1]!, songs, tags)
  return from === to ? from : `${from} → ${to}`
}

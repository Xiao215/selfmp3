import type { MapPlace } from '@selfmp3/shared'

/**
 * How the sound map sits on the screen (docs/features/sound-map.md): the
 * map's 0–1 square drawn `base` points wide (the field's shorter side), then
 * scaled and moved. Pure, so zooming at a point and fitting can be tested.
 */

export interface MapView {
  readonly scale: number
  /** Where the map's top left corner is on the field, in points. */
  readonly x: number
  readonly y: number
  /**
   * A quarter turn clockwise: a map wider than it is tall, on a field taller
   * than it is wide (a phone held upright), is drawn standing up so it fills
   * the screen. Where songs are against each other is the same either way.
   */
  readonly turned?: boolean
}

export interface FieldSize {
  readonly width: number
  readonly height: number
}

const MIN_SCALE = 0.8
export const MAX_SCALE = 24
/** Room around the map at its fitted size, so tiles at the edge are not cut. */
const FIT_INSET = 16

/** The side of the map's square at scale 1. */
export function baseOf(field: FieldSize): number {
  return Math.max(1, Math.min(field.width, field.height) - FIT_INSET * 2)
}

/** Where the songs are on the map, 0–1: the part of it worth showing. */
export interface MapBounds {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export function boundsOf(places: readonly MapPlace[]): MapBounds {
  if (places.length === 0) return { x0: 0, y0: 0, x1: 1, y1: 1 }
  let x0 = 1
  let y0 = 1
  let x1 = 0
  let y1 = 0
  for (const place of places) {
    x0 = Math.min(x0, place.x)
    y0 = Math.min(y0, place.y)
    x1 = Math.max(x1, place.x)
    y1 = Math.max(y1, place.y)
  }
  return { x0, y0, x1, y1 }
}

/** A place as drawn: turned a quarter clockwise when the view is. */
function orient(place: MapPlace, turned: boolean | undefined): MapPlace {
  return turned ? { x: 1 - place.y, y: place.x } : place
}

function unorient(place: MapPlace, turned: boolean | undefined): MapPlace {
  return turned ? { x: place.y, y: 1 - place.x } : place
}

/** A map this much wider than tall, on a field as much taller than wide, is turned. */
const TURN_RATIO = 1.25

/**
 * What the page lays over the field: its head at the top, the tray or player
 * at the foot, and on a computer the tray's panel down the right.
 */
export interface FieldInsets {
  readonly top: number
  readonly bottom: number
  readonly right: number
}

const NO_INSETS: FieldInsets = { top: 0, bottom: 0, right: 0 }

/**
 * Every song in view, centred and as large as the field allows: a map wider
 * than it is tall fills a wide window rather than sitting in a square, and
 * stands up on a phone held upright. Centred in what the page leaves clear
 * (`insets`), since the field runs under its head and foot. `turned` keeps a
 * map already drawn one way that way, so flying to a tag never spins it.
 */
export function fitView(
  field: FieldSize,
  given: MapBounds = { x0: 0, y0: 0, x1: 1, y1: 1 },
  { insets = NO_INSETS, turned: keep }: { insets?: FieldInsets; turned?: boolean } = {},
): MapView {
  const base = baseOf(field)
  const clear = {
    width: Math.max(1, field.width - insets.right),
    height: Math.max(1, field.height - insets.top - insets.bottom),
  }
  const turned =
    keep ??
    (clear.height > clear.width * TURN_RATIO &&
      given.x1 - given.x0 > (given.y1 - given.y0) * TURN_RATIO)
  const bounds = turned ? { x0: 1 - given.y1, y0: given.x0, x1: 1 - given.y0, y1: given.x1 } : given
  const width = Math.max(bounds.x1 - bounds.x0, 0.05) * base
  const height = Math.max(bounds.y1 - bounds.y0, 0.05) * base
  const scale = Math.min(
    MAX_SCALE,
    Math.max(
      MIN_SCALE,
      Math.min((clear.width - FIT_INSET * 2) / width, (clear.height - FIT_INSET * 2) / height),
    ),
  )
  const cx = ((bounds.x0 + bounds.x1) / 2) * base * scale
  const cy = ((bounds.y0 + bounds.y1) / 2) * base * scale
  return { scale, x: clear.width / 2 - cx, y: insets.top + clear.height / 2 - cy, turned }
}

/** The view with `place` in the middle of what the page leaves clear, at `scale`. */
export function centredOn(
  view: MapView,
  field: FieldSize,
  place: MapPlace,
  scale: number,
  insets: FieldInsets = NO_INSETS,
): MapView {
  const base = baseOf(field)
  const next = { ...view, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)), x: 0, y: 0 }
  const at = toScreen(next, base, place)
  const middle = {
    x: (field.width - insets.right) / 2,
    y: insets.top + (field.height - insets.top - insets.bottom) / 2,
  }
  return { ...next, x: middle.x - at.x, y: middle.y - at.y }
}

/** How far inside what is left clear `keptClear` keeps a stroke's edge. */
const CLEAR_MARGIN = 24

/**
 * The view moved, at the same scale, just far enough that `places` lie in
 * what the page leaves clear: a loop drawn where the tray's panel or sheet
 * then opens slides out from under it. A stroke larger than the clear part is
 * centred in it. Null when it is clear already.
 */
export function keptClear(
  view: MapView,
  field: FieldSize,
  places: readonly MapPlace[],
  insets: FieldInsets = NO_INSETS,
): MapView | null {
  if (places.length === 0) return null
  const base = baseOf(field)
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const place of places) {
    const spot = toScreen(view, base, place)
    x0 = Math.min(x0, spot.x)
    y0 = Math.min(y0, spot.y)
    x1 = Math.max(x1, spot.x)
    y1 = Math.max(y1, spot.y)
  }
  const shift = (low: number, high: number, from: number, to: number): number => {
    if (high - low > to - from) return (from + to) / 2 - (low + high) / 2
    if (high > to) return to - high
    if (low < from) return from - low
    return 0
  }
  const dx = shift(x0, x1, CLEAR_MARGIN, field.width - insets.right - CLEAR_MARGIN)
  const dy = shift(y0, y1, insets.top + CLEAR_MARGIN, field.height - insets.bottom - CLEAR_MARGIN)
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null
  return { ...view, x: view.x + dx, y: view.y + dy }
}

/**
 * A step of the way from one view to another, `t` 0–1: the scale is eased on
 * its logarithm so a long zoom feels even, and the point under the middle of
 * the field moves in a straight line.
 */
export function between(from: MapView, to: MapView, t: number, field: FieldSize): MapView {
  const scale = Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * t)
  const base = baseOf(field)
  const middle = { x: field.width / 2, y: field.height / 2 }
  const a = toMap(from, base, middle)
  const b = toMap(to, base, middle)
  const spot = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  return centredOn({ ...to, scale }, field, spot, scale)
}

export function toScreen(view: MapView, base: number, place: MapPlace): { x: number; y: number } {
  const drawn = orient(place, view.turned)
  return { x: view.x + drawn.x * base * view.scale, y: view.y + drawn.y * base * view.scale }
}

export function toMap(view: MapView, base: number, point: { x: number; y: number }): MapPlace {
  const drawn = {
    x: (point.x - view.x) / (base * view.scale),
    y: (point.y - view.y) / (base * view.scale),
  }
  return unorient(drawn, view.turned)
}

/** Zoomed by `factor` about a point of the field, which stays under the finger or pointer. */
export function zoomAt(view: MapView, factor: number, point: { x: number; y: number }): MapView {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor))
  const ratio = scale / view.scale
  return {
    ...view,
    scale,
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
  }
}

export function panBy(view: MapView, dx: number, dy: number): MapView {
  return { ...view, x: view.x + dx, y: view.y + dy }
}

/**
 * A tile's side on screen at a scale: small when the whole library is in
 * view, growing as you zoom in, but more slowly than the songs spread apart,
 * so zooming in opens gaps between them.
 */
export function tileSide(scale: number): number {
  return Math.min(64, Math.max(7, 8 * Math.pow(scale, 0.6)))
}

/** The part of the map on screen, 0–1, with a tile's width of margin. */
export function visibleRect(
  view: MapView,
  base: number,
  field: FieldSize,
): { x0: number; y0: number; x1: number; y1: number } {
  const margin = tileSide(view.scale)
  const a = toMap(view, base, { x: -margin, y: -margin })
  const b = toMap(view, base, { x: field.width + margin, y: field.height + margin })
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  }
}

/** How far from a drawn path a song may be to be taken: about a finger's width on screen. */
export function pathReach(view: MapView, base: number): number {
  return 28 / (base * view.scale)
}

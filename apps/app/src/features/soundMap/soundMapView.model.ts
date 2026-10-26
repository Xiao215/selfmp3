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

/**
 * Every song in view, centred and as large as the field allows: a map wider
 * than it is tall fills a wide window rather than sitting in a square.
 */
export function fitView(
  field: FieldSize,
  bounds: MapBounds = { x0: 0, y0: 0, x1: 1, y1: 1 },
): MapView {
  const base = baseOf(field)
  const width = Math.max(bounds.x1 - bounds.x0, 0.05) * base
  const height = Math.max(bounds.y1 - bounds.y0, 0.05) * base
  const scale = Math.min(
    MAX_SCALE,
    Math.max(
      MIN_SCALE,
      Math.min((field.width - FIT_INSET * 2) / width, (field.height - FIT_INSET * 2) / height),
    ),
  )
  const cx = ((bounds.x0 + bounds.x1) / 2) * base * scale
  const cy = ((bounds.y0 + bounds.y1) / 2) * base * scale
  return { scale, x: field.width / 2 - cx, y: field.height / 2 - cy }
}

export function toScreen(view: MapView, base: number, place: MapPlace): { x: number; y: number } {
  return { x: view.x + place.x * base * view.scale, y: view.y + place.y * base * view.scale }
}

export function toMap(view: MapView, base: number, point: { x: number; y: number }): MapPlace {
  return {
    x: (point.x - view.x) / (base * view.scale),
    y: (point.y - view.y) / (base * view.scale),
  }
}

/** Zoomed by `factor` about a point of the field, which stays under the finger or pointer. */
export function zoomAt(view: MapView, factor: number, point: { x: number; y: number }): MapView {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor))
  const ratio = scale / view.scale
  return { scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio }
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

/** Covers are drawn on tiles at least this wide; smaller, a tile is its cover's colour. */
export const COVER_FROM = 18

/** The part of the map on screen, 0–1, with a tile's width of margin. */
export function visibleRect(
  view: MapView,
  base: number,
  field: FieldSize,
): { x0: number; y0: number; x1: number; y1: number } {
  const margin = tileSide(view.scale)
  const a = toMap(view, base, { x: -margin, y: -margin })
  const b = toMap(view, base, { x: field.width + margin, y: field.height + margin })
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y }
}

/** How far from a drawn path a song may be to be taken: about a finger's width on screen. */
export function pathReach(view: MapView, base: number): number {
  return 28 / (base * view.scale)
}

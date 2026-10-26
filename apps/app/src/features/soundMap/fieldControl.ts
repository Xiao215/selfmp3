import type { MapPlace } from '@selfmp3/shared'
import type { FieldWheel } from './fieldInput'
import {
  baseOf,
  fitView,
  panBy,
  pathReach,
  toMap,
  zoomAt,
  type FieldSize,
  type MapBounds,
  type MapView,
} from './soundMapView.model'

/** What the field is told as the map is moved, pressed and drawn on. */
interface FieldEvents {
  /** Every frame of a move or a zoom. */
  readonly show: (view: MapView) => void
  /** The map has held still: tiles are sized again and covers asked for. */
  readonly settle: (view: MapView) => void
  readonly press: (spot: MapPlace, point: { x: number; y: number }) => void
  readonly pathStart: (spot: MapPlace) => void
  readonly pathMove: (spot: MapPlace, reach: number) => void
  readonly pathEnd: () => void
}

/** How much a point of wheel zooms: a pinch's steps are small, a wheel's notch is 100 points. */
const ZOOM_PER_POINT = { pinch: 0.01, wheel: 0.002 } as const

/** A wheel that has stopped for this long has settled. */
const WHEEL_SETTLE_MS = 120

/**
 * Where the sound map is, as the gestures move it: kept here rather than in
 * React state, so a pinch reads the view the last frame left and not the one
 * the last render saw, and the gestures are built once.
 */
export class FieldControl {
  #view: MapView | null = null
  #field: FieldSize | null = null
  #pinchFrom = 1
  #panFrom: { x: number; y: number } | null = null
  #wheelTimer: ReturnType<typeof setTimeout> | null = null
  #events: FieldEvents | null = null
  #bounds: MapBounds | undefined = undefined

  listen(events: FieldEvents): () => void {
    this.#events = events
    return () => {
      if (this.#events === events) this.#events = null
      if (this.#wheelTimer) clearTimeout(this.#wheelTimer)
    }
  }

  /** The field's size, from its layout: the map is fitted to it. */
  resize(field: FieldSize): void {
    this.#field = field
    this.fit()
  }

  /** Where the songs are: what fitting shows. Fitted again only before anything has moved it. */
  setBounds(bounds: MapBounds): void {
    const untouched = this.#bounds === undefined
    this.#bounds = bounds
    if (untouched) this.fit()
  }

  fit(): void {
    if (this.#field) this.#set(fitView(this.#field, this.#bounds), true)
  }

  /** The + and − buttons: about the middle of the field. */
  zoomBy(factor: number): void {
    const view = this.#view
    const field = this.#field
    if (!view || !field) return
    this.#set(zoomAt(view, factor, { x: field.width / 2, y: field.height / 2 }), true)
  }

  wheel(wheel: FieldWheel): void {
    const view = this.#view
    if (!view) return
    const next = wheel.zoom
      ? zoomAt(view, Math.exp(-wheel.dy * ZOOM_PER_POINT[wheel.zoom]), { x: wheel.x, y: wheel.y })
      : panBy(view, -wheel.dx, -wheel.dy)
    this.#set(next, false)
    if (this.#wheelTimer) clearTimeout(this.#wheelTimer)
    this.#wheelTimer = setTimeout(() => this.#settle(), WHEEL_SETTLE_MS)
  }

  tap(x: number, y: number): void {
    const spot = this.#mapAt(x, y)
    if (spot) this.#events?.press(spot, { x, y })
  }

  drawStart(x: number, y: number): void {
    const spot = this.#mapAt(x, y)
    if (spot) this.#events?.pathStart(spot)
  }

  drawMove(x: number, y: number): void {
    const spot = this.#mapAt(x, y)
    if (spot && this.#view && this.#field) {
      this.#events?.pathMove(spot, pathReach(this.#view, baseOf(this.#field)))
    }
  }

  drawEnd(): void {
    this.#events?.pathEnd()
  }

  pinchStart(): void {
    this.#pinchFrom = 1
  }

  pinchMove(scale: number, focalX: number, focalY: number): void {
    const view = this.#view
    if (!view) return
    const factor = scale / this.#pinchFrom
    this.#pinchFrom = scale
    this.#set(zoomAt(view, factor, { x: focalX, y: focalY }), false)
  }

  panStart(translationX: number, translationY: number): void {
    this.#panFrom = { x: translationX, y: translationY }
  }

  panMove(translationX: number, translationY: number): void {
    const view = this.#view
    const from = this.#panFrom
    if (!view || !from) return
    this.#set(panBy(view, translationX - from.x, translationY - from.y), false)
    this.#panFrom = { x: translationX, y: translationY }
  }

  /** A pinch or a two-finger move let go. */
  gestureEnd(): void {
    this.#panFrom = null
    this.#settle()
  }

  #mapAt(x: number, y: number): MapPlace | null {
    if (!this.#view || !this.#field) return null
    return toMap(this.#view, baseOf(this.#field), { x, y })
  }

  #set(view: MapView, settle: boolean): void {
    this.#view = view
    this.#events?.show(view)
    if (settle) this.#events?.settle(view)
  }

  #settle(): void {
    if (this.#view) this.#events?.settle(this.#view)
  }
}

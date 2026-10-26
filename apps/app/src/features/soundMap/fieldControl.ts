import type { MapPlace } from '@selfmp3/shared'
import type { FieldWheel } from './fieldInput'
import {
  baseOf,
  between,
  boundsOf,
  centredOn,
  fitView,
  panBy,
  pathReach,
  toMap,
  zoomAt,
  type FieldInsets,
  type FieldSize,
  type MapBounds,
  type MapView,
} from './soundMapView.model'

/** What the field is told as the map is moved, pressed and drawn on. */
interface FieldEvents {
  /** Every frame of a move or a zoom. */
  readonly show: (view: MapView) => void
  /** The map has held still: stars are drawn again for it and covers asked for. */
  readonly settle: (view: MapView) => void
  /** A tap: where on the map, where on the field, and a finger's reach there (as `pathReach`). */
  readonly press: (spot: MapPlace, point: { x: number; y: number }, reach: number) => void
  /** A finger is down and still: the ring under it fills until drawing starts, or it lets go. */
  readonly hold: (point: { x: number; y: number } | null) => void
  readonly pathStart: (spot: MapPlace) => void
  readonly pathMove: (spot: MapPlace, reach: number) => void
  readonly pathEnd: () => void
}

/** How much a point of wheel zooms: a pinch's steps are small, a wheel's notch is 100 points. */
const ZOOM_PER_POINT = { pinch: 0.01, wheel: 0.002 } as const

/** A wheel that has stopped for this long has settled. */
const WHEEL_SETTLE_MS = 120

/** How long a flight to a tag, a song or the whole map takes. */
const FLY_MS = 420

/** How far in a song is shown when the map flies to it. */
const SONG_SCALE = 6

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/**
 * Where the sound map is, as the gestures move it: kept here rather than in
 * React state, so a pinch reads the view the last frame left and not the one
 * the last render saw, and the gestures are built once.
 */
export class FieldControl {
  #view: MapView | null = null
  #field: FieldSize | null = null
  #insets: FieldInsets = { top: 0, bottom: 0 }
  #pinchFrom = 1
  #panFrom: { x: number; y: number } | null = null
  #wheelTimer: ReturnType<typeof setTimeout> | null = null
  #flight: number | null = null
  #events: FieldEvents | null = null
  #bounds: MapBounds | undefined = undefined
  #drawing = false
  /** Moved by a hand (or flown somewhere): a late inset or a new song no longer refits it. */
  #touched = false
  /** A song to show as soon as the field has a size: the map opened on it. */
  #waiting: MapPlace | null = null

  listen(events: FieldEvents): () => void {
    this.#events = events
    return () => {
      if (this.#events === events) this.#events = null
      if (this.#wheelTimer) clearTimeout(this.#wheelTimer)
      this.#land()
    }
  }

  /** The field's size, from its layout: the map is fitted to it. */
  resize(field: FieldSize): void {
    this.#field = field
    this.fit(false)
    const waiting = this.#waiting
    this.#waiting = null
    if (waiting) this.flyToSong(waiting, true)
  }

  /** What the page lays over the field's head and foot, which a fit keeps clear of. */
  setInsets(insets: FieldInsets): void {
    this.#insets = insets
    if (!this.#touched) this.fit(false)
  }

  /** Where the songs are: what fitting shows. Fitted again only until a hand has moved it. */
  setBounds(bounds: MapBounds): void {
    this.#bounds = bounds
    if (!this.#touched) this.fit(false)
  }

  /** Every song in view: at once when the field is laid out, flown to from the button. */
  fit(fly = true): void {
    if (!this.#field) return
    const target = fitView(this.#field, this.#bounds, { insets: this.#insets })
    if (fly) this.#fly(target)
    else this.#set(target, true)
  }

  /** The songs given, in view, as large as they will go: a tag's, under its lens. */
  flyToPlaces(places: readonly MapPlace[]): void {
    if (!this.#field || places.length === 0) return
    this.#fly(
      fitView(this.#field, boundsOf(places), { insets: this.#insets, turned: this.#view?.turned }),
    )
  }

  /** One song in the middle, close enough that its neighbours are covers. */
  flyToSong(place: MapPlace, instant = false): void {
    const view = this.#view
    const field = this.#field
    if (!view || !field) {
      this.#waiting = place
      return
    }
    const target = centredOn(view, field, place, Math.max(view.scale, SONG_SCALE), this.#insets)
    this.#touched = true
    if (instant) this.#set(target, true)
    else this.#fly(target)
  }

  /** The + and − buttons: about the middle of the field. */
  zoomBy(factor: number): void {
    const view = this.#view
    const field = this.#field
    if (!view || !field) return
    this.#fly(zoomAt(view, factor, { x: field.width / 2, y: field.height / 2 }))
  }

  /** A double tap: in, about where it landed, as a street map does. */
  doubleTap(x: number, y: number): void {
    const view = this.#view
    if (view) this.#fly(zoomAt(view, 2, { x, y }))
  }

  wheel(wheel: FieldWheel): void {
    const view = this.#view
    if (!view) return
    this.#land()
    this.#touched = true
    const next = wheel.zoom
      ? zoomAt(view, Math.exp(-wheel.dy * ZOOM_PER_POINT[wheel.zoom]), { x: wheel.x, y: wheel.y })
      : panBy(view, -wheel.dx, -wheel.dy)
    this.#set(next, false)
    if (this.#wheelTimer) clearTimeout(this.#wheelTimer)
    this.#wheelTimer = setTimeout(() => this.#settle(), WHEEL_SETTLE_MS)
  }

  tap(x: number, y: number): void {
    const spot = this.#mapAt(x, y)
    if (spot && this.#view && this.#field) {
      this.#events?.press(spot, { x, y }, pathReach(this.#view, baseOf(this.#field)))
    }
  }

  /** A finger down that may become a hold: the ring under it starts to fill. */
  holdBegin(x: number, y: number): void {
    this.#events?.hold({ x, y })
  }

  /** It moved, lifted or was taken by another gesture: no ring. */
  holdEnd(): void {
    this.#events?.hold(null)
  }

  drawStart(x: number, y: number): void {
    const spot = this.#mapAt(x, y)
    this.#land()
    this.#events?.hold(null)
    if (!spot) return
    this.#drawing = true
    this.#events?.pathStart(spot)
  }

  drawMove(x: number, y: number): void {
    const spot = this.#mapAt(x, y)
    if (this.#drawing && spot && this.#view && this.#field) {
      this.#events?.pathMove(spot, pathReach(this.#view, baseOf(this.#field)))
    }
  }

  drawEnd(): void {
    if (!this.#drawing) return
    this.#drawing = false
    this.#events?.pathEnd()
  }

  pinchStart(): void {
    this.#land()
    this.#touched = true
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
    this.#land()
    this.#touched = true
    this.#panFrom = { x: translationX, y: translationY }
  }

  panMove(translationX: number, translationY: number): void {
    const view = this.#view
    const from = this.#panFrom
    if (!view || !from) return
    this.#set(panBy(view, translationX - from.x, translationY - from.y), false)
    this.#panFrom = { x: translationX, y: translationY }
  }

  /** A move or a pinch let go. */
  gestureEnd(): void {
    this.#panFrom = null
    this.#settle()
  }

  #mapAt(x: number, y: number): MapPlace | null {
    if (!this.#view || !this.#field) return null
    return toMap(this.#view, baseOf(this.#field), { x, y })
  }

  /**
   * Eased from where the map is to `target`, a frame at a time, settling once
   * it lands. A finger on the map stops it where it is.
   */
  #fly(target: MapView): void {
    const from = this.#view
    const field = this.#field
    this.#land()
    this.#touched = true
    if (!from || !field) {
      this.#set(target, true)
      return
    }
    const start = Date.now()
    const frame = (): void => {
      const t = Math.min(1, (Date.now() - start) / FLY_MS)
      if (t >= 1) {
        this.#flight = null
        this.#set(target, true)
        return
      }
      this.#set(between(from, target, easeInOut(t), field), false)
      this.#flight = requestAnimationFrame(frame)
    }
    this.#flight = requestAnimationFrame(frame)
  }

  /** A flight stopped where it is. */
  #land(): void {
    if (this.#flight === null) return
    cancelAnimationFrame(this.#flight)
    this.#flight = null
    this.#settle()
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

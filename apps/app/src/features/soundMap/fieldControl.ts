import type { MapPlace } from '@selfmp3/shared'
import { onUIThread } from '../../ports/uiThread'
import type { FieldWheel } from './fieldInput'
import type { FieldSpot } from './fieldKeys.model'
import {
  fieldMotion,
  flyTo,
  glideBy,
  land,
  place,
  setRoom,
  settle,
  slideToward,
  zoomFly,
  zoomNow,
  type FieldMotion,
} from './fieldMotion'
import {
  baseOf,
  boundsOf,
  centredOn,
  fitView,
  keptClear,
  pathReach,
  toMap,
  toScreen,
  type FieldInsets,
  type FieldSize,
  type MapBounds,
  type MapView,
} from './soundMapView.model'

/** What the field is told as the map is moved, pressed and drawn on. */
interface FieldEvents {
  /** The map has held still: stars are drawn again for it and covers asked for. */
  readonly settle: (view: MapView) => void
  /** A tap: where on the map, where on the field, and a finger's reach there (as `pathReach`). */
  readonly press: (spot: MapPlace, point: { x: number; y: number }, reach: number) => void
  /** A finger is down and still: the ring under it fills until drawing starts, or it lets go. */
  readonly hold: (point: { x: number; y: number } | null) => void
  readonly pathStart: (spot: MapPlace) => void
  readonly pathMove: (spot: MapPlace, reach: number) => void
  readonly pathEnd: () => void
  /** The page flew to a song (a tray row's Show, Find the song playing): newer than the keys' choice. */
  readonly toSong: () => void
}

/**
 * How much a point of scroll zooms: a pinch's steps are small; a mouse's
 * notch is 100 points, and a trackpad's two fingers send about as much.
 */
const ZOOM_PER_POINT = { pinch: 0.01, notch: 0.002, scroll: 0.002 } as const

/** A wheel that has stopped for this long has settled. */
const WHEEL_SETTLE_MS = 120

/** How far in a song is shown when the map flies to it. */
const SONG_SCALE = 6

/**
 * The sound map's field, as the page and the keys move it and as it is
 * pressed and drawn on. Where the map is lives on the UI thread
 * (`fieldMotion`), which the drag and pinch gestures move themselves; what
 * starts here (a flight, a fit, a zoom from the buttons or the keys) is run
 * there too, through `onUIThread`, so the two never come out of order.
 */
export class FieldControl {
  /** Where the map is, and what moves it, on the UI thread: the gestures and the sky use it. */
  readonly motion: FieldMotion
  #field: FieldSize | null = null
  #insets: FieldInsets = { top: 0, bottom: 0, right: 0 }
  #wheelTimer: ReturnType<typeof setTimeout> | null = null
  #events: FieldEvents | null = null
  #bounds: MapBounds | undefined = undefined
  #drawing = false
  /** Moved by a hand (or flown somewhere): a late inset or a new song no longer refits it. */
  #touched = false
  /** A song to show as soon as the field has a size: the map opened on it. */
  #waiting: MapPlace | null = null
  /** Where the map last settled: a finger lifted from a still map does not settle it again. */
  #settled: MapView | null = null

  constructor() {
    this.motion = fieldMotion({
      settled: view => this.#settle(view),
      grabbed: () => {
        this.#touched = true
        this.#events?.hold(null)
      },
    })
  }

  listen(events: FieldEvents): () => void {
    this.#events = events
    // A new listener has been told nothing yet.
    this.#settled = null
    return () => {
      if (this.#events === events) this.#events = null
      if (this.#wheelTimer) clearTimeout(this.#wheelTimer)
      onUIThread(land, this.motion)
    }
  }

  /** The field's size, from its layout: the map is fitted to it. */
  resize(field: FieldSize): void {
    this.#field = field
    this.#tellRoom()
    this.fit(false)
    const waiting = this.#waiting
    this.#waiting = null
    if (waiting) this.flyToSong(waiting, true)
  }

  /** What the page lays over the field's head, foot and right, which a fit keeps clear of. */
  setInsets(insets: FieldInsets): void {
    const before = this.#insets
    this.#insets = insets
    this.#tellRoom()
    // The tray's panel coming or going on a computer: the map glides with the
    // room it leaves, rather than jumping, and what was in the middle stays there.
    const view = this.#heading()
    const slide = view !== null && before.right !== insets.right
    if (!this.#touched) this.fit(slide)
    else if (view && slide) this.#fly({ ...view, x: view.x + (before.right - insets.right) / 2 })
  }

  /** Where the songs are: what fitting shows. Fitted again only until a hand has moved it. */
  setBounds(bounds: MapBounds): void {
    this.#bounds = bounds
    this.#tellRoom()
    if (!this.#touched) this.fit(false)
  }

  /** Every song in view: at once when the field is laid out, flown to from the button. */
  fit(fly = true): void {
    if (!this.#field) return
    const target = fitView(this.#field, this.#bounds, { insets: this.#insets })
    if (fly) this.#fly(target)
    else this.#place(target)
  }

  /** The songs given, in view, as large as they will go: a tag's, under its lens. */
  flyToPlaces(places: readonly MapPlace[]): void {
    if (!this.#field || places.length === 0) return
    this.#fly(
      fitView(this.#field, boundsOf(places), {
        insets: this.#insets,
        turned: this.#view()?.turned,
      }),
    )
  }

  /** One song in the middle, close enough that its neighbours are covers. */
  flyToSong(spot: MapPlace, instant = false): void {
    const view = this.#view()
    const field = this.#field
    if (!view || !field) {
      this.#waiting = spot
      return
    }
    const target = centredOn(view, field, spot, Math.max(view.scale, SONG_SCALE), this.#insets)
    this.#events?.toSong()
    this.#touched = true
    if (instant) this.#place(target)
    else this.#fly(target)
  }

  /**
   * What the tray holds, out from under it: when its panel or sheet opens over
   * a stroke, the map slides (at the same scale) until the stroke is clear.
   */
  keepClear(places: readonly MapPlace[]): void {
    const view = this.#heading()
    const field = this.#field
    if (!view || !field) return
    const target = keptClear(view, field, places, this.#insets)
    if (target) this.#fly(target)
  }

  /** The + and − buttons: about the middle of what the page leaves clear. */
  zoomBy(factor: number): void {
    const middle = this.middle()
    if (!middle) return
    this.#touched = true
    onUIThread(zoomFly, this.motion, factor, middle)
  }

  /**
   * + and − on the keyboard: about the song it has chosen, which stays where
   * it is, or the middle as the buttons zoom.
   */
  zoomAbout(spot: MapPlace | null, factor: number): void {
    const point = spot ? this.screenOf(spot) : null
    if (!point) {
      this.zoomBy(factor)
      return
    }
    this.#touched = true
    onUIThread(zoomFly, this.motion, factor, point)
  }

  /** Where a song is drawn on the field now, in points. */
  screenOf(spot: MapPlace): { x: number; y: number } | null {
    const view = this.#view()
    if (!view || !this.#field) return null
    return toScreen(view, baseOf(this.#field), spot)
  }

  /** Where each song is drawn on the field now: what the keyboard steps between. */
  spotsOf(places: readonly (MapPlace & { id: number })[]): FieldSpot[] {
    const view = this.#view()
    const field = this.#field
    if (!view || !field) return []
    const base = baseOf(field)
    return places.map(each => ({ id: each.id, ...toScreen(view, base, each) }))
  }

  /** The middle of what the page leaves clear of its head, tray and panel. */
  middle(): { x: number; y: number } | null {
    const field = this.#field
    if (!field) return null
    const { top, bottom, right } = this.#insets
    return { x: (field.width - right) / 2, y: top + (field.height - top - bottom) / 2 }
  }

  /** A finger's reach on the map as it is now (`pathReach`): how near a song a press or a line takes it. */
  reach(): number | null {
    const view = this.#view()
    if (!view || !this.#field) return null
    return pathReach(view, baseOf(this.#field))
  }

  /** A double tap: in, about where it landed, as a street map does. */
  doubleTap(x: number, y: number): void {
    if (!this.#field) return
    this.#touched = true
    onUIThread(zoomFly, this.motion, 2, { x, y })
  }

  wheel(wheel: FieldWheel): void {
    if (!this.#field) return
    const factor = Math.exp(-wheel.dy * ZOOM_PER_POINT[wheel.from])
    const at = { x: wheel.x, y: wheel.y }
    this.#touched = true
    if (wheel.from === 'notch') {
      onUIThread(glideBy, this.motion, factor, at)
      return
    }
    onUIThread(zoomNow, this.motion, factor, at)
    if (this.#wheelTimer) clearTimeout(this.#wheelTimer)
    this.#wheelTimer = setTimeout(() => onUIThread(settle, this.motion), WHEEL_SETTLE_MS)
  }

  /**
   * The arrow keys held, as a direction (none: let go): the map slides that
   * way, getting up to speed and slowing to a stop (`slideToward`).
   */
  keys(direction: { x: number; y: number }): void {
    if (!this.#field) return
    const length = Math.hypot(direction.x, direction.y)
    const unit =
      length === 0 ? { x: 0, y: 0 } : { x: direction.x / length, y: direction.y / length }
    if (length !== 0) this.#touched = true
    onUIThread(slideToward, this.motion, unit)
  }

  tap(x: number, y: number): void {
    const view = this.#view()
    const spot = this.#mapAt(view, x, y)
    if (spot && view && this.#field) {
      this.#events?.press(spot, { x, y }, pathReach(view, baseOf(this.#field)))
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
    const spot = this.#mapAt(this.#view(), x, y)
    onUIThread(land, this.motion)
    this.#events?.hold(null)
    if (!spot) return
    this.#drawing = true
    this.#events?.pathStart(spot)
  }

  drawMove(x: number, y: number): void {
    const view = this.#view()
    const spot = this.#mapAt(view, x, y)
    if (this.#drawing && spot && view && this.#field) {
      this.#events?.pathMove(spot, pathReach(view, baseOf(this.#field)))
    }
  }

  drawEnd(): void {
    if (!this.#drawing) return
    this.#drawing = false
    this.#events?.pathEnd()
  }

  /** Where the map is now, once the field has a size: read from the UI thread, where it moves. */
  #view(): MapView | null {
    return this.#field ? this.motion.view.value : null
  }

  /** Where the flight under way is going, or where the map is. */
  #heading(): MapView | null {
    return this.#field ? (this.motion.heading.value ?? this.motion.view.value) : null
  }

  #mapAt(view: MapView | null, x: number, y: number): MapPlace | null {
    if (!view || !this.#field) return null
    return toMap(view, baseOf(this.#field), { x, y })
  }

  #tellRoom(): void {
    onUIThread(setRoom, this.motion, {
      field: this.#field,
      bounds: this.#bounds ?? null,
      insets: this.#insets,
    })
  }

  /** Eased there from where the map is, settling once it lands (`flyTo`). */
  #fly(target: MapView): void {
    this.#touched = true
    onUIThread(flyTo, this.motion, target)
  }

  /** Put there at once, and settled. */
  #place(target: MapView): void {
    this.#settle(onUIThread(place, this.motion, target))
  }

  /**
   * The map holds still at `view`. What comes from the UI thread is a copy, so
   * it is compared by value: every tap ends a pan that never began, and each
   * settle redraws the sky.
   */
  #settle(view: MapView): void {
    const was = this.#settled
    if (
      was &&
      was.scale === view.scale &&
      was.x === view.x &&
      was.y === view.y &&
      was.turned === view.turned
    ) {
      return
    }
    this.#settled = view
    this.#events?.settle(view)
  }
}

import type { MapPlace } from '@selfmp3/shared'
import type { FieldWheel } from './fieldInput'
import {
  baseOf,
  between,
  boundsOf,
  centredOn,
  fitView,
  FLING_LEAST,
  flung,
  heldOn,
  keptClear,
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

/**
 * How much a point of scroll zooms: a pinch's steps are small; a mouse's
 * notch is 100 points, and a trackpad's two fingers send about as much.
 */
const ZOOM_PER_POINT = { pinch: 0.01, notch: 0.002, scroll: 0.002 } as const

/** A wheel that has stopped for this long has settled. */
const WHEEL_SETTLE_MS = 120

/**
 * A mouse's wheel zooms by gliding to where its notches point rather than
 * jumping a notch at a time: it closes this much of the way in each such
 * stretch of milliseconds, as a map's wheel does.
 */
const WHEEL_GLIDE_MS = 70

/** How fast the arrow keys move the map, in points a millisecond. */
const KEY_SPEED = 0.9
/** How quickly the arrow keys' move gets up to speed, and slows once they are let go. */
const KEY_EASE_MS = 90

/** A pinch let go this recently: a pan ending with it is not a flick. */
const PINCH_GRACE_MS = 250

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
  #insets: FieldInsets = { top: 0, bottom: 0, right: 0 }
  #pinchFrom = 1
  #panFrom: { x: number; y: number } | null = null
  #wheelTimer: ReturnType<typeof setTimeout> | null = null
  #flight: number | null = null
  /** Where the flight in progress is going, so a flight started on top of it begins from there. */
  #heading: MapView | null = null
  #events: FieldEvents | null = null
  #bounds: MapBounds | undefined = undefined
  #drawing = false
  /** Moved by a hand (or flown somewhere): a late inset or a new song no longer refits it. */
  #touched = false
  /** A song to show as soon as the field has a size: the map opened on it. */
  #waiting: MapPlace | null = null
  /** Where a mouse's wheel is gliding the zoom to, while it glides. */
  #glide: { scale: number; at: { x: number; y: number } } | null = null
  /** When a pinch last ended, or 0 while one is under way. */
  #pinchEnded = -Infinity
  /** The arrow keys' move, while they are held or it is slowing: which way, and how fast now. */
  #keyMove: { direction: { x: number; y: number }; speed: { x: number; y: number } } | null = null

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

  /** What the page lays over the field's head, foot and right, which a fit keeps clear of. */
  setInsets(insets: FieldInsets): void {
    const before = this.#insets
    this.#insets = insets
    // The tray's panel coming or going on a computer: the map glides with the
    // room it leaves, rather than jumping, and what was in the middle stays there.
    const view = this.#heading ?? this.#view
    const slide = view !== null && before.right !== insets.right
    if (!this.#touched) this.fit(slide)
    else if (view && slide) this.#fly({ ...view, x: view.x + (before.right - insets.right) / 2 })
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

  /**
   * What the tray holds, out from under it: when its panel or sheet opens over
   * a stroke, the map slides (at the same scale) until the stroke is clear.
   */
  keepClear(places: readonly MapPlace[]): void {
    const view = this.#heading ?? this.#view
    const field = this.#field
    if (!view || !field) return
    const target = keptClear(view, field, places, this.#insets)
    if (target) this.#fly(target)
  }

  /** The + and − buttons: about the middle of what the page leaves clear. */
  zoomBy(factor: number): void {
    const view = this.#view
    const field = this.#field
    if (!view || !field) return
    const { top, bottom, right } = this.#insets
    this.#fly(
      zoomAt(view, factor, {
        x: (field.width - right) / 2,
        y: top + (field.height - top - bottom) / 2,
      }),
    )
  }

  /** A double tap: in, about where it landed, as a street map does. */
  doubleTap(x: number, y: number): void {
    const view = this.#view
    if (view) this.#fly(zoomAt(view, 2, { x, y }))
  }

  wheel(wheel: FieldWheel): void {
    const view = this.#view
    if (!view) return
    const factor = Math.exp(-wheel.dy * ZOOM_PER_POINT[wheel.from])
    if (wheel.from === 'notch') {
      this.#glideBy(factor, { x: wheel.x, y: wheel.y })
      return
    }
    this.#land()
    this.#touched = true
    this.#set(zoomAt(view, factor, { x: wheel.x, y: wheel.y }), false)
    if (this.#wheelTimer) clearTimeout(this.#wheelTimer)
    this.#wheelTimer = setTimeout(() => this.#settle(), WHEEL_SETTLE_MS)
  }

  /**
   * A mouse's notch: the zoom glides there, about the pointer, and a notch
   * while it glides goes further from where it was heading. It settles once
   * it arrives.
   */
  #glideBy(factor: number, at: { x: number; y: number }): void {
    const view = this.#view
    if (!view) return
    const glide = this.#glide
    if (!glide) this.#land()
    this.#touched = true
    const scale = zoomAt(view, (glide ? glide.scale / view.scale : 1) * factor, at).scale
    this.#glide = { scale, at }
    if (glide) return
    let last = Date.now()
    const frame = (): void => {
      const now = Date.now()
      const heading = this.#glide
      const from = this.#view
      if (!heading || !from) return
      const left = Math.log(heading.scale / from.scale)
      if (Math.abs(left) < 0.003) {
        this.#flight = null
        this.#glide = null
        this.#set(zoomAt(from, heading.scale / from.scale, heading.at), true)
        return
      }
      const share = 1 - Math.exp(-(now - last) / WHEEL_GLIDE_MS)
      last = now
      this.#set(zoomAt(from, Math.exp(left * share), heading.at), false)
      this.#flight = requestAnimationFrame(frame)
    }
    this.#flight = requestAnimationFrame(frame)
  }

  /**
   * The arrow keys held, as a direction (none: let go): the map slides that
   * way, as a map's does, getting up to speed and slowing to a stop rather
   * than jumping a step at each key repeat. An arrow shows more of the map
   * that way, so the map itself moves the other.
   */
  keys(direction: { x: number; y: number }): void {
    const length = Math.hypot(direction.x, direction.y)
    const unit =
      length === 0 ? { x: 0, y: 0 } : { x: direction.x / length, y: direction.y / length }
    const moving = this.#keyMove
    if (moving) {
      moving.direction = unit
      return
    }
    if (length === 0 || !this.#view) return
    this.#land()
    this.#touched = true
    const move = { direction: unit, speed: { x: 0, y: 0 } }
    this.#keyMove = move
    let last = Date.now()
    const frame = (): void => {
      const view = this.#view
      if (this.#keyMove !== move || !view) return
      const now = Date.now()
      const ms = Math.min(50, now - last)
      last = now
      const share = 1 - Math.exp(-ms / KEY_EASE_MS)
      move.speed.x += (move.direction.x * KEY_SPEED - move.speed.x) * share
      move.speed.y += (move.direction.y * KEY_SPEED - move.speed.y) * share
      const still = move.direction.x === 0 && move.direction.y === 0
      if (still && Math.hypot(move.speed.x, move.speed.y) < 0.02) {
        this.#keyMove = null
        this.#flight = null
        this.#settle()
        return
      }
      this.#set(panBy(view, -move.speed.x * ms, -move.speed.y * ms), false)
      this.#flight = requestAnimationFrame(frame)
    }
    this.#flight = requestAnimationFrame(frame)
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
    this.#events?.hold(null)
    this.#land()
    this.#touched = true
    this.#pinchFrom = 1
    this.#pinchEnded = 0
  }

  pinchEnd(): void {
    this.#pinchEnded = Date.now()
    this.gestureEnd()
  }

  pinchMove(scale: number, focalX: number, focalY: number): void {
    const view = this.#view
    if (!view) return
    const factor = scale / this.#pinchFrom
    this.#pinchFrom = scale
    this.#set(zoomAt(view, factor, { x: focalX, y: focalY }), false)
  }

  panStart(translationX: number, translationY: number): void {
    this.#events?.hold(null)
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

  /**
   * A move let go at a speed, in points a second: a flick carries the map on,
   * slowing, as any map does; a pinch just ended is not a flick.
   */
  panEnd(velocityX: number, velocityY: number): void {
    this.#panFrom = null
    const velocity = { x: velocityX / 1000, y: velocityY / 1000 }
    const pinched = this.#pinchEnded === 0 || Date.now() - this.#pinchEnded < PINCH_GRACE_MS
    if (pinched || Math.hypot(velocity.x, velocity.y) < FLING_LEAST) return
    const from = this.#view
    if (!from) return
    this.#land()
    const start = Date.now()
    let was = { x: 0, y: 0 }
    const frame = (): void => {
      const now = flung(velocity, Date.now() - start)
      const view = this.#view
      if (!view) return
      const next = panBy(view, now.x - was.x, now.y - was.y)
      was = now
      // Against the edge of the songs, it stops there.
      const held = this.#held(next)
      if (now.done || held !== next) {
        this.#flight = null
        this.#set(held, true)
        return
      }
      this.#set(next, false)
      this.#flight = requestAnimationFrame(frame)
    }
    this.#flight = requestAnimationFrame(frame)
  }

  /** A move or a pinch let go: the map settles, unless a flick carries it on. */
  gestureEnd(): void {
    this.#panFrom = null
    if (this.#flight === null) this.#settle()
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
    this.#heading = target
    const start = Date.now()
    const frame = (): void => {
      const t = Math.min(1, (Date.now() - start) / FLY_MS)
      if (t >= 1) {
        this.#flight = null
        this.#heading = null
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
    this.#heading = null
    this.#glide = null
    this.#keyMove = null
    this.#settle()
  }

  /** Kept over the songs (`heldOn`), once there are songs and a field. */
  #held(view: MapView): MapView {
    return this.#field && this.#bounds
      ? heldOn(view, this.#field, this.#bounds, this.#insets)
      : view
  }

  #set(view: MapView, settle: boolean): void {
    view = this.#held(view)
    this.#view = view
    this.#events?.show(view)
    if (settle) this.#events?.settle(view)
  }

  #settle(): void {
    if (this.#view) this.#events?.settle(this.#view)
  }
}

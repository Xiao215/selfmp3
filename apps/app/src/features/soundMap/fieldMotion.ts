import { makeMutable, type SharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import {
  between,
  FLING_LEAST,
  flung,
  heldOn,
  panBy,
  zoomAt,
  type FieldInsets,
  type FieldSize,
  type MapBounds,
  type MapView,
} from './soundMapView.model'

/**
 * The sound map's view, and everything that moves it a frame at a time, on
 * the UI thread (docs/features/sound-map.md): a drag, a pinch, a flick, a
 * flight, a mouse wheel's glide and the arrow keys' slide. The sky reads the
 * same shared value, so the map follows a finger whatever the JS thread is
 * doing. Until 2026-11-12 all of it ran on the JS thread, and every stall
 * there (a recording of the sky, covers arriving) stopped the map under the
 * finger. On a browser the "UI thread" is the page's one thread; nothing
 * here knows the difference.
 *
 * Every function here is a worklet over a `FieldMotion`, run by the field's
 * gestures on the UI thread or by `FieldControl` through `onUIThread`. Each
 * is defined after the ones it calls: a worklet takes what it calls when it
 * is made, so one defined later is not there yet.
 */

interface Point {
  readonly x: number
  readonly y: number
}

/** What the map is kept over and fitted in, set by the page. */
interface FieldRoom {
  readonly field: FieldSize | null
  readonly bounds: MapBounds | null
  readonly insets: FieldInsets
}

/** What the JS thread is told from the UI thread. */
interface FieldTold {
  /** The map has held still: the sky is recorded again for it. */
  readonly settled: (view: MapView) => void
  /** A finger took the map: the hold ring goes, and fitting no longer moves it. */
  readonly grabbed: () => void
}

export interface FieldMotion {
  /** Where the map is now. */
  readonly view: SharedValue<MapView>
  readonly room: SharedValue<FieldRoom>
  /** Counted up whenever a motion begins or is stopped: a frame of an older one ends there. */
  readonly run: SharedValue<number>
  /** A flight, a flick, a glide or the keys' slide is under way. */
  readonly moving: SharedValue<boolean>
  /** Where the flight under way is going, so one begun on top of it starts from there. */
  readonly heading: SharedValue<MapView | null>
  /** Where a mouse's wheel is gliding the zoom to, while it glides. */
  readonly glide: SharedValue<{ scale: number; at: Point } | null>
  /** Which way the arrow keys are sliding the map while they are held or it slows. */
  readonly keyWay: SharedValue<Point | null>
  readonly panFrom: SharedValue<Point | null>
  readonly pinchFrom: SharedValue<number>
  /** When a pinch last ended, or 0 while one is under way. */
  readonly pinchEnded: SharedValue<number>
  readonly told: FieldTold
}

export function fieldMotion(told: FieldTold): FieldMotion {
  return {
    view: makeMutable<MapView>({ scale: 1, x: 0, y: 0 }),
    room: makeMutable<FieldRoom>({
      field: null,
      bounds: null,
      insets: { top: 0, bottom: 0, right: 0 },
    }),
    run: makeMutable(0),
    moving: makeMutable(false),
    heading: makeMutable<MapView | null>(null),
    glide: makeMutable<{ scale: number; at: Point } | null>(null),
    keyWay: makeMutable<Point | null>(null),
    panFrom: makeMutable<Point | null>(null),
    pinchFrom: makeMutable(1),
    pinchEnded: makeMutable(-Infinity),
    told,
  }
}

/** How long a flight to a tag, a song or the whole map takes. */
const FLY_MS = 420
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

function easeInOut(t: number): number {
  'worklet'
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

/** The page's room changed: the field laid out, the songs known, or what lies over the field. */
export function setRoom(motion: FieldMotion, room: FieldRoom): void {
  'worklet'
  motion.room.value = room
}

/** Kept over the songs (`heldOn`), once there are songs and a field. */
function held(motion: FieldMotion, view: MapView): MapView {
  'worklet'
  const { field, bounds, insets } = motion.room.value
  return field && bounds ? heldOn(view, field, bounds, insets) : view
}

/** The map moved to `view`, kept over the songs; `settle` tells the JS thread it holds still there. */
function show(motion: FieldMotion, view: MapView, settle: boolean): MapView {
  'worklet'
  const next = held(motion, view)
  motion.view.value = next
  if (settle) scheduleOnRN(motion.told.settled, next)
  return next
}

/** The map holds still where it is. */
export function settle(motion: FieldMotion): void {
  'worklet'
  scheduleOnRN(motion.told.settled, motion.view.value)
}

/** Whatever was moving the map stops where it is; true when something was. */
function halt(motion: FieldMotion): boolean {
  'worklet'
  const was = motion.moving.value
  motion.run.value = motion.run.value + 1
  motion.moving.value = false
  motion.heading.value = null
  motion.glide.value = null
  motion.keyWay.value = null
  return was
}

/** A flight stopped where it is, and settled there. */
export function land(motion: FieldMotion): void {
  'worklet'
  if (halt(motion)) settle(motion)
}

/** The map put at `view` at once, whatever was moving it stopped: what it ended up at. */
export function place(motion: FieldMotion, view: MapView): MapView {
  'worklet'
  halt(motion)
  return show(motion, view, false)
}

/**
 * A motion, a frame at a time, until `step` says it is done (having shown its
 * last view, settled). Anything begun after it stops it.
 */
function animate(motion: FieldMotion, step: (now: number) => boolean): void {
  'worklet'
  land(motion)
  const run = motion.run.value + 1
  motion.run.value = run
  motion.moving.value = true
  const frame = (): void => {
    if (motion.run.value !== run) return
    if (step(Date.now())) {
      motion.moving.value = false
      return
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

/**
 * Eased from where the map is to `target`, settling once it lands. A finger
 * on the map stops it where it is.
 */
export function flyTo(motion: FieldMotion, target: MapView): void {
  'worklet'
  const from = motion.view.value
  const field = motion.room.value.field
  if (!field) {
    halt(motion)
    show(motion, target, true)
    return
  }
  const start = Date.now()
  animate(motion, now => {
    const t = Math.min(1, (now - start) / FLY_MS)
    if (t >= 1) {
      motion.heading.value = null
      show(motion, target, true)
      return true
    }
    show(motion, between(from, target, easeInOut(t), field), false)
    return false
  })
  motion.heading.value = target
}

/** Flown in or out by `factor` about a point of the field, which stays where it is. */
export function zoomFly(motion: FieldMotion, factor: number, at: Point): void {
  'worklet'
  flyTo(motion, zoomAt(motion.view.value, factor, at))
}

/** A flick: the map carried on at `velocity` points a millisecond, slowing, until it stops or meets the songs' edge. */
function fling(motion: FieldMotion, velocity: Point): void {
  'worklet'
  const start = Date.now()
  let was = { x: 0, y: 0 }
  animate(motion, now => {
    const gone = flung(velocity, now - start)
    const next = panBy(motion.view.value, gone.x - was.x, gone.y - was.y)
    was = gone
    // Against the edge of the songs, it stops there.
    const kept = held(motion, next)
    if (gone.done || kept !== next) {
      show(motion, kept, true)
      return true
    }
    show(motion, next, false)
    return false
  })
}

/** A finger begins to move the map: anything moving it stops. */
export function panStart(motion: FieldMotion, x: number, y: number): void {
  'worklet'
  scheduleOnRN(motion.told.grabbed)
  land(motion)
  motion.panFrom.value = { x, y }
}

export function panMove(motion: FieldMotion, x: number, y: number): void {
  'worklet'
  const from = motion.panFrom.value
  if (!from) return
  show(motion, panBy(motion.view.value, x - from.x, y - from.y), false)
  motion.panFrom.value = { x, y }
}

/**
 * A move let go at a speed, in points a second: a flick carries the map on,
 * slowing, as any map does; a pinch just ended is not a flick.
 */
export function panEnd(motion: FieldMotion, velocityX: number, velocityY: number): void {
  'worklet'
  motion.panFrom.value = null
  const velocity = { x: velocityX / 1000, y: velocityY / 1000 }
  const ended = motion.pinchEnded.value
  const pinched = ended === 0 || Date.now() - ended < PINCH_GRACE_MS
  if (pinched || Math.hypot(velocity.x, velocity.y) < FLING_LEAST) return
  if (motion.room.value.field) fling(motion, velocity)
}

/** A move or a pinch let go: the map settles, unless a flick carries it on. */
export function gestureEnd(motion: FieldMotion): void {
  'worklet'
  motion.panFrom.value = null
  if (!motion.moving.value) settle(motion)
}

export function pinchStart(motion: FieldMotion): void {
  'worklet'
  scheduleOnRN(motion.told.grabbed)
  land(motion)
  motion.pinchFrom.value = 1
  motion.pinchEnded.value = 0
}

export function pinchMove(motion: FieldMotion, scale: number, x: number, y: number): void {
  'worklet'
  const factor = scale / motion.pinchFrom.value
  motion.pinchFrom.value = scale
  show(motion, zoomAt(motion.view.value, factor, { x, y }), false)
}

export function pinchEnd(motion: FieldMotion): void {
  'worklet'
  motion.pinchEnded.value = Date.now()
  gestureEnd(motion)
}

/** A trackpad's scroll or pinch: zoomed at once about the pointer, settled by the field once it stops. */
export function zoomNow(motion: FieldMotion, factor: number, at: Point): void {
  'worklet'
  land(motion)
  show(motion, zoomAt(motion.view.value, factor, at), false)
}

/**
 * A mouse's notch: the zoom glides there, about the pointer, and a notch
 * while it glides goes further from where it was heading. It settles once
 * it arrives.
 */
export function glideBy(motion: FieldMotion, factor: number, at: Point): void {
  'worklet'
  const view = motion.view.value
  const glide = motion.glide.value
  const scale = zoomAt(view, (glide ? glide.scale / view.scale : 1) * factor, at).scale
  if (glide) {
    motion.glide.value = { scale, at }
    return
  }
  let last = Date.now()
  animate(motion, now => {
    const heading = motion.glide.value
    const from = motion.view.value
    if (!heading) return true
    const left = Math.log(heading.scale / from.scale)
    if (Math.abs(left) < 0.003) {
      motion.glide.value = null
      show(motion, zoomAt(from, heading.scale / from.scale, heading.at), true)
      return true
    }
    const share = 1 - Math.exp(-(now - last) / WHEEL_GLIDE_MS)
    last = now
    show(motion, zoomAt(from, Math.exp(left * share), heading.at), false)
    return false
  })
  motion.glide.value = { scale, at }
}

/**
 * The arrow keys held, as a unit direction (none: let go): the map slides
 * that way, as a map's does, getting up to speed and slowing to a stop rather
 * than jumping a step at each key repeat. An arrow shows more of the map that
 * way, so the map itself moves the other.
 */
export function slideToward(motion: FieldMotion, way: Point): void {
  'worklet'
  if (motion.keyWay.value) {
    motion.keyWay.value = way
    return
  }
  if (way.x === 0 && way.y === 0) return
  let speed = { x: 0, y: 0 }
  let last = Date.now()
  animate(motion, now => {
    const direction = motion.keyWay.value
    if (!direction) return true
    const ms = Math.min(50, now - last)
    last = now
    const share = 1 - Math.exp(-ms / KEY_EASE_MS)
    speed = {
      x: speed.x + (direction.x * KEY_SPEED - speed.x) * share,
      y: speed.y + (direction.y * KEY_SPEED - speed.y) * share,
    }
    if (direction.x === 0 && direction.y === 0 && Math.hypot(speed.x, speed.y) < 0.02) {
      motion.keyWay.value = null
      settle(motion)
      return true
    }
    show(motion, panBy(motion.view.value, -speed.x * ms, -speed.y * ms), false)
    return false
  })
  motion.keyWay.value = way
}

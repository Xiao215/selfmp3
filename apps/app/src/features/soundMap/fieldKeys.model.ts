import type { MapPlace } from '@selfmp3/shared'

/** A song where it is drawn on the field, in points. */
export interface FieldSpot {
  readonly id: number
  readonly x: number
  readonly y: number
}

/** A way across the field: one of the arrow keys. */
interface FieldDirection {
  readonly x: number
  readonly y: number
}

/**
 * How far to one side a song may lie, against how far it is ahead, and still
 * be the way an arrow points: about 63° either side.
 */
const CONE = 2
/** How much a song off to one side counts against it, beside how far ahead it is. */
const ASIDE = 2

/**
 * The song an arrow steps to from `from`: the nearest one the way it points,
 * one straight ahead counting nearer than one as far off to the side. Null
 * when there is none that way.
 */
export function songToward(
  spots: readonly FieldSpot[],
  from: FieldSpot,
  direction: FieldDirection,
): number | null {
  const length = Math.hypot(direction.x, direction.y)
  if (length === 0) return null
  const ux = direction.x / length
  const uy = direction.y / length
  let best: number | null = null
  let bestScore = Infinity
  for (const spot of spots) {
    if (spot.id === from.id) continue
    const dx = spot.x - from.x
    const dy = spot.y - from.y
    const ahead = dx * ux + dy * uy
    const aside = Math.abs(dx * uy - dy * ux)
    if (ahead <= 0 || aside > ahead * CONE) continue
    const score = ahead + aside * ASIDE
    if (score < bestScore || (score === bestScore && best !== null && spot.id < best)) {
      bestScore = score
      best = spot.id
    }
  }
  return best
}

/** The song drawn nearest a point of the field: where the keyboard comes in. */
export function songNearest(
  spots: readonly FieldSpot[],
  point: { x: number; y: number },
): number | null {
  let best: number | null = null
  let bestD = Infinity
  for (const spot of spots) {
    const d = (spot.x - point.x) ** 2 + (spot.y - point.y) ** 2
    if (d < bestD || (d === bestD && best !== null && spot.id < best)) {
      bestD = d
      best = spot.id
    }
  }
  return best
}

/**
 * Every song in an order a screen reader can step through one at a time: in
 * bands from the top of the map down, across each band and back along the
 * next, as a field is ploughed, so each song is near the one before.
 */
export function readingOrder(places: readonly (MapPlace & { id: number })[]): number[] {
  if (places.length === 0) return []
  const byY = [...places].sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id)
  const rows = Math.max(1, Math.round(Math.sqrt(places.length)))
  const size = Math.ceil(byY.length / rows)
  const order: number[] = []
  for (let row = 0; row * size < byY.length; row++) {
    const band = byY.slice(row * size, (row + 1) * size).sort((a, b) => a.x - b.x || a.id - b.id)
    if (row % 2 === 1) band.reverse()
    for (const place of band) order.push(place.id)
  }
  return order
}

/**
 * What the keyboard, or a screen reader's actions, can ask of the map:
 *
 * - an arrow, to step to the next song that way;
 * - `next` and `previous`, a screen reader's swipes, through `readingOrder`;
 * - `enter` (Enter or Space), which plays the song chosen, or, armed (the pen,
 *   or Shift held), starts a line at it that the arrows then carry from song
 *   to song, and Enter ends;
 * - `play` and `draw`, a screen reader's double tap and its action for a line;
 * - `escape`, which stops a line being drawn, or lets go of the song;
 * - `in` and `out`, + and −.
 */
export type FieldKey =
  | { readonly key: 'arrow'; readonly direction: FieldDirection }
  | { readonly key: 'next' | 'previous' | 'enter' | 'play' | 'draw' | 'escape' | 'in' | 'out' }

/**
 * Where the keyboard is on the map: the song chosen, and while a line is
 * being drawn with it, the song the line has reached so far.
 */
export interface FieldKeyState {
  readonly chosen: number | null
  readonly line: number | null
}

export const NO_FIELD_KEYS: FieldKeyState = { chosen: null, line: null }

/** What a key does, for the field to carry out in order. */
export type FieldKeyEffect =
  | { readonly do: 'choose' | 'play' | 'lineFrom' | 'lineTo'; readonly id: number }
  | { readonly do: 'lineEnd' | 'lineCancel' | 'letGo' }
  | { readonly do: 'zoom'; readonly factor: number }

/** How far + and − zoom, as the buttons do. */
export const KEY_ZOOM = 1.6

/**
 * A key's answer: the state after it, what it does, and whether it was the
 * map's at all. One it leaves (an arrow with no song chosen, Escape with
 * nothing to let go of) is the page's: the arrows then move the map, and
 * Escape lets go of what the tray holds.
 */
export function answerKey(
  state: FieldKeyState,
  input: FieldKey,
  ask: {
    /** The pen is out, or Shift is held: Enter starts a line rather than playing. */
    readonly armed: boolean
    /** The song an arrow steps to from the one chosen (`songToward`). */
    readonly toward: (from: number, direction: FieldDirection) => number | null
    /** The song before or after one in `readingOrder`. */
    readonly beside: (from: number, step: 1 | -1) => number | null
    /** The song nearest the middle of what the page leaves clear. */
    readonly middle: () => number | null
  },
): { state: FieldKeyState; effects: FieldKeyEffect[]; handled: boolean } {
  const { chosen, line } = state
  const unchanged = { state, effects: [], handled: true }
  const choose = (id: number, extend: boolean) => ({
    state: { chosen: id, line: extend && line !== null ? id : line },
    effects: [
      { do: 'choose', id } as const,
      ...(extend && line !== null ? [{ do: 'lineTo', id } as const] : []),
    ],
    handled: true,
  })
  // A line ends at the song chosen, reached by an arrow or not.
  const endLine = (at: number) => ({
    state: { chosen: at, line: null },
    effects: [
      ...(at !== line ? [{ do: 'lineTo', id: at } as const] : []),
      { do: 'lineEnd' } as const,
    ],
    handled: true,
  })
  const lineFrom = (at: number, choosing: boolean) => ({
    state: { chosen: at, line: at },
    effects: [
      ...(choosing ? [{ do: 'choose', id: at } as const] : []),
      { do: 'lineFrom', id: at } as const,
    ],
    handled: true,
  })

  switch (input.key) {
    case 'arrow': {
      if (chosen === null) return { state, effects: [], handled: false }
      const next = ask.toward(chosen, input.direction)
      return next === null ? unchanged : choose(next, true)
    }
    case 'next':
    case 'previous': {
      const next =
        chosen === null ? ask.middle() : ask.beside(chosen, input.key === 'next' ? 1 : -1)
      return next === null ? unchanged : choose(next, false)
    }
    case 'enter': {
      if (line !== null && chosen !== null) return endLine(chosen)
      if (chosen === null) {
        const middle = ask.middle()
        return middle === null ? unchanged : choose(middle, false)
      }
      if (ask.armed) return lineFrom(chosen, false)
      return { state, effects: [{ do: 'play', id: chosen }], handled: true }
    }
    case 'play': {
      const at = chosen ?? ask.middle()
      if (at === null) return unchanged
      return {
        state: { chosen: at, line },
        effects: [
          ...(at !== chosen ? [{ do: 'choose', id: at } as const] : []),
          { do: 'play', id: at },
        ],
        handled: true,
      }
    }
    case 'draw': {
      const at = chosen ?? ask.middle()
      if (at === null) return unchanged
      if (line !== null) return endLine(at)
      return lineFrom(at, at !== chosen)
    }
    case 'escape':
      if (line !== null) {
        return { state: { chosen, line: null }, effects: [{ do: 'lineCancel' }], handled: true }
      }
      if (chosen !== null)
        return { state: NO_FIELD_KEYS, effects: [{ do: 'letGo' }], handled: true }
      return { state, effects: [], handled: false }
    case 'in':
    case 'out':
      return {
        state,
        effects: [{ do: 'zoom', factor: input.key === 'in' ? KEY_ZOOM : 1 / KEY_ZOOM }],
        handled: true,
      }
  }
}

/** What a screen reader's action on the field asks of it (`fieldAccess`), or null for one it does not take. */
export function actionKey(action: string): FieldKey | null {
  switch (action) {
    case 'increment':
      return { key: 'next' }
    case 'decrement':
      return { key: 'previous' }
    case 'activate':
      return { key: 'play' }
    case 'draw':
      return { key: 'draw' }
    case 'escape':
      return { key: 'escape' }
    default:
      return null
  }
}

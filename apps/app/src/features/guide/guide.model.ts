/**
 * The one-time guides: a dark layer over the app with a spotlight on the
 * thing a gesture works on, a hand acting the gesture out, and a line saying
 * it — 网易云音乐's way of teaching, which Xiao chose on 2026-10-13 over
 * sentences that stay on screen for good. Each is shown once on a device and
 * remembered the moment it appears (B1); Settings › About forgets them all
 * (B3). The pure half lives here; `guideMemory.ts` keeps it, `Guide.tsx`
 * draws it.
 */

/** Every guide, by the name it is remembered under. */
export type GuideName =
  | 'playlist-move'
  | 'library-select'
  | 'lyrics'
  | 'sidebar-drop'
  | 'up-next'
  | 'up-next-rail'
  | 'import-rows'
  | 'tag-hold'
  | 'import-review'
  | 'import-box'

/**
 * What the device keeps: the names seen, comma-separated. `*` stands for all
 * of them, which is what an automated run seeds so that no layer sits over
 * the buttons it is about to press (`verify/playwright.config.ts`).
 */
export type Seen = ReadonlySet<string> | 'all'

export function parseSeen(raw: string | null): Seen {
  if (raw === null) return new Set()
  if (raw.trim() === '*') return 'all'
  return new Set(
    raw
      .split(',')
      .map(name => name.trim())
      .filter(name => name !== ''),
  )
}

export function hasSeen(seen: Seen, name: GuideName): boolean {
  return seen === 'all' || seen.has(name)
}

export function withSeen(seen: Seen, name: GuideName): Seen {
  if (seen === 'all' || seen.has(name)) return seen
  return new Set([...seen, name])
}

export function writeSeen(seen: Seen): string {
  return seen === 'all' ? '*' : [...seen].join(',')
}

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** How far the spotlight stands off what it lights, so the dashed ring clears it. */
const HOLE_PAD = 6

/** The spotlight around a measured element, kept inside the screen. */
export function holeAround(target: Box, screen: { width: number; height: number }): Box {
  const x = Math.max(4, target.x - HOLE_PAD)
  const y = Math.max(4, target.y - HOLE_PAD)
  const right = Math.min(screen.width - 4, target.x + target.width + HOLE_PAD)
  const bottom = Math.min(screen.height - 4, target.y + target.height + HOLE_PAD)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

/**
 * The layer as one path: the whole screen, then the spotlight's rounded box
 * drawn inside it. Filled `evenodd`, the box is cut out and the rest is dark.
 */
export function layerPath(screen: { width: number; height: number }, hole: Box, r: number): string {
  const { x, y, width: w, height: h } = hole
  const k = Math.max(0, Math.min(r, w / 2, h / 2))
  return [
    `M0 0H${screen.width}V${screen.height}H0Z`,
    `M${x + k} ${y}H${x + w - k}`,
    `A${k} ${k} 0 0 1 ${x + w} ${y + k}V${y + h - k}`,
    `A${k} ${k} 0 0 1 ${x + w - k} ${y + h}H${x + k}`,
    `A${k} ${k} 0 0 1 ${x} ${y + h - k}V${y + k}`,
    `A${k} ${k} 0 0 1 ${x + k} ${y}Z`,
  ].join('')
}

/** Where the words go: under the spotlight, over it, or beside it. */
type WordsPlace =
  | { readonly kind: 'below'; readonly top: number; readonly left: number; readonly width: number }
  | {
      readonly kind: 'above'
      readonly bottom: number
      readonly left: number
      readonly width: number
    }
  | { readonly kind: 'beside'; readonly left: number; readonly top: number; readonly width: number }

/** The widest the words run, so a line reads at a glance on a computer too. */
const WORDS_WIDTH = 340
const EDGE = 16

/** Room the words need: two lines of the title size and a line under them. */
const WORDS_HEIGHT = 84
const WORDS_GAP = 28

/**
 * Under the spotlight when there is room, which is where the eye goes after
 * the hand; over it when the spotlight sits low; beside it when the spotlight
 * is a narrow column (the sidebar on a computer) on a screen wide enough to
 * read beside it.
 */
export function placeWords(hole: Box, screen: { width: number; height: number }): WordsPlace {
  if (hole.width < 300 && screen.width - (hole.x + hole.width) > 360) {
    return {
      kind: 'beside',
      left: hole.x + hole.width + 36,
      top: Math.max(EDGE, hole.y + 8),
      width: WORDS_WIDTH,
    }
  }
  // Centred under (or over) the spotlight, kept on the screen: on a phone that
  // is the screen's middle, beside a computer's rail it is the rail's.
  const width = Math.min(WORDS_WIDTH, screen.width - EDGE * 2)
  const centre = hole.x + hole.width / 2
  const left = Math.min(Math.max(EDGE, centre - width / 2), screen.width - EDGE - width)
  const below = hole.y + hole.height + WORDS_GAP
  if (below + WORDS_HEIGHT <= screen.height - 24) return { kind: 'below', top: below, left, width }
  return { kind: 'above', bottom: screen.height - hole.y + WORDS_GAP, left, width }
}

/**
 * Which step comes after `now` in a guide of `steps`, or -1 once it is over.
 * A guide already over stays over: a tap on the layer as it fades out went on
 * to step 0 and started the guide again.
 */
export function stepAfter(now: number, steps: number): number {
  if (now < 0) return now
  return now + 1 < steps ? now + 1 : -1
}

/** Whether a box has moved enough that the spotlight should follow it. */
export function boxMoved(from: Box, to: Box): boolean {
  return (
    Math.abs(from.x - to.x) > 0.5 ||
    Math.abs(from.y - to.y) > 0.5 ||
    Math.abs(from.width - to.width) > 0.5 ||
    Math.abs(from.height - to.height) > 0.5
  )
}

/**
 * How many fingers are still down once a touch has ended: the touches React
 * reports less the ones this event ended. Some platforms still count the
 * lifted finger among `touches`, some do not; this is right for both.
 */
export function fingersLeft(
  touches: readonly { readonly identifier: string | number }[],
  ended: readonly { readonly identifier: string | number }[],
): number {
  return touches.filter(touch => !ended.some(gone => gone.identifier === touch.identifier)).length
}

/** The input types that are pressed rather than typed in. */
const NOT_TYPED = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

/** Whether an element (a browser's) is somewhere keys type into. */
export function takesTyping(
  element: {
    readonly tagName?: string
    readonly type?: string
    readonly isContentEditable?: boolean
  } | null,
): boolean {
  if (element === null) return false
  if (element.isContentEditable === true) return true
  const tag = element.tagName?.toUpperCase()
  if (tag === 'TEXTAREA') return true
  return tag === 'INPUT' && !NOT_TYPED.has((element.type ?? 'text').toLowerCase())
}

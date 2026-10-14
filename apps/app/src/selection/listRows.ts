import { SONG_ROW, songRowOf } from '../shell/keyOwner'

/*
 * A song list's rows as a browser has them, for the list's keys
 * (`useListKeys.web.ts`) and a row keeping its focus (`useRowFocus.web.ts`).
 * Found by the attributes React Native for web writes from a `SongRow`'s
 * `dataSet`, since a list draws only some of its rows and the keys answer
 * what is drawn.
 */

/** The row's press target, under its cover and title: what holds a row's focus. */
const ROW_PRESS = 'data-row-press'
/** The row's song. */
const SONG_ID = 'data-song-id'
/** The row's ⋯, which ⇧F10 presses. */
export const ROW_MORE = 'data-row-more'

/** The rows of `listKey` that are drawn, in the list's order. */
function rowsOf(listKey: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${SONG_ROW}]`)).filter(
    row => row.getAttribute(SONG_ROW) === listKey,
  )
}

/** The row of `listKey` that `target` is in, or null. */
export function listRowOf(target: EventTarget | null, listKey: string): HTMLElement | null {
  const row = songRowOf(target)
  return row && row.getAttribute(SONG_ROW) === listKey ? row : null
}

/** The song a row is, or null for a row that names none. */
export function songOf(row: HTMLElement): number | null {
  const songId = Number(row.getAttribute(SONG_ID))
  return row.hasAttribute(SONG_ID) && Number.isFinite(songId) ? songId : null
}

/** A row's press target. */
export function pressOf(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>(`[${ROW_PRESS}]`)
}

/** The row `step` rows from `row`, in the list's order, or null at either end. */
export function neighbour(row: HTMLElement, listKey: string, step: 1 | -1): HTMLElement | null {
  const rows = rowsOf(listKey)
  const at = rows.indexOf(row)
  return (at === -1 ? undefined : rows[at + step]) ?? null
}

/**
 * What in a row takes focus, left to right: its circle, its ▶, its press
 * target, its tag chips and +, its ⋯ — every one of them out of Tab's way
 * (`tabIndex` -1), and reached with ← and →. Not one that is not drawn.
 */
export function controlsOf(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>('[tabindex]')).filter(
    control =>
      control.getAttribute('aria-disabled') !== 'true' &&
      control.closest('[aria-hidden="true"]') === null &&
      // Older browsers, and a test's document, cannot say: drawn, then.
      (typeof control.checkVisibility !== 'function' || control.checkVisibility()),
  )
}

/** The drawn row of `listKey` that is `songId`, or null. */
export function rowOfSong(listKey: string, songId: number): HTMLElement | null {
  return rowsOf(listKey).find(row => songOf(row) === songId) ?? null
}

/**
 * Where Tab comes into a list: the row the keyboard or a click was last on,
 * while it is drawn. A list draws only rows within a few screens of where it
 * is scrolled, so one that is not drawn has been scrolled well away from:
 * then the first row in view, and with no row in view, the first one drawn —
 * the stop Tab can land on at once, before the list is scrolled back to the
 * row it was on (`useListKeys.web.ts`).
 */
export function entryRow(listKey: string, activeId: number | null): HTMLElement | null {
  const rows = rowsOf(listKey)
  const active = activeId === null ? undefined : rows.find(row => songOf(row) === activeId)
  return active ?? rows.find(inView) ?? rows[0] ?? null
}

/**
 * Make `row` the list's one Tab stop: its press target takes Tab, and no other
 * row's does. Null leaves the list with none for the moment, which is how Tab
 * from inside a row goes past the list rather than to that row's own target.
 *
 * Set on the element rather than rendered: which row it is changes with every
 * arrow, and a row is memoised so that a list of a thousand does not redraw
 * for one. Every target renders as -1 and React leaves the attribute alone
 * while that does not change; a row drawn again starts at -1, and the stop is
 * put back the next time Tab is pressed.
 */
export function placeStop(listKey: string, row: HTMLElement | null): void {
  const stop = row ? pressOf(row) : null
  for (const each of rowsOf(listKey)) {
    const target = pressOf(each)
    if (target && target !== stop && target.tabIndex !== -1) target.tabIndex = -1
  }
  if (stop) stop.tabIndex = 0
}

/** Whether a row is on screen, and not under something drawn over it (a pinned bar). */
function inView(row: HTMLElement): boolean {
  if (typeof document.elementFromPoint !== 'function') return false
  const box = row.getBoundingClientRect()
  if (box.height === 0) return false
  const scroller = scrollerOf(row)
  const top = Math.max(scroller ? scroller.getBoundingClientRect().top : 0, 0)
  const bottom = Math.min(
    scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight,
    window.innerHeight,
  )
  if (box.top < top || box.bottom > bottom) return false
  const over = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  return over !== null && row.contains(over)
}

/**
 * Scroll the list just far enough to show `row`, and out from under the
 * selection bar where the bar stays at the top of the list (`SongList`'s
 * `pinned`): the browser's own scrolling counts a row under a sticky bar as
 * shown. What covers the row's top edge, if anything, is that bar's header.
 */
export function bringIntoView(row: HTMLElement): void {
  row.scrollIntoView?.({ block: 'nearest' })
  if (typeof document.elementFromPoint !== 'function') return
  const box = row.getBoundingClientRect()
  const over = document.elementFromPoint(box.left + box.width / 2, box.top + 1)
  if (!over || row.contains(over)) return
  // The outermost thing covering it that is not one of the row's own boxes.
  let cover: Element = over
  while (cover.parentElement && !cover.parentElement.contains(row)) cover = cover.parentElement
  const overlap = cover.getBoundingClientRect().bottom - box.top
  if (overlap > 0) scrollerOf(row)?.scrollBy({ top: -overlap })
}

/** The nearest box above `element` that scrolls up and down. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight)
      return at
  }
  return null
}

/**
 * Lists whose focused row was taken away as it scrolled out of the drawn
 * rows, and which song it was: the row takes focus back when it is drawn
 * again, if nothing else has taken it since (`useRowFocus.web.ts`). Focus
 * anywhere else, or a press, forgets it (`useListKeys.web.ts`).
 */
export const lostFocus = new Map<string, number>()

/** Whether no element has focus: what is left when the focused one is taken away. */
export function nothingFocused(): boolean {
  return document.activeElement === null || document.activeElement === document.body
}

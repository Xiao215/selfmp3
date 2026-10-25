import { tabbing } from './tabbing'

/** Widgets that run their own keys. */
const RUNS_ITS_OWN_KEYS = '[role="combobox"], [role="listbox"], [role="menu"], [role="dialog"]'

/**
 * Whether a key pressed where focus is belongs to what has focus rather than
 * to the page — the one test the page's own keys (`useHotkeys.web.ts`) and
 * Escape (`useEscape.web.ts`) both stand aside on.
 *
 * A menu, a list box, a combo box or a dialog runs its own keys: arrows, Enter,
 * Escape. When `typing`, a text field owns the keys too, where a letter is a
 * word and not a shortcut. Escape is not typing: it leaves a field as readily
 * as anywhere, so only those widgets keep it.
 */
export function focusOwnsKey(target: EventTarget | null, { typing }: { typing: boolean }): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  if (
    typing &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    return true
  }
  return target.closest(RUNS_ITS_OWN_KEYS) !== null
}

/**
 * A song row's own attribute, naming the list it is in: what a list's keys
 * (`selection/useListKeys.web.ts`) find their rows by. React Native for web
 * writes `dataSet={{ songRow }}` as this.
 */
export const SONG_ROW = 'data-song-row'

/** The song row `target` is in — its press target, its circle, its ⋯ — or null. */
export function songRowOf(target: EventTarget | null): HTMLElement | null {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return null
  return target.closest<HTMLElement>(`[${SONG_ROW}]`)
}

/**
 * Whether a song row with the keyboard on it keeps a key from the page.
 *
 * Space is a row's tick once the keyboard has brought focus to it — Tab, or
 * the list's arrows, which is when its ring shows. The focus a click leaves on
 * a row is not that: Space after clicking a song still pauses it. The page's
 * play and pause (`useHotkeys`, before focus) stands aside here, or one press
 * would tick the row and pause the music.
 */
export function rowOwnsKey(target: EventTarget | null, combination: string): boolean {
  return combination === ' ' && tabbing() && songRowOf(target) !== null
}

/** Controls that Space works, as Enter does (`Press`). */
const SPACE_CONTROL = '[role="switch"], [role="checkbox"], [role="radio"], [role="tab"]'

/**
 * Whether Space is a switch's, a radio's, a checkbox's or a tab's, rather
 * than the page's play and pause: on one the keyboard has brought focus to,
 * Space flips, chooses or opens it, as WAI-ARIA's patterns have it. As with a
 * row, the focus a click leaves behind is not that, and Space still pauses.
 */
export function controlOwnsKey(target: EventTarget | null, combination: string): boolean {
  if (combination !== ' ' || !tabbing()) return false
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  return target.matches(SPACE_CONTROL)
}

/** On `<html>` while the keyboard is moving focus, which is when the ring is drawn (`FocusStyle.web.tsx`). */
const TABBING = 'data-tabbing'

/**
 * Whether focus is being moved with the keyboard right now, for what shows
 * itself on keyboard focus but not on the focus a click leaves behind: a tag
 * tile's record comes out under Tab, and a song row the keyboard is on takes
 * Space for its tick rather than for play and pause. A phone has no Tab key,
 * and no document, so there it is never.
 */
export function tabbing(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(TABBING)
}

/**
 * The keyboard is moving focus: Tab, or a list's arrows. A pointer press ends
 * it (`FocusStyle.web.tsx`).
 */
export function setTabbing(on: boolean): void {
  if (typeof document === 'undefined') return
  if (on) document.documentElement.setAttribute(TABBING, '')
  else document.documentElement.removeAttribute(TABBING)
}

/**
 * Spread on a list that clips what it holds (the sidebar, a shelf, a strip of
 * chips): the focus ring of anything in it is drawn just inside its edge, as
 * a song row's is, where the clip cannot cut it (AF1).
 */
export const FOCUS_INSIDE = { dataSet: { focusInside: 'true' } } as const

/** The selector for rules drawn only while the keyboard moves focus. */
export const TABBING_SELECTOR = `html[${TABBING}]`

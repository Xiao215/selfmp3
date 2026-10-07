import { createValueStore } from '../state/valueStore.model'
import { FULL_SCREEN_ROUTES } from './fullScreen.model'
import { useValueStore } from '../state/useValueStore'

/**
 * Whether the floating chrome — the mini player and the tab bar — is on the
 * page at all.
 *
 * Two things need the answer and neither can ask the other: `_layout.tsx`
 * draws the chrome, and `useFloatingChrome` leaves room at the foot of every
 * scrolling page for it. A page that owns the display must not keep a hole
 * where the bar would have been.
 *
 * Outside React, as the root's width is (`rootWidth.ts`): one flag, read by
 * every list, and a context around the whole app would redraw all of them
 * from the top whenever it changed.
 */

/**
 * And, on a phone only, the pages it opens over its tabs rather than as one:
 * everything under Profile, and Search. They are a step away from the tabs
 * rather than one of them, and each carries its own way back, so the display
 * is theirs (Xiao, 2026-09-20). A computer keeps its sidebar and its player
 * bar on all of them, because the sidebar is how it reaches them at all.
 */
const PHONE_FULL_SCREEN = ['/profile', '/import', '/stats', '/settings', '/search']

/** Does this page take the whole display, leaving no room for the chrome? */
export function pageOwnsScreen(pathname: string, wide: boolean): boolean {
  if (FULL_SCREEN_ROUTES.includes(pathname)) return true
  if (wide) return false
  return PHONE_FULL_SCREEN.some(route => pathname === route || pathname.startsWith(`${route}/`))
}

const shown = createValueStore(true)

export const setPageChrome = shown.set

/** True while the mini player and the tab bar are on the page. */
export function usePageChrome(): boolean {
  return useValueStore(shown)
}

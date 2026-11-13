import { activeTab, TABS } from './nav.model'
import { MOVE_MS } from '../ui/motion.model'
import { addressOf } from './backGesture'
import { FULL_SCREEN_ROUTES } from './fullScreen.model'

/**
 * When the page steps in, and from which side (docs/ui-mock `M2`, 4 and `M3`, 5).
 *
 * On a phone it is changing tabs: the new page steps in a few points from the
 * side its tab is on, and a page pushed within a tab (a tag from Home) is left
 * to its own move. On a computer every page change settles in from a few
 * points below. Pages that own the whole display — Now Playing, the welcome —
 * have their own entrances and do not count as a change, so coming back from
 * them to the page underneath plays nothing.
 */

/** The phone's tabs, left to right, and Search's circle after them. */
const PHONE_ORDER: readonly string[] = [...TABS.map(tab => tab.href), '/search']

/**
 * What a page change is counted by, or null for a page that does not count.
 *
 * On a phone it is the tab, because the stack moves a page pushed within one
 * itself — unless it does not (`stackMoves`, false in a browser), and then
 * every page is its own change or nothing would move at all: Profile opened
 * from Home, and Settings from Profile, would arrive instantly.
 */
export function pageKey(pathname: string, wide: boolean, stackMoves = true): string | null {
  if (FULL_SCREEN_ROUTES.includes(pathname)) return null
  if (wide || !stackMoves) return pathname
  return activeTab(pathname) ?? (pathname === '/search' ? '/search' : null)
}

/**
 * A phone's next step to this page that plays nothing, because the pages play
 * the change themselves: Search rising out of Home's field and going back
 * down into it (`features/search/useSearchDoor.tsx`). Stepped in from the
 * side as well, Search would fade in from nothing over the field that had
 * just landed. Kept by the page's key until `PageStep` next changes page,
 * whichever page that is.
 */
let quietTo: string | null = null

export function quietNextStepTo(pathname: string): void {
  quietTo = pageKey(pathname, false)
}

export function stepIsQuiet(key: string): boolean {
  return quietTo === key
}

export function clearQuietStep(): void {
  quietTo = null
}

/** How far a page steps in from: a phone's from the side, a computer's from below. */
export const PAGE_STEP_PHONE = 8
export const PAGE_STEP_WIDE = 6

/**
 * A phone's tab pressed: the page it brings steps in itself, from its first
 * frame (`keepNearTop.tsx`), and `PageStep` leaves that change alone.
 *
 * `PageStep` learns of a change from the address, and the address changes
 * only once the new page has been drawn — expo-router hears of it from the
 * navigator afterwards — so its step came a frame late: the new tab was
 * drawn whole for a frame, vanished, and then stepped in. Told from the
 * press, it stepped on the old page, as the navigator draws the new one in a
 * render of its own; told by the new page as it mounted, its frame still
 * came after the page's own. Only the page's first render is sure to be in
 * the page's first frame.
 */
let pressed: { readonly to: string; readonly from: string; readonly at: number } | null = null

/** How long after the press the page it went to may still arrive as its own. */
const ARRIVAL_MS = 1500

/** Call it just before going from the tab `from` to the tab `to`. */
export function stepAheadTo(to: string, from: string): void {
  pressed = { to, from, at: Date.now() }
}

/**
 * Asked once by a page as it mounts at `address`: the side it steps in from
 * if it is the tab just pressed for, or null.
 */
export function takeTabArrival(address: string): -1 | 1 | null {
  const press = pressed
  if (press === null || Date.now() - press.at > ARRIVAL_MS || address !== press.to) return null
  pressed = null
  quietNextStepTo(press.to)
  return stepSide(pageKey(press.from, false) ?? press.from, press.to)
}

/** The page `PageStep` last showed: what it was counted by, and under which layout. */
export interface PageShown {
  readonly key: string
  readonly wide: boolean
}

/**
 * Whether the page now shown is a step to another page, which steps in. Not
 * when only the layout changed: an iPad turned across the breakpoint keeps its
 * page, and a page pushed on a phone is counted by its tab where a computer
 * counts it by itself, so the key changes without the page changing. Stepped
 * in, the page drew nothing for the first frames of the upright layout
 * (r1 m43, R2-m17).
 */
export function pageStepped(from: PageShown, to: PageShown): boolean {
  return from.wide === to.wide && from.key !== to.key
}

/**
 * Which side the new page comes from on a phone: 1 from the right, -1 from
 * the left. Only the tabs have sides; a page pushed over one — Profile,
 * Settings — comes from the right, the way a push does.
 */
export function stepSide(from: string, to: string): -1 | 1 {
  const was = PHONE_ORDER.indexOf(from)
  const now = PHONE_ORDER.indexOf(to)
  if (was === -1 || now === -1) return 1
  return now < was ? -1 : 1
}

/** A tag's or an artist's page, which a Home tile or a row's name opens. */
const PLACE_ROUTES = ['tag/[name]', 'artist/[name]', 'combined']

/**
 * The native stack's own move for a screen, beside `PageStep`'s. A phone's
 * tab pages play none, because the step is theirs. Every other page a phone
 * pushes slides in from the right and back out to it — iOS's own push, the
 * one the swipe back drags — except a place opened from its Home tile, which
 * crossfades in over 340 ms while its head grows out of the tile, and leaves
 * with the slide (`ui/useHeroGrow.ts` asks for it once the page has arrived).
 * A computer's pages all
 * play none: the step is the whole of its page change. A browser's stack has
 * no moves at all, so there only the step plays. With less motion asked for,
 * none at all: the navigator's moves are outside `ui/motion.ts`, so they are
 * answered here.
 */
export function stackAnimation(
  routeName: string,
  wide: boolean,
  reduced = false,
  fromTile = false,
): { animation: 'none' | 'fade' | 'default'; animationDuration?: number } {
  const address = addressOf(routeName)
  if (reduced || wide || pageKey(address, false) === address) return { animation: 'none' }
  if (fromTile && PLACE_ROUTES.includes(routeName)) {
    return { animation: 'fade', animationDuration: MOVE_MS.place }
  }
  return { animation: 'default' }
}

/**
 * The navigator's part in Now Playing's move. On a phone, none: the page
 * rises from the foot itself and its cover travels from the mini player's
 * (`M2`, 1; `NowPlayingScreen`), which a navigator sliding the page under it
 * could not be told about. On an iPad the stack slides the page up over 380
 * ms, or not at all under Reduce Motion. `presentation` is the layout's to
 * choose (a phone's modal, a computer's card).
 */
export function nowPlayingAnimation(
  wide: boolean,
  reduced: boolean,
): { animation: 'none' } | { animation: 'slide_from_bottom'; animationDuration: number } {
  return !wide || reduced
    ? { animation: 'none' }
    : { animation: 'slide_from_bottom', animationDuration: MOVE_MS.nowPlaying }
}

import { activeTab } from '../ui/components/bottomNav.model'
import { MOVE_MS } from '../ui/motion.model'
import { addressOf } from './backGesture'

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
const PHONE_ORDER = ['/', '/library', '/playlists', '/search'] as const

const OWN_ENTRANCE = ['/now-playing', '/welcome', '/storage', '/first-sync']

/**
 * What a page change is counted by, or null for a page that does not count.
 *
 * On a phone it is the tab, because the stack moves a page pushed within one
 * itself — unless it does not (`stackMoves`, false in a browser), and then
 * every page is its own change or nothing would move at all: Profile opened
 * from Home, and Settings from Profile, arrived instantly.
 */
export function pageKey(pathname: string, wide: boolean, stackMoves = true): string | null {
  if (OWN_ENTRANCE.includes(pathname)) return null
  if (wide || !stackMoves) return pathname
  return activeTab(pathname) ?? (pathname === '/search' ? '/search' : null)
}

/**
 * Which side the new page comes from on a phone: 1 from the right, -1 from
 * the left. Only the tabs have sides; a page pushed over one — Profile,
 * Settings — comes from the right, the way a push does.
 */
export function stepSide(from: string, to: string): -1 | 1 {
  const was = PHONE_ORDER.indexOf(from as (typeof PHONE_ORDER)[number])
  const now = PHONE_ORDER.indexOf(to as (typeof PHONE_ORDER)[number])
  if (was === -1 || now === -1) return 1
  return now < was ? -1 : 1
}

/** A tag's or an artist's page, which a Home tile or a row's name opens. */
const PLACE_ROUTES = ['tag/[name]', 'artist/[name]']

/**
 * The native stack's own move for a screen, beside `PageStep`'s. A phone's
 * tab pages play none, because the step is theirs; every other page a phone
 * pushes crossfades, a place page over 340 ms. A computer's pages all play
 * none: the step is the whole of its page change. A browser's stack has no
 * moves at all, so there only the step plays. With less motion asked for,
 * none at all: the navigator's moves are outside `ui/motion.ts`, so they are
 * answered here.
 */
export function stackAnimation(
  routeName: string,
  wide: boolean,
  reduced = false,
): { animation: 'none' | 'fade'; animationDuration?: number } {
  const address = addressOf(routeName)
  if (reduced || wide || pageKey(address, false) === address) return { animation: 'none' }
  if (PLACE_ROUTES.includes(routeName)) {
    return { animation: 'fade', animationDuration: MOVE_MS.place }
  }
  return { animation: 'fade' }
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

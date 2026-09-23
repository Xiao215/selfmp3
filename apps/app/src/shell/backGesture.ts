import { activeTab } from '../ui/components/bottomNav.model'

/**
 * Which screens iOS's swipe-back gesture belongs on.
 *
 * The app is one native stack and the tab bar navigates inside it: tapping
 * Playlists pushes Playlists over Library. iOS then offers its interactive pop
 * on the pushed screen — and from iOS 26 react-native-screens takes that swipe
 * anywhere on the display rather than at the left edge alone, because
 * `fullScreenSwipeEnabled` defaults to true there. So a swipe across the middle
 * of Playlists dragged Library back in, which reads as switching tabs by
 * swiping. No iOS app does that, and it was never designed here.
 *
 * A tab's own page is exactly where it happened: changing tab always pushes
 * one, so a screen that a tab leads to directly is the only place a pop can
 * cross tabs. Taking the gesture off those, and leaving it everywhere else, is
 * the whole rule — a playlist, Settings, Stats and the migration page are each
 * pushed from the page they go back to, and keep the gesture that means back.
 *
 * iOS only, in both directions: react-navigation forces the native gesture off
 * on Android and handles the system back itself, and a browser has its own Back
 * button. Nothing here changes either.
 */
export function swipeBackAllowed(routeName: string): boolean {
  if (GATES.includes(routeName)) return false
  const address = addressOf(routeName)
  // A tab's own page is the one its tab points at; every other page a tab
  // lights — Settings under Profile, a playlist under Playlists — was pushed onto it.
  return activeTab(address) !== address
}

/**
 * The way in, which nothing is behind.
 *
 * Both replace the screen they leave rather than push onto it, so there is
 * usually nothing to pop; saying so anyway keeps a stray swipe on Welcome from
 * revealing the library it just turned away, and one on First sync from going
 * back to a Welcome that has already let the person in.
 */
const GATES = ['welcome', 'storage', 'first-sync']

/**
 * The address a route name draws: `index` is `/`, `playlists/index` and
 * `playlists` are both `/playlists`. Router state spells a folder's route
 * either way, which is why both are folded here.
 */
export function addressOf(routeName: string): string {
  const path = routeName.replace(/\/index$/, '')
  return path === 'index' ? '/' : `/${path}`
}

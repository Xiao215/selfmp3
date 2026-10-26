/**
 * The app's places, once for the phone's tab bar and the computer's rail
 * (docs/ui-mock `P04`; docs/UI-MIGRATION.md, "Routes after"), and which one a
 * page belongs to.
 *
 * A phone has three tabs — Home, Library, Playlists. Everything that is not a
 * tab of its own is reached from Home: the tags from its tiles (and a tag's
 * or an artist's own page, and tags combined from one), a room that ended
 * from Recently played, Profile from its avatar and, through it, Stats and
 * Settings; Import from its +. A shared playlist sits among your playlists.
 * So those pages light Home, and a shared one Playlists: the bar says
 * where you are in the app, not only which page answered the address.
 *
 * A computer's rail carries Import and Stats as rows of their own, where a
 * phone reaches them through Profile (docs/UI-MIGRATION.md, Open question 7),
 * and Playlists as a section whose header is the way to the playlists page.
 */

export type NavId = 'home' | 'library' | 'playlists' | 'import' | 'stats' | 'soundMap'

interface NavPlace {
  readonly id: NavId
  readonly href: '/' | '/library' | '/playlists' | '/import' | '/stats' | '/sound-map'
  readonly label: string
  /** One of the phone's tabs. */
  readonly tab: boolean
  /** How the rail draws it: a row under Search, or a section's header further down. */
  readonly rail: 'row' | 'section'
}

/** In the order both draw them. */
export const NAV: readonly NavPlace[] = [
  { id: 'home', href: '/', label: 'Home', tab: true, rail: 'row' },
  { id: 'library', href: '/library', label: 'Library', tab: true, rail: 'row' },
  { id: 'playlists', href: '/playlists', label: 'Playlists', tab: true, rail: 'section' },
  // Import and Stats both need the server itself. A cloud library reaches it by
  // the addresses in its last sync and says so when it cannot, which is the
  // page's business — leaving the row out would say the feature did not exist.
  { id: 'import', href: '/import', label: 'Import', tab: false, rail: 'row' },
  { id: 'stats', href: '/stats', label: 'Stats', tab: false, rail: 'row' },
  { id: 'soundMap', href: '/sound-map', label: 'Sound map', tab: false, rail: 'row' },
]

export type TabHref = '/' | '/library' | '/playlists'

/** The phone's tabs, left to right. */
export const TABS = NAV.filter((place): place is NavPlace & { href: TabHref } => place.tab)

/** The pages reached from Home: a tag's tiles, Recently played, the avatar, the +. */
const HOME_PAGES = [
  '/tags',
  '/tag',
  '/combined',
  '/artist',
  '/past-room',
  '/profile',
  '/stats',
  '/sound-map',
  '/settings',
  '/import',
] as const

/** `/stats` and `/stats/report`, but not `/statsomething`. */
function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`)
}

/**
 * Which of the rail's places a page belongs to.
 *
 * The longest match wins, so `/stats/report` lights Stats. `under` rather
 * than a bare `startsWith`, so `/statsomething` lights nothing.
 */
export function activeDestination(pathname: string): NavPlace['href'] | null {
  const matches = NAV.map(place => place.href).filter(href =>
    href === '/' ? pathname === '/' : under(pathname, href),
  )
  return [...matches].sort((a, b) => b.length - a.length)[0] ?? null
}

/** The tab to light for a page, or none for a page no tab leads to. */
export function activeTab(pathname: string): TabHref | null {
  if (pathname === '/') return '/'
  if (under(pathname, '/library')) return '/library'
  // A shared playlist is one of your playlists, in their grid.
  if (under(pathname, '/playlists') || under(pathname, '/shared')) return '/playlists'
  if (HOME_PAGES.some(page => under(pathname, page))) return '/'
  return null
}

/**
 * Whether pressing a place goes anywhere. A lit place still goes to its own
 * first page — Home from Settings, Playlists from a playlist, Stats from its
 * report — as a phone's tab bar does; only its first page itself stays put.
 */
export function navGoes(pathname: string, href: NavPlace['href']): boolean {
  return pathname !== href
}

/**
 * What a place says to a screen reader, on the bar and the rail alike: a tab,
 * and which one is chosen. `aria-selected` as well, because react-native-web
 * does not turn `accessibilityState` into it.
 */
export function navItemProps(active: boolean): {
  accessibilityRole: 'tab'
  accessibilityState: { selected: boolean }
  'aria-selected': boolean
} {
  return {
    accessibilityRole: 'tab',
    accessibilityState: { selected: active },
    'aria-selected': active,
  }
}

/**
 * The tab bar, without the bar: which tab a page belongs to (docs/ui-mock
 * `P04`; docs/UI-MIGRATION.md, "Routes after").
 *
 * A phone has three tabs — Home, Library, Playlists — and a search circle
 * beside them. Everything that is not a tab of its own is reached from Home:
 * the tags from its tiles (and a tag's or an artist's own page), Profile from its avatar and, through it, Stats and
 * Settings; Import from its +. So those pages light Home: the bar says where
 * you are in the app, not only which page answered the address.
 */

export type TabHref = '/' | '/library' | '/playlists'

/** The pages reached from Home, and Home itself. */
const HOME_PAGES = [
  '/tags',
  '/tag',
  '/artist',
  '/profile',
  '/stats',
  '/settings',
  '/import',
] as const

/** `/stats` and `/stats/report`, but not `/statsomething`. */
function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`)
}

/**
 * Which of a set of destinations a page belongs to: the rail's four (`/`,
 * `/library`, `/import`, `/stats`), where a computer reaches Import and Stats
 * from the rail itself rather than through Profile.
 *
 * The longest match wins, so `/stats/report` lights Stats. `under` rather
 * than a bare `startsWith`, so `/statsomething` lights nothing — the sidebar
 * derived this inline and had that bug.
 */
export function activeDestination(pathname: string, hrefs: readonly string[]): string | null {
  const matches = hrefs.filter(href => (href === '/' ? pathname === '/' : under(pathname, href)))
  return [...matches].sort((a, b) => b.length - a.length)[0] ?? null
}

/** The tab to light for a page, or none for a page no tab leads to. */
export function activeTab(pathname: string): TabHref | null {
  if (pathname === '/') return '/'
  if (under(pathname, '/library')) return '/library'
  if (under(pathname, '/playlists')) return '/playlists'
  if (HOME_PAGES.some(page => under(pathname, page))) return '/'
  return null
}

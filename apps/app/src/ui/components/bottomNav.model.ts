/**
 * The tab bar, without the bar: which tab a page belongs to.
 *
 * A phone has four tabs and more pages than that. Stats, Untagged, Tags and
 * Settings are all reached from You, so they light You: the tab says where
 * you are in the app, not only which page answered the address.
 */

export type TabHref = '/' | '/playlists' | '/import' | '/you'

/** The pages the You tab lists, and itself. */
const YOU_PAGES = ['/you', '/settings', '/stats', '/inbox', '/tags'] as const

/** `/stats` and `/stats/report`, but not `/statsomething`. */
function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`)
}

/** The tab to light for a page, or none for a page no tab leads to. */
export function activeTab(pathname: string): TabHref | null {
  if (pathname === '/') return '/'
  if (pathname.startsWith('/playlists')) return '/playlists'
  if (under(pathname, '/import')) return '/import'
  if (YOU_PAGES.some(page => under(pathname, page))) return '/you'
  return null
}

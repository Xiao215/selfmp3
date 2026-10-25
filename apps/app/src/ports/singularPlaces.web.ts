/**
 * Whether going to a place already in the stack brings that page back up
 * rather than adding another (`app/_layout.tsx`, `PLACES`).
 *
 * Yes in a browser and the desktop app, where every history entry carries the
 * whole stack: a stack that grew by a page a sidebar click made each click
 * cost more than the last.
 */
export const singularPlaces = true

/**
 * The same for a tag's, an artist's, a playlist's and a song's page, one per
 * name or id: going back and forth between a playlist and a tag from the
 * sidebar had added a page each click, kept for the tab's life — half a
 * megabyte and three more views a visit, a hundred visits on (bug bash F138).
 * Now a page already in the stack is the one brought back.
 */
export function singularPage(
  _route: string,
  params: Readonly<Record<string, unknown>>,
): string | undefined {
  const which = params['name'] ?? params['id']
  return typeof which === 'string' ? which : undefined
}

/**
 * Search, one of each: All, and each section a See all opens, which is a
 * page over All so that Back comes back to it (`SearchScreen`).
 */
export function singularSearch(_route: string, params: Readonly<Record<string, unknown>>): string {
  return typeof params['section'] === 'string' ? params['section'] : 'all'
}

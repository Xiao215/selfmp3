/**
 * Whether going to a place already in the stack brings that page back up
 * rather than adding another (`app/_layout.tsx`, `PLACES`).
 *
 * Yes in a browser and the desktop app, where every history entry carries the
 * whole stack: a stack that grew by a page a sidebar click made each click
 * cost more than the last.
 */
export const singularPlaces = true

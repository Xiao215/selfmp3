/**
 * Whether going to a place already in the stack brings that page back up
 * rather than adding another (`app/_layout.tsx`, `PLACES`).
 *
 * No on a phone, whose native stack's motion is tuned to pushes, and whose
 * pages further down draw nothing anyway (`shell/keepNearTop.tsx`).
 */
export const singularPlaces = false

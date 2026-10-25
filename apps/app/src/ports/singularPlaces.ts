/**
 * Whether going to a place already in the stack brings that page back up
 * rather than adding another (`app/_layout.tsx`, `PLACES`).
 *
 * No on a phone, whose native stack's motion is tuned to pushes, and whose
 * pages further down draw nothing anyway (`shell/keepNearTop.tsx`).
 */
export const singularPlaces = false

/** Nor a tag's, an artist's, a playlist's or a song's page: each visit pushes one. */
export const singularPage = undefined

/** Nor Search's pages. */
export const singularSearch = false

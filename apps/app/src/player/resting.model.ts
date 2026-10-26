/**
 * Resting songs, as a list starts playing (docs/features/lists.md, "Resting
 * songs"): a list played as a list passes over them, and the song whose row
 * was tapped plays whether it rests or not.
 *
 * Pure, so vitest runs it: no React, no engine.
 */

/** The list to play, and where in it to start. */
export interface ListStart {
  readonly songIds: readonly number[]
  readonly startIndex: number
}

/**
 * These songs without the resting ones. `tapped` keeps the song at
 * `startIndex` whatever it is: a row was pressed, and that song is the one
 * wanted. Otherwise the list starts at its first awake song from there. A
 * list that is all resting is played as it is, rather than not at all.
 */
export function passOverResting(
  list: ListStart,
  resting: (songId: number) => boolean,
  tapped: boolean,
): ListStart {
  const { songIds, startIndex } = list
  const chosen = songIds[startIndex]
  const kept = songIds.filter(
    (songId, index) => !resting(songId) || (tapped && index === startIndex),
  )
  if (kept.length === songIds.length || kept.length === 0) return list
  if (tapped && chosen !== undefined) return { songIds: kept, startIndex: kept.indexOf(chosen) }
  // The first awake song at or after where it was to start; the list's first when none is.
  const next = songIds.slice(startIndex).find(songId => !resting(songId))
  return { songIds: kept, startIndex: next === undefined ? 0 : kept.indexOf(next) }
}

/**
 * How the stage's lyrics keep up with the song.
 *
 * Both rules come from a seek, measured in Chrome: dragging the scrubber from
 * 5% to 70% of 夜に駆ける smooth-scrolled the words for about 1.2 s, and the
 * end of that scroll, arriving after the 700 ms allowed for it, was taken for a
 * hand scroll, so the words then stopped following the song for 4 s.
 */

/** Moving on by this many lines or fewer is the song playing; more is a seek. */
export const LYRIC_GLIDE_LINES = 1

/**
 * Whether the words glide to `to` or jump there. The song moving on to the next
 * line glides; a seek, a tapped line, or the first line shown jumps, so the
 * words are where the song is the moment it gets there.
 */
export function glideToLine(from: number, to: number): boolean {
  return from >= 0 && Math.abs(to - from) <= LYRIC_GLIDE_LINES
}

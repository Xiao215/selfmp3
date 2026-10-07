/**
 * The signatures a cloud pass compares a song's files against
 * (`cloud_songs.*_sig`; services/cloudSync.ts `#signatures`).
 *
 * Spelled here once because two places write them: the pass, from what it
 * finds on this disk, and adoption (services/cloudAdopt.ts), which records a
 * song taken from the bucket's snapshot with exactly the values the pass will
 * work out for a song with no file here — so the song reads as unchanged and
 * nothing is sent again. Drift between the two would upload every adopted
 * song on every pass, or never.
 */

/** No file of this kind here: no cover, no curve, no words. */
export const NO_FILE_SIGNATURE = 'none'

/** The audio file as its row describes it: size and modification time. */
export function audioSignature(sizeBytes: number, mtimeMs: number): string {
  return `${sizeBytes}-${mtimeMs}`
}

/** Words kept in the audio file's own tags, which change exactly when the audio does. */
export function tagsLyricsSignature(audio: string): string {
  return `tags-${audio}`
}

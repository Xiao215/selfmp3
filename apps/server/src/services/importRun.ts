import { fromSqliteTime, type ImportRun } from '@selfmp3/shared'

/**
 * How long a song takes when nothing paces it: reading YouTube's page, the
 * download, lyrics, saving and the upload, measured at about ten seconds on a
 * home connection (2026-10-01). Only the first few songs of a run are told
 * from this; after that the run's own finishes say.
 */
const SONG_MS = 10_000

/** A gap longer than this between two finishes is a pause, not a song's length. */
const PAUSE_GAP_MS = 10 * 60_000

/** How many of the latest finishes the pace is read from. */
const RECENT = 10

/**
 * The queue's progress (`ImportRunSchema`): how many of the run are in, of
 * how many, and about how long the rest will take.
 *
 * The time a song takes is read from the run itself once it has finished a
 * few — the average gap between its latest finishes, leaving out any gap long
 * enough to be a pause — since what decides it is the pacing, the connection
 * and the bucket, none of which the server can see from here. Before that it
 * is the pacing's interval, or `SONG_MS` where the pacing allows faster.
 */
export function importRun(
  facts: { open: number; moving: number; finishes: readonly string[] } | null,
  budgetPerHour: number,
): ImportRun | null {
  if (!facts) return null
  const done = facts.finishes.length
  const total = done + facts.open
  if (facts.moving === 0) return { done, total, leftMs: null }

  const times = facts.finishes.slice(-(RECENT + 1)).map(fromSqliteTime)
  const gaps = times
    .slice(1)
    .map((time, index) => time - (times[index] ?? time))
    .filter(gap => gap >= 0 && gap <= PAUSE_GAP_MS)
  const paced = budgetPerHour > 0 ? 3_600_000 / budgetPerHour : SONG_MS
  const perSong =
    gaps.length >= 2
      ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
      : Math.max(paced, SONG_MS)
  return { done, total, leftMs: Math.round(perSong * facts.moving) }
}

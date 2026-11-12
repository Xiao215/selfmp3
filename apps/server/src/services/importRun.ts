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
 * The rest takes the longer of two things. One is the work: the run's own
 * pace once it has finished a few — the average gap between its latest
 * finishes, leaving out any gap long enough to be a pause, since what decides
 * it is the connection and the bucket, none of which the server can see from
 * here — and before that `SONG_MS` a song, `concurrency` at a time. The other
 * is the waiting songs' turns at YouTube, `turnsMs` (`turnsWaitMs` in
 * ytBudget.ts): the turns the bucket holds already go at once, and only the
 * ones past them wait on the pacing, after which the last song still takes
 * its `SONG_MS`. Charging every song a whole pacing interval instead told a
 * 26-song album it had hours left when a full bucket let all of it go at
 * once, and then minutes as soon as three songs were in.
 */
export function importRun(
  facts: { open: number; moving: number; finishes: readonly string[] } | null,
  pace: { turnsMs: number; concurrency: number },
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
  const perSong =
    gaps.length >= 2
      ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
      : SONG_MS / Math.max(1, pace.concurrency)
  const workMs = perSong * facts.moving
  const turnsMs = pace.turnsMs > 0 ? pace.turnsMs + SONG_MS : 0
  return { done, total, leftMs: Math.round(Math.max(workMs, turnsMs, SONG_MS)) }
}

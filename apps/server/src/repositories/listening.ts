/**
 * The arithmetic the listening pages share: Stats (`stats.ts`) and Wrapped
 * (`wrapped.ts`) count the same plays the same way, so a streak or a number of
 * minutes reads the same on both.
 */

/** Milliseconds as minutes, to one decimal. */
export function toMinutes(ms: number | null): number {
  return Math.round(((ms ?? 0) / 60_000) * 10) / 10
}

/** Whole days between two YYYY-MM-DD strings, ignoring time zones and DST. */
export function dayGap(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY
  return Math.round((b - a) / 86_400_000)
}

/**
 * Runs of consecutive dates in a sorted, distinct list of YYYY-MM-DD: the
 * longest, and the one the list ends on.
 */
export function runs(dates: readonly string[]): { longest: number; last: number } {
  if (dates.length === 0) return { longest: 0, last: 0 }
  let longest = 1
  let run = 1
  for (let i = 1; i < dates.length; i++) {
    run = dayGap(dates[i - 1]!, dates[i]!) === 1 ? run + 1 : 1
    if (run > longest) longest = run
  }
  return { longest, last: run }
}

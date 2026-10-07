/**
 * How long an answer counts as fresh, by name rather than as a literal in each
 * hook. Freshness is rarely what keeps a screen right — an edit invalidates
 * what it reaches (queries.ts) — so these are about how often a screen that is
 * merely being looked at asks again.
 */
export const STALE = {
  tenSeconds: 10_000,
  halfMinute: 30_000,
  minute: 60_000,
  fiveMinutes: 5 * 60_000,
  tenMinutes: 10 * 60_000,
  hour: 60 * 60_000,
} as const

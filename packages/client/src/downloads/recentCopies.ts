/**
 * Songs kept because they were played: the budget, with nothing to store them in.
 *
 * A browser on a cloud library streams from the bucket and keeps nothing by
 * default, which is right for a library of a thousand songs and wrong for the
 * twenty actually played. So a song that counts as a play is kept, up to a
 * budget, and the least recently played copies are let go to make room. Moved
 * from the web app's `offline/recentCache.ts`; where the copies live is the
 * app's (`ports/recentCopies.web.ts`).
 *
 * These are a cache, not downloads: they stay out of "on this device", because
 * a mark that can disappear on its own is worse than none, and asking for the
 * song by hand turns its copy into a download.
 */

/**
 * At most this much, however roomy the device: a cache, not a second library.
 *
 * Every song kept is one not fetched again, and a bucket bills egress at a few
 * times what storage costs, so the ceiling is generous. It is not the real
 * guard against filling a device; the share below is.
 */
export const RECENT_BUDGET_BYTES = 2 * 1024 * 1024 * 1024

/** And at most this share of what the browser will give the origin in total. */
const RECENT_SHARE = 0.25

/** The budget on a device whose quota the browser states, and on one that will not. */
export function budgetFor(quota: number | null): number {
  if (quota === null || !Number.isFinite(quota) || quota <= 0) return RECENT_BUDGET_BYTES
  return Math.min(RECENT_BUDGET_BYTES, Math.floor(quota * RECENT_SHARE))
}

export interface RecentCopy {
  readonly songId: number
  /** When it was last played, as epoch milliseconds. */
  readonly playedAt: number
  readonly bytes: number
}

/**
 * Which copies to let go: least recently played first, until the rest fit.
 *
 * Ties break on the id so two tabs deciding at the same moment decide the same
 * way, and the one playing now is the newest, so it is the last thing taken.
 */
export function toEvict(copies: readonly RecentCopy[], budget: number): number[] {
  let total = copies.reduce((sum, copy) => sum + copy.bytes, 0)
  if (total <= budget) return []
  const going: number[] = []
  const oldestFirst = [...copies].sort((a, b) => a.playedAt - b.playedAt || a.songId - b.songId)
  for (const copy of oldestFirst) {
    if (total <= budget) break
    going.push(copy.songId)
    total -= copy.bytes
  }
  return going
}

/** The kept list as stored: song id to when it was last played. Anything malformed is dropped. */
export function parseKept(raw: string | null): Map<number, number> {
  const kept = new Map<number, number>()
  if (!raw) return kept
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return kept
    for (const [id, playedAt] of Object.entries(parsed as Record<string, unknown>)) {
      const songId = Number(id)
      if (Number.isInteger(songId) && typeof playedAt === 'number') kept.set(songId, playedAt)
    }
  } catch {
    // Half-written or foreign: start again.
  }
  return kept
}

export function serialiseKept(kept: ReadonlyMap<number, number>): string {
  return JSON.stringify(Object.fromEntries(kept))
}

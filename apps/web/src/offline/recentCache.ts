import { CLOUD } from '../lib/platform.js'
import {
  cacheSong,
  cachedBytes,
  isCached,
  offlineStorageAvailable,
  uncacheSong,
} from './audioCache.js'
import { loadExcluded, loadPrefs } from './autoDownload.js'

/**
 * Songs kept because they were listened to.
 *
 * A browser reading the bucket streams (sw.ts) and stores nothing by default,
 * which is the only sane answer for a library of a thousand songs and the
 * wrong one for the twenty actually played: a song heard all the way through
 * is one likely to be heard again, quite possibly somewhere with no signal.
 * So a song that counted as a play is kept, up to a budget, and the
 * least-recently-played copies are let go to make room.
 *
 * These copies are a cache, not downloads. They are deliberately invisible in
 * the library's "on this device" marks — a mark that can disappear on its own
 * is worse than no mark — and asking for a song by hand turns its copy into a
 * download, out of this budget's hands for good.
 */

const RECENT_KEY = 'selfmp3:recent-audio'

/**
 * At most this much, however roomy the device: a cache, not a second library.
 *
 * Every song this holds is a song not fetched again, and B2 bills egress at
 * three times what you store each month, so the ceiling wants to be generous
 * — a few hundred songs rather than a few dozen. It is not the real guard
 * against filling a device; the share below is, because it scales to what the
 * browser actually has. This only stops a desktop with tens of gigabytes free
 * from quietly mirroring the whole library, which is what this file exists to
 * prevent.
 */
export const RECENT_BUDGET_BYTES = 2 * 1024 * 1024 * 1024

/** And at most this share of what the browser will give the origin in total. */
const RECENT_SHARE = 0.25

/**
 * What the budget is on a device whose quota the browser will state, and what
 * it is on one that will not (Safari says nothing until asked for a lot).
 */
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
 * Ties break on the id so that two tabs deciding at the same moment decide
 * the same way, and the one being played right now is the newest, so it is
 * the last thing this would ever take.
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

/** The copies this device is keeping, by id, each with when it was last played. */
function load(): Map<number, number> {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (typeof parsed !== 'object' || parsed === null) return new Map()
    const kept = new Map<number, number>()
    for (const [id, playedAt] of Object.entries(parsed as Record<string, unknown>)) {
      const songId = Number(id)
      if (Number.isInteger(songId) && typeof playedAt === 'number') kept.set(songId, playedAt)
    }
    return kept
  } catch {
    return new Map()
  }
}

function save(kept: ReadonlyMap<number, number>): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    // Private browsing. The copies are still there; they just outlive the list,
    // and the next `pruneCache` sweeps them with everything else.
  }
}

/** The songs held only because they were played, so the UI can leave them out. */
export function recentIds(): Set<number> {
  return new Set(load().keys())
}

/**
 * Stop counting this song as a played-and-kept copy: it was asked for by hand
 * and is a download now, or it has been removed and there is nothing to count.
 */
export function forgetRecent(songId: number): void {
  const kept = load()
  if (kept.delete(songId)) save(kept)
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(RECENT_KEY)
  } catch {
    // As above.
  }
}

/**
 * Keep the song that just counted as a play, if this device keeps songs that
 * way at all.
 *
 * Called as the play is counted rather than at the end of the song, so the
 * copy is usually there before the track is.
 */
export async function keepRecentlyPlayed(songId: number): Promise<void> {
  // Only where songs come from the bucket. Reaching the Mac, this device
  // either holds the files already or is mirroring them on purpose.
  if (!CLOUD || !offlineStorageAvailable()) return
  // Downloading everything anyway: nothing here to second-guess.
  if (loadPrefs().auto) return
  // Taken off this device by hand. Playing it is not asking for it back.
  if (loadExcluded().has(songId)) return

  try {
    const kept = load()
    if (await isCached(songId)) {
      // One of ours, played again: it is the newest now. Somebody's download:
      // not this budget's business, and not to be touched.
      if (kept.has(songId)) {
        kept.set(songId, Date.now())
        save(kept)
      }
      return
    }

    await cacheSong(songId)
    kept.set(songId, Date.now())
    await trim(kept)
  } catch {
    // Storage full, a quota refusal, the bucket unreachable: the song played
    // regardless, and the next time it does this tries again.
  }
}

/** Let go of the oldest copies until the rest fit, and write down what is left. */
async function trim(kept: Map<number, number>): Promise<void> {
  const bytes = await cachedBytes(kept.keys())
  const copies: RecentCopy[] = []
  for (const [songId, playedAt] of kept) {
    const size = bytes.get(songId)
    // Gone already — the browser evicted it under pressure, or another tab
    // did. A copy that is not there is not this list's to remember.
    if (size === undefined) kept.delete(songId)
    else copies.push({ songId, playedAt, bytes: size })
  }

  for (const songId of toEvict(copies, budgetFor(await quotaBytes()))) {
    await uncacheSong(songId)
    kept.delete(songId)
  }
  save(kept)
}

async function quotaBytes(): Promise<number | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  try {
    const { quota } = await navigator.storage.estimate()
    return quota ?? null
  } catch {
    return null
  }
}

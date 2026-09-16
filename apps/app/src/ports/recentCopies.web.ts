import { budgetFor, parseKept, serialiseKept, toEvict, type RecentCopy } from '@selfmp3/client'
import {
  cachedBytes,
  cacheSong,
  isCached,
  offlineStorageAvailable,
  uncacheSong,
} from './offline.web'
import { prefs } from './prefs'

/**
 * Songs kept because they were played, in a browser: built over the same
 * audio cache downloads use, so the service worker serves a kept copy exactly
 * as it serves a download.
 *
 * The rules for when to keep one are the caller's (`DownloadsProvider`: only a
 * cloud library, not a song removed by hand); this only keeps, trims and lists.
 */

const RECENT_KEY = 'recent-audio'

function load(): Map<number, number> {
  return parseKept(prefs.get(RECENT_KEY))
}

function save(kept: ReadonlyMap<number, number>): void {
  prefs.set(RECENT_KEY, serialiseKept(kept))
}

/** The songs held only because they were played, so "on this device" can leave them out. */
export function recentIds(): ReadonlySet<number> {
  return new Set(load().keys())
}

/** Asked for by hand, or removed: no longer this budget's to count. */
export function forgetRecent(songIds: readonly number[]): void {
  const kept = load()
  let changed = false
  for (const songId of songIds) changed = kept.delete(songId) || changed
  if (changed) save(kept)
}

export function clearRecent(): void {
  prefs.set(RECENT_KEY, '{}')
}

/**
 * Keep the song that just counted as a play.
 *
 * Called as the play is counted, not at the end, so the copy is usually there
 * before the track is. A song already kept by hand is somebody's download and
 * not touched; one of ours played again becomes the newest.
 */
export async function keepRecentlyPlayed(songId: number): Promise<void> {
  if (!offlineStorageAvailable()) return
  try {
    const kept = load()
    if (await isCached(songId)) {
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
    // regardless, and the next play tries again.
  }
}

/** Let go of the oldest copies until the rest fit, and write down what is left. */
async function trim(kept: Map<number, number>): Promise<void> {
  const bytes = await cachedBytes(kept.keys())
  const copies: RecentCopy[] = []
  for (const [songId, playedAt] of kept) {
    const size = bytes.get(songId)
    // Gone already: evicted by the browser under pressure, or by another tab.
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

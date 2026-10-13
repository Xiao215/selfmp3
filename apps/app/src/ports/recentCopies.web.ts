import type { Song } from '@selfmp3/shared'
import { budgetFor, parseKept, serialiseKept, toEvict, type RecentCopy } from '@selfmp3/client'
import {
  cachedBytes,
  cacheSong,
  isCached,
  offlineStorageAvailable,
  uncacheSong,
} from './offline.web'
import { desktopRecentCopies } from './desktop/recentCopies.desktop'
import { prefs } from './prefs'

/**
 * Songs kept because they were played, in a browser: built over the same
 * audio cache downloads use, so the service worker serves a kept copy exactly
 * as it serves a download. The installed desktop app, whose `app://` page has
 * no Cache API, keeps files through the shell instead (`recentCopies.desktop.ts`).
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
function browserRecentIds(): ReadonlySet<number> {
  return new Set(load().keys())
}

/**
 * Never an address of its own: a kept copy is in the audio cache, and the
 * service worker answers the song's ordinary address from it. A phone, which
 * keeps files, has one to give (the twin).
 */
function browserRecentUri(_song: Pick<Song, 'id' | 'path'> | undefined): string | null {
  return null
}

/**
 * Asked for by hand: the copy stays where it is and stops being the budget's.
 * It is already in the cache downloads use, so it simply becomes one.
 */
function browserPromoteRecent(songIds: readonly number[]): void {
  browserForgetRecent(songIds)
}

/** Asked for by hand, or removed: no longer this budget's to count. */
function browserForgetRecent(songIds: readonly number[]): void {
  const kept = load()
  let changed = false
  for (const songId of songIds) changed = kept.delete(songId) || changed
  if (changed) save(kept)
}

function browserClearRecent(): void {
  prefs.set(RECENT_KEY, '{}')
}

/**
 * Keep the song that just counted as a play.
 *
 * Called as the play is counted, not at the end, so the copy is usually there
 * before the track is. A song already kept by hand is somebody's download and
 * not touched; one of ours played again becomes the newest.
 */
async function browserKeepRecentlyPlayed({ id: songId }: Pick<Song, 'id' | 'path'>): Promise<void> {
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

const browserRecentCopies = {
  recentIds: browserRecentIds,
  recentUri: browserRecentUri,
  promoteRecent: browserPromoteRecent,
  forgetRecent: browserForgetRecent,
  clearRecent: browserClearRecent,
  keepRecentlyPlayed: browserKeepRecentlyPlayed,
}

const chosen: typeof browserRecentCopies = desktopRecentCopies ?? browserRecentCopies

export const recentIds = chosen.recentIds
export const recentUri = chosen.recentUri
export const promoteRecent = chosen.promoteRecent
export const forgetRecent = chosen.forgetRecent
export const clearRecent = chosen.clearRecent
export const keepRecentlyPlayed = chosen.keepRecentlyPlayed

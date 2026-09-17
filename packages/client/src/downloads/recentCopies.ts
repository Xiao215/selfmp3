/**
 * Songs kept because they were played: the budget, with nothing to store them in.
 *
 * A browser on a cloud library streams from the bucket and keeps nothing by
 * default, which is right for a library of a thousand songs and wrong for the
 * twenty actually played. So a song that counts as a play is kept, up to a
 * budget, and the least recently played copies are let go to make room. Where
 * the copies live is the app's (`ports/recentCopies.web.ts`).
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

/**
 * The budget on a device that keeps files, which states free space, not a quota.
 *
 * The same quarter, of what would be free if this cache were empty — so the
 * budget does not shrink as the cache fills, which would have every new copy
 * evicting one only because the last copy was kept. A phone with 40 GB free
 * gets the full ceiling; one with 2 GB free keeps about twenty songs, and one
 * that is nearly full keeps the song that is playing and little else, which is
 * what somebody who has run out of room would choose.
 */
export function budgetForDisk(freeBytes: number | null, heldBytes: number): number {
  if (freeBytes === null || !Number.isFinite(freeBytes) || freeBytes < 0) return RECENT_BUDGET_BYTES
  return Math.min(RECENT_BUDGET_BYTES, Math.floor((freeBytes + heldBytes) * RECENT_SHARE))
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

/**
 * A copy kept as a file, which has to remember more than when it was played.
 *
 * A browser's copies are found by song id in a cache it can ask the size of. A
 * file is found by its name, and a song's name on disk comes from its path in
 * the bucket (`fileNameFor`) — which is only known while the song is still in
 * the library. Written down here, a copy can be sized, played and deleted
 * after its song has gone, rather than being left on the disk with nothing
 * that remembers it is there.
 */
export interface KeptFile {
  readonly playedAt: number
  readonly fileName: string
  readonly bytes: number
}

/** The file-backed kept list as stored. Anything malformed is dropped, as above. */
export function parseKeptFiles(raw: string | null): Map<number, KeptFile> {
  const kept = new Map<number, KeptFile>()
  if (!raw) return kept
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return kept
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const songId = Number(id)
      if (!Number.isInteger(songId) || typeof value !== 'object' || value === null) continue
      const { playedAt, fileName, bytes } = value as Record<string, unknown>
      if (typeof playedAt !== 'number' || typeof bytes !== 'number') continue
      // A name is joined to a folder and deleted: nothing with a separator in it.
      if (typeof fileName !== 'string' || !/^[\w.-]+$/.test(fileName)) continue
      kept.set(songId, { playedAt, fileName, bytes })
    }
  } catch {
    // Half-written or foreign: start again.
  }
  return kept
}

export function serialiseKeptFiles(kept: ReadonlyMap<number, KeptFile>): string {
  return JSON.stringify(Object.fromEntries(kept))
}

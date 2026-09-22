import { MotionSchema, type Motion } from '@selfmp3/shared'
import { deleteStoredPrefix, readStored, writeStored } from '../ports/idbStore.web'

/**
 * The browser's copy of each song's motion curve: one IndexedDB record per
 * song. See `motionCache.ts`, and `lyricsCache.web.ts`, which this mirrors.
 */

const KEY_PREFIX = 'motion-'

/**
 * Songs whose curve this page has written or read back whole, so the catch-up
 * pass asking after every downloaded song on every library change is a set
 * lookup once a song is known to be kept. Only what is known to be there.
 */
const kept = new Set<number>()

/** Whether a song's curve is kept: the catch-up pass asks for every downloaded song. */
export async function hasCachedMotion(songId: number): Promise<boolean> {
  if (kept.has(songId)) return true
  return (await readCachedMotion(songId)) !== null
}

export async function readCachedMotion(songId: number): Promise<Motion | null> {
  try {
    const stored = (await readStored(`${KEY_PREFIX}${songId}`)) as { motion?: unknown } | null
    if (!stored) return null
    const parsed = MotionSchema.safeParse(stored.motion)
    if (!parsed.success) return null
    kept.add(songId)
    return parsed.data
  } catch {
    return null
  }
}

export function writeCachedMotion(songId: number, motion: Motion): void {
  void writeStored(`${KEY_PREFIX}${songId}`, { savedAt: Date.now(), motion }).then(
    () => kept.add(songId),
    () => undefined,
  )
}

/**
 * Forget them all: signing out, where another account's ids would collide and
 * a song's visuals would follow another song's curve. The set first, so nothing
 * asked meanwhile is told the curve is still here.
 */
export async function clearCachedMotion(): Promise<void> {
  kept.clear()
  await deleteStoredPrefix(KEY_PREFIX)
}

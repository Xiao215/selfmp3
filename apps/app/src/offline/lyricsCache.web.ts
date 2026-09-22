import { LyricsResponseSchema, type LyricsResponse } from '@selfmp3/shared'
import { deleteStoredPrefix, readStored, writeStored } from '../ports/idbStore.web'

/**
 * The browser's copy of each song's words: one IndexedDB record per song.
 * See `lyricsCache.ts`.
 */

const KEY_PREFIX = 'lyrics-'

/**
 * Songs whose words this page has written or read back whole. The catch-up
 * pass asks after every downloaded song on every library change, and an
 * IndexedDB record has to be read and validated to be sure of — once a song is
 * known to be kept, asking again is a set lookup. Only what is known to be
 * there: a record that is missing or stale is read, and fetched, again.
 */
const kept = new Set<number>()

/** Whether a song's words are kept: the catch-up pass asks for every downloaded song. */
export async function hasCachedLyrics(songId: number): Promise<boolean> {
  if (kept.has(songId)) return true
  return (await readCachedLyrics(songId)) !== null
}

export async function readCachedLyrics(songId: number): Promise<LyricsResponse | null> {
  try {
    const stored = (await readStored(`${KEY_PREFIX}${songId}`)) as { lyrics?: unknown } | null
    if (!stored) return null
    const parsed = LyricsResponseSchema.safeParse(stored.lyrics)
    if (!parsed.success) return null
    kept.add(songId)
    return parsed.data
  } catch {
    return null
  }
}

export function writeCachedLyrics(songId: number, lyrics: LyricsResponse): void {
  void writeStored(`${KEY_PREFIX}${songId}`, { savedAt: Date.now(), lyrics }).then(
    () => kept.add(songId),
    () => undefined,
  )
}

/**
 * Forget them all: signing out, where another account's ids would collide —
 * its song 12 would open on this account's song 12's words. The set first, so
 * nothing asked meanwhile is told the words are still here.
 */
export async function clearCachedLyrics(): Promise<void> {
  kept.clear()
  await deleteStoredPrefix(KEY_PREFIX)
}

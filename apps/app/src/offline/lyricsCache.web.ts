import { LyricsResponseSchema, type LyricsResponse } from '@selfmp3/shared'
import { readStored, writeStored } from '../ports/idbStore.web'

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

/** The store lists no keys; the records are small and go with the site's data. */
export function clearCachedLyrics(): void {
  kept.clear()
}

import { LyricsResponseSchema, type LyricsResponse } from '@selfmp3/shared'
import { readStored, writeStored } from '../ports/idbStore.web'

/**
 * The browser's copy of each song's words: one IndexedDB record per song.
 * See `lyricsCache.ts`.
 */

const KEY_PREFIX = 'lyrics-'

/** Whether a song's words are kept: the catch-up pass asks for every downloaded song. */
export async function hasCachedLyrics(songId: number): Promise<boolean> {
  return (await readCachedLyrics(songId)) !== null
}

export async function readCachedLyrics(songId: number): Promise<LyricsResponse | null> {
  try {
    const stored = (await readStored(`${KEY_PREFIX}${songId}`)) as { lyrics?: unknown } | null
    if (!stored) return null
    const parsed = LyricsResponseSchema.safeParse(stored.lyrics)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeCachedLyrics(songId: number, lyrics: LyricsResponse): void {
  void writeStored(`${KEY_PREFIX}${songId}`, { savedAt: Date.now(), lyrics }).catch(
    () => undefined,
  )
}

/** The store lists no keys; the records are small and go with the site's data. */
export function clearCachedLyrics(): void {}

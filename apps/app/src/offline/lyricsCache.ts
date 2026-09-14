import { Directory, File, Paths } from 'expo-file-system'
import { LyricsResponseSchema, type LyricsResponse } from '@selfmp3/shared'

/**
 * Each song's words, on disk beside its file.
 *
 * A song kept for the plane wants its lyrics on the plane too. One small file
 * per song, written after every successful fetch — and when a song's download
 * finishes — and read only when the server cannot be reached.
 */

const CACHE_DIRECTORY = 'lyrics'

function cacheDirectory(): Directory {
  return new Directory(Paths.document, CACHE_DIRECTORY)
}

function cacheFile(songId: number): File {
  return new File(cacheDirectory(), `${songId}.json`)
}

/** Whether a song's words are kept, without reading them: the catch-up pass asks for every song. */
export async function hasCachedLyrics(songId: number): Promise<boolean> {
  try {
    return cacheFile(songId).exists
  } catch {
    return false
  }
}

export async function readCachedLyrics(songId: number): Promise<LyricsResponse | null> {
  const file = cacheFile(songId)
  if (!file.exists) return null
  try {
    const parsed = LyricsResponseSchema.safeParse(JSON.parse(await file.text()))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeCachedLyrics(songId: number, lyrics: LyricsResponse): void {
  try {
    cacheDirectory().create({ intermediates: true, idempotent: true })
    cacheFile(songId).write(JSON.stringify(lyrics))
  } catch {
    // A cache that cannot be written is words that need the server, not a failure.
  }
}

/** Forget them all: signing out, where another account's ids would collide. */
export function clearCachedLyrics(): void {
  try {
    const directory = cacheDirectory()
    if (directory.exists) directory.delete()
  } catch {
    // Nothing to clear.
  }
}

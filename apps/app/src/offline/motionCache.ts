import { Directory, File, Paths } from 'expo-file-system'
import { MotionSchema, type Motion } from '@selfmp3/shared'

/**
 * Each song's motion curve, on disk beside its file.
 *
 * What Now Playing's visuals follow on the phone, where nothing can listen to
 * the music live. A song kept for the plane wants its visuals moving with it
 * there too: one small file per song (about 13 KB for four minutes), written
 * after every successful fetch and when a song's download starts, and read
 * only when the server cannot be reached. See `lyricsCache.ts`, which this
 * mirrors.
 */

const CACHE_DIRECTORY = 'motion'

function cacheDirectory(): Directory {
  return new Directory(Paths.document, CACHE_DIRECTORY)
}

function cacheFile(songId: number): File {
  return new File(cacheDirectory(), `${songId}.json`)
}

/** Whether a song's curve is kept, without reading it: the catch-up pass asks for every song. */
export async function hasCachedMotion(songId: number): Promise<boolean> {
  try {
    return cacheFile(songId).exists
  } catch {
    return false
  }
}

export async function readCachedMotion(songId: number): Promise<Motion | null> {
  const file = cacheFile(songId)
  if (!file.exists) return null
  try {
    const parsed = MotionSchema.safeParse(JSON.parse(await file.text()))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeCachedMotion(songId: number, motion: Motion): void {
  try {
    cacheDirectory().create({ intermediates: true, idempotent: true })
    cacheFile(songId).write(JSON.stringify(motion))
  } catch {
    // A curve that cannot be kept is a visual that follows the tempo offline, not a failure.
  }
}

/** Forget them all: signing out, where another account's ids would collide. */
export function clearCachedMotion(): void {
  try {
    const directory = cacheDirectory()
    if (directory.exists) directory.delete()
  } catch {
    // Nothing to clear.
  }
}

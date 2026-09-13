import { File, Paths } from 'expo-file-system'
import { LibrarySchema, type Library } from '@selfmp3/shared'

/**
 * The last library payload, on disk.
 *
 * `GET /api/library` is the whole library in one response, so caching it is
 * one file and the app opens with a full, browsable library on a plane. It is
 * written after every successful fetch and read once at launch.
 *
 * Parsed back through the same zod schema on read: a cache written by an older
 * build of the app is exactly the kind of thing that would otherwise crash on
 * a field that has since changed shape.
 */

const CACHE_FILE_NAME = 'library.json'

function cacheFile(): File {
  return new File(Paths.document, CACHE_FILE_NAME)
}

export async function readCachedLibrary(): Promise<Library | null> {
  const file = cacheFile()
  if (!file.exists) return null
  try {
    const parsed = LibrarySchema.safeParse(JSON.parse(await file.text()))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Forget it: signing out, where another account's library would reuse the same ids. */
export function clearCachedLibrary(): Promise<void> {
  try {
    const file = cacheFile()
    if (file.exists) file.delete()
  } catch {
    // Nothing to clear.
  }
  return Promise.resolve()
}

export function writeCachedLibrary(library: Library): void {
  try {
    cacheFile().write(JSON.stringify(library))
  } catch {
    // A cache that cannot be written is a slower cold start, not a failure.
  }
}

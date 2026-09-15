import { LibrarySchema, type Library } from '@selfmp3/shared'
import { deleteStored, readStored, writeStored } from '../ports/idbStore.web'

/**
 * The last library payload, in a browser: a snapshot kept in IndexedDB.
 *
 * The phone's file (`libraryCache.ts`) writes through expo-file-system, which a
 * browser does not have, so until this file the web build never kept the
 * library and could not open one it had seen with no network.
 *
 * Failures are swallowed on purpose: a private window, a full disk or a quota
 * refusal is a slower cold start, never a failure to work online.
 */

const LIBRARY_KEY = 'library-snapshot'

export async function readCachedLibrary(): Promise<Library | null> {
  try {
    const stored = (await readStored(LIBRARY_KEY)) as { library?: unknown } | null
    if (!stored) return null
    // Parsed rather than trusted: a snapshot written by an older build may lack
    // fields the app now assumes.
    const parsed = LibrarySchema.safeParse(stored.library)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeCachedLibrary(library: Library): void {
  void writeStored(LIBRARY_KEY, { savedAt: Date.now(), library }).catch(() => undefined)
}

/** Forget it: signing out, where another account's library would reuse the same ids. */
export async function clearCachedLibrary(): Promise<void> {
  try {
    await deleteStored(LIBRARY_KEY)
  } catch {
    // Nothing to clear.
  }
}

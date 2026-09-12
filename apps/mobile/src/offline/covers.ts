import { Directory, File, Paths } from 'expo-file-system'
import { library, nativePlatform, session as cloudSession } from '../cloud'

/**
 * Cover art from the bucket, as files this phone can hand to the OS.
 *
 * Artwork cannot be fetched the way everything else is. `Image` and the
 * lock-screen player are handed a URL and given no chance to attach a header,
 * while the doorman reads the bearer header and nothing else — so a cover has
 * to be on the device before it can be shown at all. Which is why, until this
 * existed, every song from the bucket fell back to the coloured first-letter
 * tile: not a design, an absence.
 *
 * Kept in the cache directory and named by the hash already in the key, so two
 * songs sharing an album share one file, nothing ever goes stale, and the OS
 * may reclaim the lot without anything being lost.
 */

const CACHE = new Directory(Paths.cache, 'covers')

/** Resolved covers by song id, so a list that re-renders does not re-ask. */
const known = new Map<number, string | null>()
/** In-flight fetches, so ten rows appearing at once make one request. */
const fetching = new Map<number, Promise<string | null>>()

/** Whoever wants to know when a cover arrives — the list, mostly. */
const listeners = new Set<() => void>()

export function onCoversChanged(run: () => void): () => void {
  listeners.add(run)
  return () => listeners.delete(run)
}

function announce(): void {
  for (const run of listeners) run()
}

/** What this device holds right now, as something a screen can keep in state. */
export function coversNow(): ReadonlyMap<number, string> {
  const found = new Map<number, string>()
  for (const [songId, uri] of known) if (uri) found.set(songId, uri)
  return found
}

/**
 * Make sure a song's cover is on this device, and say where.
 *
 * Safe to call for every visible row on every render: a resolved cover is
 * answered from memory, and a request already in flight is joined rather than
 * repeated.
 */
export async function ensureCover(songId: number): Promise<string | null> {
  if (known.has(songId)) return known.get(songId) ?? null
  const already = fetching.get(songId)
  if (already) return already

  const work = (async (): Promise<string | null> => {
    try {
      const key = await library.cloudCoverKey(songId)
      if (!key) return null

      if (!CACHE.exists) CACHE.create({ intermediates: true })
      // `covers/4f1c….jpg` → `4f1c….jpg`: the hash is already the name.
      const file = new File(CACHE, key.slice(key.lastIndexOf('/') + 1))
      if (file.exists) return file.uri

      const signedIn = await cloudSession.loadSession()
      if (!signedIn) return null

      // `downloadFileAsync`, not a `DownloadTask`. A task is the right shape
      // for a song — progress, pause, resume — but on iOS it defaults to a
      // *background* URLSession, which is for a few large transfers that
      // outlive the app, not thirteen small ones started in the same frame.
      // Thirteen of them failed as one: `UnableToDownloadException: unknown
      // error`. A cover is one small GET and wants nothing but the bytes.
      //
      // `idempotent` because the name is the hash of the contents: the same
      // file twice is the same file, and racing to write it is not an error.
      const written = await File.downloadFileAsync(
        `${nativePlatform.doormanUrl}/v1/files/${key}`,
        file,
        { headers: { Authorization: `Bearer ${signedIn.token}` }, idempotent: true },
      )
      return written.exists ? written.uri : null
    } catch (error) {
      // A missing cover is survivable — the letter tile is behind it — but it
      // should not be silent: swallowing this is what made an expo-file-system
      // mistake look like "the bucket has no artwork" for an hour.
      console.warn(
        `self.mp3: could not fetch a cover for song ${songId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return null
    }
  })()

  fetching.set(songId, work)
  const uri = await work
  fetching.delete(songId)
  known.set(songId, uri)
  if (uri) announce()
  return uri
}

/** After signing out: another account's ids mean other songs. */
export function forgetCovers(): void {
  known.clear()
  fetching.clear()
  try {
    if (CACHE.exists) CACHE.delete()
  } catch {
    // Nothing to clear.
  }
}

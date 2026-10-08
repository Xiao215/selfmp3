import { Directory, File, Paths } from 'expo-file-system'
import { createCoverStore, isPicture, parseServedName, type CoverPlatform } from './coverStore'

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
 * What to do about a cover is offline/coverStore.ts, shared with the web twin.
 * This is where the bytes go: two directories, and expo-file-system.
 */

/**
 * Every cover this phone keeps, in the document directory rather than the
 * cache the OS may reclaim: a cover is part of the library — a song not
 * downloaded is still drawn with its picture — and one reclaimed could only
 * come back as another read from the bucket. A bucket's covers and artists'
 * pictures are named by the hash already in their key, so two songs sharing
 * an album share one file and nothing ever goes stale; the library's own
 * sweep (`sweepPictures`) deletes those it no longer names. A server's are
 * named by song and revision, so new art replaces old.
 */
const STORE = new Directory(Paths.document, 'covers')

/**
 * Where a bucket's covers were kept before they were kept for good: moved into
 * `STORE` once, on the first launch that finds them, rather than fetched again.
 */
// TODO(after the phones have launched once): drop this and `moved`.
const OLD_CACHE = new Directory(Paths.cache, 'covers')

const moved: Promise<void> = (async () => {
  try {
    if (!OLD_CACHE.exists) return
    STORE.create({ intermediates: true, idempotent: true })
    for (const entry of OLD_CACHE.list()) {
      if (!(entry instanceof File)) continue
      if (new File(STORE, entry.name).exists) entry.delete()
      else await entry.move(STORE)
    }
    OLD_CACHE.delete()
  } catch {
    // What could not be moved is fetched again when it is next drawn.
  }
})()

const platform: CoverPlatform = {
  // A phone always has somewhere to put a cover.
  canKeep: () => true,

  // Synchronous, which is the point: `coverFor()` knows the kept covers on the
  // very first read, before a row has drawn a letter tile in their place.
  prime: found => {
    try {
      if (!STORE.exists) return
      for (const entry of STORE.list()) {
        const served = parseServedName(entry.name)
        if (served && entry instanceof File) found(served.songId, served.rev, entry.uri)
      }
    } catch {
      // Nothing kept, or nothing readable: the server is asked as before.
    }
  },

  haveCloud: async name => {
    await moved
    const file = new File(STORE, name)
    return file.exists ? file.uri : null
  },

  // The same look, synchronous: expo-file-system's `exists` is. While the old
  // cache is still being moved it may not find one, and `haveCloud` will.
  peekCloud: name => {
    const file = new File(STORE, name)
    return file.exists ? file.uri : null
  },

  listCloud: async () => {
    await moved
    if (!STORE.exists) return []
    return STORE.list().flatMap(entry => (entry instanceof File ? [entry.name] : []))
  },

  removeCloud: name => {
    const file = new File(STORE, name)
    if (file.exists) file.delete()
    return Promise.resolve()
  },

  // `downloadFileAsync`, not a `DownloadTask`. A task is the right shape for a
  // song — progress, pause, resume — but on iOS it defaults to a *background*
  // URLSession, which is for a few large transfers that outlive the app, not
  // thirteen small ones started in the same frame. Thirteen of them failed as
  // one: `UnableToDownloadException: unknown error`. A cover is one small GET
  // and wants nothing but the bytes.
  //
  // `idempotent` because the name is the hash of the contents: the same file
  // twice is the same file, and racing to write it is not an error.
  keepCloud: async (name, url, headers) => {
    await moved
    STORE.create({ intermediates: true, idempotent: true })
    const written = await File.downloadFileAsync(url, new File(STORE, name), {
      headers,
      idempotent: true,
    })
    return written.exists ? written.uri : null
  },

  keepServed: async (name, url) => {
    if (!STORE.exists) STORE.create({ intermediates: true, idempotent: true })
    const file = new File(STORE, name)
    if (!file.exists) {
      const written = await File.downloadFileAsync(url, file, { idempotent: true })
      if (!written.exists) return null
    }
    return file.uri
  },

  forgetFiles: async () => {
    await moved
    if (STORE.exists) STORE.delete()
  },
}

/** Whether this device keeps covers at all. A phone always does. */
export const keepsCovers = true

/**
 * The covers this phone still holds, newest first, for Welcome to show a
 * device that signed in before (docs/ui-mock `P02`).
 *
 * The folder, read as files rather than through the store: the store only
 * knows a cloud cover once a row has asked for it this launch, and Welcome is
 * drawn before any row. Newest first so the fan is what was played lately,
 * not whichever album sorts first.
 */
export async function keptCovers(limit: number): Promise<readonly string[]> {
  await moved
  try {
    const files: File[] = []
    if (STORE.exists) {
      for (const entry of STORE.list()) {
        if (entry instanceof File && isPicture(entry.name)) files.push(entry)
      }
    }
    files.sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0))
    return files.slice(0, limit).map(file => file.uri)
  } catch {
    // Nothing kept, or nothing readable: Welcome draws its tiles.
    return []
  }
}

export const {
  subscribeCovers,
  coversVersion,
  coverFor,
  coverFailed,
  ensureServerCover,
  ensureCover,
  subscribePictures,
  picturesVersion,
  pictureFor,
  ensurePicture,
  sweepPictures,
  forgetCovers,
} = createCoverStore(platform)
export { KEPT_COVER_SIZE } from './coverStore'

import { Directory, File, Paths } from 'expo-file-system'
import { createCoverStore, type CoverPlatform } from './coverStore'

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
 * Cloud covers, in the cache directory and named by the hash already in the
 * key, so two songs sharing an album share one file, nothing ever goes stale,
 * and the OS may reclaim the lot without anything being lost.
 */
const CACHE = new Directory(Paths.cache, 'covers')

/**
 * A server's covers, kept beside the songs in the document directory rather than
 * in the cache the OS may reclaim: a song downloaded for the plane wants its
 * picture on the plane too. Named by song and revision, so new art replaces old.
 */
const STORE = new Directory(Paths.document, 'covers')

const platform: CoverPlatform = {
  // A phone always has somewhere to put a cover.
  canKeep: () => true,

  // Synchronous, which is the point: `coverFor()` knows the kept covers on the
  // very first read, before a row has drawn a letter tile in their place.
  prime: found => {
    try {
      if (!STORE.exists) return
      for (const entry of STORE.list()) {
        const match = /^(\d+)-(.*)\.jpg$/.exec(entry.name)
        if (match && entry instanceof File) {
          found(Number(match[1]), match[2] ?? '', entry.uri)
        }
      }
    } catch {
      // Nothing kept, or nothing readable: the server is asked as before.
    }
  },

  haveCloud: name => {
    if (!CACHE.exists) CACHE.create({ intermediates: true })
    const file = new File(CACHE, name)
    return Promise.resolve(file.exists ? file.uri : null)
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
    const written = await File.downloadFileAsync(url, new File(CACHE, name), {
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

  forgetFiles: () => {
    if (CACHE.exists) CACHE.delete()
    if (STORE.exists) STORE.delete()
    return Promise.resolve()
  },
}

const store = createCoverStore(platform)

/** Whether this device keeps covers at all. A phone always does. */
export const keepsCovers = true

/** A cover's file, whatever the bucket's picture was: a cloud cover keeps its own extension. */
const PICTURE = /\.(jpe?g|png|webp|gif)$/i

/**
 * The covers this phone still holds, newest first, for Welcome to show a
 * device that signed in before (docs/ui-mock `P02`).
 *
 * Both folders, read as files rather than through the store: the store only
 * knows a cloud cover once a row has asked for it this launch, and Welcome is
 * drawn before any row. Newest first so the fan is what was played lately,
 * not whichever album sorts first.
 */
export function keptCovers(limit: number): Promise<readonly string[]> {
  try {
    const files: File[] = []
    for (const dir of [CACHE, STORE]) {
      if (!dir.exists) continue
      for (const entry of dir.list()) {
        if (entry instanceof File && PICTURE.test(entry.name)) files.push(entry)
      }
    }
    files.sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0))
    return Promise.resolve(files.slice(0, limit).map(file => file.uri))
  } catch {
    // Nothing kept, or nothing readable: Welcome draws its tiles.
    return Promise.resolve([])
  }
}

export const subscribeCovers = store.subscribeCovers
export const coversVersion = store.coversVersion
export const coverFor = store.coverFor
export const ensureServerCover = store.ensureServerCover
export const ensureCover = store.ensureCover
export const forgetCovers = store.forgetCovers
export { KEPT_COVER_SIZE } from './coverStore'

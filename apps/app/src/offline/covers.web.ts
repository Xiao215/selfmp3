import { API_CACHE } from '../../sw/names'
import { bucketPictureAddress } from '../ports/bucketMedia'
import { coverFiles } from '../ports/coverFiles'
import { namesDigest } from './coverPacks'
import {
  createCoverStore,
  fanOfCovers,
  parseServedName,
  type CoverPlatform,
  type PackSink,
} from './coverStore'

/**
 * Cover art from the bucket, for the platforms Metro calls web: the installed
 * app, and an ordinary tab.
 *
 * The reason is the same one offline/covers.ts gives for a phone. `Image` and
 * the media session are handed a URL and given no chance to attach a header,
 * while the doorman reads the bearer header and nothing else — so a cover has
 * to be on this device, under a URL of its own, before it can be shown at all.
 *
 * In the installed app it is: `coverFiles` puts it in the shell's covers folder
 * and `app://selfmp3/_media/covers/…` serves it back. In a tab there is no such
 * place, so `coverFiles` is null and `canKeep` is false: the service worker
 * attaches the header and draws each cover from an address of its own
 * (sw/sw.ts), and a server's covers are drawn from the server's. What a tab
 * does keep is what the packs bring (`tabPictures`).
 *
 * What to do about a cover is offline/coverStore.ts, shared with the phone.
 */

/**
 * Where a tab puts the pictures of a pack of covers: the service worker's
 * covers cache, under the `api/bucket/<key>` address it answers a bucket
 * picture at, which is where it looks for a song's cover before the bucket
 * (sw/sw.ts). A tab keeps no files, but with this a cloud library's covers
 * are a few reads for the whole library rather than one a row. Null where no
 * worker answers those addresses.
 *
 * Kept, they are let go by the rules a computer's folder is: the sweep takes
 * the pictures the library no longer names, and signing out takes them all
 * (`remove`, `forget`) — the worker keeps one version of a song's cover, but
 * never looks back at a picture under its key.
 */
interface TabPictures extends PackSink {
  readonly remove: (name: string) => Promise<void>
  readonly forget: () => Promise<void>
}

function tabPictures(): TabPictures | null {
  if (typeof caches === 'undefined' || bucketPictureAddress('covers/') === null) return null
  const addressOf = (name: string): string =>
    new URL(bucketPictureAddress(`covers/${name}`) ?? '', location.origin).href
  const have = async (): Promise<readonly string[]> => {
    const cache = await caches.open(API_CACHE)
    const prefix = addressOf('')
    return (await cache.keys()).flatMap(request =>
      request.url.startsWith(prefix) ? [request.url.slice(prefix.length)] : [],
    )
  }
  return {
    have,
    unpack: async (url, headers, slices) => {
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`the bucket answered ${response.status}`)
      const pack = new Uint8Array(await response.arrayBuffer())
      const cache = await caches.open(API_CACHE)
      for (const slice of slices) {
        if (slice.at + slice.size > pack.length) continue
        const bytes = pack.slice(slice.at, slice.at + slice.size)
        if (!namesDigest(slice.name, await crypto.subtle.digest('SHA-256', bytes))) continue
        await cache.put(
          addressOf(slice.name),
          new Response(bytes, { headers: { 'content-type': pictureType(slice.name) } }),
        )
      }
    },
    remove: async name => {
      await (await caches.open(API_CACHE)).delete(addressOf(name))
    },
    forget: async () => {
      const cache = await caches.open(API_CACHE)
      for (const name of await have()) await cache.delete(addressOf(name))
    },
  }
}

/** What a picture's extension says it is, for the worker to answer it with. */
function pictureType(name: string): string {
  const extension = name.slice(name.lastIndexOf('.') + 1)
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  return `image/${extension}`
}

/** A tab's, where there is no folder to keep covers in. */
const tab = coverFiles ? null : tabPictures()

const platform: CoverPlatform = {
  canKeep: () => coverFiles !== null,

  // The listing is a shell call rather than a directory read, so what it finds
  // arrives after this returns and the store announces it instead of the first
  // read simply having it.
  prime: found => {
    const files = coverFiles
    if (!files) return
    void (async () => {
      try {
        for (const name of await files.list()) {
          const served = parseServedName(name)
          if (served) found(served.songId, served.rev, files.uriFor(name))
        }
      } catch {
        // Nothing kept, or nothing readable: the server is asked as before.
      }
    })()
  },

  // The name is the hash of the contents, so a file already there is the right
  // file and nothing goes stale.
  haveCloud: async name => {
    const files = coverFiles
    if (!files) return null
    return (await files.has(name)) ? files.uriFor(name) : null
  },

  listCloud: async () => (coverFiles ? coverFiles.list() : ((await tab?.have()) ?? [])),

  removeCloud: async name => {
    await (coverFiles ?? tab)?.remove(name)
  },

  keepCloud: async (name, url, headers) => {
    const files = coverFiles
    if (!files) return null
    await files.keep(name, url, headers)
    return files.uriFor(name)
  },

  keepServed: async (name, url) => {
    const files = coverFiles
    if (!files) return null
    if (!(await files.has(name))) await files.keep(name, url)
    return files.uriFor(name)
  },

  forgetFiles: async () => {
    await (coverFiles ?? tab)?.forget()
  },

  packs: coverFiles
    ? {
        have: () => coverFiles?.list() ?? Promise.resolve([]),
        unpack: async (url, headers, slices) => {
          await coverFiles?.unpack(url, headers, slices)
        },
      }
    : (tab ?? undefined),
}

/**
 * Whether this device keeps covers at all: the installed app does, and a tab,
 * which draws each cover from its own address, does not.
 */
export const keepsCovers = coverFiles !== null

/**
 * The covers this device still holds, for Welcome to show a device that signed
 * in before (docs/ui-mock `P02`). The installed app lists its covers folder; a
 * tab keeps none, and Welcome draws its tiles there.
 *
 * In the folder's order: the shell's listing carries no dates, and which few
 * covers come back matters less than that they are the person's own.
 */
export async function keptCovers(limit: number): Promise<readonly string[]> {
  const files = coverFiles
  if (!files) return []
  try {
    return fanOfCovers(await files.list(), limit).map(name => files.uriFor(name))
  } catch {
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
  keepLent,
  holdPictures,
  sweepPictures,
  fillFromPacks,
  forgetCovers,
} = createCoverStore(platform)
export { KEPT_COVER_SIZE } from './coverStore'

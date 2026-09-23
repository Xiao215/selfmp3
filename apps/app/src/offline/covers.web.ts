import { coverFiles } from '../ports/coverFiles'
import { createCoverStore, type CoverPlatform } from './coverStore'

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
 * place, so `coverFiles` is null, `canKeep` is false, and every export here
 * becomes the nothing a browser has always done — a cloud library's rows keep
 * their letter tiles, and a server's covers are drawn from the server's own
 * address, which needs no file.
 *
 * What to do about a cover is offline/coverStore.ts, shared with the phone.
 */

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
          const match = /^(\d+)-(.*)\.jpg$/.exec(name)
          if (!match) continue
          found(Number(match[1]), match[2] ?? '', files.uriFor(name))
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
    await coverFiles?.forget()
  },
}

const store = createCoverStore(platform)

/**
 * Whether this device keeps covers at all: the installed app does, and a tab,
 * which draws each cover from its own address, does not.
 */
export const keepsCovers = coverFiles !== null

/** A cover's file, whatever the bucket's picture was: a cloud cover keeps its own extension. */
const PICTURE = /\.(jpe?g|png|webp|gif)$/i

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
    const names = (await files.list()).filter(name => PICTURE.test(name))
    return names.slice(0, limit).map(name => files.uriFor(name))
  } catch {
    return []
  }
}

export const subscribeCovers = store.subscribeCovers
export const coversVersion = store.coversVersion
export const coverFor = store.coverFor
export const ensureServerCover = store.ensureServerCover
export const ensureCover = store.ensureCover
export const forgetCovers = store.forgetCovers
export { KEPT_COVER_SIZE } from './coverStore'

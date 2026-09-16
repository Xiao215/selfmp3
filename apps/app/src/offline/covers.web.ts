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

export const subscribeCovers = store.subscribeCovers
export const coversVersion = store.coversVersion
export const coversNow = store.coversNow
export const coverFor = store.coverFor
export const ensureServerCover = store.ensureServerCover
export const ensureCover = store.ensureCover
export const forgetCovers = store.forgetCovers
export { KEPT_COVER_SIZE } from './coverStore'

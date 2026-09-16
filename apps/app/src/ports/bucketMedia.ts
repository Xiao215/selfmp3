import type { MediaRoutes } from '../api/mediaAddress.model'

/**
 * Addresses this platform can have answered from the bucket, for a library
 * that came from there.
 *
 * Null on a phone, and that is the whole answer. The doorman reads a bearer
 * header and nothing else, while the OS audio player and the lock screen are
 * handed a URL with no chance to attach one — so a phone cannot fetch a song
 * or a cover by address at all. It has files instead: a cloud song is
 * downloaded first (`playBlock` refuses to play an installed app's
 * undownloaded cloud song for exactly this reason) and played from disk, and
 * its cover is fetched with the header and kept (src/offline/covers.ts).
 *
 * A browser has somewhere to put the header: its own service worker. That is
 * the web twin.
 */
export const bucketMedia: MediaRoutes | null = null

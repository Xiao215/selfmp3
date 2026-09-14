import type { CoverFiles } from './coverFiles'
import { desktop } from './desktop/bridge'

export type { CoverFiles }

/**
 * The installed app's covers, kept beside its songs.
 *
 * An ordinary tab answers null: the Cache API could hold the bytes, but not
 * under a URL an `<img>` can be handed without a fetch first, and the service
 * worker that would do that is the one the desktop deliberately does not
 * register. So this is the desktop's, and a browser keeps drawing the server's
 * address as it always has.
 */
function filesFor(bridge: NonNullable<typeof desktop>): CoverFiles {
  return {
    uriFor: name => bridge.mediaUrl('covers', name),
    has: async name => (await bridge.files.stat('covers', name)) !== null,
    keep: (name, url, headers) => bridge.files.fetchTo('covers', name, url, headers),
    list: async () => (await bridge.files.list('covers')).map(one => one.name),
    forget: () => bridge.files.clear('covers'),
  }
}

export const coverFiles: CoverFiles | null = desktop ? filesFor(desktop) : null

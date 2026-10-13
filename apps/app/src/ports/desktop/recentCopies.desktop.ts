import type { DesktopBridge, FileKind } from '@selfmp3/desktop-bridge'

import { createRecentCopies, type RecentCopies } from '../recentCopyFiles'
import { desktop } from './bridge'

/**
 * Songs kept because they were played, in the installed desktop app: files in
 * the shell's `recent` folder, kept by the phone's rules (`recentCopyFiles.ts`)
 * through the bridge.
 *
 * The browser's way, the Cache API, does not work on the app's own `app://`
 * page, so without this a computer signed in to the cloud fetched the same
 * songs from the bucket every day.
 *
 * A folder of its own, apart from `songs`, so a copy never counts as "on this
 * computer" and Settings' usage leaves it out. Asking for the song by hand
 * moves its copy into `songs` (`adoptRecent`) instead of fetching it again.
 */

const KIND = 'recent'

/** A transfer id the shell can be told to cancel. */
let nextId = 0

function copiesOver(bridge: DesktopBridge): RecentCopies<FileKind> {
  return createRecentCopies<FileKind>({
    // The note is trusted between launches: nothing but this writes the folder,
    // and the shell cannot be asked synchronously for every song in a queue.
    address: fileName => bridge.mediaUrl(KIND, fileName),
    has: async fileName => (await bridge.files.stat(KIND, fileName)) !== null,
    list: async () => (await bridge.files.list(KIND)).map(file => file.name),
    async fetch(fileName, url, headers) {
      const result = await bridge.files.download({
        id: `recent-${++nextId}`,
        kind: KIND,
        name: fileName,
        url,
        ...(headers ? { headers } : {}),
      })
      return result.state === 'done' ? result.bytes : null
    },
    move: async (fileName, destination) =>
      (await bridge.files.move(KIND, destination, fileName))?.bytes ?? null,
    delete: fileName => void bridge.files.delete(KIND, fileName).catch(() => undefined),
    clear: () => void bridge.files.clear(KIND).catch(() => undefined),
    async free() {
      try {
        return (await bridge.files.usage()).free
      } catch {
        return null
      }
    },
  })
}

/** Null outside the installed app, where a browser keeps its copies in the Cache API. */
export const desktopRecentCopies = desktop ? copiesOver(desktop) : null

import { Directory, File, Paths } from 'expo-file-system'

import { createRecentCopies } from './recentCopyFiles'

/**
 * Songs kept because they were played, on a phone: files in the cache folder.
 *
 * A phone streams a cloud song it has not downloaded (`ports/bucketMedia.ts`),
 * which is the point of a phone short of room — and would mean fetching the
 * same twenty songs from the bucket every day. So a song that counts as a play
 * is kept, up to a budget, and the least recently played copies are let go to
 * make room. The rules are the desktop's too (`recentCopyFiles.ts`); this is
 * only where the files are.
 *
 * These are a cache, not downloads, and live apart from them on purpose:
 *
 *  - In the OS's cache folder, not the documents one. The system may clear it
 *    when the phone is full, which is exactly what should happen to a copy
 *    nobody asked for, and it is left out of the device's backup.
 *  - Out of the download index, so they never count as "on this device": a mark
 *    that can disappear on its own is worse than none. Asking for the song by
 *    hand turns its copy into a download (`adoptRecent`).
 *
 * The rules for when to keep one are the caller's (`DownloadsProvider`: only a
 * cloud library, not a song removed by hand).
 */

const RECENT_DIRECTORY = 'recent-songs'
/** A copy still arriving. Never played and never counted: only a whole file is renamed into place. */
const PARTIAL_SUFFIX = '.part'

function directory(): Directory {
  return new Directory(Paths.cache, RECENT_DIRECTORY)
}

function remove(file: File): void {
  try {
    if (file.exists) file.delete()
  } catch {
    // Already gone, which is what was wanted.
  }
}

const copies = createRecentCopies<File>({
  /**
   * Asks the disk rather than trusting the note: the system clears this folder
   * without telling anyone, and a `file://` address with nothing behind it
   * would be played as silence in place of a song that could have streamed.
   */
  address(fileName) {
    const file = new File(directory(), fileName)
    return file.exists ? file.uri : null
  },

  has: fileName => Promise.resolve(new File(directory(), fileName).exists),

  list() {
    const dir = directory()
    if (!dir.exists) return Promise.resolve([])
    return Promise.resolve(
      dir
        .list()
        .map(entry => entry.name)
        .filter(name => !name.endsWith(PARTIAL_SUFFIX)),
    )
  },

  /** The whole file, or nothing: fetched beside its name and renamed once complete. */
  async fetch(fileName, url, headers) {
    directory().create({ intermediates: true, idempotent: true })
    const file = new File(directory(), fileName)
    const partial = new File(directory(), `${fileName}${PARTIAL_SUFFIX}`)
    if (partial.exists) partial.delete()
    try {
      const task = File.createDownloadTask(url, partial, {
        ...(headers ? { headers } : {}),
        // Foreground, for the reason the download queue gives (downloadStorage.ts).
        sessionType: 'foreground',
      })
      const finished = await task.downloadAsync()
      if (finished === null) return null
      if (file.exists) file.delete()
      await partial.move(file)
      return file.size ?? finished.size ?? 0
    } finally {
      if (partial.exists) partial.delete()
    }
  },

  async move(fileName, destination) {
    const file = new File(directory(), fileName)
    if (!file.exists) return null
    const bytes = file.size ?? 0
    await file.move(destination)
    return bytes
  },

  delete: fileName => remove(new File(directory(), fileName)),

  clear() {
    try {
      const dir = directory()
      if (dir.exists) dir.delete()
    } catch {
      // Nothing to clear, or not ours to: the emptied note is what stops it being used.
    }
  },

  free() {
    try {
      return Promise.resolve(Paths.availableDiskSpace)
    } catch {
      return Promise.resolve(null)
    }
  },
})

export const {
  recentIds,
  recentUri,
  promoteRecent,
  forgetRecent,
  clearRecent,
  keepRecentlyPlayed,
  adoptRecent,
} = copies

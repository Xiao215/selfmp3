import { Directory, File, Paths } from 'expo-file-system'
import { fileNameFor } from '@selfmp3/client'
import type { Song } from '@selfmp3/shared'

import { createRecentCopies } from './recentCopyFiles'
import { songStream, streamsOnce } from './songStream'

/**
 * Songs kept because they were played, on a phone: files in the cache folder.
 *
 * A phone streams a cloud song it has not downloaded (`ports/bucketMedia.ts`),
 * which is the point of a phone short of room — and would mean fetching the
 * same twenty songs from the bucket every day. So a played song is kept, up to
 * a budget, and the least recently played copies are let go to make room. The
 * rules are the desktop's too (`recentCopyFiles.ts`); this is only where the
 * files are.
 *
 * The stream is what fills this folder (`streamOnce`): the player is pointed at
 * the app's own loopback server (`songStream.ts`), which downloads the song
 * once, whole, into here and answers every range from it. The copy is kept the
 * moment it is all here, as played when it was asked for, whether or not the
 * play goes on to count — the bytes came anyway, over Wi-Fi or mobile data
 * alike — and a fetch of the song, for the play counting or for the next song
 * ahead of time, joins that one download rather than starting another.
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
 * cloud library, not a song removed by hand — including while its stream was
 * still arriving, `forgetRecent`).
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

/** The songs the loopback server has been asked for, by file name: what it says arrived is told by name. */
const streaming = new Map<string, Pick<Song, 'id' | 'path'>>()

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

  /**
   * The whole file, or nothing, through the loopback server: the song
   * streaming now, or about to, is the same download, not a second. The
   * server fetches beside the name and renames once complete. A file not named
   * by its hash is not a bucket song's, and the doorman would refuse its key.
   */
  fetch(fileName, url, headers) {
    if (!streamsOnce(fileName)) return Promise.resolve(null)
    directory().create({ intermediates: true, idempotent: true })
    return songStream.fetch(fileName, url, headers ?? {}, directory().uri)
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
    // A download still arriving would put its song back in the emptied folder,
    // and an address the player still holds would go on relaying with the
    // bearer it was named with: the server forgets both, and so does this.
    songStream.stopAll()
    streaming.clear()
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

songStream.addListener('onArrived', ({ name, bytes }) => {
  const song = streaming.get(name)
  if (song) void copies.arrived(song, bytes)
})

/**
 * Where the player is to ask for a bucket song that is not here: the loopback
 * server's address, which brings it into this folder in one download — or
 * null where the server cannot listen, or the song's file is not named by its
 * hash, and the player is to ask the doorman itself. Kept, once whole, as
 * played now (`streaming`), not when it lands.
 */
export function streamOnce(
  song: Pick<Song, 'id' | 'path'>,
  url: string,
  headers: Readonly<Record<string, string>>,
): string | null {
  const fileName = fileNameFor(song)
  if (!streamsOnce(fileName)) return null
  streaming.set(fileName, song)
  copies.streaming(song.id)
  return songStream.address(fileName, url, headers, directory().uri)
}

export const {
  recentIds,
  recentUri,
  promoteRecent,
  forgetRecent,
  clearRecent,
  keepRecentlyPlayed,
  adoptRecent,
} = copies

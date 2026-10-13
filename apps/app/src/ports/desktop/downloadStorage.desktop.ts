import type { Song } from '@selfmp3/shared'
import {
  fileNameFor,
  parseIndex,
  type DownloadIndex,
  type DownloadStorage,
  type ServerConnection,
} from '@selfmp3/client'

import { transferInto, type TransferFiles } from '../downloadTransfer'
import { desktop } from './bridge'
import { desktopRecentCopies } from './recentCopies.desktop'

/**
 * Where the installed desktop app keeps songs: files on disk, beside a JSON
 * index — the phone's arrangement, through the bridge.
 *
 * The browser's storage is the Cache API: written whole, not resumable, and the
 * browser's to evict. This is neither of those things. A download interrupted
 * at 40% continues from the `.part` with a `Range:`, and
 * `~/Library/Application Support/self.mp3/songs` is nobody's to reclaim.
 *
 * The *index* is the page's, kept where the phone keeps it — a JSON document,
 * here written through `files` — so `parseIndex` and `DownloadIndex` from
 * `packages/client` are reused exactly as they are. Which songs are kept is the
 * index's to say, and it can be, because unlike a cache nothing removes a file
 * behind the app's back. The steps of one song's transfer, words and cover
 * included, are the phone's too (`downloadTransfer.ts`).
 */

const INDEX_NAME = 'downloads.json'
/** The songs, and the index with them: it is a file like any other. */
const SONGS = 'songs'

let connection: ServerConnection | null = null

/** A transfer id the shell can be told to cancel. */
let nextId = 0

/** The desktop's half of a transfer (`downloadTransfer.ts` has the steps). */
function filesFor(song: Song): TransferFiles {
  const bridge = desktop
  if (!bridge) throw new Error('no desktop bridge')
  const id = `song-${song.id}-${++nextId}`

  return {
    adopt: async () => (await desktopRecentCopies?.adoptRecent(song, SONGS)) ?? null,

    async download(url, headers, onProgress) {
      const stop = bridge.onProgress(progress => {
        if (progress.id === id) {
          onProgress({ bytesWritten: progress.bytesWritten, totalBytes: progress.totalBytes })
        }
      })
      try {
        const result = await bridge.files.download({
          id,
          kind: SONGS,
          name: fileNameFor(song),
          url,
          ...(headers ? { headers } : {}),
        })
        // `null` is the port's "stopped, not failed"; the queue resumes it.
        return result.state === 'done' ? result.bytes : null
      } finally {
        stop()
      }
    },

    // The `.part` stays behind on a pause, and the shell continues it with a
    // `Range:` when the transfer runs again — which is the whole difference
    // between this and the browser's storage.
    resume: () => null,

    pause() {
      void bridge.files.cancel(id)
    },

    cancel() {
      void bridge.files.cancel(id)
    },
  }
}

export const downloadStorage: DownloadStorage = {
  available: true,
  resumable: true,

  configure(next: ServerConnection | null) {
    connection = next
  },

  async readIndex(): Promise<DownloadIndex | null> {
    if (!desktop) return null
    try {
      const url = desktop.mediaUrl(SONGS, INDEX_NAME)
      const response = await fetch(url)
      if (!response.ok) return null
      return parseIndex(await response.json())
    } catch {
      return null
    }
  },

  async writeIndex(index) {
    if (!desktop) return
    /*
     * Through `files.write`, which is the shell's channel for the page's own
     * text — not a `blob:` URL handed to `fetchTo`: it is the *main* process
     * that fetches, and a blob URL belongs to the renderer that created it, so
     * the main process cannot read one at all (`net::ERR_UNKNOWN_URL_SCHEME`).
     */
    await desktop.files.write(SONGS, INDEX_NAME, JSON.stringify(index))
  },

  localUri(entry) {
    // What makes the player play from disk: `streamAddress` prefers this over
    // the stream URL, and the shell answers it with a proper 206 so seeking works.
    return desktop ? desktop.mediaUrl(SONGS, entry.fileName) : null
  },

  begin(song, _expectedBytes, onProgress) {
    return transferInto(song, connection, filesFor(song), onProgress)
  },

  discard(song) {
    void desktop?.files.delete(SONGS, fileNameFor(song))
  },

  async delete(entry) {
    // Awaited, and its rejection passed on: the shell's `rm` is forced, so it
    // fails only when the file genuinely would not go, and that is the one
    // case the queue must hear about to keep the entry.
    await desktop?.files.delete(SONGS, entry.fileName)
  },

  async clear() {
    if (!desktop) return
    await desktop.files.clear(SONGS)
  },
}

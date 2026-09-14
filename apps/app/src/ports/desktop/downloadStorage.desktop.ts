import type { Song } from '@selfmp3/shared'
import {
  fileNameFor,
  parseIndex,
  type DownloadIndex,
  type DownloadStorage,
  type DownloadTransfer,
  type ServerConnection,
  type TransferProgress,
} from '@selfmp3/client'

import { mediaUrlFor } from '../../api/client'
import { cloudPlatform, session as cloudSession } from '../../cloud'
import { desktop } from './bridge'

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
 * behind the app's back.
 */

const INDEX_NAME = 'downloads.json'
/** The index is a file like any other, so it lives with the songs. */
const INDEX_KIND = 'songs'

let connection: ServerConnection | null = null

/** A transfer id the shell can be told to cancel. */
let nextId = 0

/**
 * Where a song's bytes come from: the phone's rule, unchanged.
 *
 * The bucket through the doorman when this device is signed in, with a bearer
 * header — the doorman reads nothing else, and `song.path` is already the key.
 * Otherwise a Mac, where the token rides in the query string because the same
 * URL is handed to the player.
 */
async function sourceFor(song: Song): Promise<{ url: string; headers?: Record<string, string> }> {
  const signedIn = await cloudSession.loadSession().catch(() => null)
  if (signedIn) {
    return {
      url: `${cloudPlatform.doormanUrl}/v1/files/${song.path}`,
      headers: { Authorization: `Bearer ${signedIn.token}` },
    }
  }
  if (!connection) throw new Error('no server, and not signed in to the cloud')
  return { url: mediaUrlFor(connection).stream(song.id) }
}

function transferFor(
  song: Song,
  onProgress: (progress: TransferProgress) => void,
): DownloadTransfer {
  const bridge = desktop
  if (!bridge) throw new Error('no desktop bridge')

  const id = `song-${song.id}-${++nextId}`
  const name = fileNameFor(song)
  let cancelled = false

  return {
    async run() {
      if (cancelled) throw new Error('cancelled')
      const from = await sourceFor(song)
      if (cancelled) throw new Error('cancelled')

      const stop = bridge.onProgress(progress => {
        if (progress.id === id) {
          onProgress({ bytesWritten: progress.bytesWritten, totalBytes: progress.totalBytes })
        }
      })
      try {
        const result = await bridge.files.download({
          id,
          kind: 'songs',
          name,
          url: from.url,
          ...(from.headers ? { headers: from.headers } : {}),
        })
        // `null` is the port's "stopped, not failed"; the queue resumes it.
        return result.state === 'done' ? result.bytes : null
      } finally {
        stop()
      }
    },

    pause() {
      // The `.part` stays behind, and `run()` again continues from it — which
      // is the whole difference between this and the browser's storage.
      void bridge.files.cancel(id)
    },

    cancel() {
      cancelled = true
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
      const url = desktop.mediaUrl(INDEX_KIND, INDEX_NAME)
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
     * Written through `fetchTo` from a `blob:` URL rather than a channel of its
     * own. The shell already knows how to put a fetched body in a file, and a
     * blob URL is same-process and costs no copy through IPC; adding a
     * `files.write` would be a second way to put bytes on disk, and a second
     * thing to get the atomic rename right in.
     */
    const blob = new Blob([JSON.stringify(index)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    try {
      await desktop.files.fetchTo(INDEX_KIND, INDEX_NAME, url)
    } finally {
      URL.revokeObjectURL(url)
    }
  },

  localUri(entry) {
    // What makes the player play from disk: `tracks.ts` prefers this over the
    // stream URL, and the shell answers it with a proper 206 so seeking works.
    return desktop ? desktop.mediaUrl('songs', entry.fileName) : null
  },

  begin(song, _expectedBytes, onProgress) {
    return transferFor(song, onProgress)
  },

  discard(song) {
    void desktop?.files.delete('songs', fileNameFor(song))
  },

  delete(entry) {
    void desktop?.files.delete('songs', entry.fileName)
  },

  async clear() {
    if (!desktop) return
    await desktop.files.clear('songs')
  },
}

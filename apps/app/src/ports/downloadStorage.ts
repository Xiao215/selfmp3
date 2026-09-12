import { Directory, File, Paths, type DownloadProgress, type DownloadTask } from 'expo-file-system'
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

import { mediaUrlFor } from '../api/client'
import { nativePlatform, session as cloudSession } from '../cloud'

/**
 * Where the phone keeps songs: files on disk, beside a JSON index.
 *
 * The storage half of what used to be the phone's `DownloadQueue`, moved
 * behind the `DownloadStorage` port. Ordering, pausing, progress and failure
 * are now the shared queue's, in `packages/client`; what is left here is only
 * where the bytes go and where they come from — and it is the same files, in
 * the same folder, with the same index, so a phone that already has downloads
 * keeps them.
 *
 * Resumable, which is why a transfer is an object: a paused download task
 * keeps the platform's resume data, and running it again continues the file
 * rather than starting it over.
 */

const SONGS_DIRECTORY = 'songs'
const INDEX_FILE_NAME = 'downloads.json'

function directory(): Directory {
  return new Directory(Paths.document, SONGS_DIRECTORY)
}

function indexFile(): File {
  return new File(Paths.document, INDEX_FILE_NAME)
}

let connection: ServerConnection | null = null

/**
 * Where a song's bytes come from.
 *
 * The bucket, through the doorman, when this device is signed in — with a
 * header, since that is all the doorman reads, and `song.path` is already the
 * key there. Otherwise a Mac, where the token has to ride in the query string:
 * the same URL is handed to the OS audio player, which cannot attach headers.
 */
async function sourceFor(song: Song): Promise<{ url: string; headers?: Record<string, string> }> {
  const signedIn = await cloudSession.loadSession().catch(() => null)
  if (signedIn) {
    return {
      url: `${nativePlatform.doormanUrl}/v1/files/${song.path}`,
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
  const destination = new File(directory(), fileNameFor(song))
  let task: DownloadTask | null = null
  let cancelled = false

  return {
    async run() {
      if (cancelled) throw new Error('cancelled')
      if (task !== null) {
        // Run again after a pause: continue the file.
        const resumed = await task.resumeAsync()
        return resumed === null ? null : resumed.size
      }

      if (destination.exists) destination.delete()
      const from = await sourceFor(song)
      // Called off while the source was being worked out.
      if (cancelled) throw new Error('cancelled')

      task = File.createDownloadTask(from.url, destination, {
        ...(from.headers ? { headers: from.headers } : {}),
        // Foreground, against the default. iOS's background URLSession is what
        // `createDownloadTask` reaches for, and every download failed against it
        // with `UnableToDownloadException: unknown error`. What it would buy is a
        // transfer that outlives the app being suspended; what it cost, here, was
        // every transfer. Progress, pause and resume are the task's, not the
        // session's, and all still work.
        sessionType: 'foreground',
        onProgress: ({ bytesWritten, totalBytes }: DownloadProgress) =>
          onProgress({ bytesWritten, totalBytes }),
      })
      const finished = await task.downloadAsync()
      return finished === null ? null : finished.size
    },

    pause() {
      // A task that has already stopped throws when asked to stop again.
      if (task !== null && task.state !== 'paused') task.pause()
    },

    cancel() {
      cancelled = true
      task?.cancel()
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
    directory().create({ intermediates: true, idempotent: true })
    const file = indexFile()
    if (!file.exists) return null
    try {
      return parseIndex(JSON.parse(await file.text()))
    } catch {
      return null
    }
  },

  writeIndex(index) {
    try {
      indexFile().write(JSON.stringify(index))
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error('could not save the download index'),
      )
    }
  },

  localUri(entry) {
    const file = new File(directory(), entry.fileName)
    return file.exists ? file.uri : null
  },

  begin(song, _expectedBytes, onProgress) {
    return transferFor(song, onProgress)
  },

  discard(song) {
    const file = new File(directory(), fileNameFor(song))
    if (file.exists) file.delete()
  },

  delete(entry) {
    const file = new File(directory(), entry.fileName)
    if (file.exists) file.delete()
  },

  clear() {
    const dir = directory()
    if (dir.exists) dir.delete()
    dir.create({ intermediates: true, idempotent: true })
    return Promise.resolve()
  },
}

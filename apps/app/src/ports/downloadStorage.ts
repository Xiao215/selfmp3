import { Directory, File, Paths, type DownloadProgress, type DownloadTask } from 'expo-file-system'
import type { Song } from '@selfmp3/shared'
import {
  fileNameFor,
  parseIndex,
  type DownloadIndex,
  type DownloadStorage,
  type ServerConnection,
} from '@selfmp3/client'

import { transferInto, type TransferFiles } from './downloadTransfer'
import { adoptRecent } from './recentCopies'

/**
 * Where the phone keeps songs: files on disk, beside a JSON index.
 *
 * Ordering, pausing, progress and failure are the shared queue's, in
 * `packages/client`, and the steps of one song's transfer are shared with the
 * desktop (`downloadTransfer.ts`); what is left here is only where the bytes
 * go — the same files, in the same folder, with the same index, so a phone
 * that already has downloads keeps them.
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
 * The phone's half of a transfer (`downloadTransfer.ts` has the steps).
 *
 * Resumable, which is why a transfer is an object: a paused download task
 * keeps the platform's resume data, and running it again continues the file
 * rather than starting it over.
 */
function filesFor(song: Song): TransferFiles {
  const destination = new File(directory(), fileNameFor(song))
  let task: DownloadTask | null = null

  /** What an earlier attempt left under the name; a move or a download into it would fail. */
  function clearDestination(): void {
    if (destination.exists) destination.delete()
  }

  return {
    adopt() {
      clearDestination()
      return adoptRecent(song, destination)
    },

    async download(url, headers, onProgress) {
      clearDestination()
      task = File.createDownloadTask(url, destination, {
        ...(headers ? { headers } : {}),
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

    resume() {
      // Run again after a pause: continue the file.
      return task === null ? null : task.resumeAsync().then(resumed => resumed?.size ?? null)
    },

    pause() {
      // A task that has already stopped throws when asked to stop again.
      if (task !== null && task.state !== 'paused') task.pause()
    },

    cancel() {
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
    return transferInto(song, connection, filesFor(song), onProgress)
  },

  discard(song) {
    const file = new File(directory(), fileNameFor(song))
    if (file.exists) file.delete()
  },

  async delete(entry) {
    // `async` so a `delete()` that throws — a file the system will not let go
    // of — is a rejection the queue can keep the entry for, not a stray throw.
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

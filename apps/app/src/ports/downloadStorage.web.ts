import type { Song } from '@selfmp3/shared'
import {
  addEntry,
  EMPTY_INDEX,
  parseIndex,
  type DownloadIndex,
  type DownloadStorage,
  type ServerConnection,
} from '@selfmp3/client'

import { mediaUrlFor } from '../api/client'
import {
  cachedBytes,
  cachedSongIds,
  cacheSong,
  clearAudioCache,
  configureAudioCache,
  offlineStorageAvailable,
  uncacheSong,
} from './offline.web'
import { recentIds } from './recentCopies'

/**
 * Where the browser keeps songs: the Cache API, behind the service worker.
 *
 * Not resumable. A cached `Response` is written whole, so there is nothing
 * half-finished to continue; `pause()` lets the song in flight finish and the
 * shared queue stops after it — which is what the web has always done.
 *
 * **The index is two things kept apart on purpose.** Which songs are kept is
 * the cache's to say: a browser may evict them, and an index that disagreed
 * would offer to play something that is gone. What is known about each — above
 * all the etag recorded when it was fetched — is the saved index's, because
 * the cache does not have it. The earlier web queue rebuilt the whole index
 * from the cache and so lost every etag, and `staleIds` compares exactly that
 * against the manifest.
 *
 * It also no longer needs the stream URL to load. Which songs are cached is
 * read off the key's path, and a song's size or deletion wants the full URL,
 * `rev` and all — which the provider configures *after* it loads. Asking for
 * sizes first threw, and the old queue fell back to an empty index: after a
 * reload the web very likely showed nothing kept.
 */

const INDEX_KEY = 'selfmp3.downloads'

function savedIndex(): DownloadIndex | null {
  try {
    const raw = window.localStorage.getItem(INDEX_KEY)
    return raw ? parseIndex(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export const downloadStorage: DownloadStorage = {
  get available() {
    return offlineStorageAvailable()
  },
  resumable: false,

  configure(connection: ServerConnection | null, songs: readonly Song[]) {
    if (!connection) return
    const media = mediaUrlFor(connection)
    const revs = new Map(songs.map(song => [song.id, song.rev]))
    // The same URL the player asks for, which is what lets the service worker
    // answer it from the cache without the player knowing a copy exists.
    configureAudioCache({ streamUrl: songId => media.stream(songId, revs.get(songId)) })
  },

  async readIndex() {
    const saved = savedIndex()
    const present = await cachedSongIds()
    // Kept because it was played, not asked for: a cache, and not "on this device".
    const recent = recentIds()
    let index = EMPTY_INDEX
    for (const songId of present) {
      if (recent.has(songId)) continue
      const known = saved?.entries[String(songId)]
      if (known) {
        index = addEntry(index, known)
        continue
      }
      // In the cache but not in the note: kept by an earlier build, or the note
      // was cleared. Present, with what can be learned about it now.
      let sizeBytes = 0
      try {
        sizeBytes = (await cachedBytes([songId])).get(songId) ?? 0
      } catch {
        // Not configured yet; the size fills in when it is next fetched.
      }
      index = addEntry(index, {
        songId,
        fileName: String(songId),
        sizeBytes,
        etag: '',
        downloadedAt: new Date(0).toISOString(),
      })
    }
    return index
  },

  writeIndex(index) {
    try {
      window.localStorage.setItem(INDEX_KEY, JSON.stringify(index))
    } catch {
      // The cache is the truth for what is kept; only the metadata is lost.
    }
    return Promise.resolve()
  },

  localUri() {
    // The service worker intercepts the ordinary stream URL, so the player
    // never needs to know a copy was involved.
    return null
  },

  begin(song, expectedBytes, onProgress) {
    const controller = new AbortController()
    let running: Promise<number | null> | null = null
    return {
      run() {
        running ??= cacheSong(song.id, controller.signal, fraction => {
          if (fraction === null) return
          onProgress({
            bytesWritten: Math.round(fraction * (expectedBytes || 1)),
            totalBytes: expectedBytes,
          })
        })
        return running
      },
      pause() {
        // Not resumable: the song in flight finishes, and the queue stops after.
      },
      cancel() {
        controller.abort()
      },
    }
  },

  discard(song) {
    void uncacheSong(song.id).catch(() => undefined)
  },

  delete(entry) {
    void uncacheSong(entry.songId).catch(() => undefined)
  },

  clear() {
    return clearAudioCache()
  },
}

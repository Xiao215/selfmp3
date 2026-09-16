import type { Song } from '@selfmp3/shared'
import {
  addEntry,
  EMPTY_INDEX,
  parseIndex,
  type DownloadIndex,
  type DownloadStorage,
  type ServerConnection,
} from '@selfmp3/client'

import { answeringFromCloud, mediaUrlFor } from '../api/client'
import { serverRoutes, streamAddress } from '../api/mediaAddress.model'
import { bucketMedia } from './bucketMedia'
import { desktop } from './desktop/bridge'
import { downloadStorage as desktopStorage } from './desktop/downloadStorage.desktop'
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
 * shared queue stops after it.
 *
 * **The index is two things kept apart on purpose.** Which songs are kept is
 * the cache's to say: a browser may evict them, and an index that disagreed
 * would offer to play something that is gone. What is known about each — above
 * all the etag recorded when it was fetched — is the saved index's, because
 * the cache does not have it. Rebuilding the whole index from the cache would
 * lose every etag, so `staleIds` compares the saved index against the manifest
 * instead.
 *
 * It does not need the stream URL to load. Which songs are cached is read off
 * the key's path; a song's size or deletion wants the full URL, `rev` and all,
 * which the provider configures *after* it loads — asking for it too early
 * throws, and would show nothing kept after a reload.
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

const cacheStorage: DownloadStorage = {
  get available() {
    return offlineStorageAvailable()
  },
  resumable: false,

  configure(connection: ServerConnection | null, songs: readonly Song[]) {
    const server = connection ? serverRoutes(mediaUrlFor(connection)) : null
    const revs = new Map(songs.map(song => [song.id, song.rev]))
    /*
     * The same address the player asks for, which is what lets the service
     * worker answer it from the cache without the player knowing a copy
     * exists — and, for a cloud library, what makes downloading possible at
     * all. There is no server to build an address from there, and this used to
     * give up on one: `configureAudioCache` was never called, and every
     * download threw "configureAudioCache() has not been called" from inside
     * the cache. The worker fetches the bucket's file and the response is kept
     * under its own address, so playing it afterwards needs no network.
     *
     * `local` is null on purpose. A browser's copy *is* the thing this address
     * reaches; `localUri` returns null here for the same reason.
     */
    configureAudioCache({
      streamUrl: songId =>
        streamAddress(songId, revs.get(songId), {
          local: null,
          bucket: bucketMedia,
          server,
          // Read when a song is fetched rather than captured here: whether this
          // device answers from the bucket can change without the connection
          // this was configured with changing at all.
          fromCloud: answeringFromCloud(),
        }),
    })
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

/**
 * A tab caches; an installed app keeps files.
 *
 * The same `DownloadStorage` port either way, so the shared queue in
 * `packages/client` — ordering, pausing, progress, the 500 MB rule, failure —
 * is the same code on both, and neither this file nor any screen knows which
 * one it got.
 */
export const downloadStorage: DownloadStorage = desktop ? desktopStorage : cacheStorage

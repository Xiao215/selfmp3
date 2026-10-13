import { API_ERROR, type Song } from '@selfmp3/shared'
import {
  ApiError,
  type DownloadTransfer,
  type ServerConnection,
  type TransferProgress,
} from '@selfmp3/client'
import { bucketHold } from '@selfmp3/replica'

import { api, mediaUrlFor } from '../api/client'
import { ensureServerCover, KEPT_COVER_SIZE } from '../offline/covers'
import { lyricsCache, motionCache } from '../offline/caches'
import { askWhyRefused } from './bucketRefusal'
import { sourceFor } from './songSource'

/**
 * One song's download into files: the steps, for a phone (`downloadStorage.ts`)
 * and the installed desktop app (`desktop/downloadStorage.desktop.ts`) alike.
 *
 * They were two copies of the same sequence, and only the phone's kept what a
 * song needs beside its audio: a computer that downloaded a song just before
 * going offline had no words for it until the catch-up pass came round
 * (`useKeepAlongside`), which it never did offline. Now both keep the words,
 * the motion curve and a server's cover as the song arrives.
 *
 * What differs is only how bytes reach the disk, which is the platform's.
 */
export interface TransferFiles {
  /**
   * A copy of the song played lately, moved to where the download goes, and
   * its size — or null when there is none (`recentCopyFiles.ts`).
   */
  adopt(): Promise<number | null>
  /** The file and its size, or null when it stopped short (paused). Rejects when it failed. */
  download(
    url: string,
    headers: Record<string, string> | undefined,
    onProgress: (progress: TransferProgress) => void,
  ): Promise<number | null>
  /**
   * After a pause: the platform's own continuation, or null when running the
   * whole sequence again is how it continues (the desktop's shell resumes a
   * `.part` with a `Range:` from the start of `download`).
   */
  resume(): Promise<number | null> | null
  pause(): void
  /** Stop for good. Whatever `download` is waiting on rejects or resolves null. */
  cancel(): void
}

/** A song's words onto this device, or nothing when it has none. Throws when the server could not be asked. */
async function keepLyrics(song: Song): Promise<void> {
  try {
    lyricsCache.write(song.id, await api.lyrics(song.id))
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 404 || error.code === API_ERROR.instrumental)
    )
      return
    throw error
  }
}

/**
 * A song's motion curve onto this device, so its visuals follow it on the plane.
 * Never fails a download: a song not analysed yet is a 404, and a curve the
 * server could not send now is fetched by the catch-up pass (useKeepAlongside).
 */
async function keepMotion(song: Song): Promise<void> {
  try {
    motionCache.write(song.id, await api.motion(song.id))
  } catch {
    // No curve: the visual follows the tempo instead.
  }
}

export function transferInto(
  song: Song,
  connection: ServerConnection | null,
  files: TransferFiles,
  onProgress: (progress: TransferProgress) => void,
): DownloadTransfer {
  let cancelled = false

  return {
    async run() {
      if (cancelled) throw new Error('cancelled')
      const resumed = files.resume()
      if (resumed !== null) return resumed

      // The words first, and the download is not a download without them: a
      // song kept for the plane is kept with its lyrics. A song with none is a
      // 404 (or marked instrumental) and is fine; the server not answering is
      // not, and fails the download here before any of the file is fetched,
      // so the queue tries the whole thing again later.
      await keepLyrics(song)
      // Beside the words, but never in the way of the file.
      void keepMotion(song)
      // Played lately, so a copy of it may be here already, kept as a cache.
      // Asking for the song turns that copy into this download: the same
      // bytes, moved rather than fetched a second time.
      const adopted = await files.adopt().catch(() => null)
      if (adopted !== null) return adopted
      const from = await sourceFor(song, connection)
      // Called off while the source was being worked out.
      if (cancelled) throw new Error('cancelled')
      // The bucket refusing reads for the day: this one would be refused too.
      const held = from.headers ? bucketHold('read') : null
      if (held) throw new Error(held.message)

      let finished: number | null
      try {
        finished = await files.download(from.url, from.headers, onProgress)
      } catch (error) {
        // Called off: nothing went wrong, and nothing to ask the doorman.
        if (cancelled || !from.headers) throw error
        // From the bucket, the transfer says only that it failed: the doorman
        // is asked why, and a refusal for the day holds the other downloads too.
        const why = await askWhyRefused(from.url, from.headers)
        if (why === null) throw error
        throw new Error(why, { cause: error })
      }
      // A song kept for later wants its picture kept with it. The bucket's
      // covers are fetched on their own path (offline/covers.ts); a server's are
      // fetched here, while the server is known to be answering.
      if (finished !== null && song.hasArt && from.headers === undefined && connection) {
        void ensureServerCover(
          song.id,
          song.rev,
          mediaUrlFor(connection).art(song.id, song.rev, KEPT_COVER_SIZE),
        )
      }
      return finished
    },

    pause() {
      files.pause()
    },

    cancel() {
      cancelled = true
      files.cancel()
    },
  }
}

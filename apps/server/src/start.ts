import { messageOf } from '@selfmp3/shared'
import type { Container } from './container.js'
import { romanizeLibrary } from './services/romanizedLines.js'

/**
 * Set one library's background work going: presence, the import queue, the
 * folder watch, the inbox sweep, then the lyrics index and publishing, which
 * read what the sweep found. For each library a server works for, once its
 * container is made (hub/hub.ts).
 */
export function startContainer(container: Container): void {
  const { config, logger } = container

  // Presence sweep and library-version watch for the event stream.
  container.devices.start()
  container.importQueue.start()
  void container.covers.sweepThumbnails().catch((error: unknown) => {
    logger.warn('could not sweep cover thumbnails', { message: messageOf(error) })
  })
  // Covers kept as PNG or WebP from before every cover was a JPEG
  // (squareCover.ts); each one converted goes up with the next cloud pass.
  void container.covers
    .jpegKept(
      container.songs
        .all()
        .filter(song => song.hasArt)
        .map(song => song.id),
    )
    .then(converted => {
      if (converted > 0) container.bumpLibraryVersion()
    })
    .catch((error: unknown) => {
      logger.warn('making kept covers JPEGs stopped early', { message: messageOf(error) })
    })
  // Rescan on folder changes (a file dropped into the inbox) when the setting is on.
  container.libraryWatcher.apply()
  // Publishing, and any links other devices asked for while this server was off.
  const startCloud = (): void => {
    container.cloudSync.start()
    void container.cloudImports.process()
  }

  // Lyrics+: the search index, then romaji for every song with words, so a
  // phone's first request for a song's lyrics finds both already made.
  const warmLyrics = (): void => {
    void container.lyricsIndex
      .backfill()
      .then(() => romanizeLibrary(container))
      .catch((error: unknown) => {
        logger.warn('romanizing the library stopped early', {
          message: messageOf(error),
        })
      })
  }

  if (!config.scanOnBoot) {
    warmLyrics()
    startCloud()
    return
  }
  // Deliberately not awaited: the API is already serving, and a first scan of
  // a large library should not delay that.
  void container.scanner
    .scan()
    .then(result => {
      if (result.added || result.updated) container.bumpLibraryVersion()
    })
    .catch((error: unknown) => {
      logger.error('initial scan failed', {
        message: messageOf(error),
      })
    })
    // The lyrics index and publishing read what the scan found, so they wait
    // for it — however it went.
    .finally(() => {
      // Let go while it scanned (a grant taken back a moment after joining):
      // its database is closed, and nothing is left to start.
      if (container.stopped()) return
      warmLyrics()
      startCloud()
    })
}

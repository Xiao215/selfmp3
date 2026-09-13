import { formatRelative } from '@selfmp3/shared'
import type { ImportRequestView } from '@selfmp3/cloud'

/**
 * Importing into a cloud library: the web's `CloudImportView`, with nothing drawn.
 *
 * A phone or a browser on GitHub Pages cannot run yt-dlp, so a link sent from
 * one is a request in the bucket's change log. The Mac picks it up the next
 * time it is on, downloads it, and every device sees how it went.
 */

type Request = Pick<ImportRequestView, 'state' | 'songIds' | 'error' | 'requestedAt'>

/** One request's line under its title, in the web's words. */
export function describeCloudImport(item: Request, now = new Date()): string {
  switch (item.state) {
    case 'waiting':
      return `Waiting for your Mac · asked ${formatRelative(item.requestedAt, now)}`
    case 'working':
      return 'Downloading on your Mac…'
    case 'done':
      return item.songIds.length === 0
        ? 'Already in your library'
        : `Added ${item.songIds.length} song${item.songIds.length === 1 ? '' : 's'}`
    case 'failed':
      return `Couldn’t import it: ${item.error ?? 'something went wrong'}`
    case 'cancelled':
      return 'Cancelled'
  }
}

/** Only a request the Mac has not finished can still be called off. */
export const canCancelCloudImport = (item: Pick<ImportRequestView, 'state'>): boolean =>
  item.state === 'waiting' || item.state === 'working'

/** How many have finished with songs, so the library can be fetched again when it grows. */
export const finishedCloudImports = (items: readonly Pick<ImportRequestView, 'state'>[]): number =>
  items.filter(item => item.state === 'done').length

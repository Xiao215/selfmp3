import { youtubeVideoId } from '@selfmp3/shared'
import type { ImportRequestView } from '@selfmp3/cloud'

/**
 * Links asked of the server that have not reached the library yet, with nothing
 * drawn: shown at the top of a cloud library as rows that cannot play.
 *
 * The server only publishes a song once its audio is in the bucket, so until then
 * the library has nothing to show for it. What this device does have is its own
 * requests, with a title once the server has looked the link up, and for a
 * YouTube video a thumbnail that can be worked out from the link.
 */

type Request = Pick<ImportRequestView, 'uid' | 'url' | 'state' | 'title' | 'songIds' | 'error' | 'requestedAt'>

export interface PendingImport {
  readonly uid: string
  readonly title: string
  readonly thumbnail: string | null
  readonly status: string
  readonly failed: boolean
}

/** A YouTube video's thumbnail, from its link alone; null for playlists and anything else. */
export function linkThumbnail(url: string): string | null {
  const id = youtubeVideoId(url)
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null
}

/**
 * The requests worth a row, newest first. Waiting, downloading and failed ones
 * show; a finished one shows until every song it brought is in the library, so
 * there is no gap between the row leaving and the song arriving. Called-off
 * requests do not show.
 */
export function pendingImports(
  requests: readonly Request[],
  librarySongIds: ReadonlySet<number>,
): PendingImport[] {
  return [...requests]
    .filter(item => {
      if (item.state === 'cancelled') return false
      if (item.state !== 'done') return true
      return item.songIds.some(id => !librarySongIds.has(id))
    })
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .map(item => ({
      uid: item.uid,
      title: item.title ?? item.url,
      thumbnail: linkThumbnail(item.url),
      status: pendingStatus(item),
      failed: item.state === 'failed',
    }))
}

function pendingStatus(item: Request): string {
  switch (item.state) {
    case 'waiting':
      return 'Waiting for your server'
    case 'working':
      return 'Downloading on your server…'
    case 'done':
      return 'Almost ready: uploading to your library'
    case 'failed':
      return `Couldn’t import it: ${item.error ?? 'something went wrong'}`
    case 'cancelled':
      return 'Cancelled'
  }
}

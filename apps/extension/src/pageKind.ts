import {
  isYouTubeUrl,
  youtubeChannel,
  youtubeMusicAlbum,
  youtubeMusicSearch,
  youtubeVideoId,
} from '@selfmp3/shared'

/**
 * What a link opens, as far as importing goes — read from the address alone,
 * never from the page, so the popup, the worker and a test get the same answer.
 *
 * A watch page is a song whatever `list=` it carries (a radio or a playlist
 * being played through). YouTube Music turns an album's `browse/MPREb_…` link
 * into `playlist?list=OLAK5uy_…` as it opens, so both are an album.
 */
export type PageKind =
  | { readonly kind: 'song'; readonly videoId: string }
  | { readonly kind: 'playlist' }
  | { readonly kind: 'album' }
  | { readonly kind: 'artist' }
  | { readonly kind: 'search' }
  | { readonly kind: 'other' }

export function pageKind(url: string | null): PageKind {
  if (!url || !isYouTubeUrl(url)) return { kind: 'other' }
  const videoId = youtubeVideoId(url)
  if (videoId) return { kind: 'song', videoId }
  if (youtubeMusicAlbum(url)) return { kind: 'album' }

  const parsed = new URL(url)
  const list = parsed.searchParams.get('list')
  if (parsed.pathname.replace(/\/+$/, '') === '/playlist' && list) {
    return list.startsWith('OLAK5uy_') ? { kind: 'album' } : { kind: 'playlist' }
  }
  if (youtubeChannel(url)) return { kind: 'artist' }
  if (youtubeMusicSearch(url)) return { kind: 'search' }
  return { kind: 'other' }
}

/** Whether the server can read songs out of the page: one, or a list of them. */
export function importable(page: PageKind): boolean {
  return page.kind !== 'other'
}

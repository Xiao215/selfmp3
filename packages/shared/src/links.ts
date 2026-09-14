/**
 * Pulling links out of loose text.
 *
 * Used on both sides: the server accepts "one link per line" in the import
 * box, and the share sheet on a phone hands over free text like
 * "Rick Astley – Never Gonna Give You Up https://youtu.be/dQw4w9WgXcQ".
 * Both cases reduce to "find every http(s) URL in this string".
 */

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi

/** Characters a sentence tends to glue onto the end of a pasted link. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/

/**
 * Every http(s) URL in `text`, in order, de-duplicated, capped at `limit`.
 * Trailing punctuation is stripped so "see https://x.y/z." still works.
 */
export function extractUrls(text: string, limit = 20): string[] {
  const seen = new Set<string>()
  const urls: string[] = []
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, '')
    if (url.length < 10 || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
    if (urls.length >= limit) break
  }
  return urls
}

/** Liked Music on YouTube Music: a private playlist that only resolves with cookies. */
export const YT_LIKED_MUSIC_URL = 'https://music.youtube.com/playlist?list=LM'

/** True for any YouTube / YouTube Music link, in either of the two hosts and the short form. */
export function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return (
      host === 'youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtu.be' ||
      host === 'm.youtube.com'
    )
  } catch {
    return false
  }
}

/**
 * The words searched for, from a link to a YouTube Music search page —
 * `music.youtube.com/search?q=yoasobi` — or null for any other link. A search
 * is not a list of songs yt-dlp can read; YouTube Music itself is asked.
 */
export function youtubeMusicSearch(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.toLowerCase() !== 'music.youtube.com') return null
    if (parsed.pathname.replace(/\/+$/, '') !== '/search') return null
    const query = parsed.searchParams.get('q')?.trim() ?? ''
    return query.length > 0 ? query : null
  } catch {
    return null
  }
}

/**
 * An album's id from a link to its page on YouTube Music —
 * `music.youtube.com/browse/MPREb_…` — or null for any other link.
 */
export function youtubeMusicAlbum(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.toLowerCase() !== 'music.youtube.com') return null
    const [first = '', second = ''] = parsed.pathname.split('/').filter(Boolean)
    return first === 'browse' && /^MPREb_[A-Za-z0-9_-]+$/.test(second) ? second : null
  } catch {
    return null
  }
}

/**
 * A playlist's id from a link to it on either host — `playlist?list=PL…`,
 * `watch?v=…&list=PL…`, or YouTube Music's `browse/VLPL…` — or null.
 *
 * Only a made playlist (`PL…`) or an album's (`OLAK5uy_…`): Liked Music
 * (`LM`) needs a signed-in session, and a mix or radio (`RD…`) is made anew
 * each time it is opened, so both are left to yt-dlp, as is everything else.
 */
export function youtubePlaylistId(url: string): string | null {
  if (!isYouTubeUrl(url)) return null
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean)
    const fromBrowse =
      segments[0] === 'browse' && segments[1]?.startsWith('VL') ? segments[1].slice(2) : null
    const id = fromBrowse ?? parsed.searchParams.get('list')
    return id && /^(PL|OLAK5uy_)[A-Za-z0-9_-]+$/.test(id) ? id : null
  } catch {
    return null
  }
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/**
 * The video id in a link to one YouTube video, or null: `watch?v=`, the
 * `youtu.be/` short form, `/shorts/` and `/embed/`, on either host.
 */
export function youtubeVideoId(url: string | null | undefined): string | null {
  if (!url || !isYouTubeUrl(url)) return null
  const parsed = new URL(url)
  const host = parsed.hostname.toLowerCase()
  const segments = parsed.pathname.split('/').filter(Boolean)
  const candidate =
    host === 'youtu.be'
      ? segments[0]
      : segments[0] === 'shorts' || segments[0] === 'embed'
        ? segments[1]
        : parsed.searchParams.get('v')
  return candidate && VIDEO_ID.test(candidate) ? candidate : null
}

/** A YouTube channel, by its `@handle` or its `UC…` id. */
export type YouTubeChannel = { readonly handle: string } | { readonly channelId: string }

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/

/**
 * The channel a link opens at its front page — `/@handle` or `/channel/UC…`,
 * on either host — or null. A link to one of its tabs (`/videos`, `/playlists`)
 * is a list of its own and is left to yt-dlp, as is everything else.
 */
export function youtubeChannel(url: string): YouTubeChannel | null {
  if (!isYouTubeUrl(url)) return null
  let segments: string[]
  try {
    const parsed = new URL(url)
    // The short host only ever carries a video.
    if (parsed.hostname.toLowerCase() === 'youtu.be') return null
    segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }

  const [first = '', second = ''] = segments
  let channel: YouTubeChannel | null = null
  let rest: string[] = []
  if (first.length > 1 && first.startsWith('@')) {
    channel = { handle: first }
    rest = segments.slice(1)
  } else if (first === 'channel' && CHANNEL_ID.test(second)) {
    channel = { channelId: second }
    rest = segments.slice(2)
  }

  const frontPage = rest.length === 0 || (rest.length === 1 && rest[0] === 'featured')
  return frontPage ? channel : null
}

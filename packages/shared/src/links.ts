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

/**
 * The one link that stands for a video, whichever form it arrived in.
 *
 * The same video reaches us as `youtube.com/watch?v=…`,
 * `music.youtube.com/watch?v=…&list=…` and `youtu.be/…`; anything that asks
 * about a video by URL — the pill, the import queue — has to agree on which of
 * those to use, so it is spelled once here rather than at each of them.
 */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
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

// --- 网易云音乐 ---------------------------------------------------------------

/** What a 网易云音乐 link opens: one song, an album, or a playlist (a chart is one). */
export interface NeteaseLink {
  readonly kind: 'song' | 'album' | 'playlist'
  readonly id: string
}

const NETEASE_HOSTS = new Set(['music.163.com', 'y.music.163.com', 'm.music.163.com'])

/** True for a link to 网易云音乐 itself, on any of its hosts, or its short form (`163cn.tv`). */
export function isNeteaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return NETEASE_HOSTS.has(host) || host === '163cn.tv'
  } catch {
    return false
  }
}

/**
 * The song, album or playlist a 网易云音乐 link opens, or null.
 *
 * The same page reaches us in several spellings: the site's own
 * `music.163.com/#/playlist?id=…` (the part after `#` is the address), the
 * app's share link `y.music.163.com/m/playlist?id=…&userid=…`, and
 * `music.163.com/song/123/`. A short `163cn.tv` link names nothing until it is
 * followed, which only the server can do.
 */
export function neteaseLink(url: string): NeteaseLink | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!NETEASE_HOSTS.has(parsed.hostname.toLowerCase().replace(/^www\./, ''))) return null
  // `#/playlist?id=1` is the page itself; read it as if it were the path.
  const page = parsed.hash.startsWith('#/') ? new URL(parsed.hash.slice(1), parsed.origin) : parsed
  const segments = page.pathname.split('/').filter(Boolean)
  if (segments[0] === 'm') segments.shift()
  const kind = segments[0]
  if (kind !== 'song' && kind !== 'album' && kind !== 'playlist') return null
  const id = page.searchParams.get('id') ?? segments[1] ?? ''
  return /^\d{1,20}$/.test(id) ? { kind, id } : null
}

/** The one link that stands for a 网易云 song, whichever form it arrived in (`youtubeWatchUrl`'s twin). */
export function neteaseSongUrl(id: string): string {
  return `https://music.163.com/song?id=${id}`
}

// --- Spotify ---------------------------------------------------------------

/**
 * What a Spotify link opens: a playlist, an album or one track. Spotify's
 * audio cannot be downloaded, so each song is found on YouTube by its name.
 */
export interface SpotifyLink {
  readonly kind: 'playlist' | 'album' | 'track'
  readonly id: string
}

/** The playlist, album or track an `open.spotify.com` link opens, in any of its forms, or null. */
export function spotifyLink(url: string): SpotifyLink | null {
  const match =
    /open\.spotify\.com\/(?:embed\/)?(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(playlist|album|track)\/([A-Za-z0-9]{10,})/i.exec(
      url.trim(),
    )
  if (!match?.[1] || !match[2]) return null
  return { kind: match[1].toLowerCase() as SpotifyLink['kind'], id: match[2] }
}

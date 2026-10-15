import { youtubeWatchUrl } from './links.js'
import { withoutRepeats } from './artists.js'
import { cleanArtist, tidyVideoTitle, withoutTranslation, withoutUseNote } from './titles.js'

/**
 * A video as a song to review and import, named the way the library names
 * songs. The server reads it out of yt-dlp's JSON; a device that looks a
 * video up itself (docs/features/client-download.md) hands the same fields
 * in from the player's answer, so both name a song alike.
 */

/** Metadata yt-dlp reports for one track. */
export interface ProbedTrack {
  url: string
  title: string
  artist: string
  album: string
  duration: number
  thumbnail: string | null
}

/** The subset of yt-dlp's JSON dump this app reads — and what a device fills in alike. */
export interface YtDlpJson {
  _type?: string
  /** Which extractor a flat entry belongs to: `Youtube` for a video, `YoutubeTab` for a page. */
  ie_key?: string
  id?: string
  url?: string
  webpage_url?: string
  title?: string
  track?: string
  artist?: string
  creator?: string
  uploader?: string
  channel?: string
  album?: string
  duration?: number
  thumbnail?: string
  /** A search entry lists its thumbnails smallest first, and names no `thumbnail`. */
  thumbnails?: { url?: string; width?: number }[]
  entries?: YtDlpJson[]
  playlist_title?: string
}

/** One entry of yt-dlp's JSON as a track to review and import. */
export function toProbedTrack(json: YtDlpJson, fallbackUrl: string): ProbedTrack {
  // Flat playlist entries carry only an id, so rebuild a watch URL from it.
  const url =
    json.webpage_url ??
    (json.url && /^https?:/.test(json.url)
      ? json.url
      : json.id
        ? youtubeWatchUrl(json.id)
        : fallbackUrl)

  // `track` and `artist` are the song's own when YouTube has music metadata.
  // Without them `title` is the video's — "YOASOBI「アイドル」Official Music
  // Video" — so it is tidied into the song's name, and the artist it writes in
  // front is preferred to the channel's name (titles.ts).
  const credited = json.artist ?? json.creator
  const channel = cleanArtist(credited ?? json.uploader ?? json.channel ?? '')
  const tidied = json.track ? null : tidyVideoTitle(json.title ?? '', channel)

  // Named the way the library keeps names (A9, docs/features/ai.md): each
  // name once in a credit — YouTube Music lists 薛之谦 three times on a song
  // he sings three parts of — and the original name without the English a
  // channel writes after it ("オリオン - Orion").
  return {
    url,
    title: withoutUseNote(withoutTranslation((json.track ?? tidied?.title ?? '').trim())),
    artist: withoutRepeats(credited ? channel : (tidied?.artist ?? channel)),
    album: (json.album ?? '').trim(),
    duration: typeof json.duration === 'number' ? json.duration : 0,
    thumbnail: json.thumbnail ?? largestThumbnail(json.thumbnails),
  }
}

/**
 * The cover of an entry that names none: a flat listing's entries name no
 * `thumbnail`, only `thumbnails`, so without this every song of a long
 * playlist reviewed through yt-dlp showed a letter where its picture goes.
 * The largest is the one to keep with the song.
 */
function largestThumbnail(thumbnails: YtDlpJson['thumbnails']): string | null {
  if (!thumbnails) return null
  let best: { url?: string; width?: number } | null = null
  for (const thumb of thumbnails) {
    if (thumb.url && (best === null || (thumb.width ?? 0) >= (best.width ?? 0))) best = thumb
  }
  return best?.url ?? null
}

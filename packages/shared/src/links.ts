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

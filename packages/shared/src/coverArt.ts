/**
 * Whether a cover's address serves a square picture.
 *
 * YouTube Music's art is served from googleusercontent at a size named in the
 * address — `=w544-h544-l90-rj`, or `=s576` — and is the album's own square.
 * A video's still (`i.ytimg.com/vi/…/hqdefault.jpg`) is 16:9, and for a song
 * on YouTube Music it is the square art letterboxed on black: the wrong shape
 * for a cover, and mostly black to anything picking a colour from it.
 */
export function isSquareCoverUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /=w(\d+)-h\1(?:-|$)/.test(url) || /=s\d+(?:-|$)/.test(url)
}

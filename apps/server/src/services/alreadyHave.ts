import { cleanArtist, cleanTitle } from '@selfmp3/shared'
import { similarity } from './migrateScore.js'

/**
 * Is this track already in the library?
 *
 * One rule for every way a song can arrive — a pasted link, a shared link, a
 * migrated playlist — because there were two, and the weaker one let things
 * through. The import preview compared `artist::title` as exact lowercased
 * strings; a dev library ended up with the same ZUTOMAYO track ten times over,
 * because YouTube gave the channel as "ZUTOMAYO" one week and "ずっと真夜中で
 * いいのに。 ZUTOMAYO" the next, and two strings that differ by one character
 * are, to an exact comparison, two different songs.
 *
 * Three things are checked, cheapest first, and any one of them is enough:
 *
 * 1. **The source link.** A song downloaded from a URL remembers it. Re-import
 *    that link and it is the same file, whatever either side calls it now —
 *    exact, free, and impossible to get wrong.
 * 2. **Title and artist, fuzzily.** `cleanTitle` first, so "(Official Video)"
 *    and a `feat.` do not count against a match.
 * 3. **Length, when both know it.** Two uploads of one song are rarely more
 *    than a few seconds apart, and a title that matches with a wildly different
 *    length is usually a remix, a live take or an hour-long loop — the exact
 *    things a title alone cannot tell apart.
 *
 * Deliberately not a "delete the duplicate" decision: nothing here removes
 * anything. It only decides whether a row arrives already unticked, which is a
 * judgement the person can overrule in one tap. So it errs towards saying yes.
 */

/** What a song in the library offers the comparison. */
export interface LibrarySong {
  readonly title: string
  readonly artist: string
  /** Seconds, or 0 when it is not known. */
  readonly duration?: number
  readonly sourceUrl?: string | null
}

/** What an incoming track offers it. */
interface IncomingTrack {
  readonly title: string
  readonly artist: string
  readonly duration?: number
  readonly url?: string
}

/** Titles this close count as the same song, once cleaned. */
const TITLE = 0.9
/** Artists this close count as the same act: "YOASOBI" against "YOASOBI - Topic". */
const ARTIST = 0.75
/**
 * How far two lengths may sit apart and still be one song.
 *
 * Six seconds covers a different master, a trimmed silence, a fade — and stops
 * well short of the radio-edit-versus-album-version gap, which is where the
 * two really are different recordings and the person should choose.
 */
const SECONDS = 6

/**
 * The library's source links, each with its song, for the exact half of the
 * check.
 *
 * A map rather than a scan: the preview asks this once per track and a library
 * is thousands of rows.
 */
export function sourceUrlIndex<T extends LibrarySong>(songs: readonly T[]): ReadonlyMap<string, T> {
  const urls = new Map<string, T>()
  for (const song of songs) {
    const url = normaliseUrl(song.sourceUrl)
    if (url && !urls.has(url)) urls.set(url, song)
  }
  return urls
}

/**
 * The same video on `youtube.com`, `music.youtube.com` and `youtu.be` is the
 * same file, so a link is reduced to what identifies it. Anything that is not
 * a YouTube link is compared whole, minus the noise a share button adds.
 */
export function normaliseUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  const video = /[?&]v=([\w-]{6,})/.exec(trimmed) ?? /youtu\.be\/([\w-]{6,})/.exec(trimmed)
  if (video?.[1]) return `yt:${video[1]}`
  return trimmed.replace(/[?&](si|feature|utm_[\w-]+)=[^&]*/g, '').replace(/[?&]$/, '')
}

/**
 * The song the library already holds for this track, or null. The song
 * itself rather than a yes: which one it is says where it is — on this
 * server only, or in the bucket every device reads.
 */
export function alreadyHave<T extends LibrarySong>(
  track: IncomingTrack,
  songs: readonly T[],
  urls: ReadonlyMap<string, T> = sourceUrlIndex(songs),
): T | null {
  const url = normaliseUrl(track.url)
  const linked = url ? urls.get(url) : undefined
  if (linked) return linked

  const title = cleanTitle(track.title)
  if (!title.trim()) return null
  const artist = cleanArtist(track.artist)

  for (const song of songs) {
    if (similarity(title, cleanTitle(song.title)) < TITLE) continue
    // One side with no artist at all cannot disagree about it; a title that
    // close is enough on its own.
    if (artist.trim() && song.artist.trim()) {
      if (similarity(artist, cleanArtist(song.artist)) < ARTIST) continue
    }
    if (!withinLength(track.duration, song.duration)) continue
    return song
  }
  return null
}

/** True when the lengths agree, or when either side does not know one. */
function withinLength(a: number | undefined, b: number | undefined): boolean {
  if (!a || !b || a <= 0 || b <= 0) return true
  return Math.abs(a - b) <= SECONDS
}

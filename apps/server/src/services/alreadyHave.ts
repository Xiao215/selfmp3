import { cleanArtist, cleanTitle, neteaseLink } from '@selfmp3/shared'
import { foldForMatch, similarAtLeast, type Folded } from './youtubeMatch.js'

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
 *    and a `feat.` do not count against a match. A title in two languages
 *    is also each of its halves: 网易云 writes "新月的摇篮曲（其一）：伴月同眠
 *    Lullaby of the New Moon (I): Somnias a Luna" where YouTube Music has the
 *    English alone, and the library may by now hold the Chinese alone.
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
 * The library made ready to be compared with: each song's source link, and
 * its cleaned title and artist folded for matching.
 *
 * Made once per request rather than per track: a preview or a review asks
 * about every one of its songs, a library is thousands of rows, and cleaning
 * and folding each row again for each song asked about was a good part of the
 * cost.
 */
interface LibraryIndex<T extends LibrarySong> {
  readonly urls: ReadonlyMap<string, T>
  readonly songs: readonly { song: T; titles: readonly Folded[]; artist: Folded | null }[]
}

export function libraryIndex<T extends LibrarySong>(songs: readonly T[]): LibraryIndex<T> {
  const urls = new Map<string, T>()
  for (const song of songs) {
    const url = normaliseUrl(song.sourceUrl)
    if (url && !urls.has(url)) urls.set(url, song)
  }
  return {
    urls,
    songs: songs.map(song => ({
      song,
      titles: titleForms(song.title),
      artist: song.artist.trim() ? foldForMatch(cleanArtist(song.artist)) : null,
    })),
  }
}

/**
 * The same video on `youtube.com`, `music.youtube.com` and `youtu.be` is the
 * same file, so a link is reduced to what identifies it, as is a 网易云 song
 * in any of its spellings. Anything else is compared whole, minus the noise a
 * share button adds.
 */
export function normaliseUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  const netease = neteaseLink(trimmed)
  if (netease?.kind === 'song') return `ne:${netease.id}`
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
  library: LibraryIndex<T>,
): T | null {
  const url = normaliseUrl(track.url)
  const linked = url ? library.urls.get(url) : undefined
  if (linked) return linked

  const titles = titleForms(track.title)
  if (titles.length === 0) return null
  const cleanedArtist = cleanArtist(track.artist)
  const artist = cleanedArtist.trim() ? foldForMatch(cleanedArtist) : null

  for (const song of library.songs) {
    // The length first: it is the cheapest of the three.
    if (!withinLength(track.duration, song.song.duration)) continue
    if (!titles.some(title => song.titles.some(other => similarAtLeast(title, other, TITLE))))
      continue
    // One side with no artist at all cannot disagree about it; a title that
    // close is enough on its own.
    if (artist && song.artist && !similarAtLeast(artist, song.artist, ARTIST)) continue
    return song.song
  }
  return null
}

/**
 * A title folded for matching, and when it is one name in Latin letters and
 * one in another script, each name on its own as well.
 *
 * Split only where everything before is one script and everything after is
 * the other, so a title that mixes them word by word — "恋はLemon" — stays
 * whole. Words with no letters ("(I):", "2") go with either side.
 */
function titleForms(raw: string): Folded[] {
  const cleaned = cleanTitle(raw).trim()
  if (!cleaned) return []
  const whole = foldForMatch(cleaned)
  const words = cleaned.split(/\s+/)
  const scripts = words.map(script)
  for (let at = 1; at < words.length; at++) {
    const before = oneScript(scripts.slice(0, at))
    const after = oneScript(scripts.slice(at))
    if (before && after && before !== after) {
      return [
        whole,
        ...[words.slice(0, at), words.slice(at)].map(half => foldForMatch(half.join(' '))),
      ]
    }
  }
  return [whole]
}

type Script = 'latin' | 'other' | 'mixed' | null

/** Which letters a word is written in; null when it has none. */
function script(word: string): Script {
  const latin = /\p{Script=Latin}/u.test(word)
  const other = /[^\P{L}\p{Script=Latin}]/u.test(word)
  return latin && other ? 'mixed' : latin ? 'latin' : other ? 'other' : null
}

/** The one script these words share, ignoring words with no letters. */
function oneScript(scripts: readonly Script[]): 'latin' | 'other' | null {
  const used = new Set(scripts.filter(each => each !== null))
  if (used.size !== 1 || used.has('mixed')) return null
  return used.has('latin') ? 'latin' : 'other'
}

/** True when the lengths agree, or when either side does not know one. */
function withinLength(a: number | undefined, b: number | undefined): boolean {
  if (!a || !b || a <= 0 || b <= 0) return true
  return Math.abs(a - b) <= SECONDS
}

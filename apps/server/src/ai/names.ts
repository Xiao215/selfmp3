import type { MetadataCandidate, Song, TidyField } from '@selfmp3/shared'
import { creditNames, mainArtist } from './library.js'

/**
 * A song's names as music catalogues list them (docs/features/ai.md, A4,
 * "Names from the catalogues"): 网易云 first, whose names are the
 * publisher's and often in two languages ("丹砂巍巍 Wordless Cliffs"), then
 * MusicBrainz and iTunes for a song 网易云 does not have.
 *
 * Only the same recording counts: as long as the song to within a few
 * seconds, and with its title or one of its artists in common. A cover with
 * the same name is almost never the same length; that is what keeps "Wordless
 * Cliffs" by a piano channel out of the answer for the game's own.
 */

export interface FoundName {
  readonly source: '网易云' | 'MusicBrainz' | 'iTunes'
  readonly title: string
  readonly artist: string
  readonly album: string
}

/** The names a song is found under, best first; empty when no catalogue has it. */
export type FindNames = (song: Song) => Promise<FoundName[]>

/** A catalogue's answer before it is checked against the song. */
interface Listed extends FoundName {
  /** Seconds; null when the catalogue does not say. */
  readonly seconds: number | null
}

/** How far apart in seconds a recording may be and still be the same one. */
const SAME_LENGTH_S = 3
const CACHE_MS = 24 * 60 * 60 * 1000
const CACHE_MAX = 5_000

/** Letters and digits only, lower case, widths and accents folded: "Ｌｉｙｕｅ" and "liyue" are one. */
const bare = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

/** Whether `part`, as letters and digits, is inside `whole`. */
export function within(part: string, whole: string): boolean {
  const p = bare(part)
  return p.length > 0 && bare(whole).includes(p)
}

/** What a fan's upload says of itself: "（翻自 YOASOBI）", "【翻唱】", "(Cover)". */
const COVER = /翻自|翻唱|\bcover\b|カバー|커버/i

/** Whether a catalogue's entry has one of the song's artists. */
const sameArtist = (song: Song, listed: Listed): boolean =>
  creditNames(song.artist).some(name => within(name, listed.artist) || within(listed.artist, name))

/**
 * Whether a catalogue's entry is this song's recording, not another of the
 * same name: the same length, not a cover, and its title or an artist in
 * common. The title alone is enough because an artist may be listed in another
 * script (Yorushika is ヨルシカ on 网易云); `ours` prefers the artist's own.
 */
export function sameRecording(song: Song, listed: Listed): boolean {
  if (listed.seconds === null || song.duration <= 0) return false
  if (Math.abs(listed.seconds - song.duration) > SAME_LENGTH_S) return false
  if (COVER.test(listed.title) || COVER.test(listed.album)) return false
  return (
    within(song.title, listed.title) || within(listed.title, song.title) || sameArtist(song, listed)
  )
}

/** The words of a found name a field's new value must come from. */
export function foundFor(field: TidyField, found: FoundName): string {
  return field === 'title' ? found.title : field === 'album' ? found.album : found.artist
}

interface Catalogues {
  /** 网易云's search, as `NeteaseMusic.search` gives it. */
  readonly netease: (
    words: string,
  ) => Promise<readonly { title: string; artist: string; album: string; duration: number }[]>
  /** MusicBrainz and iTunes, as `MetadataLookupService.lookup` gives them. */
  readonly lookup: (query: {
    title: string
    artist: string
    album: string
    duration: number
  }) => Promise<readonly MetadataCandidate[]>
}

/** A finder over the catalogues, remembering each song's answer for a day. */
export function catalogueFinder(catalogues: Catalogues, now = () => Date.now()): FindNames {
  const cache = new Map<string, { at: number; found: FoundName[] }>()
  return async song => {
    const key = [song.title, song.artist, song.album, Math.round(song.duration)].join('\u0000')
    const hit = cache.get(key)
    if (hit && now() - hit.at < CACHE_MS) return hit.found

    // The same recording; when some entries have the song's artist, only those.
    const ours = (listed: readonly Listed[]): FoundName[] => {
      const same = listed.filter(each => sameRecording(song, each))
      const byArtist = same.filter(each => sameArtist(song, each))
      return (byArtist.length > 0 ? byArtist : same).map(({ source, title, artist, album }) => ({
        source,
        title,
        artist,
        album,
      }))
    }
    const artist = mainArtist(song.artist)
    let found = ours(
      (await catalogues.netease(`${song.title} ${song.artist ? artist : ''}`.trim())).map(
        track => ({ source: '网易云' as const, ...track, seconds: track.duration || null }),
      ),
    )
    if (found.length === 0) {
      const candidates = await catalogues.lookup({
        title: song.title,
        artist: song.artist ? artist : '',
        album: song.album,
        duration: song.duration,
      })
      found = ours(
        candidates.map(candidate => ({
          source:
            candidate.source === 'musicbrainz' ? ('MusicBrainz' as const) : ('iTunes' as const),
          title: candidate.title,
          artist: candidate.artist,
          album: candidate.album,
          seconds: candidate.durationSec ?? null,
        })),
      )
    }
    // The same names from two entries are said once.
    const seen = new Set<string>()
    found = found.filter(each => {
      const id = `${each.title}\u0000${each.artist}\u0000${each.album}`
      return !seen.has(id) && Boolean(seen.add(id))
    })

    cache.set(key, { at: now(), found })
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    return found
  }
}

import {
  fromSqliteTime,
  fuzzyRank,
  isCjkQuery,
  type Library,
  type Song,
  type Tag,
  libraryArtists,
  type Artist,
} from '@selfmp3/shared'
import { searchSongs } from '@selfmp3/client'

/**
 * Search, without the screen (docs/ui-mock `P18`–`P20`, `C05`; `S3`, "Search").
 *
 * One search, opened from anywhere, the same whichever door it came through.
 * Before anything is typed it offers your tags and what you played last, and
 * it keeps no history. Typed, it shows everything at once — artists and tags,
 * then songs, then lines of lyrics, a few of each — and a section's "See all"
 * opens that section alone. There is no row of scopes to pick from first
 * (2026-10-12): the sections already sort what was found.
 *
 * The command palette is this search with its commands and playlists added
 * (`commandPalette.model.ts`), so the two cannot disagree about what a query
 * finds.
 */

/** A section of the results, which "See all" opens alone. */
export type SearchSection = 'places' | 'songs' | 'lyrics'

/** What a section is called, on its head in All and on the way back from it. */
export const SECTION_TITLES: Readonly<Record<SearchSection, string>> = {
  places: 'Artists and tags',
  songs: 'Songs',
  lyrics: 'Lyrics',
}

type SearchLibrary = Pick<Library, 'songs' | 'tags'>

interface SearchFound {
  /** Every song that matches, best first. */
  readonly songs: readonly Song[]
  readonly tags: readonly Tag[]
  readonly artists: readonly Artist[]
}

const NOTHING: SearchFound = { songs: [], tags: [], artists: [] }

/**
 * What a query finds in the library, each kind best first. Lyrics are the
 * server's to search and arrive separately (`lyricsQueryFor`).
 */
export function searchLibrary(query: string, library: SearchLibrary | undefined): SearchFound {
  const trimmed = query.trim()
  if (!trimmed || !library) return NOTHING
  return {
    songs: searchSongs(trimmed, library.songs).map(match => match.item),
    tags: fuzzyRank(trimmed, library.tags, tag => tag.name).map(match => match.item),
    artists: fuzzyRank(trimmed, libraryArtists(library.songs), artist => artist.name).map(
      match => match.item,
    ),
  }
}

/** How many each section holds, and all of them together. */
export function sectionCounts(
  found: SearchFound,
  lyricLines: number,
): Record<SearchSection | 'all', number> {
  const places = found.artists.length + found.tags.length
  const songs = found.songs.length
  return { all: places + songs + lyricLines, places, songs, lyrics: lyricLines }
}

/** A place a query found: an artist or a tag, drawn together at the top of All. */
export type SearchPlace =
  { readonly kind: 'artist'; readonly artist: Artist } | { readonly kind: 'tag'; readonly tag: Tag }

/** How many of each section All shows before "See all" opens it alone. */
export const ALL_LIMITS = { places: 4, songs: 5, lyrics: 3 } as const

/**
 * Every place a query found, artists before tags. An artist comes before a tag
 * of the same name — the place the songs name themselves is the one more often
 * meant — and both are shown, since they are two different places (`P11`).
 */
export function placesOf(found: SearchFound): readonly SearchPlace[] {
  return [
    ...found.artists.map(artist => ({ kind: 'artist' as const, artist })),
    ...found.tags.map(tag => ({ kind: 'tag' as const, tag })),
  ]
}

/** All, in its order and a few of each: artists and tags, then songs (lyric lines follow). */
export function allResults(found: SearchFound): {
  readonly places: readonly SearchPlace[]
  readonly songs: readonly Song[]
} {
  return {
    places: placesOf(found).slice(0, ALL_LIMITS.places),
    songs: found.songs.slice(0, ALL_LIMITS.songs),
  }
}

/** Something played lately, offered before anything is typed. */
export type RecentItem =
  | { readonly kind: 'song'; readonly song: Library['songs'][number] }
  | { readonly kind: 'playlist'; readonly playlist: Library['playlists'][number] }

/** How many recent things an empty search offers: a glance, not a history page. */
const RECENT_LIMIT = 5

/**
 * What was played lately, newest first: the song loaded now, then songs and
 * playlists by when they were last played.
 *
 * The loaded song leads because it is the one most likely wanted back — a
 * restored session, paused — and its last play may not have counted yet. The
 * rest come from the library's own `lastPlayedAt`, which the server keeps for
 * every device, so a song finished on the phone is recent here too. This is
 * listening, not searching: nothing typed is ever kept.
 */
export function recentItems(
  library: Pick<Library, 'songs' | 'playlists'> | undefined,
  currentSongId: number | null = null,
  limit = RECENT_LIMIT,
): readonly RecentItem[] {
  if (!library || limit <= 0) return []
  const current =
    currentSongId === null ? undefined : library.songs.find(song => song.id === currentSongId)
  // The server's `YYYY-MM-DD HH:MM:SS` and this device's ISO stamps do not
  // sort as text against each other, so they are compared as times.
  const dated: { at: number; item: RecentItem }[] = []
  const add = (stamp: string | null, item: RecentItem): void => {
    const at = stamp ? fromSqliteTime(stamp) : Number.NaN
    if (!Number.isNaN(at)) dated.push({ at, item })
  }
  for (const song of library.songs) {
    if (song.id !== currentSongId) add(song.lastPlayedAt, { kind: 'song', song })
  }
  for (const playlist of library.playlists)
    add(playlist.lastPlayedAt, { kind: 'playlist', playlist })
  dated.sort((a, b) => b.at - a.at)
  const items = dated.map(entry => entry.item)
  return (current ? [{ kind: 'song' as const, song: current }, ...items] : items).slice(0, limit)
}

/**
 * The phone's Search before anything is typed (`P18`): your tags, the ones
 * with the most songs first, and the songs played last.
 */
export function beforeTyping(
  library: Pick<Library, 'songs' | 'playlists' | 'tags'> | undefined,
  currentSongId: number | null,
): { readonly tags: readonly Tag[]; readonly recent: readonly Song[] } {
  if (!library) return { tags: [], recent: [] }
  const tags = [...library.tags]
    .filter(tag => tag.songCount > 0)
    .sort((a, b) => b.songCount - a.songCount || a.name.localeCompare(b.name))
  const recent = recentItems(library, currentSongId).flatMap(item =>
    item.kind === 'song' ? [item.song] : [],
  )
  return { tags, recent }
}

/**
 * The query worth sending to the lyric search, or '' when it is too short to
 * mean anything: two characters is a word in Chinese or Japanese, three is the
 * floor for Latin text.
 */
export function lyricsQueryFor(query: string): string {
  const trimmed = query.trim()
  return trimmed.length >= (isCjkQuery(trimmed) ? 2 : 3) ? trimmed : ''
}

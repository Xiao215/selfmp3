import { fuzzyRank, isCjkQuery, type Library, type Song, type Tag } from '@selfmp3/shared'
import { libraryArtists, searchSongs, type Artist } from '@selfmp3/client'

/**
 * Search, without the screen (docs/ui-mock `P18`–`P20`, `C05`; `S3`, "Search").
 *
 * One search, opened from anywhere; the door only picks the scope it starts
 * on — All from Home and the search circle, Songs from Library, Tags from the
 * Tags page. Before anything is typed it offers your tags and what you played
 * last, and it keeps no history. Typed, it finds artists and tags first, then
 * songs, then lines of lyrics.
 *
 * The command palette is this search with its commands and playlists added
 * (`commandPalette.model.ts`), so the two cannot disagree about what a query
 * finds.
 */

export type SearchScope = 'all' | 'songs' | 'tags' | 'artists' | 'lyrics'

export const SEARCH_SCOPES: readonly { readonly value: SearchScope; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'songs', label: 'Songs' },
  { value: 'tags', label: 'Tags' },
  { value: 'artists', label: 'Artists' },
  { value: 'lyrics', label: 'Lyrics' },
]

/** `?scope=`, read leniently: anything unknown starts on All. */
export function parseScope(value: unknown): SearchScope {
  return SEARCH_SCOPES.some(scope => scope.value === value) ? (value as SearchScope) : 'all'
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
 * What a query finds in the library, each kind best first. Songs whose file is
 * missing are left out, as they are from Library. Lyrics are the server's to
 * search and arrive separately (`lyricsQueryFor`).
 */
export function searchLibrary(query: string, library: SearchLibrary | undefined): SearchFound {
  const trimmed = query.trim()
  if (!trimmed || !library) return NOTHING
  const present = library.songs.filter(song => !song.missing)
  return {
    songs: searchSongs(trimmed, present).map(match => match.item),
    tags: fuzzyRank(trimmed, library.tags, tag => tag.name).map(match => match.item),
    artists: fuzzyRank(trimmed, libraryArtists(library.songs), artist => artist.name).map(
      match => match.item,
    ),
  }
}

/** How many each scope holds, for the counts on the scope pills once something is typed. */
export function scopeCounts(found: SearchFound, lyricLines: number): Record<SearchScope, number> {
  const songs = found.songs.length
  const tags = found.tags.length
  const artists = found.artists.length
  return {
    all: songs + tags + artists + lyricLines,
    songs,
    tags,
    artists,
    lyrics: lyricLines,
  }
}

/** A place a query found: an artist or a tag, drawn together at the top of All. */
type SearchPlace =
  { readonly kind: 'artist'; readonly artist: Artist } | { readonly kind: 'tag'; readonly tag: Tag }

/** How many of each kind All shows before "See all" is the scope's own page. */
export const ALL_LIMITS = { places: 4, songs: 5, lyrics: 3 } as const

/**
 * All, in its order: artists and tags, then songs, then lyric lines. An artist
 * comes before a tag of the same name — the place the songs name themselves
 * is the one more often meant — and both are shown, since they are two
 * different places (`P11`).
 */
export function allResults(found: SearchFound): {
  readonly places: readonly SearchPlace[]
  readonly songs: readonly Song[]
} {
  const places: SearchPlace[] = [
    ...found.artists.map(artist => ({ kind: 'artist' as const, artist })),
    ...found.tags.map(tag => ({ kind: 'tag' as const, tag })),
  ]
  return {
    places: places.slice(0, ALL_LIMITS.places),
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
  const dated: { at: string; item: RecentItem }[] = []
  for (const song of library.songs) {
    if (song.lastPlayedAt && song.id !== currentSongId && !song.missing) {
      dated.push({ at: song.lastPlayedAt, item: { kind: 'song', song } })
    }
  }
  for (const playlist of library.playlists) {
    if (playlist.lastPlayedAt)
      dated.push({ at: playlist.lastPlayedAt, item: { kind: 'playlist', playlist } })
  }
  // ISO timestamps sort as text; the newest is the largest.
  dated.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
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

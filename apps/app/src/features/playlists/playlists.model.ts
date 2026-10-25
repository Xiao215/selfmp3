import { useMemo } from 'react'
import {
  WEEKDAYS,
  calendarDaysAgo,
  type CreatePlaylist,
  EMPTY_SMART_RULES,
  formatLongDuration,
  fromSqliteTime,
  type Playlist,
  playlistRules,
  plural,
  type SmartRules,
  type CoverSwatch,
  type Song,
} from '@selfmp3/shared'
import { uniqueName, useLibrary } from '@selfmp3/client'

/**
 * The playlists screen's state, with nothing it draws.
 *
 * Foundation 3: this file imports `packages/*` and React and nothing else, so
 * the order playlists appear in can be checked by vitest rather than by looking
 * at a screenshot.
 *
 * There are three ways to make a playlist and two kinds stored. A *playlist* is
 * a list you keep. A *smart playlist* is a way of making one — a template picks
 * the songs once, and what you get is a playlist like any other. A *live
 * playlist* follows rules and updates itself; it is stored as `kind: 'live'`,
 * the name the server, the sync log and the bucket have always used for it.
 */

/**
 * What a playlist that fills itself from tags is called, wherever it has to be
 * named in passing: under its title, on its row in a list.
 *
 * A verb, not a category. "Live" and "auto" name a *kind* of playlist, which
 * then has to be explained somewhere and learned; "fills from tags" says what
 * happens, and it is the same word as the row that shows it and the button
 * that stops it — one thing to learn instead of three. Not "follows", which
 * reads as following a person (docs/features/lists.md).
 */
export const FOLLOWS_LABEL = 'fills from tags'

export type PlaylistSort = 'recent' | 'name' | 'added'

export const PLAYLIST_SORTS: readonly { value: PlaylistSort; label: string }[] = [
  { value: 'recent', label: 'Last played' },
  { value: 'name', label: 'A–Z' },
  { value: 'added', label: 'Recently added' },
]

export function isPlaylistSort(value: string | null): value is PlaylistSort {
  return PLAYLIST_SORTS.some(option => option.value === value)
}

export function isLive(playlist: Pick<Playlist, 'kind'>): boolean {
  return playlist.kind === 'live'
}

const songsWord = (count: number): string => plural(count, 'song', 'songs')

/**
 * The line under a tile's name: "5 songs · yesterday".
 *
 * The day is when it was last played, or when it was made if it never has
 * been — the same day the page sorts by, so the line says why a tile is where
 * it is. A live playlist reads the same: its badge already says what it is.
 */
export function playlistTileLine(
  playlist: Pick<Playlist, 'songCount' | 'lastPlayedAt' | 'createdAt'>,
  now: Date,
): string {
  const day = relativeDay(playlist.lastPlayedAt ?? playlist.createdAt, now)
  return day ? `${songsWord(playlist.songCount)} · ${day}` : songsWord(playlist.songCount)
}

/**
 * The line under a playlist's name on its own page: "5 songs · 18 min ·
 * played yesterday". A playlist never played leaves the last part off rather
 * than saying "never", which reads as a reproach for a list made a minute ago.
 */
export function playlistHeadLine(
  count: number,
  seconds: number,
  lastPlayedAt: string | null,
  now: Date,
): string {
  const day = lastPlayedAt ? relativeDay(lastPlayedAt, now) : null
  const parts = [songsWord(count), formatLongDuration(seconds)]
  if (day) parts.push(`played ${day}`)
  return parts.join(' · ')
}

/** The line under the page's title: how many, and in what order. */
export function playlistsSubline(count: number, sort: PlaylistSort): string {
  const order = { recent: 'last played first', name: 'A–Z', added: 'newest first' }[sort]
  return `${plural(count, 'playlist', 'playlists')} · ${order}`
}

/**
 * A stamp as a day a person would say: "today", "yesterday", "Tuesday", "last
 * week", "3 weeks ago", "last month", "5 months ago", "last year". Null when
 * the stamp cannot be read.
 *
 * Counted in calendar days where the reader is, not in 24-hour spans
 * (`calendarDaysAgo`): a song played at 23:00 was "yesterday" at 08:00 the
 * next morning. A stamp from the future is today.
 */
export function relativeDay(value: string, now: Date): string | null {
  const ago = calendarDaysAgo(value, now)
  if (ago === null) return null
  const { then } = ago
  const days = Math.max(0, ago.days)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return WEEKDAYS[then.getDay()] ?? null
  if (days < 14) return 'last week'
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`
  if (days < 60) return 'last month'
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  if (days < 730) return 'last year'
  return `${Math.floor(days / 365)} years ago`
}

interface PlaylistsModel {
  /** The ones the page lists, in the order it lists them: none of them empty. */
  playlists: readonly Playlist[]
  loading: boolean
  /** True when the library answered and there is genuinely nothing to show. */
  empty: boolean
  /**
   * The library did not answer and nothing is kept from before, so "none of
   * your own yet" would be a guess: there may be twenty.
   */
  unreachable: boolean
  /** Why the library did not answer, for the card that says so. */
  failure: unknown
  /** Ask for the library again. */
  retry: () => void
}

export function usePlaylistsModel(sort: PlaylistSort = 'recent'): PlaylistsModel {
  const library = useLibrary()
  const all = library.data?.playlists
  const playlists = useMemo(() => listedPlaylists(all ?? [], sort), [all, sort])

  const unreachable = library.isError && all === undefined
  return {
    playlists,
    loading: library.isPending,
    empty: !library.isPending && !unreachable && playlists.length === 0,
    unreachable,
    failure: library.error,
    retry: () => void library.refetch(),
  }
}

/**
 * A stamp as a time to compare. The server writes `2026-09-13 06:17:55` and a
 * bucket writes ISO, which `fromSqliteTime` reads alike; none (or one that
 * cannot be read) is 0, the oldest of all.
 */
function when(value: string | null | undefined): number {
  const time = value ? fromSqliteTime(value) : 0
  return Number.isNaN(time) ? 0 : time
}

const byName = (a: Playlist, b: Playlist): number => a.name.localeCompare(b.name)

/**
 * The playlists page's order.
 *
 * "Last played" is by the newest play among a playlist's songs; the ones never
 * played come after every one that has been, newest made first, so a list made
 * a minute ago is at the top of the unplayed rather than lost under them.
 * Names compare the way the reader's locale does — this library is mostly
 * Japanese, where `localeCompare` and `<` disagree a lot.
 */
export function sortPlaylists(
  playlists: readonly Playlist[],
  sort: PlaylistSort,
): readonly Playlist[] {
  const list = [...playlists]
  const newestMade = (a: Playlist, b: Playlist): number => when(b.createdAt) - when(a.createdAt)
  switch (sort) {
    case 'name':
      return list.sort(byName)
    case 'added':
      return list.sort((a, b) => newestMade(a, b) || byName(a, b))
    case 'recent':
      return list.sort((a, b) => {
        const played = when(b.lastPlayedAt) - when(a.lastPlayedAt)
        // Never played is 0, before any real time, so "never" is already last.
        return played || newestMade(a, b) || byName(a, b)
      })
  }
}

/**
 * What the playlists page lists: every playlist with a song in it, in the
 * chosen order. An empty one is never shown — a playlist exists once it has a
 * song (docs/UI-MIGRATION.md, Phase 5), and one emptied by hand has nothing to
 * show on a tile but a hole.
 */
export function listedPlaylists(
  playlists: readonly Playlist[],
  sort: PlaylistSort,
): readonly Playlist[] {
  return sortPlaylists(
    playlists.filter(playlist => playlist.songCount > 0),
    sort,
  )
}

/**
 * The playlists a song can be added to, for every "Add to playlist" list:
 * only the ones you keep (a live playlist's rules decide its songs), the one
 * played last first, because that is the one you are most likely reaching for.
 * `except` is the playlist the list was opened from, which is not offered.
 */
export function playlistsToAddTo(
  playlists: readonly Playlist[],
  except?: number,
): readonly Playlist[] {
  return sortPlaylists(
    playlists.filter(playlist => !isLive(playlist) && playlist.id !== except),
    'recent',
  )
}

/**
 * What to ask the server for when a playlist is made, or null when the name
 * is only whitespace.
 *
 * A live playlist starts from the rules it is given, or the shared empty set,
 * which matches the whole library until a rule narrows it; a playlist has none.
 */
export function newPlaylist(
  kind: Playlist['kind'],
  name: string,
  options: { rules?: SmartRules; description?: string } = {},
): CreatePlaylist | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  return {
    name: trimmed,
    description: options.description ?? '',
    ...playlistRules(kind, kind === 'live' ? (options.rules ?? EMPTY_SMART_RULES) : null),
  }
}

/**
 * The name for a copy: "Evening copy", then "Evening copy 2" and on, never
 * one that is already taken.
 */
export function copyName(name: string, taken: readonly string[]): string {
  return uniqueName(`${name} copy`, taken)
}

/**
 * The songs whose covers make a mosaic (a playlist's, a place's): four with
 * different pictures where the songs have them, else the first cover alone.
 *
 * Different pictures, not different songs: three discs of one soundtrack carry
 * the same art and no album name, and a mosaic of the first four showed it
 * three times (P10 B). A picture is told by the colours the server read from
 * it: the same art, encoded again for another file, reads within a hair of
 * the same. Songs of one named album count as one picture too, whose covers
 * can be cropped a little differently. A cover not read yet counts as its own.
 *
 * The whole list is searched, not its head: a tag that opens on forty tracks
 * of one soundtrack still has other pictures further down. `hasArt` can fetch
 * a cover (`useArt`), so it is asked only of a song whose picture is not
 * already in, and the search ends at the fourth.
 */
export function mosaicCovers<T extends Pick<Song, 'id' | 'album' | 'coverTone'>>(
  songs: readonly T[],
  hasArt: (song: T) => boolean,
): readonly T[] {
  const different: T[] = []
  for (const song of songs) {
    if (different.some(kept => samePicture(kept, song))) continue
    if (!hasArt(song)) continue
    different.push(song)
    if (different.length === 4) return different
  }
  return different.length > 0 ? different.slice(0, 1) : songs.slice(0, 1)
}

/** How far apart two palettes may be and still be one picture. */
const SAME_PICTURE = 0.02

function samePicture(
  a: Pick<Song, 'album' | 'coverTone'>,
  b: Pick<Song, 'album' | 'coverTone'>,
): boolean {
  const album = a.album.trim()
  if (album !== '' && album === b.album.trim()) return true
  const one = a.coverTone?.palette
  const other = b.coverTone?.palette
  if (!one || !other) return false
  return Math.max(paletteReach(one, other), paletteReach(other, one)) < SAME_PICTURE
}

/** How far `from`'s colours are from their nearest in `to`, weighted by how much of the cover each is. */
function paletteReach(from: readonly CoverSwatch[], to: readonly CoverSwatch[]): number {
  const lab = (swatch: CoverSwatch): readonly [number, number, number] => {
    const turn = (swatch.h * Math.PI) / 180
    return [swatch.l, swatch.c * Math.cos(turn), swatch.c * Math.sin(turn)]
  }
  const total = from.reduce((sum, swatch) => sum + swatch.share, 0) || 1
  return (
    from.reduce((sum, swatch) => {
      const [l, x, y] = lab(swatch)
      const nearest = Math.min(
        ...to.map(other => {
          const [l2, x2, y2] = lab(other)
          return Math.hypot(l - l2, x - x2, y - y2)
        }),
      )
      return sum + nearest * swatch.share
    }, 0) / total
  )
}

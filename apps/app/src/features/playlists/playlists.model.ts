import { useMemo } from 'react'
import {
  plural,
  EMPTY_SMART_RULES,
  formatLongDuration,
  type CreatePlaylist,
  type Playlist,
  type SmartRules,
} from '@selfmp3/shared'
import { useLibrary } from '@selfmp3/client'

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
 * What a playlist that follows tags is called, wherever it has to be named in
 * passing: under its title, on its row in a list.
 *
 * A verb, not a category. "Live" and "auto" name a *kind* of playlist, which
 * then has to be explained somewhere and learned; "follows tags" says what
 * happens, and it is the same word as the switch that turns it on and the row
 * that shows it — one thing to learn instead of three.
 */
export const FOLLOWS_LABEL = 'follows tags'

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

const songsWord = (count: number): string => `${plural(count, 'song', 'songs')}`

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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A stamp as a day a person would say: "today", "yesterday", "Tuesday", "last
 * week", "3 weeks ago", "last month", "5 months ago", "last year". Null when
 * the stamp cannot be read.
 *
 * Counted in calendar days where the reader is, not in 24-hour spans: a song
 * played at 23:00 was "yesterday" at 08:00 the next morning, nine hours later.
 * The server writes UTC without a zone (`2026-09-13 06:17:55`), which is read
 * as UTC; a bucket's ISO carries its own. A stamp from the future is today.
 */
export function relativeDay(value: string, now: Date): string | null {
  const then = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(then.getTime())) return null
  const midnight = (date: Date): number =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  // Rounded, because a day that crosses a clock change is 23 or 25 hours long.
  const days = Math.max(0, Math.round((midnight(now) - midnight(then)) / DAY_MS))
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
    retry: () => void library.refetch(),
  }
}

/**
 * The server writes `2026-09-13 06:17:55` and a bucket writes ISO; compared as
 * text, the space sorts before the `T`. One shape makes the comparison honest.
 */
function stamp(value: string | null | undefined): string {
  return value ? value.replace(' ', 'T') : ''
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
  const newestMade = (a: Playlist, b: Playlist): number =>
    stamp(b.createdAt).localeCompare(stamp(a.createdAt))
  switch (sort) {
    case 'name':
      return list.sort(byName)
    case 'added':
      return list.sort((a, b) => newestMade(a, b) || byName(a, b))
    case 'recent':
      return list.sort((a, b) => {
        const played = stamp(b.lastPlayedAt).localeCompare(stamp(a.lastPlayedAt))
        // An empty stamp sorts before any real one, so "never" is already last.
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
 */
export function playlistsToAddTo(playlists: readonly Playlist[]): readonly Playlist[] {
  return sortPlaylists(
    playlists.filter(playlist => !isLive(playlist)),
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
    kind,
    rules: kind === 'live' ? (options.rules ?? EMPTY_SMART_RULES) : null,
  }
}

/**
 * The name for a copy: "Evening copy", then "Evening copy 2" and on, never
 * one that is already taken.
 */
export function copyName(name: string, taken: readonly string[]): string {
  const names = new Set(taken)
  const base = `${name} copy`
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

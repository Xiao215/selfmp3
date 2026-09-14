import { useMemo } from 'react'
import { EMPTY_SMART_RULES, type CreatePlaylist, type Playlist, type SmartRules } from '@selfmp3/shared'
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

/** What the self-updating kind is called wherever a person reads it. */
export const LIVE_NAME = 'Live'

export type PlaylistSort = 'recent' | 'name' | 'added'

export const PLAYLIST_SORTS: readonly { value: PlaylistSort; label: string }[] = [
  { value: 'recent', label: 'Recently played' },
  { value: 'name', label: 'A–Z' },
  { value: 'added', label: 'Recently added' },
]

export function isPlaylistSort(value: string | null): value is PlaylistSort {
  return PLAYLIST_SORTS.some(option => option.value === value)
}

export function isLive(playlist: Pick<Playlist, 'kind'>): boolean {
  return playlist.kind === 'live'
}

export interface PlaylistsModel {
  playlists: readonly Playlist[]
  /** Pinned ones, for the sidebar and the phone's row along the top. */
  pinned: readonly Playlist[]
  loading: boolean
  /** True when the library answered and there is genuinely nothing to show. */
  empty: boolean
}

export function usePlaylistsModel(sort: PlaylistSort = 'recent'): PlaylistsModel {
  const library = useLibrary()
  const all = library.data?.playlists
  const playlists = useMemo(() => sortPlaylists(all ?? [], sort), [all, sort])
  const pinned = useMemo(() => pinnedPlaylists(all ?? []), [all])

  return {
    playlists,
    pinned,
    loading: library.isPending,
    empty: !library.isPending && playlists.length === 0,
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
 * The playlists page's order. Pinning does not move a playlist here: pinned
 * lists have their own place (the sidebar, the phone's row), and a list that
 * jumped to the front of the grid when pinned would be in two places at once
 * with nothing to say why.
 *
 * "Recently played" counts making a list as its first play, so a playlist you
 * just made is at the front rather than under everything you have ever played.
 * Names compare the way the reader's locale does — this library is mostly
 * Japanese, where `localeCompare` and `<` disagree a lot.
 */
export function sortPlaylists(
  playlists: readonly Playlist[],
  sort: PlaylistSort,
): readonly Playlist[] {
  const list = [...playlists]
  switch (sort) {
    case 'name':
      return list.sort(byName)
    case 'added':
      return list.sort((a, b) => stamp(b.createdAt).localeCompare(stamp(a.createdAt)) || byName(a, b))
    case 'recent': {
      const recency = (playlist: Playlist): string => {
        const played = stamp(playlist.lastPlayedAt)
        const made = stamp(playlist.createdAt)
        return played > made ? played : made
      }
      return list.sort((a, b) => recency(b).localeCompare(recency(a)) || byName(a, b))
    }
  }
}

/** Pinned playlists in name order: the sidebar should not reshuffle as music plays. */
export function pinnedPlaylists(playlists: readonly Playlist[]): readonly Playlist[] {
  return playlists.filter(playlist => playlist.pinned).sort(byName)
}

/**
 * The playlists a song can be added to, for every "Add to playlist" list:
 * only the ones you keep (a live playlist's rules decide its songs), pinned
 * first because those are the ones you reach for, then by name.
 */
export function playlistsToAddTo(playlists: readonly Playlist[]): readonly Playlist[] {
  return playlists
    .filter(playlist => !isLive(playlist))
    .sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1) || byName(a, b))
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A smart playlist's description: how it was made, so a fixed list that a
 * template filled never later passes for one that updates itself.
 */
export function madeFrom(templateName: string, when: Date): string {
  return `Made from ${templateName} · ${when.getDate()} ${MONTHS[when.getMonth()]}`
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

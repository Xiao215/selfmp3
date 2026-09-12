import { useMemo } from 'react'
import type { Playlist } from '@selfmp3/shared'
import { useLibrary } from '@selfmp3/client'

/**
 * The playlists screen's state, with nothing it draws.
 *
 * Foundation 3: this file imports `packages/*` and React and nothing else, so
 * the order playlists appear in can be checked by vitest rather than by looking
 * at a screenshot.
 */

export interface PlaylistsModel {
  playlists: readonly Playlist[]
  loading: boolean
  /** True when the library answered and there is genuinely nothing to show. */
  empty: boolean
}

export function usePlaylistsModel(): PlaylistsModel {
  const library = useLibrary()
  const playlists = useMemo(
    () => orderPlaylists(library.data?.playlists ?? []),
    [library.data?.playlists],
  )

  return {
    playlists,
    loading: library.isPending,
    empty: !library.isPending && playlists.length === 0,
  }
}

/**
 * Pinned first, then by name.
 *
 * Pinning is the whole point of pinning: a list somebody pinned is one they
 * want to reach without reading, so it goes above the alphabet rather than
 * into it. Within each group the order is the name, compared the way the
 * reader's locale compares names — `localeCompare` rather than `<`, so that
 * accents and non-Latin titles sort as a person expects instead of by code
 * point. This library is mostly Japanese, where the difference is not subtle.
 */
export function orderPlaylists(playlists: readonly Playlist[]): readonly Playlist[] {
  return [...playlists].sort(
    (a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1) || a.name.localeCompare(b.name),
  )
}

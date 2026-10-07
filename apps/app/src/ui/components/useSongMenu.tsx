import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { View } from 'react-native'
import type { Song } from '@selfmp3/shared'

import { SongMenu } from './SongMenu'

interface SongListMenu {
  /** The song whose menu is open, for its row's `menuOpen`; null with none open. */
  readonly openId: number | null
  /** A row's ⋯: opens that song's menu beside it, or closes it if it is the one open. */
  readonly onMore: (anchor: View | null, song: Song) => void
  /** The menu itself, drawn once for the whole list. */
  readonly menu: ReactNode
}

/**
 * The ⋯ menu of a song list: one menu for the list, opened beside the row
 * whose ⋯ was pressed — at desktop width — and closed by pressing it again.
 * The library, a tag's or an artist's page, search's rows and a playlist's
 * ordered list each kept the same three pieces of this by hand.
 *
 * `onMore` is made once, so a row handed it is never drawn again for it.
 */
export function useSongMenu(
  /** The playlist the list is, for the menu's "Remove from this playlist". */
  playlist?: { readonly id: number; readonly name: string },
): SongListMenu {
  const [song, setSong] = useState<Song | null>(null)
  const anchor = useRef<View | null>(null)
  const onMore = useCallback((node: View | null, picked: Song) => {
    anchor.current = node
    setSong(current => (current?.id === picked.id ? null : picked))
  }, [])
  return {
    openId: song?.id ?? null,
    onMore,
    menu: (
      <SongMenu song={song} anchorRef={anchor} onClose={() => setSong(null)} playlist={playlist} />
    ),
  }
}

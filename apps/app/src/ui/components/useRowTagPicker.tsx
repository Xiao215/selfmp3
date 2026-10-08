import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { View } from 'react-native'
import type { Song } from '@selfmp3/shared'

import { TagPicker } from './TagPicker'

interface RowTagPicker {
  /**
   * A row's tag controls — the dashed + on a computer, the count of tags the
   * row had no room for — open that song's tags beside the one pressed, or
   * close them if they are the ones open.
   */
  readonly onEditTags: (anchor: View | null, song: Song) => void
  /** The picker itself, drawn once for the whole list. */
  readonly picker: ReactNode
}

/**
 * The tag window of a list that shows tags on its rows (`S3`): Library,
 * Search, Up next. One window for the list, as `useSongMenu` is one menu. The
 * "+2" on a row opened it in Library and did nothing in Search or Up next,
 * which each lacked these same three pieces (E1, 2026-10-08).
 *
 * `onEditTags` is made once, so a row handed it is never drawn again for it.
 */
export function useRowTagPicker(): RowTagPicker {
  const [song, setSong] = useState<Song | null>(null)
  const anchor = useRef<View | null>(null)
  const onEditTags = useCallback((node: View | null, picked: Song) => {
    anchor.current = node
    setSong(current => (current?.id === picked.id ? null : picked))
  }, [])
  return {
    onEditTags,
    picker: <TagPicker song={song} onClose={() => setSong(null)} anchorRef={anchor} />,
  }
}

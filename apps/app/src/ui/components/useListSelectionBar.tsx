import { useMemo } from 'react'
import type { ReactElement } from 'react'
import type { ViewStyle } from 'react-native'
import type { Song } from '@selfmp3/shared'
import type { Selection } from '../../selection/useSelection'
import { SELECTION_BAR_SPACE, SelectionBar } from './SelectionBar'

/** Where a list page puts its selection bar, and the room its list leaves for it. */
interface ListSelectionBar {
  /** Drawn above the list on a phone, where the bar floats at the foot; null on a computer. */
  readonly floating: ReactElement | null
  /** The list's pinned lane on a computer, at the head's foot; null on a phone. */
  readonly pinned: ReactElement | null
  /** The list's bottom room on a phone while the bar is up, so the last row can scroll out from under it. */
  readonly listPadding: ViewStyle | undefined
}

const UNDER_THE_BAR: ViewStyle = { paddingBottom: SELECTION_BAR_SPACE }

/**
 * The selection bar of a list's page — a tag's, a playlist's, an answer's —
 * placed the way all three place it: always mounted and told when to show, so
 * it rises and sinks rather than appearing; in the list at the head's foot on
 * a computer, staying at the top once the head has scrolled away; floating at
 * the foot on a phone, with room left under the last row.
 */
export function useListSelectionBar({
  songs,
  selection,
  scope,
  wide,
  playlist,
}: {
  songs: readonly Song[]
  selection: Selection
  /** What "all" means on this page: "in this tag", "in this playlist". */
  scope: string
  wide: boolean
  /** A playlist whose membership the bar may edit. */
  playlist?: { readonly id: number; readonly name: string }
}): ListSelectionBar {
  const selected = useMemo(() => songs.filter(song => selection.has(song.id)), [songs, selection])
  const bar = (
    <SelectionBar
      shown={selection.active}
      songs={selected}
      total={songs.length}
      scope={scope}
      allSelected={selection.allSelected}
      onSelectAll={selection.selectAll}
      onDeselectAll={selection.clear}
      onDone={selection.clear}
      playlist={playlist}
      inline={wide}
    />
  )
  return {
    floating: wide ? null : bar,
    pinned: wide ? bar : null,
    listPadding: selection.active && !wide ? UNDER_THE_BAR : undefined,
  }
}

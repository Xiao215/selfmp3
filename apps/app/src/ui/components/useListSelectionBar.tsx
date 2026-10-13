import { useMemo } from 'react'
import type { ReactElement } from 'react'
import type { ViewStyle } from 'react-native'
import type { Song } from '@selfmp3/shared'
import type { Selection } from '../../selection/useSelection'
import { SELECTION_BAR_SPACE, SelectionBar } from './SelectionBar'

/** Where a list page puts its selection bar, and the room its list leaves for it. */
interface ListSelectionBar {
  /**
   * Drawn before the list, in the box the list fills: a phone's bar, which
   * floats at the foot, and a computer's lane above a list with no head of
   * its own (`placement="aboveList"`). Null where the bar is `pinned` instead.
   */
  readonly beforeList: ReactElement | null
  /** The list's pinned lane on a computer, at the head's foot; null otherwise. */
  readonly pinned: ReactElement | null
  /** The list's bottom room on a phone while the bar is up, so the last row can scroll out from under it. */
  readonly listPadding: ViewStyle | undefined
}

const UNDER_THE_BAR: ViewStyle = { paddingBottom: SELECTION_BAR_SPACE }

/**
 * The selection bar of a list of songs — Library's, Search's, a tag's, a
 * playlist's, an answer's — placed the one way: always mounted and told when
 * to show, so it rises and sinks rather than appearing; floating at the foot
 * on a phone, with room left under the last row; on a computer either in the
 * list at the head's foot, staying at the top once the head has scrolled away
 * (a page whose head scrolls with its songs), or a lane of its own above the
 * list (Library and Search, whose heads stay put).
 *
 * Library and Search had mounted the bar by hand: Search worked out its
 * selected songs afresh every render and left the room under its rows twice.
 */
export function useListSelectionBar({
  songs,
  selection,
  scope,
  wide,
  narrowed = false,
  placement = 'underHead',
  playlist,
}: {
  songs: readonly Song[]
  selection: Selection
  /** What "all" means on this page: "in this tag", "in your library". */
  scope: string
  wide: boolean
  /** A search or filter is narrowing the list, which the bar says of "all". */
  narrowed?: boolean
  /** On a computer: in the list under a head that scrolls away, or a lane above the list. */
  placement?: 'underHead' | 'aboveList'
  /** A playlist whose membership the bar may edit. */
  playlist?: { readonly id: number; readonly name: string }
}): ListSelectionBar {
  const selected = useMemo(() => songs.filter(song => selection.has(song.id)), [songs, selection])
  const inList = wide && placement === 'underHead'
  const bar = (
    <SelectionBar
      shown={selection.active}
      songs={selected}
      total={songs.length}
      narrowed={narrowed}
      scope={scope}
      allSelected={selection.allSelected}
      onSelectAll={selection.selectAll}
      onDeselectAll={selection.clear}
      onDone={selection.clear}
      playlist={playlist}
      inline={inList}
    />
  )
  return {
    beforeList: inList ? null : bar,
    pinned: inList ? bar : null,
    listPadding: selection.active && !wide ? UNDER_THE_BAR : undefined,
  }
}

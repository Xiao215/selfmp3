import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ComponentProps, ReactElement, ReactNode, RefObject } from 'react'
import type { GestureResponderEvent } from 'react-native'
import type { Song } from '@selfmp3/shared'
import { useLibrary } from '@selfmp3/client'
import { useOpenTag } from '../../features/tag/useOpenTag'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { useListKeys } from '../../selection/useListKeys'
import { modifiersOf, type Selection } from '../../selection/useSelection'
import { useSongTagLookup } from '../songTags'
import { useRowAvailability } from '../useRowAvailability'
import type { FlatList } from './Scroll'
import { SongRow } from './SongRow'
import { useRowTagPicker } from './useRowTagPicker'
import { useSongMenu } from './useSongMenu'

/** Everything a list hands one of its rows. */
type SongRowProps = ComponentProps<typeof SongRow>

interface SongRows {
  /** A row, drawn: what a `SongList` takes as `renderSong`. */
  readonly renderSong: (info: { item: Song; index: number }) => ReactElement
  /**
   * What a row of this list is handed, for a list that wraps its rows in
   * something of its own (`OrderedSongList`'s hold to move). Spread, so each
   * prop is compared on its own and the row's memo holds.
   */
  readonly rowProps: (song: Song, index: number) => SongRowProps
  /** A row's press: select with Shift, Cmd or while selecting, play otherwise. Made once. */
  readonly press: (event: GestureResponderEvent, song: Song) => void
  /** The song menu, and the tag window where rows show tags: drawn once for the list. */
  readonly menu: ReactNode
  /**
   * The list these rows are drawn in: a `SongList`'s `listRef`. Tab coming
   * back to a row scrolled far out of the drawn ones scrolls the list to it.
   */
  readonly listRef: RefObject<FlatList<Song> | null>
}

/**
 * The rows of a list of songs, wired the one way every list wires them:
 * Library, Search, a tag's and an artist's page, a playlist's and an answer's.
 *
 * A tap plays — what playing means is the list's (`onPlay`) — and Shift, Cmd
 * or a tap while selecting selects; holding a row starts selecting; on a
 * computer's keyboard the arrows move between rows, Space ticks one and ⌘A
 * selects them all (`useListKeys`), and Enter is a tap; a drag
 * from a ticked row carries every ticked song; the ⋯ and a right-click open
 * the song's menu; a song that cannot play here is faded
 * (`rowAvailability`). Where the list shows tags (`S3`: Library, Search) a
 * chip opens its tag and the count of the rest opens the song's tag window.
 *
 * Each handler is made once and reads what it needs when it runs, so a row's
 * memo holds through a song change, a pause or a new selection; whether a row
 * is the playing one the row asks the player itself. These had been written
 * out four times, and the copies drifted: the place pages and Search never
 * faded a song that could not play, and a fix to one list had to be made in
 * five.
 */
export function useSongRows({
  songs,
  selection,
  onPlay,
  testPrefix = 'song-row',
  withTags = false,
  hideTagIds,
  withAlbum = true,
  numbered = true,
  playlist,
}: {
  /** The rows, in the list's order. */
  songs: readonly Song[]
  selection: Selection
  /** A row pressed outside selecting: play it, its way. Read when pressed, so it may be new each render. */
  onPlay: (index: number, song: Song) => void
  /** Rows are named `<prefix>-<index>`, so a flow can tap one by position. */
  testPrefix?: string
  /** Draw each row's tags (`S3`): Library and Search do; inside a place the place is the tag. */
  withTags?: boolean
  /** Tags every row already shares, whose chips would only repeat the page. */
  hideTagIds?: readonly number[]
  /** Each row's album: off where the list is grouped under album headings. */
  withAlbum?: boolean
  /**
   * The position at desktop width: off where it is no rank and no track,
   * only where a match fell (Search's results, M1).
   */
  numbered?: boolean
  /** The playlist these are, for the song menu's "Remove from this playlist". */
  playlist?: { readonly id: number; readonly name: string }
}): SongRows {
  const artFor = useArt(ROW_COVER_SIZE)
  const availability = useRowAvailability()
  const songMenu = useSongMenu(playlist)
  const rowTags = useRowTagPicker()
  const tagsOf = useSongTagLookup()
  const openTag = useOpenTag()
  const { data: library } = useLibrary()
  const ids = useMemo(() => songs.map(song => song.id), [songs])

  const tags = library?.tags
  const latest = useRef({ ids, selection, onPlay, tags, openTag })
  useEffect(() => {
    latest.current = { ids, selection, onPlay, tags, openTag }
  })

  const press = useCallback((event: GestureResponderEvent, song: Song) => {
    const now = latest.current
    // Shift and Cmd on the web, and a tap in selection mode, select; a plain tap plays.
    if (now.selection.click(song.id, modifiersOf(event))) return
    const index = now.ids.indexOf(song.id)
    if (index >= 0) now.onPlay(index, song)
  }, [])
  // Holding a row selects it; the ⋯ opens the menu.
  const onLongPress = useCallback((song: Song) => latest.current.selection.enter(song.id), [])
  // A tick ticks; with Shift it ticks every row from the last one ticked, as
  // Shift on the row does, rather than that one alone.
  const onToggleSelect = useCallback((song: Song, event?: GestureResponderEvent) => {
    const { selection } = latest.current
    const modifiers = modifiersOf(event)
    if (modifiers.shiftKey) selection.click(song.id, modifiers)
    else selection.toggle(song.id)
  }, [])
  // A drag from a ticked row carries every ticked song.
  const dragSongs = useCallback((song: Song) => latest.current.selection.carried(song.id), [])
  const listRef = useRef<FlatList<Song>>(null)
  // On a computer's keyboard: the arrows, Space for the tick, ⌘A for all.
  const listKey = useListKeys({
    toggle: songId => latest.current.selection.toggle(songId),
    selectAll: () => {
      const now = latest.current
      if (now.ids.length === 0) return false
      now.selection.selectAll()
      return true
    },
    // The list's own scroll to a row by its place, which draws the row there;
    // the keys find it once it is drawn. In the middle, clear of any bar.
    reveal: songId => {
      const index = latest.current.ids.indexOf(songId)
      const list = listRef.current
      if (index < 0 || !list) return false
      list.scrollToIndex({ index, viewPosition: 0.5, animated: false })
      return true
    },
  })
  const onOpenTag = useCallback((tagId: number) => {
    const now = latest.current
    const tag = now.tags?.find(each => each.id === tagId)
    if (tag) now.openTag(tag)
  }, [])

  const { onMore, openId: menuSongId } = songMenu
  const { onEditTags } = rowTags
  const rowProps = useCallback(
    (song: Song, index: number): SongRowProps => ({
      testID: `${testPrefix}-${index}`,
      song,
      artUri: artFor(song),
      ...availability(song.id),
      index: numbered ? index : undefined,
      onPress: press,
      onMore,
      menuOpen: menuSongId === song.id,
      onLongPress,
      selecting: selection.active,
      selected: selection.has(song.id),
      onToggleSelect,
      dragSongs,
      listKey,
      showAlbum: withAlbum,
      ...(withTags ? { tags: tagsOf(song), hideTagIds, onOpenTag, onEditTags } : null),
    }),
    [
      testPrefix,
      artFor,
      availability,
      press,
      onMore,
      menuSongId,
      onLongPress,
      selection,
      onToggleSelect,
      dragSongs,
      listKey,
      withAlbum,
      numbered,
      withTags,
      tagsOf,
      hideTagIds,
      onOpenTag,
      onEditTags,
    ],
  )
  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => (
      <SongRow key={item.id} {...rowProps(item, index)} />
    ),
    [rowProps],
  )

  return {
    renderSong,
    rowProps,
    press,
    listRef,
    menu: (
      <>
        {songMenu.menu}
        {withTags ? rowTags.picker : null}
      </>
    ),
  }
}

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { Animated } from 'react-native'
import type { FlatListProps, GestureResponderEvent, StyleProp, View, ViewStyle } from 'react-native'
import type { Song } from '@selfmp3/shared'
import { isDownloaded, useLibrary } from '@selfmp3/client'
import { dropIndex, movedTo } from './orderedSongList.model'
import { useDownloads } from '../../offline/DownloadsProvider'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { modifiersOf, type Selection } from '../../selection/useSelection'
import { roomShift } from '../motion.model'
import { HoldToReorder, useLiftScale, useMakeRoom } from './HoldToReorder'
import { SongList } from './SongList'
import { useSongMenu } from './useSongMenu'
import { SongRow } from './SongRow'

/**
 * A list of songs in an order that is yours (docs/features/lists.md): a
 * playlist's page, and an Ask answer's. The rows are the library's `SongRow`,
 * without tag chips, as every row inside a place is (`S3`); holding one lifts
 * it to move it, the rows around opening a gap where it will land; Cmd, Shift
 * and selection mode select, and the selection bar acts on what is ticked;
 * the ⋯ opens the song's menu. One list, so an answer's songs and a
 * playlist's are the same rows that move the same way.
 *
 * The page owns the order: `onReorder` hands it the new one, and the page
 * keeps it wherever it keeps it — the server for a playlist, memory for an
 * answer.
 */
export function OrderedSongList({
  songs,
  label,
  selection,
  onPlay,
  onReorder,
  header,
  pinned,
  empty,
  style,
  contentContainerStyle,
  onRefresh,
  refreshing,
  keyboardShouldPersistTaps,
  keyboardDismissMode,
  menuPlaylist,
}: {
  songs: readonly Song[]
  /** What a screen reader calls the list: "Evening songs". */
  label: string
  selection: Selection
  /** A row pressed outside selecting: play from it. */
  onPlay: (index: number) => void
  /** A row moved: the songs' ids in their new order. */
  onReorder: (songIds: readonly number[]) => void
  header?: ReactElement | null
  pinned?: ReactElement | null
  empty?: ReactElement | null
  style?: StyleProp<ViewStyle>
  contentContainerStyle?: StyleProp<ViewStyle>
  onRefresh?: () => void
  refreshing?: boolean
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled'
  keyboardDismissMode?: 'none' | 'on-drag' | 'interactive'
  /** The playlist these are, for the song menu's "Remove from this playlist". */
  menuPlaylist?: { readonly id: number; readonly name: string }
}): ReactNode {
  const artFor = useArt(ROW_COVER_SIZE)
  const library = useLibrary()
  const { state: downloads, installed } = useDownloads()
  const songMenu = useSongMenu(menuPlaylist)
  const onMore = songMenu.onMore
  // The row being moved and the row it would land on. Not how far it has
  // travelled: that is `dragY`, which moves the row without a render.
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const [dragY] = useState(() => new Animated.Value(0))
  /*
   * The scale the row being moved wears (`useLiftScale`): a swell while the
   * hold is counted, the full lift while it is carried, and the settle back on
   * the spring once it is let go. One scale for the list, worn by whichever
   * song is being moved — by song and not by row, since the drop reorders the
   * list under it and the settle plays on into the row's new place.
   */
  const lift = useLiftScale()
  const { holding: holdRow, start: liftRow, drop: dropRow } = lift
  const [rowHeight, setRowHeight] = useState(0)
  const songIds = useMemo(() => songs.map(song => song.id), [songs])

  /*
   * What a row's handlers read at the moment they run, so the handlers are
   * made once (`rowActions`) and a row's memo holds.
   */
  const latest = useRef({ songIds, rowHeight, selection, onPlay, onReorder })
  /*
   * When a move last let go. Letting go of a carried row is also a press on
   * it as far as the row is concerned, and a press plays: the press that ends
   * a move is the move's, not a request to play that song.
   */
  const moving = useRef({ carried: false, droppedAt: 0 })
  useEffect(() => {
    latest.current = { songIds, rowHeight, selection, onPlay, onReorder }
  })

  /*
   * A move. The pointer's travel goes into `dragY`, which the lifted cell
   * reads (`LiftedCell`), so following the pointer is no render at all. State
   * changes when the move starts, when it crosses into another row, and when
   * it ends.
   */
  const dragStart = useCallback(
    (songId: number) => {
      const index = latest.current.songIds.indexOf(songId)
      if (index < 0) return
      dragY.setValue(0)
      moving.current.carried = true
      liftRow(songId)
      setDrag({ from: index, over: index })
    },
    [dragY, liftRow],
  )
  const dragMove = useCallback(
    (songId: number, dy: number) => {
      const now = latest.current
      const index = now.songIds.indexOf(songId)
      if (index < 0) return
      dragY.setValue(dy)
      const over = dropIndex(index, dy, now.rowHeight, now.songIds.length)
      setDrag(current =>
        current !== null && current.from === index && current.over === over
          ? current
          : { from: index, over },
      )
    },
    [dragY],
  )
  const dragEnd = useCallback(
    (songId: number, dy: number) => {
      const now = latest.current
      const index = now.songIds.indexOf(songId)
      if (index < 0) return
      const moved = movedTo(now.songIds, index, dy, now.rowHeight)
      // `dragY` is left where it is: the settle covers the frame before the
      // new order lands (see the playlist page's history for why).
      setDrag(null)
      moving.current = { carried: false, droppedAt: Date.now() }
      dropRow()
      if (moved) now.onReorder(moved.songIds)
    },
    [dropRow],
  )

  const rowActions = useMemo<RowActions>(
    () => ({
      dragStart,
      dragMove,
      dragEnd,
      holding: holdRow,
      press: (event, songId, index) => {
        const now = latest.current
        // The release of a move, not a press of its own.
        if (moving.current.carried || Date.now() - moving.current.droppedAt < RELEASE_MS) return
        // Cmd, Shift and selection mode select; anything else plays from here.
        if (now.selection.click(songId, modifiersOf(event))) return
        now.onPlay(index)
      },
      more: onMore,
      toggleSelect: song => latest.current.selection.toggle(song.id),
      // Holding a row is how it is moved, so selecting starts from the page's
      // ⋯ (Select songs); while selecting, holding selects.
      longPress: song => latest.current.selection.enter(song.id),
      measure: setRowHeight,
    }),
    [dragStart, dragMove, dragEnd, holdRow, onMore],
  )

  /*
   * What every cell of the list needs to know about the move under way
   * (`LiftedCell`): which row is carried and how far it has travelled, which
   * rows are to step aside and by how much, and which row is wearing the lift.
   */
  const liftedFrom = drag?.from ?? null
  const liftedOver = drag?.over ?? null
  const wearingAt = lift.wearing === null ? -1 : songIds.indexOf(lift.wearing)
  const settling = wearingAt < 0 ? null : wearingAt
  const carry = useMemo(
    () => ({
      from: liftedFrom,
      over: liftedOver,
      step: rowHeight,
      dragY,
      lift: lift.lift,
      settling,
    }),
    [liftedFrom, liftedOver, rowHeight, dragY, lift.lift, settling],
  )

  // Not on this phone and no server to stream it from: faded.
  const unreachableHere = library.isError && installed
  const menuSongId = songMenu.openId
  // Selection mode is not what reordering is for, so a held row selects
  // rather than lifts while it is on.
  const reorderable = !selection.active
  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => {
      const here = isDownloaded(downloads.index, item.id)
      return (
        <OrderedRow
          testID={`song-row-${index}`}
          song={item}
          index={index}
          artUri={artFor(item)}
          downloaded={here}
          notDownloadedMark={installed && !here}
          unavailable={unreachableHere && !here}
          reorderable={reorderable}
          selecting={selection.active}
          selected={selection.has(item.id)}
          lifted={drag?.from === index}
          menuOpen={menuSongId === item.id}
          actions={rowActions}
        />
      )
    },
    [
      artFor,
      installed,
      unreachableHere,
      downloads.index,
      reorderable,
      selection,
      drag,
      menuSongId,
      rowActions,
    ],
  )

  return (
    <>
      <LiftContext.Provider value={carry}>
        <SongList
          songs={songs}
          label={label}
          renderSong={renderSong}
          header={header}
          pinned={pinned}
          empty={empty}
          style={style}
          contentContainerStyle={contentContainerStyle}
          scrollEnabled={drag === null}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          keyboardDismissMode={keyboardDismissMode}
          CellRendererComponent={LiftedCell}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
      </LiftContext.Provider>
      {songMenu.menu}
    </>
  )
}

/** How long after a move lets go a press on the list is still that move's release. */
const RELEASE_MS = 400

/** What a row can ask of the screen. Made once, so a row's memo holds. */
interface RowActions {
  /**
   * A move, named by the song rather than by where it sits. A row's place
   * changes when a move ends, and a gesture built around a place that has
   * changed since is a gesture that moves the wrong row — so the row's
   * handlers are made once, for its song, and last as long as the row does.
   */
  readonly dragStart: (songId: number) => void
  readonly dragMove: (songId: number, dy: number) => void
  readonly dragEnd: (songId: number, dy: number) => void
  /** The hold has begun on a song, or it is over: the row's swell (`useLiftScale`). */
  readonly holding: (songId: number, holding: boolean) => void
  readonly press: (event: GestureResponderEvent, songId: number, index: number) => void
  readonly more: (anchor: View | null, song: Song) => void
  readonly toggleSelect: (song: Song) => void
  readonly longPress: (song: Song) => void
  readonly measure: (height: number) => void
}

/**
 * One row of an ordered list: the library's row, with what an order adds.
 *
 * The row itself is `SongRow`, the same component and the same file the
 * library draws — a song row is a song row, and a playlist that had its own
 * was a playlist whose songs had no ⋯ at a finger's size and no colour under
 * the one that was playing. It is drawn without tag chips, as every row inside
 * a place is (`S3`). What a playlist adds is the hold that lifts a row and the
 * lifted look while it is being moved; where it would land is the gap the rows
 * around it open (`LiftedCell`), not a line drawn between two of them, which
 * is how the queue sheet and the rail say the same thing. Taking a song off the
 * playlist is in the ⋯ menu, where everything else done to a song already is.
 *
 * Only the handlers that need this row's song or place are made here — the
 * press, which plays from it, and those that carry a move. The rest are the
 * screen's own, handed down unchanged, so the memo holds.
 */
const OrderedRow = memo(function OrderedRow({
  testID,
  song,
  index,
  artUri,
  downloaded,
  notDownloadedMark,
  unavailable,
  reorderable,
  selecting,
  selected,
  lifted,
  menuOpen,
  actions,
}: {
  testID: string
  song: Song
  index: number
  artUri: string | null | undefined
  downloaded: boolean
  notDownloadedMark: boolean
  unavailable: boolean
  /** This list's order is yours to change, and nothing is being selected. */
  reorderable: boolean
  selecting: boolean
  selected: boolean
  lifted: boolean
  menuOpen: boolean
  actions: RowActions
}): ReactNode {
  const songId = song.id
  const onHolding = useCallback(
    (holding: boolean) => actions.holding(songId, holding),
    [actions, songId],
  )
  const onDragStart = useCallback(() => actions.dragStart(songId), [actions, songId])
  const onPress = useCallback(
    (event: GestureResponderEvent) => actions.press(event, songId, index),
    [actions, songId, index],
  )

  // One gesture, everywhere: hold the row and it lifts. The grip column that
  // used to stand in for it on a computer is gone — six dots on every row
  // read as clutter, and a mouse can hold a row as well as a finger can
  // (Xiao, 2026-09-21).
  return (
    <HoldToReorder
      enabled={reorderable}
      onHolding={onHolding}
      onStart={onDragStart}
      // An ordered list's rows only ever move up and down.
      onMove={(_dx, dy) => actions.dragMove(songId, dy)}
      onEnd={(_dx, dy) => actions.dragEnd(songId, dy)}
      onLayoutHeight={index === 0 ? actions.measure : undefined}
    >
      <SongRow
        testID={testID}
        song={song}
        artUri={artUri}
        downloaded={downloaded}
        notDownloadedMark={notDownloadedMark}
        unavailable={unavailable}
        index={index}
        selecting={selecting}
        selected={selected}
        menuOpen={menuOpen}
        lifted={lifted}
        onPress={onPress}
        onMore={actions.more}
        onToggleSelect={actions.toggleSelect}
        // Left out while the hold is the move's: see `SongRow`.
        onLongPress={reorderable ? undefined : actions.longPress}
      />
    </HoldToReorder>
  )
})

/** The move under way, as every cell of the list needs it. */
interface Carry {
  /** The row being carried, if one is. */
  readonly from: number | null
  /** The row it would land on. */
  readonly over: number | null
  /** How tall a row is, which is how far a row steps when it makes room. */
  readonly step: number
  /** How far the carried row has travelled. */
  readonly dragY: Animated.Value | null
  /** The scale the row being moved wears (`useLiftScale`). */
  readonly lift: Animated.Value | null
  /** Which row is wearing that scale: held, carried, or settling after the drop. */
  readonly settling: number | null
}

const LiftContext = createContext<Carry>({
  from: null,
  over: null,
  step: 0,
  dragY: null,
  lift: null,
  settling: null,
})

type CellProps = ComponentProps<NonNullable<FlatListProps<Song>['CellRendererComponent']>>

/**
 * A list cell that takes part in a move: the carried one lifted over its
 * neighbours and following the pointer by an animated value rather than by
 * re-rendering, and every other one stepping aside to make room for it.
 *
 * On the cell rather than the row because a list puts each row in a cell of
 * its own, and on a phone a raised `zIndex` only counts among siblings — a
 * row raised inside its cell still slid under the next cell. Reads the move
 * from context, so this component stays the same one for the list's life and
 * starting a move does not remount every row, and its gesture with it.
 *
 * Make-room here is the same step the queue sheet's rows take (`useMakeRoom`),
 * so where the row will land is a gap and not a line — one reorder language on
 * every surface. A `FlatList` mounts and unmounts cells rather than recycling
 * them, so a cell's step is its own and a cell scrolled away and back simply
 * works its step out again.
 */
function LiftedCell({ index, style, onLayout, onFocusCapture, children }: CellProps): ReactNode {
  const { from, over, step, dragY, lift, settling } = useContext(LiftContext)
  const carried = dragY !== null && from === index
  const room = useMakeRoom(
    from === null || over === null || carried ? 0 : roomShift(index, from, over),
    step,
    from !== null,
  )
  return (
    <Animated.View
      style={[
        style,
        carried && lift !== null
          ? { zIndex: 2, transform: [{ translateY: dragY }, { scale: lift }] }
          : // Settling, or swelling while its hold is counted: the scale only.
            // `dragY` is left where the finger put it until the new order
            // lands, so a row reading it now would settle in the wrong place.
            settling === index && lift !== null
            ? { zIndex: 2, transform: [{ scale: lift }] }
            : room,
      ]}
      onLayout={onLayout}
      // The list's own cell passes this on to a View, which takes it on both
      // platforms; the types of Animated.View just do not name it.
      {...{ onFocusCapture }}
    >
      {children}
    </Animated.View>
  )
}

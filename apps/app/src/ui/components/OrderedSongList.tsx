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
import { Animated, View } from 'react-native'
import type { FlatListProps, GestureResponderEvent, StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { dropIndex, movedTo } from './orderedSongList.model'
import { useDragToReorder } from '../../ports/songDrag'
import type { Selection } from '../../selection/useSelection'
import { useLayoutValue } from '../../shell/useLayout'
import { roomShift } from '../motion.model'
import { HoldToReorder, useLiftScale, useMakeRoom } from './HoldToReorder'
import { SongList } from './SongList'
import { SongRow } from './SongRow'
import { useSongRows } from './useSongRows'
import { Guide, liftWith, makeRoomWith } from '../../features/guide/Guide'
import { useGuide, type GuideHandle, type GuideTarget } from '../../features/guide/useGuide'

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
 * answer. A playlist that fills from tags hands none, because its order is
 * its rule's: nothing lifts, and a hold selects as it does in Library.
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
  keyboardDismissMode,
  menuPlaylist,
}: {
  songs: readonly Song[]
  /** What a screen reader calls the list: "Evening songs". */
  label: string
  selection: Selection
  /** A row pressed outside selecting: play from it. */
  onPlay: (index: number) => void
  /** A row moved: the songs' ids in their new order. Left out, the order is not yours to change. */
  onReorder?: (songIds: readonly number[]) => void
  header?: ReactElement | null
  pinned?: ReactElement | null
  empty?: ReactElement | null
  style?: StyleProp<ViewStyle>
  contentContainerStyle?: StyleProp<ViewStyle>
  onRefresh?: () => void
  refreshing?: boolean
  keyboardDismissMode?: 'none' | 'on-drag' | 'interactive'
  /** The playlist these are, for the song menu's "Remove from this playlist". */
  menuPlaylist?: { readonly id: number; readonly name: string }
}): ReactNode {
  // The library's rows, wired as every list's are; a press here also has to
  // tell a move's release from a tap (`press`, below).
  const rows = useSongRows({
    songs,
    selection,
    onPlay,
    playlist: menuPlaylist,
  })
  const { press: pressRow } = rows
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
   * made once (`moves`) and a row's memo holds.
   */
  const latest = useRef({ songIds, rowHeight, onReorder })
  /*
   * When a move last let go. Letting go of a carried row is also a press on
   * it as far as the row is concerned, and a press plays: the press that ends
   * a move is the move's, not a request to play that song.
   */
  const moving = useRef({ carried: false, droppedAt: 0 })
  useEffect(() => {
    latest.current = { songIds, rowHeight, onReorder }
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
      // `dragY` is left where it is until the new order lands (`LiftedCell`
      // says why). The move ends even when its song has left the list under
      // it, or the list would stay carrying a row that is not there.
      setDrag(null)
      moving.current = { carried: false, droppedAt: Date.now() }
      dropRow()
      const index = now.songIds.indexOf(songId)
      if (index < 0) return
      const moved = movedTo(now.songIds, index, dy, now.rowHeight)
      if (moved) now.onReorder?.(moved.songIds)
    },
    [dropRow],
  )

  // The release of a move is a press on its row too, and not a request to
  // play it; anything else is the list's press.
  const press = useCallback(
    (event: GestureResponderEvent, song: Song) => {
      if (moving.current.carried || Date.now() - moving.current.droppedAt < RELEASE_MS) return
      pressRow(event, song)
    },
    [pressRow],
  )
  const moves = useMemo<MoveActions>(
    () => ({ dragStart, dragMove, dragEnd, holding: holdRow, measure: setRowHeight }),
    [dragStart, dragMove, dragEnd, holdRow],
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
      guide: null as GuideHandle | null,
      target: null as GuideTarget | null,
    }),
    [liftedFrom, liftedOver, rowHeight, dragY, lift.lift, settling],
  )

  // Selection mode is not what reordering is for, so a held row selects
  // rather than lifts while it is on — and always, where the order is not
  // yours to change.
  const reorderable = onReorder !== undefined && !selection.active
  /*
   * With a mouse a plain drag moves a row too, no hold first: the same drag
   * that carries it to a playlist in the sidebar, read by the list while it
   * is over the list (`useDragToReorder`). The hold still works. The list
   * keeps scrolling through it, since the browser scrolls the list when the
   * pointer nears its edge.
   */
  const dense = useLayoutValue(isDense)
  const frameRef = useRef<View>(null)
  const [byBrowser, setByBrowser] = useState(false)
  useDragToReorder(frameRef, {
    enabled: reorderable && dense,
    onStart: songId => {
      setByBrowser(true)
      dragStart(songId)
    },
    onMove: dragMove,
    onEnd: (songId, dy) => {
      setByBrowser(false)
      dragEnd(songId, dy)
    },
  })
  /*
   * Nothing on a row says it can be moved, so the first list of yours with
   * two songs in it shows how once (`useGuide`): the first row lifts with the
   * hand, goes one place down and comes back, and the order is untouched.
   */
  const [firstTarget, guide] = useGuide(
    'playlist-move',
    reorderable && songs.length >= 2 && rowHeight > 0 && drag === null,
  )
  const demoing = guide.shown
  const lit = useMemo(
    () => ({ ...carry, guide: guide.shown ? guide : null, target: firstTarget }),
    [carry, guide, firstTarget],
  )
  const { rowProps } = rows
  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => (
      <OrderedRow
        {...rowProps(item, index)}
        onPress={press}
        reorderable={reorderable}
        // The move guide's row wears the lifted look as it acts the move out.
        lifted={drag?.from === index || (demoing && index === 0)}
        moves={moves}
      />
    ),
    [rowProps, press, reorderable, drag, demoing, moves],
  )

  return (
    <>
      <LiftContext.Provider value={lit}>
        {/* The frame a drag over the list is read on. */}
        <View ref={frameRef} collapsable={false} style={styles.frame}>
          <SongList
            songs={songs}
            label={label}
            renderSong={renderSong}
            header={header}
            pinned={pinned}
            empty={empty}
            style={style}
            contentContainerStyle={contentContainerStyle}
            scrollEnabled={drag === null || byBrowser}
            keyboardDismissMode={keyboardDismissMode}
            CellRendererComponent={LiftedCell}
            onRefresh={onRefresh}
            refreshing={refreshing}
          />
        </View>
      </LiftContext.Provider>
      {rows.menu}
      <Guide
        guide={guide}
        reach={rowHeight}
        steps={[
          dense
            ? { gesture: 'hold-move', text: 'Drag a song to move it', distance: rowHeight }
            : {
                gesture: 'hold-move',
                text: 'Hold a song to move it',
                sub: 'Drag it up or down, then let go',
                distance: rowHeight,
              },
        ]}
      />
    </>
  )
}

/** How long after a move lets go a press on the list is still that move's release. */
const RELEASE_MS = 400

const isDense = (layout: { dense: boolean }): boolean => layout.dense

const styles = StyleSheet.create({
  frame: { flex: 1, minHeight: 0 },
})

/** How a row takes part in a move. Made once, so a row's memo holds. */
interface MoveActions {
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
  readonly measure: (height: number) => void
}

/**
 * One row of an ordered list: the library's row, with what an order adds.
 *
 * The row itself is `SongRow`, the same component and the same file the library
 * draws — a song row is a song row: a playlist's own would lack the ⋯ at a
 * finger's size and the colour under the one playing. It is drawn without tag
 * chips, as every row inside a place is (`S3`). What a playlist adds is the
 * hold that lifts a row and the lifted look while it is being moved; where it
 * would land is the gap the rows around it open (`LiftedCell`), not a line
 * drawn between two of them, which is how the queue sheet and the rail say the
 * same thing. Taking a song off the playlist is in the ⋯ menu, where everything
 * else done to a song already is.
 *
 * Its props are the list's rows' (`useSongRows`), spread so each is compared
 * on its own; only the handlers that carry a move for this row's song are
 * made here, so the memo holds.
 */
const OrderedRow = memo(function OrderedRow({
  reorderable,
  moves,
  onLongPress,
  ...row
}: ComponentProps<typeof SongRow> & {
  /** This list's order is yours to change, and nothing is being selected. */
  reorderable: boolean
  moves: MoveActions
}): ReactNode {
  const songId = row.song.id
  const index = row.index ?? 0
  const onHolding = useCallback(
    (holding: boolean) => moves.holding(songId, holding),
    [moves, songId],
  )
  const onDragStart = useCallback(() => moves.dragStart(songId), [moves, songId])

  // One gesture, everywhere: hold the row and it lifts — and with a mouse a
  // plain drag lifts it as well (`useDragToReorder`, above). There is no grip
  // column: six dots on every row read as clutter.
  return (
    <HoldToReorder
      enabled={reorderable}
      onHolding={onHolding}
      onStart={onDragStart}
      // An ordered list's rows only ever move up and down.
      onMove={(_dx, dy) => moves.dragMove(songId, dy)}
      onEnd={(_dx, dy) => moves.dragEnd(songId, dy)}
      onLayoutHeight={index === 0 ? moves.measure : undefined}
    >
      <SongRow
        {...row}
        // Left out while the hold is the move's: see `SongRow`. Holding a row
        // is how it is moved, so selecting starts from the page's ⋯ (Select
        // songs); while selecting, holding selects.
        onLongPress={reorderable ? undefined : onLongPress}
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
  /** The move guide, while it is up: the first row acts it out, the second makes room. */
  readonly guide: GuideHandle | null
  /** What the guide measures to light: the first row's cell. */
  readonly target: GuideTarget | null
}

const LiftContext = createContext<Carry>({
  from: null,
  over: null,
  step: 0,
  dragY: null,
  lift: null,
  settling: null,
  guide: null,
  target: null,
})

type CellProps = ComponentProps<NonNullable<FlatListProps<Song>['CellRendererComponent']>>

/**
 * A list cell that takes part in a move: the carried one lifted over its
 * neighbours and following the pointer by an animated value rather than by
 * re-rendering, and every other one stepping aside to make room for it.
 *
 * On the cell rather than the row because a list puts each row in a cell of
 * its own, and on a phone a raised `zIndex` only counts among siblings — a
 * row raised inside its cell would still slide under the next cell. Reads the move
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
  const { from, over, step, dragY, lift, settling, guide, target } = useContext(LiftContext)
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
            : guide !== null && index === 0
              ? liftWith(guide, step)
              : guide !== null && index === 1
                ? makeRoomWith(guide, step)
                : room,
      ]}
      ref={index === 0 && target !== null ? target : undefined}
      onLayout={onLayout}
      // The list's own cell passes this on to a View, which takes it on both
      // platforms; the types of Animated.View just do not name it.
      {...{ onFocusCapture }}
    >
      {children}
    </Animated.View>
  )
}

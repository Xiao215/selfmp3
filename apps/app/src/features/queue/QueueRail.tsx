import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { formatDuration, type Song } from '@selfmp3/shared'
import { radius, space, type, withAlpha } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useOverlay } from '../../shell/Overlay'
import { useLayout } from '../../shell/useLayout'
import { ease, spring, timing } from '../../ui/motion'
import { MOVE_MS } from '../../ui/motion.model'
import { label, sectionTitle } from '../../ui/surfaces'
import { useSongColor } from '../../ui/useSongColor'
import { Cover } from '../../ui/components/Cover'
import { Equalizer } from '../../ui/components/Equalizer'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronRight, Grip } from '../../ui/components/Icons'
import { HoldToReorder } from '../../ui/components/HoldToReorder'
import { useSongDropTarget } from '../../ports/songDrag'
import { usePlayer } from '../../player/PlayerProvider'
import { Popover } from '../../ui/components/Popover'
import { SheetItem } from '../../ui/components/Sheet'
import { Toggle } from '../../ui/components/Toggle'
import { closeQueueSheet, useQueueSheetOpen } from './queueSheet.store'
import {
  autoMixLine,
  dragOutcome,
  dragTarget,
  draggedOut,
  nextSummary,
  type QueueRow,
} from './queue.model'
import { useQueueEdits } from './useQueueEdits'

/** The rail's width (`S2`, "Gutters": up-next rail 288). */
const RAIL_WIDTH = 288
/**
 * The narrowest window that keeps the rail beside the page: the sidebar, a
 * page a list still reads in, and the rail. Narrower (an iPad in portrait),
 * the rail lies over the page instead, as the board draws it.
 */
const BESIDE_MIN = 1060
/** Every row of the rail is this tall, so a drag is counted in rows by arithmetic. */
const ROW_HEIGHT = 44

/**
 * Up next on a computer (docs/ui-mock `C11`, `C12`): a rail beside the page,
 * opened from the player bar and left open across pages until it is closed.
 *
 * The playing song on top, what is next under it with a grip each, what has
 * played greyed at the end. Hold a row to move it. Keep dragging past the
 * rail's edge and the row shrinks, greys and says "Let go to remove"; let go
 * and it is gone, with an Undo for five seconds, and dragged back in nothing
 * happens. So that a drag is never the only way, Delete or Backspace on a
 * focused row, and "Remove from queue" in its right-click menu, do the same and
 * draw nothing.
 *
 * Always mounted in the wide frame and drawing nothing while shut, so an Undo
 * raised here still reaches the queue as it is when pressed (`useQueueEdits`).
 */
export function QueueRail(): ReactNode {
  const shown = useQueueRailShown()
  const edits = useQueueEdits()

  // Kept up from the moment it is asked for until its exit has played out, as
  // the phone's sheet is: shut, the rail slides away first and only then is it
  // taken down, which is when the page gets its room back. Adjusted during
  // render, so opening never paints a frame without it.
  const [mounted, setMounted] = useState(shown)
  if (shown && !mounted) setMounted(true)
  const gone = useCallback(() => setMounted(false), [])

  return mounted ? <Rail shown={shown} onGone={gone} edits={edits} /> : null
}

/** Whether the rail is up, or on its way: mounted, and sliding in rather than out. */
function useQueueRailShown(): boolean {
  const open = useQueueSheetOpen()
  const { wide } = useLayout()
  const player = usePlayer()
  return open && wide && player.current !== null
}

/**
 * The room the rail takes from the page: its width while it is beside the
 * page or on its way there, and none while it is away or lies over the page.
 * What the frame takes off the page's width the moment the rail is asked
 * for, not frame by frame as the room widens (`Shell`).
 */
export function useQueueRailRoom(): number {
  const shown = useQueueRailShown()
  const { width } = useLayout()
  return shown && width >= BESIDE_MIN ? RAIL_WIDTH : 0
}

/** A drag under way: the row it started on, where it would land, and whether it is out. */
interface Drag {
  readonly from: number
  readonly over: number
  readonly out: boolean
  readonly song: Song
  /** Where the row was on screen when the drag began, for the copy that follows the pointer. */
  readonly rect: { x: number; y: number; width: number }
}

/**
 * What a row's handlers do, read when they run. Made once for the rail, so a
 * row's memo holds and a grip remade mid-drag does not lose its travel.
 */
interface RowActions {
  readonly play: (index: number) => void
  readonly remove: (index: number) => void
  readonly menu: (anchor: View | null, row: QueueRow) => void
  readonly dragStart: (row: QueueRow, node: View | null, x: number) => void
  readonly dragMove: (index: number, dx: number, dy: number) => void
  readonly dragEnd: (index: number, dx: number, dy: number) => void
  /** Songs dragged in from a list and let go at `at`, an index into `items`. */
  readonly dropSongs: (at: number, songIds: readonly number[]) => void
}

function Rail({
  shown,
  onGone,
  edits,
}: {
  shown: boolean
  onGone: () => void
  edits: ReturnType<typeof useQueueEdits>
}): ReactNode {
  const { width } = useLayout()
  const { theme } = useUnistyles()
  const router = useRouter()
  const artFor = useArt(ROW_COVER_SIZE)
  const { player, rows, remove } = edits
  const railRef = useRef<View>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  // The pointer's travel, which the copy follows without a render, and how far
  // it has turned into "remove" (0 or 1, sprung between).
  const [dx] = useState(() => new Animated.Value(0))
  const [dy] = useState(() => new Animated.Value(0))
  const [outness] = useState(() => new Animated.Value(0))
  const [menuRow, setMenuRow] = useState<QueueRow | null>(null)
  const menuAnchor = useRef<View | null>(null)

  /*
   * What the handlers read when they run: the rows a move may land among, the
   * rail's edges on screen, where the pointer started, and the player. Kept
   * current after every render; read only inside events.
   */
  const latest = useRef({
    first: 0,
    last: 0,
    rail: { left: 0, right: 0 },
    startX: 0,
    out: false,
    player,
    remove,
  })
  useEffect(() => {
    latest.current.first = rows.next[0]?.index ?? 0
    latest.current.last = rows.next[rows.next.length - 1]?.index ?? 0
    latest.current.player = player
    latest.current.remove = remove
  })

  const actions = useMemo<RowActions>(
    () => ({
      play: index => latest.current.player.jumpTo(index),
      remove: index => latest.current.remove(index),
      menu: (anchor, row) => {
        menuAnchor.current = anchor
        setMenuRow(row)
      },
      dragStart: (row, node, x) => {
        const now = latest.current
        now.startX = x
        now.out = false
        // Nothing is out until the rail's edges are known, a moment from now.
        now.rail = { left: -Infinity, right: Infinity }
        dx.setValue(0)
        dy.setValue(0)
        outness.setValue(0)
        railRef.current?.measureInWindow((left, _top, width) => {
          now.rail = { left, right: left + width }
        })
        const begin = (rect: Drag['rect']): void =>
          setDrag({ from: row.index, over: row.index, out: false, song: row.song, rect })
        if (node) node.measureInWindow((x2, y2, width) => begin({ x: x2, y: y2, width }))
        else begin({ x: 0, y: 0, width: RAIL_WIDTH })
      },
      dragMove: (index, moveX, moveY) => {
        const now = latest.current
        dx.setValue(moveX)
        dy.setValue(moveY)
        const out = draggedOut(now.startX + moveX, now.rail)
        if (out !== now.out) {
          now.out = out
          spring(outness, out ? 1 : 0)
        }
        const over = dragTarget(index, moveY, ROW_HEIGHT, now)
        setDrag(current =>
          current && (current.over !== over || current.out !== out)
            ? { ...current, over, out }
            : current,
        )
      },
      dragEnd: (index, moveX, moveY) => {
        const now = latest.current
        const outcome = dragOutcome({
          out: draggedOut(now.startX + moveX, now.rail),
          from: index,
          to: dragTarget(index, moveY, ROW_HEIGHT, now),
        })
        setDrag(null)
        if (outcome.kind === 'remove') now.remove(index)
        else if (outcome.kind === 'move') now.player.reorderQueue(index, outcome.to)
      },
      dropSongs: (at, songIds) => latest.current.player.insertIntoQueue(at, songIds),
    }),
    [dx, dy, outness],
  )

  // The row being dragged, drawn over everything so it can leave the rail.
  useOverlay(
    drag ? (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[
            styles.ghost,
            {
              left: drag.rect.x,
              top: drag.rect.y,
              width: drag.rect.width,
              opacity: outness.interpolate({ inputRange: [0, 1], outputRange: [1, 0.62] }),
              transform: [
                { translateX: dx },
                { translateY: dy },
                { scale: outness.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }) },
                {
                  rotate: outness.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '-4deg'],
                  }),
                },
              ],
            },
          ]}
        >
          <RowFace song={drag.song} artUri={artFor(drag.song)} grip />
          <Animated.View style={[styles.letGo, { opacity: outness }]}>
            <Text style={styles.letGoText}>Let go to remove</Text>
          </Animated.View>
        </Animated.View>
      </View>
    ) : null,
    drag !== null,
  )

  const playing = rows.playing

  /*
   * The rows come in a transition after the rail's first paint, so the slide
   * starts on the frame after the press rather than after every row of a long
   * queue has been drawn: the first frames show the rail's edge coming in
   * with its title, and the rows are there before much of it is. Only at the
   * mount — after it the rows follow the queue at once, or a row let go
   * after a drag would be drawn where it was for a frame.
   */
  const [rowsDrawn, setRowsDrawn] = useState(false)
  useEffect(() => {
    startTransition(() => setRowsDrawn(true))
  }, [])

  /*
   * Open and shut (docs/ui-mock `M3`, 6): 0 is away past the right edge, 1 is
   * open. In on the spring, out in `railOut` and then `onGone`, so Hide slides
   * the rail off the window before the rail is taken down rather than blinking
   * it out of the frame.
   *
   * Beside the page the rail's room is the slot's width, which grows and
   * shrinks under it: the page widens and narrows over the same fifth of a
   * second instead of snapping at either end. A width is beyond the native
   * driver, and one value cannot be on the native driver for the slide and off
   * it for the width, so the two moves are two values: the room's width on the
   * JavaScript side, and the floating rail's slide (an iPad in portrait, where
   * a transform is all that moves) on the native driver, which a stalled
   * JavaScript thread cannot stutter. Both run on every change, since which
   * one is drawn can change under them with the window's width.
   */
  const [progress] = useState(() => new Animated.Value(0))
  const [slid] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (shown) {
      spring(progress, 1, { native: false })
      spring(slid, 1)
      return
    }
    timing(progress, 0, MOVE_MS.railOut, onGone, { easing: ease.in, native: false })
    timing(slid, 0, MOVE_MS.railOut, undefined, { easing: ease.in })
  }, [shown, progress, slid, onGone])

  /*
   * Made once, since an interpolation made each render is a new node each
   * render. `clamp` on the width so the spring's small overshoot cannot open a
   * hairline of page between the rail's right edge and the window's.
   */
  const [slide] = useState(() => ({
    room: {
      width: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, RAIL_WIDTH],
        extrapolate: 'clamp' as const,
      }),
    },
    over: {
      transform: [
        { translateX: slid.interpolate({ inputRange: [0, 1], outputRange: [RAIL_WIDTH, 0] }) },
      ],
    },
  }))

  /*
   * Too narrow to keep the rail beside the page (an iPad in portrait): it lies
   * over the page instead, as the board draws it, and slides in over a page
   * that keeps its width rather than taking room of its own.
   */
  const over = width < BESIDE_MIN

  /*
   * The rail itself takes a drop, under the rows: let go anywhere in it — the
   * empty space below the last song included — and the song joins the end.
   * A row's own target sits inside this one and stops the drop there, so only
   * the space no row covers reaches here (Xiao, 2026-09-22).
   */
  const overRail = useSongDropTarget(railRef, {
    enabled: true,
    onDrop: songIds => actions.dropSongs(player.queue.items.length, songIds),
  })

  return (
    <Animated.View
      style={over ? styles.roomOver : [styles.room, slide.room]}
      pointerEvents={shown ? 'auto' : 'none'}
      aria-hidden={!shown}
    >
      <Animated.View
        ref={railRef}
        style={[
          styles.rail,
          over && [styles.railOver, slide.over],
          overRail && styles.railTakingDrop,
        ]}
        testID="queue-rail"
        role="complementary"
      >
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            Up next
          </Text>
          <IconButton onPress={closeQueueSheet} label="Hide Up next" size={28} filled>
            <ChevronRight size={15} color={theme.colors.textSecondary} />
          </IconButton>
        </View>
        <Text style={styles.summary}>{nextSummary(rows.next)}</Text>

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          // A held row is being moved, not the list under it.
          scrollEnabled={drag === null}
        >
          {playing ? (
            <PlayingRow
              row={playing}
              artUri={artFor(playing.song)}
              playing={player.isPlaying}
              onOpen={() => router.navigate('/now-playing')}
              onDropSongs={actions.dropSongs}
            />
          ) : null}
          {rowsDrawn
            ? rows.next.map(row => (
                <RailRow
                  key={row.song.id}
                  row={row}
                  artUri={artFor(row.song)}
                  kind="next"
                  placeholder={drag?.from === row.index}
                  dropTarget={
                    drag !== null && !drag.out && drag.over === row.index && drag.from !== row.index
                  }
                  actions={actions}
                />
              ))
            : null}
          {rowsDrawn && rows.played.length > 0 ? (
            <>
              <Text style={styles.label}>Played</Text>
              {rows.played.map(row => (
                <RailRow
                  key={row.song.id}
                  row={row}
                  artUri={artFor(row.song)}
                  kind="played"
                  placeholder={false}
                  dropTarget={false}
                  actions={actions}
                />
              ))}
            </>
          ) : null}
        </ScrollView>

        <View style={styles.autoMix}>
          <Toggle
            value={player.autoMix}
            onChange={player.setAutoMix}
            label="Auto-mix"
            testID="auto-mix"
          />
          <Text style={styles.autoMixLabel}>Auto-mix</Text>
          <Text style={styles.autoMixHint} numberOfLines={1}>
            {autoMixLine({
              autoMix: player.autoMix,
              canCrossfade: player.canCrossfade,
              upcoming: rows.next.length,
              nextCrossfadeSeconds: player.nextCrossfadeSeconds,
            })}
          </Text>
        </View>

        <Popover
          open={menuRow !== null}
          onClose={() => setMenuRow(null)}
          anchorRef={menuAnchor}
          align="start"
          width={200}
          testID="queue-menu"
        >
          <SheetItem
            label="Play"
            onPress={() => {
              if (menuRow) actions.play(menuRow.index)
              setMenuRow(null)
            }}
          />
          <SheetItem
            label="Remove from queue"
            onPress={() => {
              if (menuRow) actions.remove(menuRow.index)
              setMenuRow(null)
            }}
          />
        </Popover>
      </Animated.View>
    </Animated.View>
  )
}

/** The song playing, at the top of the rail: its colour behind it and the equaliser on its cover. */
function PlayingRow({
  row,
  artUri,
  playing,
  onOpen,
  onDropSongs,
}: {
  row: QueueRow
  artUri: string | null
  playing: boolean
  onOpen: () => void
  onDropSongs: (at: number, songIds: readonly number[]) => void
}): ReactNode {
  const tone = useSongColor(row.song, artUri)
  // A song let go over what is playing goes straight after it — there is no
  // "before" to drop into, and doing nothing there read as the drag being
  // broken (Xiao, 2026-09-22).
  const playingRef = useRef<View>(null)
  const over = useSongDropTarget(playingRef, {
    enabled: true,
    onDrop: songIds => onDropSongs(row.index + 1, songIds),
  })
  return (
    <Pressable
      ref={playingRef}
      testID={`queue-row-${row.index}`}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Playing ${row.song.title}. Open now playing`}
      style={[styles.row, { backgroundColor: withAlpha(tone.color, 0.2) }]}
    >
      {over ? <View style={[styles.dropLine, styles.dropLineFoot]} /> : null}
      <View style={styles.gripSlot} />
      <View>
        <Cover uri={artUri} title={row.song.album || row.song.title} size={34} />
        <View style={styles.equalizer} pointerEvents="none">
          <Equalizer paused={!playing} size={12} color={tone.tint} />
        </View>
      </View>
      <View style={styles.text}>
        <Text style={[styles.songTitle, { color: tone.tint }]} numberOfLines={1}>
          {row.song.title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {row.song.artist || 'Unknown artist'} · {formatDuration(row.song.duration)}
        </Text>
      </View>
    </Pressable>
  )
}

/** The key a focused row answers with removal. */
const REMOVE_KEYS = new Set(['Delete', 'Backspace'])

/**
 * A song still to come, or one that has played (greyed, no grip). A click
 * plays it. Keys and the right-click menu arrive as a browser's events, which
 * react-native-web hands to a pressable; a phone has neither.
 */
const RailRow = memo(function RailRow({
  row,
  artUri,
  kind,
  placeholder,
  dropTarget,
  actions,
}: {
  row: QueueRow
  artUri: string | null
  kind: 'next' | 'played'
  /** This row is out being dragged: its place stays, empty, until it lands. */
  placeholder: boolean
  dropTarget: boolean
  actions: RowActions
}): ReactNode {
  const rowRef = useRef<View>(null)
  const { index, song } = row

  /*
   * A song dragged in from a list lands where it was let go, not at the end:
   * each row is its own drop target and the half of it the pointer is over
   * decides which side of the row the song goes (Xiao, 2026-09-22).
   */
  const [side, setSide] = useState<'above' | 'below'>('above')
  const sideAt = (y: number): 'above' | 'below' => (y < ROW_HEIGHT / 2 ? 'above' : 'below')
  const over = useSongDropTarget(rowRef, {
    enabled: kind === 'next',
    onOver: y => setSide(sideAt(y)),
    onDrop: (songIds, y) => actions.dropSongs(sideAt(y) === 'above' ? index : index + 1, songIds),
  })
  // Read through `over` rather than cleared when it goes false: the side is
  // only meaningful while the pointer is here, and nothing has to unset it.
  const dropSide = over ? side : null
  const onDragStart = useCallback(
    (x: number) => actions.dragStart(row, rowRef.current, x),
    [actions, row],
  )
  const onDragMove = useCallback(
    (moveX: number, moveY: number) => actions.dragMove(row.index, moveX, moveY),
    [actions, row],
  )
  const onDragEnd = useCallback(
    (moveX: number, moveY: number) => actions.dragEnd(row.index, moveX, moveY),
    [actions, row],
  )
  const web = {
    onKeyDown: (event: { nativeEvent: { key: string }; preventDefault: () => void }) => {
      if (!REMOVE_KEYS.has(event.nativeEvent.key)) return
      event.preventDefault()
      actions.remove(index)
    },
    onContextMenu: (event: { preventDefault: () => void }) => {
      event.preventDefault()
      actions.menu(rowRef.current, row)
    },
  }

  return (
    <View ref={rowRef} collapsable={false} style={[styles.slot, placeholder && styles.hole]}>
      {dropTarget || dropSide === 'above' ? <View style={styles.dropLine} /> : null}
      {dropSide === 'below' ? <View style={[styles.dropLine, styles.dropLineFoot]} /> : null}
      <HoldToReorder
        enabled={kind === 'next'}
        onStart={onDragStart}
        onMove={onDragMove}
        onEnd={onDragEnd}
      >
        <View
          style={[styles.row, placeholder && styles.hidden, kind === 'played' && styles.greyed]}
        >
          <Pressable
            testID={`queue-row-${index}`}
            onPress={() => actions.play(index)}
            accessibilityRole="button"
            accessibilityLabel={`${song.title}, ${song.artist || 'Unknown artist'}`}
            style={({ pressed }) => [styles.press, pressed && styles.pressed]}
            {...web}
          >
            <RowFace song={song} artUri={artUri} />
          </Pressable>
        </View>
      </HoldToReorder>
    </View>
  )
})

/** Cover, title, and "artist · time": what a row shows, and what the dragged copy shows. */
function RowFace({
  song,
  artUri,
  grip = false,
}: {
  song: Song
  artUri: string | null
  grip?: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  return (
    <View style={styles.face}>
      {grip ? (
        <View style={styles.gripSlot}>
          <Grip size={14} color={theme.colors.textMuted} />
        </View>
      ) : null}
      <Cover uri={artUri} title={song.album || song.title} size={34} />
      <View style={styles.text}>
        <Text style={styles.songTitle} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {song.artist || 'Unknown artist'} · {formatDuration(song.duration)}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  /*
   * The rail's room beside the page, which is all that grows and shrinks: the
   * rail inside it keeps its width, so nothing in it is laid out again frame
   * by frame — a title that fits at the end fits all the way. Clipped, so the
   * part of the rail still hanging off the window is not drawn over the
   * practice panel or a scrollbar.
   */
  room: { flexShrink: 0, overflow: 'hidden' },
  /*
   * Its room where the rail lies over the page instead: the full width from
   * the first frame, the page under it left as wide as it was, and nothing
   * clipped, so the rail's shadow still falls on the page.
   */
  roomOver: { position: 'absolute', top: 0, right: 0, bottom: 0, width: RAIL_WIDTH, zIndex: 2 },
  // Pinned to the left edge of its room, which is what carries it in: as the
  // slot widens, the rail's left edge travels in from the window's right edge.
  rail: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: RAIL_WIDTH,
    paddingTop: 28,
    paddingHorizontal: 18,
    paddingBottom: space.lg,
    gap: 10,
    // A step up from the page, told apart by tone and not by a line (`S2`).
    backgroundColor: theme.colors.surface1,
  },
  railOver: {
    // Thrown sideways, onto the page the rail slides over, so not `artShadow`'s.
    boxShadow: `-18px 0 40px ${theme.colors.floatShadow}`,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: sectionTitle(theme.colors),
  summary: { color: theme.colors.textSecondary, fontSize: type.small, marginTop: -6 },
  list: { flex: 1, marginHorizontal: -6 },
  listContent: { paddingBottom: space.md },
  label: { ...label(theme.colors), paddingTop: space.md, paddingBottom: space.xs, paddingLeft: 6 },
  slot: { height: ROW_HEIGHT, borderRadius: radius.cover },
  // The dragged row's place, kept open until it lands.
  hole: { backgroundColor: theme.colors.surface2 },
  hidden: { opacity: 0 },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.cover,
    paddingRight: 6,
  },
  greyed: { opacity: 0.42 },
  press: { flex: 1, minWidth: 0, alignSelf: 'stretch', borderRadius: radius.cover },
  pressed: { backgroundColor: theme.colors.surface2 },
  face: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  gripSlot: {
    width: 24,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  equalizer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.coverSm,
    // The shade a playing row lays over its cover (`SongRow`).
    backgroundColor: theme.colors.coverShade,
  },
  text: { flex: 1, minWidth: 0, gap: 1, marginLeft: space.sm },
  songTitle: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  sub: { color: theme.colors.textSecondary, fontSize: type.tiny },
  dropLineFoot: { top: undefined, bottom: 0 },
  // Let go anywhere else in the rail and the song joins the end: the whole
  // rail says so, since there is no one row to draw a line against.
  railTakingDrop: { backgroundColor: theme.colors.surface2 },
  dropLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.accent,
  },
  ghost: {
    position: 'absolute',
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 6,
    borderRadius: radius.cover,
    backgroundColor: theme.colors.surface3,
    boxShadow: `0 18px 36px ${theme.colors.floatShadow}`,
  },
  letGo: {
    position: 'absolute',
    left: 14,
    top: ROW_HEIGHT + 14,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    justifyContent: 'center',
    backgroundColor: theme.colors.remove,
  },
  letGoText: { color: theme.colors.textPrimary, fontSize: type.tiny, fontWeight: '600' },
  autoMix: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  autoMixLabel: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '500' },
  autoMixHint: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    color: theme.colors.textMuted,
    fontSize: type.tiny,
  },
}))

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { spring, useEntrance } from '../../ui/motion'
import { label, sectionTitle } from '../../ui/surfaces'
import { useSongColor } from '../../ui/useSongColor'
import { Cover } from '../../ui/components/Cover'
import { Equalizer } from '../../ui/components/Equalizer'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronRight, Grip } from '../../ui/components/Icons'
import { HoldToReorder } from '../../ui/components/HoldToReorder'
import { useSongDropTarget } from '../../ports/songDrag'
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
  const open = useQueueSheetOpen()
  const { wide } = useLayout()
  const edits = useQueueEdits()
  const shown = open && wide && edits.player.current !== null
  return shown ? <Rail edits={edits} /> : null
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

function Rail({ edits }: { edits: ReturnType<typeof useQueueEdits> }): ReactNode {
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

  // In from the window's right edge on the spring as Up next opens
  // (docs/ui-mock `M3`, 6). The board draws it over a page that stays live;
  // here it is a column beside the page, which makes its room at once.
  const entrance = useEntrance()
  const [slide] = useState(() => ({
    transform: [
      { translateX: entrance.interpolate({ inputRange: [0, 1], outputRange: [RAIL_WIDTH, 0] }) },
    ],
  }))

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
      ref={railRef}
      style={[
        styles.rail,
        width < BESIDE_MIN && styles.railOver,
        overRail && styles.railTakingDrop,
        slide,
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

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {playing ? (
          <PlayingRow
            row={playing}
            artUri={artFor(playing.song)}
            playing={player.isPlaying}
            onOpen={() => router.navigate('/now-playing')}
            onDropSongs={actions.dropSongs}
          />
        ) : null}
        {rows.next.map(row => (
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
        ))}
        {rows.played.length > 0 ? (
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
  rail: {
    width: RAIL_WIDTH,
    flexShrink: 0,
    paddingTop: 28,
    paddingHorizontal: 18,
    paddingBottom: space.lg,
    gap: 10,
    // A step up from the page, told apart by tone and not by a line (`S2`).
    backgroundColor: theme.colors.surface1,
  },
  railOver: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    boxShadow: '-18px 0 40px rgba(0, 0, 0, 0.35)',
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

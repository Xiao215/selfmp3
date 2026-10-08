import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, ScrollView, Text, View } from 'react-native'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { artistOr, formatDuration, type Song } from '@selfmp3/shared'
import { motion, radius, space, type, withAlpha } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useOverlay } from '../../shell/Overlay'
import { useLayout } from '../../shell/useLayout'
import { ease, spring, timing, usePresence } from '../../ui/motion'
import { MOVE_MS, roomShift } from '../../ui/motion.model'
import { label, sectionTitle } from '../../ui/surfaces'
import { useSongColor } from '../../ui/useSongColor'
import { Cover } from '../../ui/components/Cover'
import { Equalizer } from '../../ui/components/Equalizer'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronRight, Grip } from '../../ui/components/Icons'
import { HoldToReorder, useLiftScale, useMakeRoom } from '../../ui/components/HoldToReorder'
import { useSongDropTarget } from '../../ports/songDrag'
import { usePlayer } from '../../player/PlayerProvider'
import { Popover } from '../../ui/components/Popover'
import { SheetItem } from '../../ui/components/Sheet'
import { Toggle } from '../../ui/components/Toggle'
import { UpNextSource } from './UpNextSource'
import { OnlySongEnd, useOnlySongEndNotice } from './OnlySongEnd'
import { useRailHint } from './useRailHint'
import { closeQueueSheet, useQueueSheetOpen } from './queueSheet.store'
import {
  autoMixLine,
  dragOutcome,
  dragTarget,
  draggedOut,
  nextSummary,
  onlySongEnded,
  railWindow,
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
/** How far into the rail's slide the rows begin to fade up: its last third. */
const ROWS_FADE_FROM = 2 / 3
/**
 * The scroll the rail redraws its window at, in rows: it notes where it is
 * scrolled to only when that crosses a step this tall, and draws a step's
 * worth of rows past the viewport to cover the rest, so a scroll costs a
 * render every few rows rather than one per frame.
 */
const SCROLL_STEP_ROWS = 8
const SCROLL_STEP = SCROLL_STEP_ROWS * ROW_HEIGHT
/** What the rail assumes of its list's height before the list has been laid out. */
const VIEWPORT_GUESS = 800

/**
 * Up next on a computer (docs/ui-mock `C11`, `C12`): a rail beside the page,
 * opened from the player bar and left open across pages until it is closed.
 *
 * The playing song on top, what is next under it with a grip each, what has
 * played greyed at the end. Hold a row to move it, and the rows it passes step
 * aside for it exactly as the phone's sheet's do (`useMakeRoom`): one reorder
 * language on every surface, so where the row will land is a gap and never a
 * line. Keep dragging past the
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

  // Kept up from the moment it is asked for until its exit has played out, as
  // the phone's sheet is: shut, the rail slides away first and only then is it
  // taken down, which is when the page gets its room back. Adjusted during
  // render, so opening never paints a frame without it.
  const [mounted, setMounted] = useState(shown)
  if (shown && !mounted) setMounted(true)
  const gone = useCallback(() => setMounted(false), [])
  const edits = useQueueEdits(mounted)
  useOnlySongEndNotice(edits.player)

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
  /** The hold has begun on a row, or it is over: the row's swell (`useLiftScale`). */
  readonly holding: (songId: number, holding: boolean) => void
  readonly dragStart: (row: QueueRow, node: View | null, x: number) => void
  readonly dragMove: (index: number, dx: number, dy: number) => void
  readonly dragEnd: (index: number, dx: number, dy: number) => void
  /** Songs dragged in from a list and let go at `at`, an index into `items`. */
  readonly dropSongs: (at: number, songIds: readonly number[]) => void
  /** The lift the row being moved wears, handed down so a row's memo holds (`useLiftScale`). */
  readonly lift: Animated.Value
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
  const { width, finePointer } = useLayout()
  const { theme } = useUnistyles()
  const router = useRouter()
  const artFor = useArt(ROW_COVER_SIZE)
  const { player, rows, remove } = edits
  // Drag-out made known once (`useRailHint`); anything done in the rail puts it away.
  const hint = useRailHint(shown && rows.next.length > 0)
  const hintIn = usePresence(hint.shown, motion.base, motion.fast)
  const railRef = useRef<View>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  // The pointer's travel, which the copy follows without a render, and how far
  // it has turned into "remove" (0 or 1, sprung between).
  const [dx] = useState(() => new Animated.Value(0))
  const [dy] = useState(() => new Animated.Value(0))
  const [outness] = useState(() => new Animated.Value(0))
  /*
   * The scale the row being moved wears, from the first moment of the hold
   * until it has settled back after the drop (`useLiftScale`). While the row
   * is carried it is the copy in the overlay that wears it; the moment the
   * copy goes the row itself takes it over in its new place, which is what
   * makes the settle read as the row being set down rather than as a second
   * thing appearing.
   */
  const lift = useLiftScale()
  // Its made-once parts on their own, so the row actions below can be made once
  // too: `lift` itself is remade whenever the row wearing the scale changes.
  const { lift: liftScale, holding: holdRow, start: liftRow, drop: dropRow } = lift
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
    dismissHint: hint.dismiss,
  })
  useEffect(() => {
    latest.current.first = rows.next[0]?.index ?? 0
    latest.current.last = rows.next[rows.next.length - 1]?.index ?? 0
    latest.current.player = player
    latest.current.remove = remove
    latest.current.dismissHint = hint.dismiss
  })

  const actions = useMemo<RowActions>(
    () => ({
      play: index => latest.current.player.jumpTo(index),
      remove: index => latest.current.remove(index),
      menu: (anchor, row) => {
        // A right-click is not a press, so the rail's capture below never hears it.
        latest.current.dismissHint()
        menuAnchor.current = anchor
        setMenuRow(row)
      },
      holding: holdRow,
      dragStart: (row, node, x) => {
        const now = latest.current
        now.startX = x
        liftRow(row.song.id)
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
        // Set down: the scale settles back on the spring with a tap, on the row
        // wherever the queue has just put it.
        dropRow()
        if (outcome.kind === 'remove') now.remove(index)
        else if (outcome.kind === 'move') now.player.reorderQueue(index, outcome.to)
      },
      dropSongs: (at, songIds) => latest.current.player.insertIntoQueue(at, songIds),
      lift: liftScale,
    }),
    [dx, dy, outness, liftScale, holdRow, liftRow, dropRow],
  )

  /*
   * How the copy that follows the pointer is drawn, built once: an
   * interpolation made in the render is a new native node every render, and
   * this one renders on every row the pointer crosses. Only where the copy
   * is — the row's own place on screen, which is a plain number — changes.
   *
   * The lift is in the same list, so the copy grows as it is picked up and the
   * row it lands on carries the settle on from where the copy left off.
   */
  const [ghost] = useState(() => ({
    opacity: outness.interpolate({ inputRange: [0, 1], outputRange: [1, 0.62] }),
    transform: [
      { translateX: dx },
      { translateY: dy },
      { scale: outness.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }) },
      { scale: liftScale },
      {
        rotate: outness.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '-4deg'],
        }),
      },
    ],
  }))

  // The row being dragged, drawn over everything so it can leave the rail.
  useOverlay(
    drag ? (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[
            styles.ghost,
            ghost,
            { left: drag.rect.x, top: drag.rect.y, width: drag.rect.width },
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
  const ended = onlySongEnded(player)

  /*
   * Only the rows in view are drawn, and a margin either side (`railWindow`):
   * the rail is the whole queue, and a shuffled library made that thousands
   * of rows that took seconds to draw before the rail could slide in. Each run
   * — the songs to come, the songs played — keeps its full height, so the
   * scroll bar and a drag's arithmetic are what they would be with every row
   * there, and draws its window of rows at their places in it. Where the list
   * is scrolled to is noted only when it crosses a step (`SCROLL_STEP`), so a
   * scroll redraws the rail every few rows rather than every frame.
   */
  const [scrollStep, setScrollStep] = useState(0)
  const [viewport, setViewport] = useState(VIEWPORT_GUESS)
  const [playedLabel, setPlayedLabel] = useState(0)
  const dismissHint = hint.dismiss
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (event.nativeEvent.contentOffset.y > 0) dismissHint()
      const step = Math.floor(event.nativeEvent.contentOffset.y / SCROLL_STEP)
      setScrollStep(now => (now === step ? now : step))
    },
    [dismissHint],
  )
  const scrollTop = scrollStep * SCROLL_STEP
  const span = viewport + SCROLL_STEP
  const nextTop = playing ? ROW_HEIGHT : 0
  const nextAt = railWindow({
    count: rows.next.length,
    runTop: nextTop,
    scrollTop,
    span,
    rowHeight: ROW_HEIGHT,
  })
  const playedAt = railWindow({
    count: rows.played.length,
    runTop: nextTop + rows.next.length * ROW_HEIGHT + playedLabel,
    scrollTop,
    span,
    rowHeight: ROW_HEIGHT,
  })

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
    /*
     * The rows, over the last third of the way in: on `slid` rather than
     * `progress` because an opacity belongs on the native driver, and clamped
     * because the spring runs a little past 1. Reduce Motion sends both values
     * straight to 1, so the rows are simply there.
     */
    rows: {
      opacity: slid.interpolate({
        inputRange: [ROWS_FADE_FROM, 1],
        outputRange: [0, 1],
        extrapolate: 'clamp' as const,
      }),
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
        // Any press in the rail — a row, a grip, the close — puts the hint
        // away, and is left to whatever it was for.
        onStartShouldSetResponderCapture={() => {
          if (hint.shown) hint.dismiss()
          return false
        }}
      >
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            Up next
          </Text>
          <IconButton onPress={closeQueueSheet} label="Hide Up next" size={28} filled>
            <ChevronRight size={15} color={theme.colors.textSecondary} />
          </IconButton>
        </View>
        <UpNextSource />
        <Text style={styles.summary}>{nextSummary(rows.next)}</Text>

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          // A held row is being moved, not the list under it.
          scrollEnabled={drag === null}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onLayout={event => setViewport(event.nativeEvent.layout.height)}
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
          {ended && playing ? <OnlySongEnd song={playing.song} player={player} /> : null}
          <Animated.View style={slide.rows}>
            <View style={{ height: rows.next.length * ROW_HEIGHT }}>
              {rows.next.slice(nextAt.start, nextAt.end).map((row, at) => (
                <View
                  key={row.song.id}
                  style={[styles.placed, { top: (nextAt.start + at) * ROW_HEIGHT }]}
                >
                  <RailRow
                    song={row.song}
                    index={row.index}
                    artUri={artFor(row.song)}
                    kind="next"
                    placeholder={drag?.from === row.index}
                    // A row out past the rail's edge is being removed, not
                    // moved, so the room it had opened closes again.
                    shift={drag && !drag.out ? roomShift(row.index, drag.from, drag.over) : 0}
                    carrying={drag !== null}
                    settling={lift.wearing === row.song.id}
                    actions={actions}
                  />
                </View>
              ))}
            </View>
            {rows.played.length > 0 ? (
              <>
                <Text
                  style={styles.label}
                  onLayout={event => setPlayedLabel(event.nativeEvent.layout.height)}
                >
                  Played
                </Text>
                <View style={{ height: rows.played.length * ROW_HEIGHT }}>
                  {rows.played.slice(playedAt.start, playedAt.end).map((row, at) => (
                    <View
                      key={row.song.id}
                      style={[styles.placed, { top: (playedAt.start + at) * ROW_HEIGHT }]}
                    >
                      <RailRow
                        song={row.song}
                        index={row.index}
                        artUri={artFor(row.song)}
                        kind="played"
                        placeholder={false}
                        shift={0}
                        carrying={false}
                        settling={lift.wearing === row.song.id}
                        actions={actions}
                      />
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </Animated.View>
          {hintIn.mounted ? (
            <Animated.View
              style={[
                styles.hint,
                // Under the first song to come, the one it is about; last, so
                // it is drawn over the rows.
                { top: (playing ? ROW_HEIGHT : 0) + ROW_HEIGHT + 6, opacity: hintIn.progress },
              ]}
              testID="queue-rail-hint"
            >
              <Pressable
                onPress={hint.dismiss}
                accessibilityRole="button"
                accessibilityHint="Dismisses the tip"
                accessibilityLiveRegion="polite"
              >
                {/* "right‑click" with a hyphen that does not break, so the bubble
                    never splits the word across its two lines. A touch has no
                    right-click to offer. */}
                <Text style={styles.hintText}>
                  {finePointer
                    ? 'Drag a song out to remove it, or right‑click for more.'
                    : 'Drag a song out to remove it.'}
                </Text>
              </Pressable>
            </Animated.View>
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
  artUri: string | null | undefined
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
      style={[styles.row, styles.playing, { backgroundColor: withAlpha(tone.color, 0.2) }]}
    >
      {over ? <View style={[styles.dropLine, styles.dropLineFoot]} /> : null}
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
          {artistOr(row.song.artist)} · {formatDuration(row.song.duration)}
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
 *
 * The song and its place come as two props, not the queue's row object: those
 * are made afresh whenever the queue changes, and handed one, every row of a
 * whole library shuffled — thousands — redrew at each new song.
 */
const RailRow = memo(function RailRow({
  song,
  index,
  artUri,
  kind,
  placeholder,
  shift,
  carrying,
  settling,
  actions,
}: {
  song: Song
  /** Its index in the queue's `items`. */
  index: number
  artUri: string | null | undefined
  kind: 'next' | 'played'
  /** This row is out being dragged: its place stays, empty, until it lands. */
  placeholder: boolean
  /** Which way this row steps aside while another is carried past it. */
  shift: -1 | 0 | 1
  carrying: boolean
  /** This row is wearing the lift: its hold is being counted, or it has just landed. */
  settling: boolean
  actions: RowActions
}): ReactNode {
  const rowRef = useRef<View>(null)
  const room = useMakeRoom(shift, ROW_HEIGHT, carrying)

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
  const onHolding = useCallback(
    (holding: boolean) => actions.holding(song.id, holding),
    [actions, song.id],
  )
  const onDragStart = useCallback(
    (x: number) => actions.dragStart({ song, index }, rowRef.current, x),
    [actions, song, index],
  )
  const onDragMove = useCallback(
    (moveX: number, moveY: number) => actions.dragMove(index, moveX, moveY),
    [actions, index],
  )
  const onDragEnd = useCallback(
    (moveX: number, moveY: number) => actions.dragEnd(index, moveX, moveY),
    [actions, index],
  )
  const web = {
    onKeyDown: (event: { nativeEvent: { key: string }; preventDefault: () => void }) => {
      if (!REMOVE_KEYS.has(event.nativeEvent.key)) return
      event.preventDefault()
      actions.remove(index)
    },
    onContextMenu: (event: { preventDefault: () => void }) => {
      event.preventDefault()
      actions.menu(rowRef.current, { song, index })
    },
  }

  /*
   * The row's place steps aside for a row being carried past it, and the row
   * itself wears the lift while its own hold is counted and again as it
   * settles after the drop. Two animated views rather than one because the
   * ref, the drop lines and the place that steps aside all belong to the slot,
   * while the scale belongs to the row drawn in it.
   */
  return (
    <Animated.View ref={rowRef} collapsable={false} style={[styles.slot, room]}>
      {dropSide === 'above' ? <View style={styles.dropLine} /> : null}
      {dropSide === 'below' ? <View style={[styles.dropLine, styles.dropLineFoot]} /> : null}
      <HoldToReorder
        enabled={kind === 'next'}
        onHolding={onHolding}
        onStart={onDragStart}
        onMove={onDragMove}
        onEnd={onDragEnd}
      >
        <Animated.View
          style={[
            styles.row,
            placeholder && styles.hidden,
            kind === 'played' && styles.greyed,
            settling && { transform: [{ scale: actions.lift }] },
          ]}
        >
          <Pressable
            testID={`queue-row-${index}`}
            onPress={() => actions.play(index)}
            accessibilityRole="button"
            accessibilityLabel={`${song.title}, ${artistOr(song.artist)}`}
            style={({ pressed }) => [styles.press, pressed && styles.pressed]}
            {...web}
          >
            <RowFace song={song} artUri={artUri} />
          </Pressable>
        </Animated.View>
      </HoldToReorder>
    </Animated.View>
  )
})

/** Cover, title, and "artist · time": what a row shows, and what the dragged copy shows. */
function RowFace({
  song,
  artUri,
  grip = false,
}: {
  song: Song
  artUri: string | null | undefined
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
          {artistOr(song.artist)} · {formatDuration(song.duration)}
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
   * part of the rail still hanging off the window is not drawn over a
   * scrollbar.
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
  hint: {
    position: 'absolute',
    left: 12,
    right: 0,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.mini,
    backgroundColor: theme.colors.surface3,
    boxShadow: `0 10px 28px ${theme.colors.floatShadow}`,
  },
  hintText: { color: theme.colors.textPrimary, fontSize: type.small, lineHeight: 18 },
  listContent: { paddingBottom: space.md },
  label: { ...label(theme.colors), paddingTop: space.md, paddingBottom: space.xs, paddingLeft: 6 },
  slot: { height: ROW_HEIGHT, borderRadius: radius.cover },
  // A drawn row at its place in its run, which keeps the height of every row.
  placed: { position: 'absolute', left: 0, right: 0, height: ROW_HEIGHT },
  /*
   * The dragged row's place: kept, and empty, until the row lands. No tone of
   * its own any more — the rows below it step up into it while the copy is
   * carried (`useMakeRoom`), so a shaded hole would show through the
   * transparent row that has just moved over it. The gap the eye is meant to
   * read is the one that opens where the row will land.
   */
  hidden: { opacity: 0 },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.cover,
    paddingRight: 6,
  },
  // Laid out as a row's face is, so its cover and words line up with the rows under it.
  playing: { paddingLeft: 6, gap: space.sm },
  greyed: { opacity: 0.42 },
  press: { flex: 1, minWidth: 0, alignSelf: 'stretch', borderRadius: radius.cover },
  pressed: { backgroundColor: theme.colors.surface2 },
  // In from the row's edge by the list's bleed, so the covers stand under the
  // heading while a pressed row's shade still reaches past them.
  face: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: 6,
  },
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

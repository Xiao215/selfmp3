import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { usePathname, useRouter } from 'expo-router'
import { artistOr, formatDuration, type Song } from '@selfmp3/shared'
import { radius, space, type, iconSize } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useOverlay } from '../../shell/Overlay'
import { useLayout } from '../../shell/useLayout'
import { useEscape } from '../../shell/useEscape'
import { ease, spring, timing } from '../../ui/motion'
import { MOVE_MS, OPACITY, roomShift } from '../../ui/motion.model'
import { SectionHead } from '../../ui/components/SectionHead'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronRight, Downloaded, Grip, NotDownloaded } from '../../ui/components/Icons'
import { HoldToReorder, useLiftScale, useMakeRoom } from '../../ui/components/HoldToReorder'
import { useSongDropTarget } from '../../ports/songDrag'
import { UpNextSource } from './UpNextSource'
import { OnlySongEnd, useOnlySongEndNotice } from './OnlySongEnd'
import { Guide, slideWith } from '../guide/Guide'
import { useGuide } from '../guide/useGuide'
import { closeQueueSheet } from './queueSheet.store'
import {
  dragOutcome,
  dragTarget,
  draggedOut,
  nextLabel,
  onlySongEnded,
  type QueueRow,
} from './queue.model'
import { useQueueEdits } from './useQueueEdits'
import {
  AutoMixRow,
  ClearRestButton,
  PlayingNow,
  UpNextList,
  useQueueRowFacts,
  useUpNextShown,
} from './UpNextParts'
import { RoomList } from '../room/RoomList'
import { useRoom } from '../room/room.store'
import { SongLine } from '../../ui/components/SongLine'
import { ScrollView } from '../../ui/components/Scroll'
import { Press } from '../../ui/components/Press'
import { Menu } from '../../ui/components/MoreMenu'
import { WINDOW_WIDTH, RAIL_WIDTH } from '../../shell/widths'

/** Every row of the rail is this tall, so a drag is counted in rows by arithmetic. */
const ROW_HEIGHT = 44
/** How far into the rail's slide the rows begin to fade up: its last third. */
const ROWS_FADE_FROM = 2 / 3

/**
 * Up next on a computer (docs/ui-mock `C11`, `C12`): a rail beside the page,
 * opened from the player bar and left open across pages until it is closed.
 *
 * The playing song on top, what is next under it with a grip each, what has
 * played greyed at the end. Hold a row to move it, and the rows it passes step
 * aside for it exactly as the phone's sheet's do (`useMakeRoom`): one reorder
 * language on every surface, so where the row will land is a gap and never a
 * line. Keep dragging past the rail's edge and the row shrinks, greys and says
 * "Let go to remove"; let go and it is gone, with an Undo for five seconds, and
 * dragged back in nothing happens. So that a drag is never the only way, Delete
 * or Backspace on a focused row, and "Remove from Up next" in its right-click
 * menu, do the same and draw nothing.
 *
 * Always mounted in the wide frame and drawing nothing while shut, so an Undo
 * raised here still reaches the queue as it is when pressed (`useQueueEdits`).
 */
export function QueueRail(): ReactNode {
  const shown = useUpNextShown(true)

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

/**
 * The room the rail takes from the page: its width while it is beside the
 * page or on its way there, and none while it is away or lies over the page.
 * What the frame takes off the page's width the moment the rail is asked
 * for, not frame by frame as the room widens (`Shell`).
 */
export function useQueueRailRoom(): number {
  const shown = useUpNextShown(true)
  const { width } = useLayout()
  return shown && width >= WINDOW_WIDTH.railBeside ? RAIL_WIDTH : 0
}

/**
 * How much of the page's right edge the rail covers: its width while it lies
 * over the page (a window too narrow for it beside), none otherwise. What a
 * part centred in the page, like the toast row, keeps clear of.
 */
export function useQueueRailCover(): number {
  const shown = useUpNextShown(true)
  const { width } = useLayout()
  return shown && width < WINDOW_WIDTH.railBeside ? RAIL_WIDTH : 0
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
  /** Delete or Backspace on a focused row: removed, and the focus handed on. */
  readonly removeFocused: (index: number) => void
  /** A row's right-click menu; `played` for one in the rail's history rather than to come. */
  readonly menu: (anchor: View | null, row: QueueRow, played: boolean) => void
  /** One place up or down Up next, from the keyboard; where it went, or null if it could not. */
  readonly step: (index: number, by: 1 | -1) => number | null
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
  const factsOf = useQueueRowFacts()
  const { player, rows, remove, clearRest } = edits
  const inRoom = useRoom().state !== null
  /*
   * Dragging a song out removes it (chosen over a hover ✕, Xiao 2026-09-18),
   * which nothing on screen says: the first time the rail is open with a song
   * to come, a guide lights that song and drags it out once.
   */
  const railRef = useRef<View>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  /*
   * Too narrow to keep the rail beside the page (an iPad in portrait): it lies
   * over the page instead, as the board draws it, and slides in over a page
   * that keeps its width rather than taking room of its own.
   */
  const over = width < WINDOW_WIDTH.railBeside
  // Never over a song being carried: it came up mid-drag and acted the drag
  // out on the row under the one in hand. Lying over the page, the rail is a
  // layer of its own, which the guide does not wait for.
  const [firstTarget, hint] = useGuide('up-next-rail', shown && rows.next.length > 0 && !drag, {
    layers: over ? 1 : 0,
  })
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
  const [menuRow, setMenuRow] = useState<(QueueRow & { played: boolean }) | null>(null)
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
    /** Escape called the drag off: what is left of it does nothing. */
    cancelled: false,
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
      removeFocused: index => {
        latest.current.remove(index)
        /*
         * The row with the focus has gone, and the focus with it, to the page:
         * a second Delete did nothing. It goes on to the row that took the
         * removed one's place, or the one above it at the end. A browser's
         * rows are elements, found by the index they are drawn with.
         */
        requestAnimationFrame(() => {
          const rail = railRef.current as unknown as HTMLElement | null
          const row = (at: number): HTMLElement | null | undefined =>
            rail?.querySelector?.<HTMLElement>(`[data-testid="queue-row-${at}"]`)
          ;(row(index) ?? row(index - 1))?.focus()
        })
      },
      step: (index, by) => {
        const now = latest.current
        if (index < now.first || index > now.last) return null
        const to = dragTarget(index, by * ROW_HEIGHT, ROW_HEIGHT, now)
        if (to === index) return null
        now.player.reorderQueue(index, to)
        return to
      },
      menu: (anchor, row, played) => {
        menuAnchor.current = anchor
        setMenuRow({ ...row, played })
      },
      holding: holdRow,
      dragStart: (row, node, x) => {
        const now = latest.current
        now.startX = x
        liftRow(row.song.id)
        now.out = false
        now.cancelled = false
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
        if (now.cancelled) return
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
        if (now.cancelled) {
          now.cancelled = false
          return
        }
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

  /*
   * Escape calls a drag off: the row goes back to its place, and letting go
   * afterwards does nothing — out past the edge, it is not removed.
   */
  useEscape(
    drag !== null,
    () => {
      latest.current.cancelled = true
      setDrag(null)
      spring(outness, 0)
      dropRow()
    },
    { layer: true },
  )

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
  // A song still to come for Clear the rest to take: with none, it would take
  // only what has played.
  const clearable = rows.next.length > 0

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

  // Lying over the page it is in the page's way, so it goes as the phone's
  // sheet does: on Escape, from its source link, and when another page opens
  // (a tap on the page is the shell's, `Shell`). Beside the page it stays.
  useEscape(shown && over, closeQueueSheet, { layer: true })
  const pathname = usePathname()
  const openedOn = useRef(pathname)
  useEffect(() => {
    if (pathname === openedOn.current) return
    openedOn.current = pathname
    if (over) closeQueueSheet()
  }, [pathname, over])

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
        <SectionHead
          title="Up next"
          end={
            <IconButton onPress={closeQueueSheet} label="Hide Up next" size={28} filled>
              <ChevronRight size={iconSize.button} color={theme.colors.textSecondary} />
            </IconButton>
          }
        />
        {inRoom ? (
          <ScrollView style={styles.list} contentContainerStyle={styles.roomContent}>
            <RoomList />
          </ScrollView>
        ) : (
          <>
            <UpNextSource onOpen={over ? closeQueueSheet : undefined} />
            <View style={styles.summaryRow}>
              <Text style={styles.summary} numberOfLines={1}>
                {nextLabel(rows.next)}
              </Text>
              <ClearRestButton onPress={clearRest} enabled={clearable} />
            </View>

            <UpNextList
              style={styles.list}
              contentContainerStyle={styles.listContent}
              // A held row is being moved, not the list under it.
              scrollEnabled={drag === null}
              next={rows.next}
              played={rows.played}
              rowHeight={ROW_HEIGHT}
              runsStyle={slide.rows}
              labelStyle={styles.labelInset}
              head={
                playing ? (
                  <>
                    <PlayingDrop row={playing} onDropSongs={actions.dropSongs}>
                      <PlayingNow
                        row={playing}
                        ended={ended}
                        onOpen={() => router.navigate('/now-playing')}
                      />
                    </PlayingDrop>
                    {ended ? <OnlySongEnd song={playing.song} player={player} /> : null}
                  </>
                ) : null
              }
              renderRow={(row, kind) => {
                const facts = factsOf(row.song)
                const railRow = (
                  <RailRow
                    song={row.song}
                    index={row.index}
                    artUri={artFor(row.song)}
                    kind={kind}
                    downloaded={facts.downloaded}
                    notDownloadedMark={facts.notDownloadedMark}
                    unavailable={facts.unavailable}
                    placeholder={kind === 'next' && drag?.from === row.index}
                    // A row out past the rail's edge is being removed, not
                    // moved, so the room it had opened closes again.
                    shift={
                      kind === 'next' && drag && !drag.out
                        ? roomShift(row.index, drag.from, drag.over)
                        : 0
                    }
                    carrying={kind === 'next' && drag !== null}
                    settling={lift.wearing === row.song.id}
                    actions={actions}
                  />
                )
                // The first song to come is the one the guide lights and drags
                // out. Every row has the same wrappers, so the row that becomes
                // first as the one above it goes is not remounted mid-drag. Lit
                // by the outer one, which the pull does not move, so a window
                // resized mid-pull keeps the spotlight on the row's place.
                const first = kind === 'next' && row.index === rows.next[0]?.index
                return (
                  <View ref={first ? firstTarget : undefined} collapsable={false}>
                    <Animated.View style={first && hint.shown ? slideWith(hint, 120) : null}>
                      {railRow}
                    </Animated.View>
                  </View>
                )
              }}
            />

            <AutoMixRow player={player} upcoming={rows.next.length} />
          </>
        )}

        <Menu
          open={menuRow !== null}
          onClose={() => setMenuRow(null)}
          anchorRef={menuAnchor}
          align="start"
          items={[
            {
              key: 'play',
              label: 'Play',
              onPress: () => {
                if (menuRow) actions.play(menuRow.index)
              },
            },
            {
              key: 'remove',
              // A played song is in the rail's history, not still to come.
              label: menuRow?.played ? 'Remove from Played' : 'Remove from Up next',
              onPress: () => {
                if (menuRow) actions.remove(menuRow.index)
              },
            },
          ]}
          testID="queue-menu"
        />
      </Animated.View>
      <Guide
        guide={hint}
        steps={[
          {
            gesture: 'swipe-left',
            text: 'Drag a song out to remove it',
            // A touch has no right-click to offer.
            sub: finePointer ? 'Right-click it for more' : undefined,
            distance: 120,
          },
        ]}
      />
    </Animated.View>
  )
}

/**
 * The song playing, at the top of the rail, as a place to let go of a song
 * dragged in from a list: it goes straight after the one playing. There is no
 * "before" to drop into, and doing nothing there read as the drag being broken
 * (Xiao, 2026-09-22).
 */
function PlayingDrop({
  row,
  onDropSongs,
  children,
}: {
  row: QueueRow
  onDropSongs: (at: number, songIds: readonly number[]) => void
  children: ReactNode
}): ReactNode {
  const playingRef = useRef<View>(null)
  const over = useSongDropTarget(playingRef, {
    enabled: true,
    onDrop: songIds => onDropSongs(row.index + 1, songIds),
  })
  return (
    <View ref={playingRef} collapsable={false} style={styles.playing}>
      {children}
      {over ? <View style={[styles.dropLine, styles.dropLineFoot]} /> : null}
    </View>
  )
}

/** The key a focused row answers with removal. */
const REMOVE_KEYS = new Set(['Delete', 'Backspace'])

/**
 * Focus the rail's row at `index` once the rail has drawn its move: a row
 * moved from the keyboard is drawn anew in its new place, and the next ⌥↓
 * would otherwise go nowhere. Only a browser has keys to press.
 */
function focusRowSoon(index: number): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-testid="queue-row-${index}"]`)?.focus()
  })
}

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
  downloaded,
  notDownloadedMark,
  unavailable,
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
  downloaded: boolean
  notDownloadedMark: boolean
  /** Not on this device, with nothing to stream it from now: faded. */
  unavailable: boolean
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
    onKeyDown: (event: {
      nativeEvent: { key: string; altKey: boolean }
      preventDefault: () => void
    }) => {
      const { key, altKey } = event.nativeEvent
      // ⌥↑ and ⌥↓ move a song still to come, as dragging it does.
      if (altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
        event.preventDefault()
        const to = actions.step(index, key === 'ArrowDown' ? 1 : -1)
        if (to !== null) focusRowSoon(to)
        return
      }
      if (!REMOVE_KEYS.has(key)) return
      event.preventDefault()
      actions.removeFocused(index)
    },
    onContextMenu: (event: { preventDefault: () => void }) => {
      event.preventDefault()
      actions.menu(rowRef.current, { song, index }, kind === 'played')
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
            kind === 'played' ? styles.greyed : unavailable && styles.unavailable,
            settling && { transform: [{ scale: actions.lift }] },
          ]}
        >
          <Press
            feedback="wash"
            testID={`queue-row-${index}`}
            onPress={() => actions.play(index)}
            accessibilityRole="button"
            accessibilityLabel={`${song.title}, ${artistOr(song.artist)}`}
            style={styles.press}
            {...web}
          >
            <RowFace
              song={song}
              artUri={artUri}
              mark={
                downloaded ? (
                  <Downloaded size={iconSize.sub} tone="good" />
                ) : notDownloadedMark ? (
                  <NotDownloaded size={iconSize.sub} tone="textMuted" />
                ) : null
              }
            />
          </Press>
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
  mark,
}: {
  song: Song
  artUri: string | null | undefined
  grip?: boolean
  /** Whether the song is on this device, at the row's end, as a song row says it. */
  mark?: ReactNode
}): ReactNode {
  const { theme } = useUnistyles()
  return (
    <SongLine
      style={styles.face}
      leading={
        grip ? (
          <View style={styles.gripSlot}>
            <Grip size={iconSize.field} color={theme.colors.textMuted} />
          </View>
        ) : null
      }
      artUri={artUri}
      coverTitle={song.album || song.title}
      title={song.title}
      sub={`${artistOr(song.artist)} · ${formatDuration(song.duration)}`}
      trailing={mark}
    />
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
    gap: space.snug,
    // A step up from the page, told apart by tone and not by a line (`S2`).
    backgroundColor: theme.colors.surface1,
    // Chrome, as the sidebar is: a drag in it moves a song, not a selection.
    userSelect: 'none',
  },
  railOver: {
    // Thrown sideways, onto the page the rail slides over, so not `artShadow`'s.
    boxShadow: `-18px 0 40px ${theme.colors.floatShadow}`,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: -6 },
  summary: { flex: 1, minWidth: 0, color: theme.colors.textSecondary, fontSize: type.small },
  list: { flex: 1, marginHorizontal: -6 },
  listContent: { paddingBottom: space.md },
  roomContent: { paddingHorizontal: space.tight, paddingBottom: space.md },
  labelInset: { paddingLeft: space.tight },
  // The playing card, a step clear of the first song to come.
  playing: { marginBottom: space.xs },
  slot: { height: ROW_HEIGHT, borderRadius: radius.cover },
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
    paddingRight: space.tight,
  },
  greyed: { opacity: 0.42 },
  unavailable: { opacity: OPACITY.dim },
  press: { flex: 1, minWidth: 0, alignSelf: 'stretch', borderRadius: radius.cover },
  // In from the row's edge by the list's bleed, so the covers stand under the
  // heading while a pressed row's shade still reaches past them.
  face: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
    paddingLeft: space.tight,
  },
  gripSlot: {
    width: 24,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    paddingRight: space.tight,
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
}))

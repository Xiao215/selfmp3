import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Text, View, useWindowDimensions } from 'react-native'
import { Guide, slideWith } from '../guide/Guide'
import { useGuide } from '../guide/useGuide'
import type { StyleProp, ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useRouter, type Href } from 'expo-router'
import type { Song, Tag } from '@selfmp3/shared'
import { hitSlopFor, motion, radius, space, type, tracking, iconSize } from '@selfmp3/client'
import { fonts } from '../../ports/fonts'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { useEscape } from '../../shell/useEscape'
import { ease, motionMs, spring, timing } from '../../ui/motion'
import { MOVE_MS, overshootRange, roomShift } from '../../ui/motion.model'
import { label, rowTitle } from '../../ui/surfaces'
import { Button } from '../../ui/components/Button'
import { HoldToReorder, useLiftScale, useMakeRoom } from '../../ui/components/HoldToReorder'
import { Shuffle, X } from '../../ui/components/Icons'
import { SheetBackdrop, SheetGrabber, useSheetPull } from '../../ui/components/Sheet'
import { SongRow, useSongRowHeight } from '../../ui/components/SongRow'
import { useRowTagPicker } from '../../ui/components/useRowTagPicker'
import { sourceTagIds } from '../lists/lists.model'
import { useSwallowSwipeClick } from '../../ports/swipeClick'
import { useTouchTravel } from '../../ui/useTouchTravel'
import { closeQueueSheet } from './queueSheet.store'
import { UpNextSource } from './UpNextSource'
import { OnlySongEnd, useOnlySongEndNotice } from './OnlySongEnd'
import {
  dragTarget,
  nextLabel,
  onlySongEnded,
  swipeOffset,
  swipeRemoves,
  SWIPE_START,
  SWIPE_VERTICAL_SLOP,
  type QueueRow,
} from './queue.model'
import { useQueueEdits } from './useQueueEdits'
import {
  KeepGoingNext,
  UpNextSwitches,
  ClearRestButton,
  PlayingNow,
  UpNextList,
  useQueueRowFacts,
  useUpNextShown,
} from './UpNextParts'
import { RoomList } from '../room/RoomList'
import { useRoom } from '../room/room.store'
import { ScrollView } from '../../ui/components/Scroll'
import { Press } from '../../ui/components/Press'

/** How far below the status bar the sheet's top edge sits (`P25`: the page's title peeks out). */
const SHEET_TOP = 16

/**
 * Up next on a phone (docs/ui-mock `P25`, `P26`): a sheet over the whole
 * foot of the screen, the mini player and the tab bar included, because while
 * it is open it is the player. The song playing sits on top with its
 * equaliser, what is next below it, what has played greyed at the end — a tap
 * on one of those plays it again.
 *
 * Holding a row lifts it to be moved (`HoldToReorder`, as a playlist's rows
 * do); swiping it left removes it, over the `remove` ground, with an Undo. No
 * grips, no ✕, no bin: the row is the handle for both.
 *
 * Drawn by the shell after the tab bar rather than through the overlay host,
 * so a song's menu or the Undo toast still land above it. Stays mounted while
 * shut and draws nothing then, so the Undo it raised can still reach the queue
 * as it is when pressed (`useQueueEdits`).
 *
 * The phone's Now Playing draws one of its own while its native modal covers
 * the shell's, and hands it `go` so a tag or the source line takes the modal
 * down before the page is pushed.
 */
export function QueueSheet({ go }: { go?: (href: Href) => void }): ReactNode {
  const shown = useUpNextShown(false)

  // Mounted from the moment it is asked for until its exit has played out,
  // as `Sheet` is. Adjusted during render so opening never shows a frame without it.
  const [mounted, setMounted] = useState(shown)
  if (shown && !mounted) setMounted(true)
  const gone = useCallback(() => setMounted(false), [])
  // Here, above the panel, so an Undo raised before it shut still reaches the queue.
  const edits = useQueueEdits(mounted, go)
  useOnlySongEndNotice(edits.player)

  return mounted ? <SheetPanel shown={shown} onGone={gone} edits={edits} go={go} /> : null
}

/**
 * What a row's handlers do, read when they run. Made once for the sheet, so a
 * row's memo holds while the queue plays on and while another row is carried
 * past it: each row used to be handed new arrows on every render, and every
 * row of the sheet redrew, gestures and all, for each row a drag crossed.
 */
interface SheetRowActions {
  readonly play: (index: number) => void
  readonly remove: (index: number) => void
  readonly openTag: (tagId: number) => void
  /** A row's count of the tags it had no room for: the song's tag window. */
  readonly editTags: (anchor: View | null, song: Song) => void
  readonly holding: (songId: number, holding: boolean) => void
  readonly start: (index: number, songId: number) => void
  readonly move: (index: number, dy: number) => void
  readonly end: (index: number, dy: number) => void
  readonly measured: (height: number) => void
  /** A row has been taken by a sideways swipe, or let go. */
  readonly swiping: (swiping: boolean) => void
  /** The finger's travel, which the carried row follows without a render. */
  readonly dragY: Animated.Value
  /** The scale the held row wears (`useLiftScale`). */
  readonly lift: Animated.Value
}

function SheetPanel({
  shown,
  onGone,
  edits,
  go,
}: {
  shown: boolean
  onGone: () => void
  edits: ReturnType<typeof useQueueEdits>
  go?: (href: Href) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const router = useRouter()
  const artFor = useArt(ROW_COVER_SIZE)
  const factsOf = useQueueRowFacts()
  const { player, rows, remove, clearRest, openTag } = edits
  const inRoom = useRoom().state !== null
  const [progress] = useState(() => new Animated.Value(0))
  // Pulled down by its head, as every sheet is (`useSheetPull`): only the
  // head, not the list, so a pull on the rows is still a scroll.
  const { pull, gesture: pullDown } = useSheetPull(closeQueueSheet)
  // The dim's opacity, a native node built once: the curve runs past 1 on the
  // way up; the dim does not.
  const [dim] = useState(() =>
    progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
  )
  // The sheet's rise, rebuilt only when the window's height changes the distance.
  const rise = useMemo(
    () => Animated.add(progress.interpolate(overshootRange(height, 4)), pull),
    [progress, pull, height],
  )
  useEscape(shown, closeQueueSheet, { layer: true })

  /*
   * As tall as what it holds, between half the screen and all of it (P14 A):
   * with one song queued the full sheet was mostly empty, and the page behind
   * it may as well stay in view. The panel less the list's frame is the head
   * and the playing card; the list's content is the rest.
   */
  const [sizes, setSizes] = useState({ panel: 0, frame: 0, content: 0 })
  const tallest = height - insets.top - SHEET_TOP
  const wanted = sizes.panel - sizes.frame + sizes.content
  const sheetHeight =
    inRoom || sizes.panel === 0 || sizes.content === 0
      ? tallest
      : Math.min(tallest, Math.max(Math.round(height / 2), Math.ceil(wanted)))
  const listHeights = useCallback((frame: number | null, content: number | null) => {
    setSizes(now => {
      const next = { ...now, frame: frame ?? now.frame, content: content ?? now.content }
      return next.frame === now.frame && next.content === now.content ? now : next
    })
  }, [])

  useEffect(() => {
    // Up from the foot with a small overshoot, 300 ms, and down in 220, as
    // every sheet does (docs/ui-mock `M2`, 3).
    if (shown) {
      pull.setValue(0)
      timing(progress, 1, MOVE_MS.sheetUp, undefined, { easing: ease.overshoot })
      return
    }
    /*
     * The pull is taken off on the way out as well, on the same curve and over
     * the same length: what the panel shows is the rise plus the pull, so a
     * close left holding a hundred points of pull travelled a hundred points
     * farther in the same 220 ms and left visibly faster than a close from
     * rest. Put back rather than cleared, because clearing it would snap the
     * panel up by the pull before it began to leave.
     */
    timing(pull, 0, MOVE_MS.sheetDown, undefined, { easing: ease.in })
    timing(progress, 0, MOVE_MS.sheetDown, onGone, { easing: ease.in })
  }, [shown, progress, pull, onGone])

  // The row being held and the row it would land on; the travel is `dragY`,
  // which moves the lifted row without a render.
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const [dragY] = useState(() => new Animated.Value(0))
  // A row under a sideways swipe: the guide waits until it is let go.
  const [swiping, setSwiping] = useState(false)
  /*
   * The held row lifts a little towards the finger (`M2`, 6); the rows it
   * passes step aside for it (`MakeRoom`), so where it will land is a gap
   * rather than a line.
   *
   * One scale for the sheet, worn by one song at a time — the one whose hold
   * is being counted, then carried, then settling after the drop
   * (`useLiftScale`).
   */
  const lift = useLiftScale()
  // A row's "+2" opens the song's tags (E1); a chip for the tag Up next
  // is playing from would only repeat its name, so it is left off.
  const { onEditTags: editTags, picker: tagPicker } = useRowTagPicker()
  const fromTags = useMemo(() => sourceTagIds(player.source), [player.source])
  // Its made-once parts on their own, so the row actions below are made once too.
  const { lift: liftScale, holding: holdRow, start: liftRow, drop: dropRow } = lift
  /*
   * Every row is a song row's height, so the list draws only the rows in view
   * (`UpNextList`) and a drag is counted in rows. Text enlarged in the
   * system's settings can wrap past a row's cover, and then the first row's
   * own height is taken instead. State rather than a ref: the rows making
   * room read it while rendering.
   */
  const promised = useSongRowHeight()
  const [measured, setMeasured] = useState(0)
  const rowHeight = promised ?? (measured || ROW_HEIGHT_GUESS)
  const first = rows.next[0]?.index ?? 0
  /*
   * Swiping a song away and holding one to move it, shown once on the first
   * song to come, in place of a line that sat under the list for good. Never
   * over a row already being held or swiped: it came up mid-swipe, and the
   * tap that closed it was the swipe's own finger. A hold still being
   * counted, and a menu opened from a row, the guide waits out itself
   * (`guideBusy`); the sheet is the one layer it is drawn in.
   */
  const [firstTarget, guide] = useGuide(
    'up-next',
    shown &&
      !inRoom &&
      rows.next.length >= 2 &&
      drag === null &&
      !swiping &&
      !onlySongEnded(player),
    { layers: 1 },
  )
  const last = rows.next[rows.next.length - 1]?.index ?? 0

  /*
   * What the row handlers read when they run: the rows a move may land among,
   * a row's height, and the player. Kept current after every render; read only
   * inside events.
   */
  const latest = useRef({ first, last, rowHeight, player, remove, openTag })
  useEffect(() => {
    latest.current = { first, last, rowHeight, player, remove, openTag }
  })
  const actions = useMemo<SheetRowActions>(() => {
    const target = (index: number, dy: number): number => {
      const now = latest.current
      return dragTarget(index, dy, now.rowHeight, now)
    }
    return {
      play: index => latest.current.player.jumpTo(index),
      remove: index => latest.current.remove(index),
      openTag: tagId => latest.current.openTag(tagId),
      editTags,
      holding: holdRow,
      start: (index, songId) => {
        dragY.setValue(0)
        liftRow(songId)
        setDrag({ from: index, over: index })
      },
      move: (index, dy) => {
        dragY.setValue(dy)
        const over = target(index, dy)
        setDrag(now => (now && now.over === over ? now : { from: index, over }))
      },
      end: (index, dy) => {
        setDrag(null)
        // Dropped: the scale settles back on the spring with a tap, and the
        // row keeps wearing it into its new place.
        dropRow()
        // No travel is a hold taken away (`HoldToReorder`): the song held may
        // be the one playing now, outside the rows a move lands among, and
        // held to them it would have been moved there.
        if (dy === 0) return
        const to = target(index, dy)
        if (to !== index) latest.current.player.reorderQueue(index, to)
      },
      measured: setMeasured,
      swiping: setSwiping,
      dragY,
      lift: liftScale,
    }
  }, [dragY, liftScale, holdRow, liftRow, dropRow, editTags])

  const playing = rows.playing
  // Something to come for Clear the rest to take: with nothing after the song
  // playing it is hidden, where it sat over "Nothing next" (w23).
  const clearable = rows.next.length > 0
  const ended = onlySongEnded(player)
  const openNowPlaying = (): void => {
    closeQueueSheet()
    router.navigate('/now-playing')
  }

  const row = (entry: QueueRow, kind: 'next' | 'played'): ReactNode => {
    const movable = kind === 'next'
    const facts = factsOf(entry.song)
    const sheetRow = (
      <SheetRow
        song={entry.song}
        index={entry.index}
        movable={movable}
        shift={drag && movable ? roomShift(entry.index, drag.from, drag.over) : 0}
        step={rowHeight}
        carrying={drag !== null}
        lifted={drag?.from === entry.index}
        wearingLift={lift.wearing === entry.song.id}
        measures={promised === null && entry.index === first}
        artUri={artFor(entry.song)}
        downloaded={facts.downloaded}
        unavailable={facts.unavailable}
        tags={facts.tags}
        hideTagIds={fromTags}
        actions={actions}
        // The swipe guide pulls this row off its ground, so the red Remove
        // shows from the right as it does under a finger.
        peek={
          movable && entry.index === first && guide.shown && guide.step === 0
            ? slideWith(guide, 110)
            : null
        }
      />
    )
    /*
     * The same wrapper round every row, and the guide's ref on the first only.
     * Wrapped only when it was first, a row became something else the moment
     * the row above it went: remounted mid-swipe, its removal was dropped and
     * it came back; remounted mid-hold, it was left lifted and every swipe dead.
     */
    return (
      <View ref={movable && entry.index === first ? firstTarget : undefined} collapsable={false}>
        {sheetRow}
      </View>
    )
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <SheetBackdrop opacity={dim} onClose={closeQueueSheet} label="Close Up next" />
      <Animated.View
        testID="queue-sheet"
        role="dialog"
        aria-label="Up next"
        style={[
          styles.panel,
          {
            top: height - sheetHeight,
            paddingBottom: insets.bottom + space.md,
            transform: [{ translateY: rise }],
          },
        ]}
        onLayout={event => {
          const panel = event.nativeEvent.layout.height
          setSizes(now => (now.panel === panel ? now : { ...now, panel }))
        }}
      >
        <GestureDetector gesture={pullDown}>
          <View collapsable={false} style={styles.head}>
            {/* The grabber is also a button: a pull is hard to find with a screen reader. */}
            <Press
              feedback="dim"
              onPress={closeQueueSheet}
              accessibilityRole="button"
              accessibilityLabel="Close Up next"
              testID="queue-sheet-close"
              hitSlop={hitSlopFor(GRABBER_HIT)}
              style={styles.grabberHit}
            >
              <SheetGrabber />
            </Press>
            {inRoom ? null : (
              <View style={styles.titleRow}>
                <Text
                  style={styles.title}
                  accessibilityRole="header"
                  aria-level={2}
                  numberOfLines={1}
                >
                  Up next
                </Text>
                <View style={styles.pills}>
                  {/* On is white, as a chosen chip is (proposal P1); the
                    transport's own shuffle says it in colour instead. */}
                  <Button
                    label="Shuffle"
                    icon={
                      <Shuffle
                        color={
                          player.queue.shuffle ? theme.colors.onPrimary : theme.colors.textPrimary
                        }
                      />
                    }
                    active={player.queue.shuffle}
                    onPress={player.toggleShuffle}
                  />
                  {clearable ? <ClearRestButton onPress={clearRest} /> : null}
                </View>
              </View>
            )}
            {inRoom ? null : <UpNextSource onOpen={closeQueueSheet} go={go} />}
          </View>
        </GestureDetector>

        {inRoom ? (
          <ScrollView style={styles.list} contentContainerStyle={styles.roomContent}>
            <RoomList go={go} />
          </ScrollView>
        ) : null}

        {playing && !inRoom ? (
          <View style={styles.card}>
            <PlayingNow row={playing} ended={ended} onOpen={openNowPlaying} />
          </View>
        ) : null}

        {inRoom ? null : (
          <UpNextList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            scrollEnabled={drag === null}
            next={rows.next}
            played={rows.played}
            rowHeight={rowHeight}
            renderRow={row}
            raised={drag?.from ?? null}
            onHeights={listHeights}
            labelStyle={styles.labelInset}
            afterNext={ended ? null : <KeepGoingNext style={styles.labelInset} />}
            head={
              ended && playing ? (
                <OnlySongEnd song={playing.song} player={player} />
              ) : (
                <Text style={[styles.label, styles.labelInset]}>{nextLabel(rows.next)}</Text>
              )
            }
            foot={
              <UpNextSwitches player={player} upcoming={rows.next.length} style={styles.autoMix} />
            }
          />
        )}
      </Animated.View>
      {tagPicker}
      <Guide
        inline
        guide={guide}
        steps={[
          { gesture: 'swipe-left', text: 'Swipe left to remove a song', distance: 110 },
          {
            gesture: 'hold',
            text: 'Hold a song to move it',
            sub: 'Drag it up or down, then let go',
          },
        ]}
      />
    </View>
  )
}

/** One row of the sheet: the song, swiped to remove, held to move. */
const SheetRow = memo(function SheetRow({
  song,
  index,
  movable,
  shift,
  step,
  carrying,
  lifted,
  wearingLift,
  measures,
  artUri,
  downloaded,
  unavailable,
  tags,
  hideTagIds,
  actions,
  peek,
}: {
  song: Song
  index: number
  /** Still to come, so it can be held and moved; played rows stay put. */
  movable: boolean
  shift: -1 | 0 | 1
  step: number
  carrying: boolean
  /** This is the row being carried. */
  lifted: boolean
  /** This row wears the lift: its hold is being counted, it is carried, or it is settling. */
  wearingLift: boolean
  /** The first row to come, whose height is the step every drag is counted in. */
  measures: boolean
  artUri: string | null | undefined
  downloaded: boolean
  /** Not on this phone, with nothing to stream it from now: faded. */
  unavailable: boolean
  tags: readonly Tag[]
  /** The tags Up next is playing from, whose chips are left off. */
  hideTagIds: readonly number[]
  actions: SheetRowActions
  /** The swipe guide's pull, over the ground (`slideWith`). */
  peek: object | null
}): ReactNode {
  const onHolding = useCallback(
    (holding: boolean) => actions.holding(song.id, holding),
    [actions, song.id],
  )
  const onStart = useCallback(() => actions.start(index, song.id), [actions, index, song.id])
  const onMove = useCallback((_dx: number, dy: number) => actions.move(index, dy), [actions, index])
  const onEnd = useCallback((_dx: number, dy: number) => actions.end(index, dy), [actions, index])
  const onRemove = useCallback(() => actions.remove(index), [actions, index])
  // A sideways drag the swipe did not take lets go as a press: not a tap, so
  // the song is not played and Up next keeps its place.
  const travel = useTouchTravel()
  const onPress = useCallback(() => {
    if (!travel.moved()) actions.play(index)
  }, [actions, index, travel])
  // Wearing the scale without being carried: the hold is still being counted,
  // or the row has just been let go and is settling. Only the scale then —
  // `dragY` is left where the finger put it (see `end`), so a settling row that
  // also read it would settle in the wrong place.
  const swelling = !lifted && wearingLift
  return (
    <MakeRoom
      shift={shift}
      step={step}
      carrying={carrying}
      style={
        lifted
          ? [
              styles.liftedCell,
              { transform: [{ translateY: actions.dragY }, { scale: actions.lift }] },
            ]
          : swelling
            ? [styles.liftedCell, { transform: [{ scale: actions.lift }] }]
            : null
      }
    >
      <SwipeToRemove
        enabled={!carrying}
        onRemove={onRemove}
        onSwiping={actions.swiping}
        peek={peek}
      >
        <HoldToReorder
          enabled={movable}
          onHolding={onHolding}
          onStart={onStart}
          onMove={onMove}
          onEnd={onEnd}
          onLayoutHeight={measures ? actions.measured : undefined}
        >
          <View style={!movable && styles.played} {...travel.handlers}>
            <SongRow
              testID={`queue-row-${index}`}
              song={song}
              artUri={artUri}
              active={false}
              downloaded={downloaded}
              unavailable={unavailable}
              onPress={onPress}
              tags={tags}
              hideTagIds={hideTagIds}
              onOpenTag={actions.openTag}
              onEditTags={actions.editTags}
              lifted={lifted}
            />
          </View>
        </HoldToReorder>
      </SwipeToRemove>
    </MakeRoom>
  )
})

/**
 * A row of the queue, stepping one row up or down while a held row is carried
 * past it, 180 ms each, so the neighbours make room one at a time (`M2`, 6);
 * the step itself is `useMakeRoom`, which the rail and a playlist share.
 */
function MakeRoom({
  shift,
  step,
  carrying,
  style,
  children,
}: {
  shift: -1 | 0 | 1
  step: number
  /** A row is being carried; when it is let go every step comes off at once. */
  carrying: boolean
  /** The held row's own style, which follows the finger instead. */
  style: StyleProp<ViewStyle> | null
  children: ReactNode
}): ReactNode {
  const room = useMakeRoom(shift, step, carrying)
  // Always an animated value, never a plain style in its place: swapping one
  // for the other after mount leaves react-native-web drawing the plain one.
  return <Animated.View style={style ?? room}>{children}</Animated.View>
}

/**
 * A row that can be swiped left off the list, over the `remove` ground.
 *
 * The swipe is the row's only once the finger has gone sideways first
 * (`SWIPE_START` left, and no more than `SWIPE_VERTICAL_SLOP` up or down): a
 * finger that starts vertically is the list's scroll, and one moving right —
 * the system's back gesture — is never answered. Let go past 30 % of the row
 * and it slides the rest of the way and is removed; short of that it springs
 * back and nothing happened.
 */
function SwipeToRemove({
  enabled,
  onRemove,
  onSwiping,
  peek,
  children,
}: {
  enabled: boolean
  onRemove: () => void
  /** Told when the swipe takes the row and when the finger lets go. */
  onSwiping: (swiping: boolean) => void
  /** The guide pulling the row, the way a finger would: the ground stays put. */
  peek: object | null
  children: ReactNode
}): ReactNode {
  const { theme } = useUnistyles()
  const [x] = useState(() => new Animated.Value(0))
  // Measured once as the row lays out; the gesture is rebuilt with it. Until
  // then — and in a browser, where a row inside this list is not always told
  // its layout — the sheet's own width, which is the window's.
  const [measured, setWidth] = useState(0)
  const window = useWindowDimensions()
  const width = measured > 0 ? measured : window.width
  const [going, setGoing] = useState(false)
  // Read through a ref rather than watched: an effect that restarted with it
  // would never reach its end.
  const remove = useRef(onRemove)
  useEffect(() => {
    remove.current = onRemove
  })
  /*
   * The slide out, then the row taken out at the end of it. On a timer of the
   * slide's own length rather than the animation's end: a value the gesture
   * has been driving does not always report its end in a browser. The timer is
   * the effect's so that closing the sheet mid-slide drops it — otherwise it
   * woke afterwards and took a song out of the queue. The offset is put back,
   * so an Undo brings the row back where it was.
   *
   * Through `motionMs`, so it is the slide's length and not a number beside
   * it: under Reduce Motion the row is gone the moment it is let go, and the
   * timer must not leave it sitting there, removed but still drawn, for the
   * 140 ms of a slide that never ran.
   */
  useEffect(() => {
    if (!going) return undefined
    const timer = setTimeout(() => {
      remove.current()
      x.setValue(0)
      setGoing(false)
    }, motionMs(motion.base))
    return () => clearTimeout(timer)
  }, [going, x])

  // The click a mouse sends on letting go of a swipe is the swipe's, not a
  // press on the song or a chip under it.
  const node = useRef<View>(null)
  const markSwiping = useSwallowSwipeClick(node)

  // Made again only when it is switched or the row's width changes: a new
  // gesture each render was a native handler reconfigured each render.
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX([-SWIPE_START, Number.MAX_SAFE_INTEGER])
        .failOffsetY([-SWIPE_VERTICAL_SLOP, SWIPE_VERTICAL_SLOP])
        .runOnJS(true)
        .onStart(() => onSwiping(true))
        .onUpdate(event => {
          x.setValue(swipeOffset(event.translationX, width))
          markSwiping()
        })
        // The distance decides, not whether the recogniser calls its end a success:
        // in a browser a released pointer ends it as cancelled, and the row sprang
        // back from a full swipe.
        .onEnd(event => {
          if (swipeRemoves(event.translationX, width)) {
            // On `ease.in`, as everything that leaves is: the row carries on off
            // the edge rather than easing to a stop at it.
            timing(x, -width, motion.base, undefined, { easing: ease.in })
            setGoing(true)
          } else {
            spring(x, 0)
          }
        })
        .onFinalize(() => onSwiping(false)),
    [enabled, width, x, markSwiping, onSwiping],
  )

  return (
    <GestureDetector gesture={swipe}>
      <View
        ref={node}
        collapsable={false}
        style={styles.swipe}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
      >
        <View style={styles.ground} pointerEvents="none">
          <X size={iconSize.item} color={theme.colors.textPrimary} />
          <Text style={styles.groundText}>Remove</Text>
        </View>
        {/* The finger's pull outside, the guide's inside; only the inner one is
            opaque, so either uncovers the ground. */}
        <Animated.View style={{ transform: [{ translateX: x }] }}>
          <Animated.View style={[styles.swipeRow, peek]}>{children}</Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

/** The grabber's button: the 4-point bar and the 2 above and below it. */
const GRABBER_HIT = 8

/** A row's height before the first has been measured, where a song row's cannot be promised. */
const ROW_HEIGHT_GUESS = 64

const styles = StyleSheet.create(theme => ({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: space.md,
    paddingTop: space.snug,
    backgroundColor: theme.colors.surface1,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    overflow: 'hidden',
    boxShadow: `0 -12px 40px ${theme.colors.floatShadow}`,
  },
  head: { gap: space.md, paddingHorizontal: 18 },
  grabberHit: { alignSelf: 'center', paddingVertical: 2, paddingHorizontal: 20 },
  // On a 320 pt phone the pills take a row of their own rather than breaking
  // the title over two lines.
  titleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  title: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: type.large,
    letterSpacing: tracking.heading,
  },
  pills: { flexDirection: 'row', gap: space.tight },
  card: { marginHorizontal: space.md },
  list: { flex: 1 },
  listContent: { paddingBottom: space.lg },
  roomContent: { paddingHorizontal: 18, paddingBottom: space.lg },
  label: { ...label(theme.colors), paddingBottom: space.xs },
  labelInset: { paddingHorizontal: 18 },
  played: { opacity: 0.42 },
  liftedCell: { zIndex: 2 },
  swipe: { overflow: 'hidden' },
  ground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.sm,
    paddingRight: 22,
    backgroundColor: theme.colors.remove,
  },
  groundText: rowTitle(theme.colors),
  // Opaque, so the ground shows only where the row has been swiped off it.
  swipeRow: { backgroundColor: theme.colors.surface1 },
  autoMix: { paddingTop: space.lg, paddingHorizontal: 18 },
}))

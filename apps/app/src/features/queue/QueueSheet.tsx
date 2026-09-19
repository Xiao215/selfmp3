import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useRouter } from 'expo-router'
import { formatDuration, type Song } from '@selfmp3/shared'
import { fonts, isDownloaded, motion, radius, space, type, withAlpha } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useArt } from '../../offline/useArt'
import { usePlayerProgress } from '../../player/PlayerProvider'
import { useEscape } from '../../shell/useEscape'
import { useLayout } from '../../shell/useLayout'
import { ease, spring, timing } from '../../ui/motion'
import { MOVE_MS, overshootRange, roomShift } from '../../ui/motion.model'
import { label } from '../../ui/surfaces'
import { useSongColor } from '../../ui/useSongColor'
import { Cover } from '../../ui/components/Cover'
import { Equalizer } from '../../ui/components/Equalizer'
import { HoldToReorder } from '../../ui/components/HoldToReorder'
import { Shuffle, X } from '../../ui/components/Icons'
import { PlayPauseIcon } from '../../ui/components/PlayPauseIcon'
import { SongRow } from '../../ui/components/SongRow'
import { Toggle } from '../../ui/components/Toggle'
import { tip } from '../../ui/tip'
import { closeQueueSheet, useQueueSheetOpen } from './queueSheet.store'
import {
  autoMixLine,
  dragTarget,
  nextLabel,
  swipeOffset,
  swipeRemoves,
  SWIPE_START,
  SWIPE_VERTICAL_SLOP,
  type QueueRow,
} from './queue.model'
import { useQueueEdits } from './useQueueEdits'

/** How far below the status bar the sheet's top edge sits (`P25`: the page's title peeks out). */
const SHEET_TOP = 16
/** A pull on the head past this, or flicked faster than `PULL_FLICK`, puts the sheet away. */
const PULL_CLOSE = 120
const PULL_FLICK = 900

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
 */
export function QueueSheet(): ReactNode {
  const open = useQueueSheetOpen()
  const { wide } = useLayout()
  const edits = useQueueEdits()
  const loaded = edits.player.current !== null
  const shown = open && loaded && !wide

  // Nothing left to show: the queue was cleared, or its last song removed.
  useEffect(() => {
    if (open && !loaded) closeQueueSheet()
  }, [open, loaded])

  // Mounted from the moment it is asked for until its exit has played out,
  // as `Sheet` is. Adjusted during render so opening never shows a frame without it.
  const [mounted, setMounted] = useState(shown)
  if (shown && !mounted) setMounted(true)
  const gone = useCallback(() => setMounted(false), [])

  return mounted ? <SheetPanel shown={shown} onGone={gone} edits={edits} /> : null
}

function SheetPanel({
  shown,
  onGone,
  edits,
}: {
  shown: boolean
  onGone: () => void
  edits: ReturnType<typeof useQueueEdits>
}): ReactNode {
  const { theme } = useUnistyles()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const router = useRouter()
  const artFor = useArt()
  const { state: downloads, installed } = useDownloads()
  const { player, rows, remove, tagsOf, openTag } = edits
  const [progress] = useState(() => new Animated.Value(0))
  const [pull] = useState(() => new Animated.Value(0))
  useEscape(shown, closeQueueSheet, { layer: true })

  useEffect(() => {
    // Up from the foot with a small overshoot, 300 ms, and down in 220, as
    // every sheet does (docs/ui-mock `M2`, 3).
    if (shown) {
      pull.setValue(0)
      timing(progress, 1, MOVE_MS.sheetUp, undefined, { easing: ease.overshoot })
      return
    }
    timing(progress, 0, MOVE_MS.sheetDown, onGone, { easing: ease.in })
  }, [shown, progress, pull, onGone])

  /*
   * Pulled down by its head: the panel follows the finger, and far enough or
   * fast enough puts it away. Only the head, not the list, so a pull on the
   * rows is still a scroll.
   */
  const pullDown = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetX([-20, 20])
    .runOnJS(true)
    .onUpdate(event => pull.setValue(Math.max(0, event.translationY)))
    .onEnd((event, success) => {
      if (success && (event.translationY > PULL_CLOSE || event.velocityY > PULL_FLICK)) {
        closeQueueSheet()
      } else {
        spring(pull, 0)
      }
    })

  // The row being held and the row it would land on; the travel is `dragY`,
  // which moves the lifted row without a render.
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const [dragY] = useState(() => new Animated.Value(0))
  // The held row lifts a little towards the finger (`M2`, 6); the rows it
  // passes step aside for it (`MakeRoom`), so where it will land is a gap
  // rather than a line.
  const [lift] = useState(() => new Animated.Value(1))
  // State rather than a ref: the rows making room read it while rendering.
  const [rowHeight, setRowHeight] = useState(0)
  const first = rows.next[0]?.index ?? 0
  const last = rows.next[rows.next.length - 1]?.index ?? 0

  const playing = rows.playing
  const openNowPlaying = (): void => {
    closeQueueSheet()
    router.navigate('/now-playing')
  }

  const row = (entry: QueueRow, movable: boolean): ReactNode => {
    const here = isDownloaded(downloads.index, entry.song.id)
    const lifted = drag?.from === entry.index
    return (
      <MakeRoom
        key={entry.song.id}
        shift={drag && movable ? roomShift(entry.index, drag.from, drag.over) : 0}
        step={rowHeight}
        carrying={drag !== null}
        style={
          lifted
            ? [styles.liftedCell, { transform: [{ translateY: dragY }, { scale: lift }] }]
            : null
        }
      >
        <SwipeToRemove enabled={drag === null} onRemove={() => remove(entry.index)}>
          <HoldToReorder
            enabled={movable}
            onStart={() => {
              dragY.setValue(0)
              lift.setValue(1)
              timing(lift, LIFTED_SCALE, MOVE_MS.lift, undefined, { easing: ease.out })
              setDrag({ from: entry.index, over: entry.index })
            }}
            onMove={dy => {
              dragY.setValue(dy)
              const over = dragTarget(entry.index, dy, rowHeight, { first, last })
              setDrag(now => (now && now.over === over ? now : { from: entry.index, over }))
            }}
            onEnd={dy => {
              setDrag(null)
              const to = dragTarget(entry.index, dy, rowHeight, { first, last })
              if (to !== entry.index) player.reorderQueue(entry.index, to)
            }}
            onLayoutHeight={entry.index === first ? h => setRowHeight(h) : undefined}
          >
            <View style={!movable && styles.played}>
              <SongRow
                testID={`queue-row-${entry.index}`}
                song={entry.song}
                artUri={artFor(entry.song)}
                active={false}
                downloaded={here}
                notDownloadedMark={installed && !here}
                onPress={() => player.jumpTo(entry.index)}
                tags={tagsOf(entry.song)}
                onToggleTag={openTag}
                // The hold is the move's, not a menu's.
                onLongPress={null}
                lifted={lifted}
              />
            </View>
          </HoldToReorder>
        </SwipeToRemove>
      </MakeRoom>
    )
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.backdrop,
          {
            // The curve runs past 1 on the way up; the dim does not.
            opacity: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 1],
              extrapolate: 'clamp',
            }),
          },
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={closeQueueSheet}
          accessibilityLabel="Close Up next"
        />
      </Animated.View>
      <Animated.View
        testID="queue-sheet"
        role="dialog"
        aria-label="Up next"
        style={[
          styles.panel,
          {
            top: insets.top + SHEET_TOP,
            paddingBottom: insets.bottom + space.md,
            transform: [
              {
                translateY: Animated.add(progress.interpolate(overshootRange(height, 4)), pull),
              },
            ],
          },
        ]}
      >
        <GestureDetector gesture={pullDown}>
          <View collapsable={false} style={styles.head}>
            {/* The grabber is also a button: a pull is hard to find with a screen reader. */}
            <Pressable
              onPress={closeQueueSheet}
              accessibilityRole="button"
              accessibilityLabel="Close Up next"
              testID="queue-sheet-close"
              hitSlop={12}
              style={styles.grabberHit}
            >
              <View style={styles.grabber} />
            </Pressable>
            <View style={styles.titleRow}>
              <Text style={styles.title} accessibilityRole="header">
                Up next
              </Text>
              <View style={styles.pills}>
                <Pressable
                  onPress={player.toggleShuffle}
                  accessibilityRole="button"
                  accessibilityState={{ selected: player.queue.shuffle }}
                  accessibilityLabel="Shuffle"
                  style={({ pressed }) => [
                    styles.pill,
                    (player.queue.shuffle || pressed) && styles.pillOn,
                  ]}
                >
                  <Shuffle size={16} color={theme.colors.textPrimary} />
                  <Text style={styles.pillText}>Shuffle</Text>
                </Pressable>
                <Pressable
                  onPress={player.clearQueue}
                  accessibilityRole="button"
                  accessibilityLabel="Clear Up next"
                  style={({ pressed }) => [styles.pill, pressed && styles.pillOn]}
                >
                  <Text style={styles.pillText}>Clear</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </GestureDetector>

        {playing ? (
          <PlayingCard
            song={playing.song}
            artUri={artFor(playing.song)}
            playing={player.isPlaying}
            onOpen={openNowPlaying}
            onToggle={player.toggle}
          />
        ) : null}

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          scrollEnabled={drag === null}
        >
          <Text style={styles.label}>{nextLabel(rows.next)}</Text>
          {rows.next.map(entry => row(entry, true))}
          {rows.played.length > 0 ? (
            <>
              <Text style={[styles.label, styles.playedLabel]}>Played</Text>
              {rows.played.map(entry => row(entry, false))}
            </>
          ) : null}

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
          <Text style={styles.hint}>Hold a song to move it · swipe left to remove it</Text>
        </ScrollView>
      </Animated.View>
    </View>
  )
}

/** How much a held row grows as it lifts off the list (`M2`, 6). */
const LIFTED_SCALE = 1.04

/**
 * A row of the queue, stepping one row up or down while a held row is carried
 * past it, 180 ms each, so the neighbours make room one at a time (`M2`, 6).
 *
 * When the move ends the step is taken off at once rather than played back:
 * the list is redrawn in its new order in the same moment, and a row sliding
 * home from where it had stepped to would travel twice.
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
  const [y] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (carrying) timing(y, shift * step, MOVE_MS.room, undefined, { easing: ease.out })
    else y.setValue(0)
  }, [carrying, shift, step, y])
  // Always the animated value, never a plain style in its place: swapping one
  // for the other after mount leaves react-native-web drawing the plain one.
  return (
    <Animated.View style={style ?? { transform: [{ translateY: y }] }}>{children}</Animated.View>
  )
}

/**
 * The song playing, at the top of the sheet: its cover under the equaliser,
 * its colour washed behind it, and play and pause at the end. The rest of the
 * card opens Now Playing.
 */
function PlayingCard({
  song,
  artUri,
  playing,
  onOpen,
  onToggle,
}: {
  song: Song
  artUri: string | null
  playing: boolean
  onOpen: () => void
  onToggle: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const tone = useSongColor(song, artUri)
  return (
    <View style={[styles.card, { backgroundColor: withAlpha(tone.color, 0.2) }]}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Playing ${song.title}. Open now playing`}
        style={styles.cardMain}
      >
        <View>
          <Cover uri={artUri} title={song.album || song.title} size={48} />
          <View style={styles.equalizer} pointerEvents="none">
            <Equalizer paused={!playing} size={14} color={tone.tint} />
          </View>
        </View>
        <View style={styles.cardText}>
          <Text style={[styles.cardLabel, { color: tone.tint }]}>Playing</Text>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {song.title}
          </Text>
          <PlayingLine artist={song.artist || 'Unknown artist'} />
        </View>
      </Pressable>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause' : 'Play'}
        {...tip(playing ? 'Pause' : 'Play')}
        style={({ pressed }) => [styles.cardPlay, pressed && styles.cardPlayPressed]}
      >
        <PlayPauseIcon playing={playing} size={20} color={theme.colors.onPrimary} />
      </Pressable>
    </View>
  )
}

/** "Yorushika · 1:52 of 4:23", on its own so a tick redraws this line and not the sheet. */
function PlayingLine({ artist }: { artist: string }): ReactNode {
  const { position, duration } = usePlayerProgress()
  return (
    <Text style={styles.cardSub} numberOfLines={1}>
      {artist} · {formatDuration(position)} of {formatDuration(duration)}
    </Text>
  )
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
  children,
}: {
  enabled: boolean
  onRemove: () => void
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

  const swipe = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([-SWIPE_START, Number.MAX_SAFE_INTEGER])
    .failOffsetY([-SWIPE_VERTICAL_SLOP, SWIPE_VERTICAL_SLOP])
    .runOnJS(true)
    .onUpdate(event => x.setValue(swipeOffset(event.translationX, width)))
    // The distance decides, not whether the recogniser calls its end a success:
    // in a browser a released pointer ends it as cancelled, and the row sprang
    // back from a full swipe.
    .onEnd(event => {
      if (swipeRemoves(event.translationX, width)) {
        // Slid the rest of the way, then taken out. On a timer of the slide's
        // own length rather than the animation's end: a value the gesture has
        // been driving does not always report its end in a browser. The offset
        // is put back, so an Undo brings the row back where it was.
        timing(x, -width, motion.base)
        setTimeout(() => {
          onRemove()
          x.setValue(0)
        }, motion.base)
      } else {
        spring(x, 0)
      }
    })

  return (
    <GestureDetector gesture={swipe}>
      <View
        collapsable={false}
        style={styles.swipe}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
      >
        <View style={styles.ground} pointerEvents="none">
          <X size={16} color={theme.colors.textPrimary} />
          <Text style={styles.groundText}>Remove</Text>
        </View>
        <Animated.View style={[styles.swipeRow, { transform: [{ translateX: x }] }]}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create(theme => ({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // The dim every sheet in the app draws behind itself (`Sheet`).
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: space.md,
    paddingTop: 10,
    backgroundColor: theme.colors.surface1,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    overflow: 'hidden',
    boxShadow: `0 -12px 40px ${theme.colors.floatShadow}`,
  },
  head: { gap: space.md, paddingHorizontal: 18 },
  grabberHit: { alignSelf: 'center', paddingVertical: 2, paddingHorizontal: 20 },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surfaceSelected,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: 24,
    letterSpacing: -0.2,
  },
  pills: { flexDirection: 'row', gap: 6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface3,
  },
  pillOn: { backgroundColor: theme.colors.surfaceSelected },
  pillText: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: 68,
    marginHorizontal: 12,
    paddingHorizontal: space.md,
    borderRadius: radius.mini,
  },
  cardMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  equalizer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.cover,
    // The shade a playing row lays over its cover (`SongRow`).
    backgroundColor: 'rgba(10, 8, 16, 0.55)',
  },
  cardText: { flex: 1, minWidth: 0, gap: 2 },
  cardLabel: label(theme.colors),
  cardTitle: { color: theme.colors.textPrimary, fontSize: type.row, fontWeight: '600' },
  cardSub: {
    color: theme.colors.textSecondary,
    fontSize: type.rowSub,
    fontVariant: ['tabular-nums'],
  },
  cardPlay: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.textPrimary,
  },
  cardPlayPressed: { transform: [{ scale: 0.96 }] },
  list: { flex: 1 },
  listContent: { paddingBottom: space.lg },
  label: { ...label(theme.colors), paddingHorizontal: 18, paddingBottom: space.xs },
  playedLabel: { paddingTop: space.md },
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
  groundText: { color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600' },
  // Opaque, so the ground shows only where the row has been swiped off it.
  swipeRow: { backgroundColor: theme.colors.surface1 },
  autoMix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.lg,
    paddingHorizontal: 18,
  },
  autoMixLabel: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: '500' },
  autoMixHint: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    color: theme.colors.textMuted,
    fontSize: type.small,
  },
  hint: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    textAlign: 'center',
    paddingTop: space.lg,
  },
}))

import { startTransition, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Text, View } from 'react-native'
import type { NativeScrollEvent, NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { artistOr, formatDuration, type Tag } from '@selfmp3/shared'
import { HIT_TARGET, radius, space, type, iconSize } from '@selfmp3/client'
import { usePlayer, usePlayerProgress, type PlayerApi } from '../../player/PlayerProvider'
import { useLayoutValue } from '../../shell/useLayout'
import { label, smallTitle } from '../../ui/surfaces'
import { useSongTagLookup } from '../../ui/songTags'
import type { RowAvailability } from '../../ui/rowAvailability.model'
import { useRowAvailability } from '../../ui/useRowAvailability'
import { PlayingCard } from '../../ui/components/PlayingCard'
import { PlayPauseButton } from '../../ui/components/PlayPauseButton'
import { ScrollView } from '../../ui/components/Scroll'
import { Toggle } from '../../ui/components/Toggle'
import { useRoom } from '../room/room.store'
import { autoMixLine, upNextWindow, type QueueRow } from './queue.model'
import { closeQueueSheet, useQueueSheetOpen } from './queueSheet.store'
import { Press } from '../../ui/components/Press'
import { OPACITY } from '../../ui/motion.model'

/*
 * Up next's parts, for the phone's sheet (`QueueSheet`) and the computer's
 * rail (`QueueRail`) alike. Each container keeps its own shape — the sheet
 * rises over the foot of the screen and swipes rows away; the rail slides in
 * beside the page and drags them out — and draws the same list in it: the
 * song playing, what is next with what each row knows of its song, what
 * played, Clear the rest and auto-mix. The two had been built apart, and the
 * rail had no Clear the rest, no marks on its rows and no "Played" end, while
 * the sheet stopped at sixty songs.
 */

/**
 * Whether Up next is up: asked for, on this layout, and with something to
 * show — a song loaded, or a room, whose Up next is the room's whether or not
 * this device plays it. With nothing left — the queue cleared, its last song
 * removed — it puts itself away rather than staying asked for and coming back
 * with the next song (the rail did).
 */
export function useUpNextShown(wide: boolean): boolean {
  const open = useQueueSheetOpen()
  const layoutWide = useLayoutValue(layout => layout.wide)
  const loaded = usePlayer().current !== null
  const inRoom = useRoom().state !== null
  useEffect(() => {
    if (open && !loaded && !inRoom) closeQueueSheet()
  }, [open, loaded, inRoom])
  return open && layoutWide === wide && (loaded || inRoom)
}

/** What a row of Up next knows of its song, beside its name. */
interface QueueRowFacts extends RowAvailability {
  readonly tags: readonly Tag[]
}

/**
 * The facts of each row, for the sheet and the rail: whether it can play
 * here by every list's rule (`rowAvailability`), and its tags. The same tags
 * array for the same song (`songTagLookup`), so a row's memo holds.
 */
export function useQueueRowFacts(): (song: {
  readonly id: number
  readonly tagIds: readonly number[]
}) => QueueRowFacts {
  const availability = useRowAvailability()
  const tagsOf = useSongTagLookup()
  return useCallback(
    song => ({ ...availability(song.id), tags: tagsOf(song) }),
    [availability, tagsOf],
  )
}

/**
 * The song playing, at the top of Up next, with play and pause at its end.
 * Played on its own and ended, it is the song that was played, not the one
 * playing. The card opens Now Playing.
 */
export function PlayingNow({
  row,
  ended,
  onOpen,
}: {
  row: QueueRow
  ended: boolean
  onOpen: () => void
}): ReactNode {
  const playing = usePlayer().isPlaying
  return (
    <PlayingCard
      song={row.song}
      label={ended ? 'Played' : 'Playing'}
      line={artistOr(row.song.artist)}
      clock={<PlayingClock />}
      playing={playing}
      onOpen={onOpen}
      testID={`queue-row-${row.index}`}
    >
      <PlayPauseButton size={44} glyph={iconSize.nav} />
    </PlayingCard>
  )
}

/** "1:52 of 4:23", on its own so a tick redraws this and not Up next. */
function PlayingClock(): ReactNode {
  const { position, duration } = usePlayerProgress()
  return `${formatDuration(position)} of ${formatDuration(duration)}`
}

/**
 * "Clear the rest": every song but the one playing out of Up next, with an
 * Undo (`useQueueEdits`). Outlined, so it is not read as a second mode beside
 * Shuffle, and it says what it leaves: the song playing carries on. As tall as
 * a finger's button, or a mouse's.
 */
export function ClearRestButton({
  onPress,
  enabled,
}: {
  onPress: () => void
  /** Something besides the song playing, to come or played, for it to take. */
  enabled: boolean
}): ReactNode {
  const dense = useLayoutValue(layout => layout.dense)
  return (
    <Press
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      testID="queue-clear-rest"
      style={({ pressed }) => [
        styles.clear,
        dense && styles.clearDense,
        pressed && styles.clearPressed,
        !enabled && styles.clearOff,
      ]}
    >
      <Text style={[styles.clearText, dense && styles.clearTextDense]}>Clear the rest</Text>
    </Press>
  )
}

/** Auto-mix's switch, and what it will do next. */
export function AutoMixRow({
  player,
  upcoming,
  style,
}: {
  player: Pick<PlayerApi, 'autoMix' | 'setAutoMix' | 'canCrossfade' | 'nextCrossfadeSeconds'>
  upcoming: number
  style?: StyleProp<ViewStyle>
}): ReactNode {
  return (
    <View style={[styles.autoMix, style]}>
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
          upcoming,
          nextCrossfadeSeconds: player.nextCrossfadeSeconds,
        })}
      </Text>
    </View>
  )
}

/**
 * The scroll the list redraws its window at, in rows: it notes where it is
 * scrolled to only when that crosses a step this tall, and draws a step's
 * worth of rows past the viewport to cover the rest, so a scroll costs a
 * render every few rows rather than one per frame.
 */
const SCROLL_STEP_ROWS = 8
/** What the list assumes of its own height before it has been laid out. */
const VIEWPORT_GUESS = 800

/**
 * Up next's songs: what is next, then what played under "Played", drawing
 * only the rows in view and a margin either side (`upNextWindow`). The queue
 * is all of it — a library shuffled is thousands of songs — and each run keeps
 * its full height, so the scroll bar and a drag's arithmetic are what they
 * would be with every row there. Where the list is scrolled to is noted only
 * when it crosses a step, so a scroll redraws it every few rows.
 *
 * Every row is `rowHeight` tall: what a held row's travel is counted in, and
 * where each is placed. `head` comes first (the playing card, the line over
 * the songs) and `foot` last; `overlay` is drawn over the rows, told where the
 * songs start.
 */
export function UpNextList({
  next,
  played,
  rowHeight,
  renderRow,
  head,
  foot,
  overlay,
  raised,
  scrollEnabled,
  onScrolled,
  runsStyle,
  labelStyle,
  style,
  contentContainerStyle,
  onHeights,
  testID,
}: {
  next: readonly QueueRow[]
  played: readonly QueueRow[]
  rowHeight: number
  renderRow: (row: QueueRow, kind: 'next' | 'played') => ReactNode
  head?: ReactNode
  foot?: ReactNode
  overlay?: (songsTop: number) => ReactNode
  /** The queue index of a row drawn over its neighbours: the one being carried. */
  raised?: number | null
  /** Off while a row is carried: the row moves, not the list under it. */
  scrollEnabled: boolean
  /** The list was scrolled away from its top. */
  onScrolled?: () => void
  /** The runs' own style: the rail fades them in. */
  runsStyle?: StyleProp<ViewStyle> | Animated.WithAnimatedValue<StyleProp<ViewStyle>>
  /** Where "Played" sits, in from the edge as the rows' covers are. */
  labelStyle?: StyleProp<ViewStyle>
  style?: StyleProp<ViewStyle>
  contentContainerStyle?: StyleProp<ViewStyle>
  /** The list's own height and its content's, for a sheet sized to what it holds. */
  onHeights?: (frame: number | null, content: number | null) => void
  testID?: string
}): ReactNode {
  const step = SCROLL_STEP_ROWS * Math.max(1, rowHeight)
  const [scrollStep, setScrollStep] = useState(0)
  const [viewport, setViewport] = useState(VIEWPORT_GUESS)
  const [headHeight, setHeadHeight] = useState(0)
  const [playedLabel, setPlayedLabel] = useState(0)
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y
      if (y > 0) onScrolled?.()
      const at = Math.floor(y / step)
      // Drawn behind the scroll rather than in its way: the rows a step
      // brings are a screen ahead already (`span`), and each one sets up its
      // swipe and its hold. Drawn in the scroll's own frame, a 2,000-song
      // queue flung on a phone dropped a frame in three (bug bash F168).
      startTransition(() => setScrollStep(now => (now === at ? now : at)))
    },
    [onScrolled, step],
  )
  // A screen either side of the one in view, as a list of songs keeps, so a
  // fling is through rows already there while the next step is drawn.
  const scrollTop = scrollStep * step - viewport
  const span = viewport * 3 + step
  const nextAt = upNextWindow({
    count: next.length,
    runTop: headHeight,
    scrollTop,
    span,
    rowHeight,
  })
  const playedAt = upNextWindow({
    count: played.length,
    runTop: headHeight + next.length * rowHeight + playedLabel,
    scrollTop,
    span,
    rowHeight,
  })
  const place = (row: QueueRow, at: number, kind: 'next' | 'played'): ReactNode => (
    <View
      key={row.song.id}
      style={[styles.placed, { top: at * rowHeight }, raised === row.index && styles.raised]}
    >
      {renderRow(row, kind)}
    </View>
  )

  return (
    <ScrollView
      testID={testID}
      style={style}
      contentContainerStyle={contentContainerStyle}
      scrollEnabled={scrollEnabled}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onLayout={event => {
        setViewport(event.nativeEvent.layout.height)
        onHeights?.(event.nativeEvent.layout.height, null)
      }}
      onContentSizeChange={(_, content) => onHeights?.(null, content)}
    >
      <View onLayout={event => setHeadHeight(event.nativeEvent.layout.height)}>{head}</View>
      <Animated.View style={runsStyle}>
        <View style={{ height: next.length * rowHeight }}>
          {next
            .slice(nextAt.start, nextAt.end)
            .map((row, at) => place(row, nextAt.start + at, 'next'))}
        </View>
        {played.length > 0 ? (
          <>
            <Text
              style={[styles.label, labelStyle]}
              onLayout={event => setPlayedLabel(event.nativeEvent.layout.height)}
            >
              Played
            </Text>
            <View style={{ height: played.length * rowHeight }}>
              {played
                .slice(playedAt.start, playedAt.end)
                .map((row, at) => place(row, playedAt.start + at, 'played'))}
            </View>
          </>
        ) : null}
      </Animated.View>
      {foot}
      {overlay?.(headHeight)}
    </ScrollView>
  )
}

const styles = StyleSheet.create(theme => ({
  clear: {
    flexDirection: 'row',
    alignItems: 'center',
    height: HIT_TARGET,
    paddingHorizontal: space.roomy,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
  },
  clearDense: { height: 28, paddingHorizontal: space.snug },
  clearPressed: { backgroundColor: theme.colors.surface3 },
  clearOff: { opacity: OPACITY.disabled },
  clearText: smallTitle(theme.colors),
  clearTextDense: { fontSize: type.small },
  autoMix: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  autoMixLabel: { color: theme.colors.textSecondary, fontSize: type.sub, fontWeight: '500' },
  autoMixHint: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    color: theme.colors.textMuted,
    fontSize: type.small,
  },
  label: { ...label(theme.colors), paddingTop: space.md, paddingBottom: space.xs },
  // A drawn row at its place in its run, which keeps the height of every row.
  placed: { position: 'absolute', left: 0, right: 0 },
  // The row being carried, over the rows it passes.
  raised: { zIndex: 2 },
}))

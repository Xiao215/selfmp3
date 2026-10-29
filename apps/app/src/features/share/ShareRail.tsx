import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, PanResponder, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { artistOr, peekNext, plural, type ShareEntry } from '@selfmp3/shared'
import { radius, space, type, withAlpha } from '@selfmp3/client'
import { MOVE_MS } from '../../ui/motion.model'
import { ease, timing } from '../../ui/motion'
import { usePlayer } from '../../player/PlayerProvider'
import { Cover } from '../../ui/components/Cover'
import { Equalizer } from '../../ui/components/Equalizer'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronUp, Shuffle } from '../../ui/components/Icons'
import { Press } from '../../ui/components/Press'
import { Sheet } from '../../ui/components/Sheet'
import { FlatList } from '../../ui/components/Scroll'
import { isVerticalPull } from '../nowPlaying/nowPlaying.model'
import { RoomEntryLine } from '../room/RoomEntryLine'

/** The rail's width shut: its covers alone, so the song's page keeps the window. */
export const RAIL_WIDTH = 76
/** Open under the pointer: the covers and their names, over the song's page. */
const RAIL_OPEN = 320
const RAIL_COVER = 48
/** A row of the rail, the cover and its room: fixed, so the list can find any row without drawing it. */
const RAIL_ROW = RAIL_COVER + space.md
/** The cover's way in from the rail's edge, centring it while the rail is shut. */
const RAIL_INSET = (RAIL_WIDTH - RAIL_COVER) / 2

/** Up next's cover, on a phone. */
const UP_NEXT_COVER = 40
/** How far up Up next is pulled to open the list. */
const UP_NEXT_PULL = 32
/** Up next's height on a phone: its cover and its padding, for the song's cover to give up. */
export const UP_NEXT_ROOM = UP_NEXT_COVER + space.sm * 2

/** What the rail and the row are given: the link's songs, and which one the page shows. */
interface ListProps {
  /** The songs that still play, in the link's order. */
  entries: readonly ShareEntry[]
  /** The cover each draws: your own copy's, or the one the link lends. */
  coverOf: (entry: ShareEntry) => string | null | undefined
  /** The letter tile's hue for a cover that would not come. */
  tileHue: number
  /** Where in `entries` the page's song is. */
  shown: number
  onPick: (at: number) => void
  /** The list's own name, and its songs' count and length. */
  name: string
  summary: string
}

/**
 * A list link's songs on a computer (R1, Xiao 2026-10-26): a rail of covers
 * down the window's left edge, the song's own page beside it filling the
 * rest. Shuffle heads it. Under the pointer it opens over the page with each
 * song's name, and shuts again when the pointer leaves, so the page never
 * moves. A press plays the song there.
 *
 * Only the rows in sight are drawn, so a link of a thousand songs reads a
 * dozen covers from its sender's bucket, not a thousand.
 */
export function CoverRail({
  entries,
  coverOf,
  tileHue,
  shown,
  onPick,
  onShuffle,
  name,
  summary,
}: ListProps & { onShuffle: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const [open, setOpen] = useState(false)
  const [width] = useState(() => new Animated.Value(RAIL_WIDTH))
  const list = useRef<FlatList<ShareEntry>>(null)
  const [height, setHeight] = useState(0)
  // The names come in as the rail opens past its covers, and are gone while it is shut.
  const names = width.interpolate({
    inputRange: [RAIL_WIDTH, RAIL_WIDTH + 80],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  })

  useEffect(() => {
    const move = timing(width, open ? RAIL_OPEN : RAIL_WIDTH, MOVE_MS.railOut, undefined, {
      easing: ease.out,
      native: false,
    })
    return () => move?.stop()
  }, [open, width])

  // The song the page shows, kept in sight as the list moves on, but not
  // under a pointer reading down the names. Worked out here from the rail's
  // own height, not by scrollToIndex: before the list has measured itself it
  // takes its height as 0, and sent the first song half under the rail's head.
  useEffect(() => {
    if (open || height === 0 || shown < 0 || shown >= entries.length) return
    const offset = Math.max(0, RAIL_ROW * shown - (height - RAIL_ROW) * 0.4)
    list.current?.scrollToOffset({ offset, animated: true })
  }, [shown, open, height, entries.length])

  return (
    <Animated.View
      style={[
        styles.rail,
        { width, backgroundColor: withAlpha(theme.colors.surface0, open ? 0.92 : 0.38) },
        open && styles.railOpen,
      ]}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      testID="share-rail"
    >
      <View style={styles.railHead}>
        <IconButton onPress={onShuffle} label={`Shuffle ${name}`} testID="share-shuffle">
          <Shuffle size={20} color={theme.colors.textPrimary} />
        </IconButton>
        <Animated.View style={[styles.railNames, { opacity: names }]}>
          <Text style={styles.railName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.railSummary} numberOfLines={1}>
            {summary}
          </Text>
        </Animated.View>
      </View>
      <FlatList
        ref={list}
        data={entries}
        keyExtractor={entry => String(entry.id)}
        getItemLayout={(_data, index) => ({
          length: RAIL_ROW,
          offset: RAIL_ROW * index,
          index,
        })}
        initialNumToRender={14}
        windowSize={5}
        showsVerticalScrollIndicator={false}
        onLayout={event => setHeight(event.nativeEvent.layout.height)}
        contentContainerStyle={styles.railList}
        renderItem={({ item, index }) => (
          <Press
            feedback="wash"
            onPress={() => onPick(index)}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={item.song.title}
            accessibilityState={{ selected: index === shown }}
            style={[styles.railRow, open && index === shown && styles.railRowShown]}
            testID={`share-rail-${index}`}
          >
            <View
              style={[
                styles.railCover,
                index === shown && styles.ring,
                !open && index !== shown && styles.resting,
              ]}
            >
              <Cover uri={coverOf(item)} title={item.song.title} size={RAIL_COVER} hue={tileHue} />
            </View>
            <Animated.View style={[styles.railNames, { opacity: names }]}>
              <Text style={styles.railTitle} numberOfLines={1}>
                {item.song.title}
              </Text>
              <Text style={styles.railArtist} numberOfLines={1}>
                {artistOr(item.song.artist)}
              </Text>
            </Animated.View>
          </Press>
        )}
      />
    </Animated.View>
  )
}

/**
 * A list link's songs on a phone (C, Xiao 2026-10-26): the song's own page
 * keeps the screen, and under its controls one line says what plays next,
 * its cover, title and artist. A tap or a pull up opens every song with its
 * name as a sheet, the one on the page marked, and a press there plays it.
 *
 * What plays next is the player's own while the list plays, Shuffle and all,
 * and the song after the cued one before it does.
 */
export function UpNext({
  entries,
  ids,
  coverOf,
  tileHue,
  shown,
  onPick,
  name,
  summary,
}: ListProps & {
  /** The player's id for each of `entries`, in the same order. */
  ids: readonly number[]
}): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const [sheet, setSheet] = useState(false)
  const list = useRef<FlatList<ShareEntry>>(null)
  const inList = player.current !== null && ids.includes(player.current.id)
  const nextId = inList ? peekNext(player.queue) : (ids[shown + 1] ?? null)
  const nextAt = nextId === null ? -1 : ids.indexOf(nextId)
  const next = entries[nextAt]
  const pull = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy < 0 && isVerticalPull(gesture.dx, gesture.dy),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy < -UP_NEXT_PULL || gesture.vy < -0.5) setSheet(true)
        },
      }),
    [],
  )

  return (
    <View {...pull.panHandlers}>
      <Press
        feedback="dim"
        onPress={() => setSheet(true)}
        accessibilityRole="button"
        accessibilityLabel={next ? `Up next, ${next.song.title}. All of ${name}` : `All of ${name}`}
        style={styles.upNext}
        testID="share-up-next"
      >
        {next ? (
          <Cover uri={coverOf(next)} title={next.song.title} size={UP_NEXT_COVER} hue={tileHue} />
        ) : null}
        <View style={styles.upNextNames}>
          <Text style={styles.upNextLabel} numberOfLines={1}>
            {next ? 'Up next' : name}
          </Text>
          <Text style={styles.upNextSong} numberOfLines={1}>
            {next ? (
              <>
                {next.song.title}
                <Text style={styles.upNextArtist}>
                  {' · '}
                  {artistOr(next.song.artist)}
                </Text>
              </>
            ) : (
              summary
            )}
          </Text>
        </View>
        <View style={styles.upNextAll}>
          <Text style={styles.upNextAllText}>All {entries.length}</Text>
          <ChevronUp size={16} color={theme.colors.textSecondary} />
        </View>
      </Press>
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={name}
        subtitle={summary}
        testID="share-list-sheet"
      >
        <FlatList
          ref={list}
          data={entries}
          keyExtractor={entry => String(entry.id)}
          initialNumToRender={12}
          windowSize={5}
          style={styles.sheetList}
          // Opened on the song the page shows, a third of the way down, not at the list's top.
          onLayout={() => {
            if (shown > 0)
              list.current?.scrollToIndex({ index: shown, viewPosition: 0.3, animated: false })
          }}
          onScrollToIndexFailed={failed => {
            list.current?.scrollToOffset({
              offset: failed.averageItemLength * failed.index,
              animated: false,
            })
            setTimeout(() => {
              list.current?.scrollToIndex({
                index: failed.index,
                viewPosition: 0.3,
                animated: false,
              })
            }, 50)
          }}
          renderItem={({ item, index }) => (
            <RoomEntryLine
              song={item.song}
              uri={coverOf(item)}
              face={null}
              trailing={
                index === shown ? (
                  <Equalizer
                    paused={!player.isPlaying || !inList}
                    size={16}
                    color={theme.colors.textPrimary}
                  />
                ) : null
              }
              onPress={() => {
                setSheet(false)
                onPick(index)
              }}
              testID={`share-sheet-${index}`}
            />
          )}
        />
      </Sheet>
    </View>
  )
}

/** "100 songs · 6 hr 12 min": a list's count and how long it plays. */
export function listSummary(
  entries: readonly ShareEntry[],
  length: (seconds: number) => string,
): string {
  const seconds = entries.reduce((sum, entry) => sum + entry.song.duration, 0)
  const count = plural(entries.length, 'song', 'songs')
  return seconds > 0 ? `${count} · ${length(seconds)}` : count
}

const styles = StyleSheet.create(theme => ({
  rail: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 2,
    overflow: 'hidden',
  },
  railOpen: { boxShadow: `12px 0 36px ${theme.colors.floatShadow}` },
  railHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    width: RAIL_OPEN,
    paddingLeft: (RAIL_WIDTH - 44) / 2,
    paddingRight: space.md,
    paddingVertical: space.md,
  },
  railList: { paddingBottom: space.xl },
  railRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    width: RAIL_OPEN,
    height: RAIL_ROW,
    paddingLeft: RAIL_INSET,
    paddingRight: space.md,
  },
  railRowShown: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.1) },
  railCover: { borderRadius: radius.cover },
  ring: {
    borderRadius: radius.cover,
    outlineWidth: 2,
    outlineStyle: 'solid',
    outlineColor: theme.colors.textPrimary,
    outlineOffset: 2,
  },
  // The others a little back, so the one the page shows is found at a glance.
  resting: { opacity: 0.72 },
  railNames: { flex: 1, minWidth: 0, gap: 2 },
  railName: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '700' },
  railSummary: { color: theme.colors.textSecondary, fontSize: type.small },
  railTitle: { color: theme.colors.textPrimary, fontSize: type.sub, fontWeight: '600' },
  railArtist: { color: theme.colors.textSecondary, fontSize: type.small },

  upNext: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: UP_NEXT_ROOM,
    paddingHorizontal: space.sm,
    borderRadius: radius.card,
    backgroundColor: withAlpha(theme.colors.surface0, 0.32),
  },
  upNextNames: { flex: 1, minWidth: 0, gap: 1 },
  upNextLabel: { color: theme.colors.textSecondary, fontSize: type.small, fontWeight: '600' },
  upNextSong: { color: theme.colors.textPrimary, fontSize: type.sub, fontWeight: '600' },
  upNextArtist: { color: theme.colors.textSecondary, fontWeight: '400' },
  upNextAll: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: space.xs },
  upNextAllText: { color: theme.colors.textSecondary, fontSize: type.small, fontWeight: '600' },
  sheetList: { maxHeight: 480 },
}))

import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode, RefObject } from 'react'
import {
  Animated,
  View,
  type FlatListProps,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { useArrival } from '../motion'
import { PinnedHeaderScope, pinnedHeaderProps } from '../../ports/pinnedHeader'
import { useListScrollbar } from '../../ports/listScrollbar'
import { useLayoutValue } from '../../shell/useLayout'
import { LIST_SEMANTICS } from '../../selection/listSemantics'
import { positionLabel, type ScrollLabel } from './listScrollbar.model'
import { FlatList } from './Scroll'

/** Module-level, so the list is not handed a new function on every render. */
function keyOf(song: Song): string {
  return String(song.id)
}

/**
 * How many rows arrive when the list is answering something new. A screenful:
 * past that nobody is looking, and a stagger that reaches the hundredth row has
 * become a wait rather than an answer.
 */
const ARRIVING = 12

/** More than the selection bar's room ever is: how far past the window a list with it open may scroll. */
const PINNED_ROOM = 96

/**
 * A list of songs, wherever one is shown.
 *
 * One component rather than a bare list at each call site, as
 * `docs/ARCHITECTURE.md` asks, so the choice of list can change in one file and
 * no screen knows. It also keeps the table semantics in one place: the library
 * is a `role=table` of `role=row`s, and a row with no table around it
 * announces nothing useful. In a browser it is a `grid` (`LIST_SEMANTICS`):
 * one Tab stop whose rows the arrows move between. Each row says where it is
 * in the whole list (`aria-rowindex`), since only some of them are drawn.
 *
 * **Do not swap this for FlashList v2 without re-testing accessibility.** It
 * draws and scrolls well, but on the phone its recycled cells stop exposing
 * any accessible content after a data change — filtering by a tag and clearing
 * it is enough. The rows are present and correctly placed, and empty: no long
 * press opens a song's menu, and VoiceOver reads an empty row where a song is
 * plainly drawn. The smoke flow fails at exactly that step.
 *
 * `renderSong` goes to the list as it is, so a screen that keeps it stable
 * gets a list that stays still; wrapping it here would hand the list a new
 * `renderItem` every render and redraw every cell. With `arrivalKey` given it is
 * wrapped, but only in the renders where the key has just changed — a filter
 * answering — and never otherwise.
 */
export function SongList({
  songs,
  renderSong,
  label,
  empty,
  contentContainerStyle,
  rowHeight = null,
  header,
  style,
  scrollEnabled,
  keyboardDismissMode,
  CellRendererComponent,
  pinned,
  scrollLabel = positionLabel,
  onRefresh,
  refreshing = false,
  arrivalKey,
  listRef: givenRef,
}: {
  songs: readonly Song[]
  renderSong: (info: { item: Song; index: number }) => ReactElement | null
  /** What the table is called, e.g. "Library songs". */
  label: string
  empty?: ReactElement | null
  contentContainerStyle?: StyleProp<ViewStyle>
  /**
   * Every row's height, when every row is exactly that tall (`useSongRowHeight`).
   * The list then places rows by arithmetic rather than measuring each one as
   * it appears, which is what keeps a fast fling through thousands of songs
   * from drawing blank. Only for a list with no header: the offsets start at
   * the first row.
   */
  rowHeight?: number | null
  /** What scrolls above the songs, such as a playlist's cover and controls. */
  header?: ReactElement | null
  style?: StyleProp<ViewStyle>
  scrollEnabled?: boolean
  keyboardDismissMode?: FlatListProps<Song>['keyboardDismissMode']
  /** Wraps each cell; a playlist lifts the row being moved with it. */
  CellRendererComponent?: FlatListProps<Song>['CellRendererComponent']
  /**
   * Drawn at the foot of `header`, and kept at the top of the list once the
   * header has scrolled away, the way a table's header stays: a computer's
   * selection bar on a page whose head scrolls with its songs. The platform
   * keeps it there (`ports/pinnedHeader`), so it is never a frame behind the
   * scroll, as a bar moved from JavaScript after each scroll event was.
   */
  pinned?: ReactElement | null
  /**
   * What the scrollbar's bubble says about the song at the top while its thumb
   * is dragged, on a computer (`ports/listScrollbar`): the letter, the artist,
   * the day, as the list is sorted. Left out, the song's place in the list.
   * Keep it stable.
   */
  scrollLabel?: ScrollLabel
  /** Pulling the list down asks for it again (`usePullToRefresh`). */
  onRefresh?: () => void
  refreshing?: boolean
  /**
   * What this list is showing, as a string: the search text, the tags being
   * filtered by, the sort. When it changes, the first screen of rows fades up a
   * stagger apart instead of replacing the old ones in one frame, so a search
   * reads as answering rather than flickering. Left out, nothing arrives ever.
   */
  arrivalKey?: string
  /**
   * The list, for its rows' keys (`useSongRows`' `listRef`): Tab coming back
   * to a row scrolled far away scrolls the list to it by its place.
   */
  listRef?: RefObject<FlatList<Song> | null>
}): ReactNode {
  /*
   * The rows arrive again whenever the key changes, and only then: each row's
   * wrapper is keyed by it, so a new key mounts new wrappers, and a wrapper
   * plays its arrival as it mounts. Nothing is kept about which paint was the
   * one — React's own remount is the memory — and a row scrolled into view
   * later under the same key mounts a wrapper that plays nothing, since only
   * the first screen (`ARRIVING`) is asked to.
   */
  const renderItem = useMemo<FlatListProps<Song>['renderItem']>(
    () =>
      arrivalKey === undefined
        ? renderSong
        : info => (
            <Arriving key={arrivalKey} index={info.index}>
              {renderSong({ item: info.item, index: info.index })}
            </Arriving>
          ),
    [arrivalKey, renderSong],
  )

  // A computer's scrollbar over the list's right edge; a phone keeps its own.
  const wide = useLayoutValue(layout => layout.wide)
  const ownRef = useRef<FlatList<Song>>(null)
  const listRef = givenRef ?? ownRef

  /*
   * A new answer starts at its first row. The offset the old one was scrolled
   * to meant nothing in the new: a filter narrowing a list scrolled far down
   * clamped it to the new end, with row 1 hidden and its arrival played off
   * screen, and a new order opened in its middle.
   */
  const answered = useRef(arrivalKey)
  useLayoutEffect(() => {
    if (answered.current === arrivalKey) return
    answered.current = arrivalKey
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
  }, [arrivalKey, listRef])
  const scrollbar = useListScrollbar({
    list: listRef,
    songs,
    label: scrollLabel,
    hasHeader: header != null,
    enabled: wide,
  })

  // Where the header ends and `pinned` begins: how far the header scrolls before it stays.
  const [stayAfter, setStayAfter] = useState(0)
  const onHeaderLayout = (event: LayoutChangeEvent): void =>
    setStayAfter(event.nativeEvent.layout.height)

  /*
   * `pinned` opening — the selection bar's room under the head — pushed every
   * row on screen down by as much, so the next tick landed on the song above
   * the one aimed at (X7, 2026-10-25). The list scrolls by what it grows, in
   * the same frame, so the rows hold still under the pointer and the head
   * gives up the room instead; closing gives it back. Where the offset is is
   * kept here, and moved on at once by each step, since the scroll's own
   * report of it arrives a frame late.
   *
   * A short list — a tag on three songs — cannot scroll that far, so while
   * the room is open the list is at least a window and the room tall
   * (`PINNED_ROOM`): there is always somewhere to scroll to, below the songs.
   */
  const offset = useRef(0)
  const pinnedHeight = useRef<number | null>(null)
  const [roomOpen, setRoomOpen] = useState(false)
  const [viewport, setViewport] = useState(0)
  const onPinnedLayout = (event: LayoutChangeEvent): void => {
    const height = event.nativeEvent.layout.height
    const was = pinnedHeight.current
    pinnedHeight.current = height
    // Its first size is where it starts, not a change.
    if (was === null || height === was) return
    if (was === 0) setRoomOpen(true)
    if (height === 0) setRoomOpen(false)
    offset.current = Math.max(0, offset.current + height - was)
    listRef.current?.scrollToOffset({ offset: offset.current, animated: false })
  }
  const onListLayout = (event: LayoutChangeEvent): void => {
    setViewport(event.nativeEvent.layout.height)
    scrollbar.onLayout?.(event)
  }

  const getItemLayout = useMemo<FlatListProps<Song>['getItemLayout']>(
    () =>
      rowHeight !== null && rowHeight > 0
        ? (_data, index) => ({ length: rowHeight, offset: rowHeight * index, index })
        : undefined,
    [rowHeight],
  )

  /*
   * Scrolled to a row it has not drawn yet and cannot place by arithmetic
   * (no `rowHeight`), the list says so rather than scrolling: it is sent to
   * about where the row is, by the rows it has measured, which draws the row;
   * whoever asked finds it there and brings it into view.
   */
  const onScrollToIndexFailed: FlatListProps<Song>['onScrollToIndexFailed'] = ({
    index,
    averageItemLength,
  }) => listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false })

  return (
    <>
      <PinnedHeaderScope stayAfter={stayAfter}>
        <FlatList
          ref={listRef}
          onLayout={pinned ? onListLayout : scrollbar.onLayout}
          {...LIST_SEMANTICS}
          aria-label={label}
          aria-rowcount={songs.length}
          data={songs}
          keyExtractor={keyOf}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          onScrollToIndexFailed={onScrollToIndexFailed}
          initialNumToRender={16}
          windowSize={11}
          removeClippedSubviews
          keyboardDismissMode={keyboardDismissMode}
          scrollEnabled={scrollEnabled}
          style={pinned ? [style, styles.anchorless] : style}
          contentContainerStyle={
            roomOpen
              ? [contentContainerStyle, { minHeight: viewport + PINNED_ROOM }]
              : contentContainerStyle
          }
          // Room under the last song for a phone's floating tab bar and mini player.
          ListFooterComponent={ChromeSpacer}
          ListHeaderComponent={
            pinned ? (
              <>
                {/*
                Keyed, so it is never the header's own view reused: a page that
                draws an empty header while it loads would otherwise hand this
                its view, and a browser measures only a view that had
                `onLayout` when it first appeared.
              */}
                <View key="head" onLayout={onHeaderLayout}>
                  {header}
                </View>
                <View key="pinned" onLayout={onPinnedLayout}>
                  {pinned}
                </View>
              </>
            ) : (
              header
            )
          }
          {...(pinned ? pinnedHeaderProps(stayAfter) : null)}
          {...(pinned
            ? {
                onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
                  offset.current = event.nativeEvent.contentOffset.y
                },
                scrollEventThrottle: 16,
              }
            : null)}
          onRefresh={onRefresh}
          refreshing={refreshing}
          ListEmptyComponent={empty}
          CellRendererComponent={CellRendererComponent}
        />
      </PinnedHeaderScope>
      {scrollbar.overlay}
    </>
  )
}

/**
 * One row of the screenful that arrives when the list answers something new: it
 * fades up from a few points below, a stagger after the one before it
 * (`useArrival`). Past the first screen there is nothing to see, so those rows
 * are handed through untouched.
 */
function Arriving({ index, children }: { index: number; children: ReactNode }): ReactNode {
  const arrival = useArrival(index, index < ARRIVING, ARRIVING)
  return index < ARRIVING ? (
    <Animated.View style={arrival}>{children}</Animated.View>
  ) : (
    <>{children}</>
  )
}

const styles = StyleSheet.create({
  // `pinned` opening above what is on screen is answered by `onPinnedLayout`;
  // a browser left to itself would scroll for it as well, and twice is a jump.
  anchorless: { _web: { overflowAnchor: 'none' } },
})

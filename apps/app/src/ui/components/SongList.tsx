import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  Animated,
  FlatList,
  View,
  type FlatListProps,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { useArrival } from '../motion'
import { PinnedHeaderScope, pinnedHeaderProps } from '../../ports/pinnedHeader'
import { useListScrollbar } from '../../ports/listScrollbar'
import { useLayout } from '../../shell/useLayout'
import { positionLabel, type ScrollLabel } from './listScrollbar.model'

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

/**
 * A list of songs, wherever one is shown.
 *
 * One component rather than a bare list at each call site, as
 * `docs/ARCHITECTURE.md` asks, so the choice of list can change in one file and
 * no screen knows. It also keeps the table semantics in one place: the library
 * is a `role=table` of `role=row`s, and a row with no table around it
 * announces nothing useful.
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
  keyboardShouldPersistTaps,
  keyboardDismissMode = 'on-drag',
  CellRendererComponent,
  pinned,
  scrollLabel = positionLabel,
  onRefresh,
  refreshing = false,
  arrivalKey,
}: {
  songs: readonly Song[]
  renderSong: (info: { item: Song; index: number }) => ReactElement | null
  /** What the table is called, e.g. "Library songs". */
  label: string
  empty?: ReactNode
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
  keyboardShouldPersistTaps?: FlatListProps<Song>['keyboardShouldPersistTaps']
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
  const { wide } = useLayout()
  const listRef = useRef<FlatList<Song>>(null)
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

  const getItemLayout = useMemo<FlatListProps<Song>['getItemLayout']>(
    () =>
      rowHeight !== null && rowHeight > 0
        ? (_data, index) => ({ length: rowHeight, offset: rowHeight * index, index })
        : undefined,
    [rowHeight],
  )

  return (
    <>
      <PinnedHeaderScope stayAfter={stayAfter}>
        <FlatList
          ref={listRef}
          onLayout={scrollbar.onLayout}
          role="table"
          aria-label={label}
          data={songs}
          keyExtractor={keyOf}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          initialNumToRender={16}
          windowSize={11}
          removeClippedSubviews
          keyboardDismissMode={keyboardDismissMode}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          scrollEnabled={scrollEnabled}
          style={pinned ? [style, styles.anchorless] : style}
          contentContainerStyle={contentContainerStyle}
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
                {pinned}
              </>
            ) : (
              header
            )
          }
          {...(pinned ? pinnedHeaderProps(stayAfter) : null)}
          onRefresh={onRefresh}
          refreshing={refreshing}
          ListEmptyComponent={empty as ReactElement}
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
  // `pinned` opening above what is on screen moves it down, as it should, so
  // the bar never lands on the song just ticked; a browser left to itself
  // would scroll to keep what is on screen still under it.
  anchorless: { _web: { overflowAnchor: 'none' } },
})

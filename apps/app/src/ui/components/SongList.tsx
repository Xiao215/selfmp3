import { useMemo } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { FlatList, type FlatListProps, type StyleProp, type ViewStyle } from 'react-native'
import type { Song } from '@selfmp3/shared'

/** Module-level, so the list is not handed a new function on every render. */
function keyOf(song: Song): string {
  return String(song.id)
}

/**
 * A list of songs, wherever one is shown.
 *
 * A component rather than a bare list at each call site because
 * `docs/UNIVERSAL.md` names one — "FlashList v2 behind a `SongList`
 * component" — so that the choice of list can change in one file and no screen
 * knows. It also keeps the table semantics in one place: the library is a
 * `role=table` of `role=row`s, and a row with no table around it announces
 * nothing useful.
 *
 * **It is a `FlatList`, and the plan's fallback is why.** FlashList v2 was
 * tried here first, as the Stack table asks. It draws correctly and scrolls
 * well, and on the phone it breaks recycled rows in a way that matters: after
 * a data change — filtering by a tag and clearing it is enough — the cells keep
 * their positions and testIDs but stop exposing any accessible content at all.
 * `maestro hierarchy` shows each row present, correctly placed, and empty. In
 * practice that means a long press no longer opens a song's menu, and a person
 * using VoiceOver is read an empty row where a song is plainly drawn. The smoke
 * flow passes with `FlatList` and fails with FlashList at exactly that step.
 *
 * The plan allowed for this the other way round — "if it falls short on web,
 * `SongList.web.tsx` uses `FlatList`" — and the shape of the answer is the
 * same: keep the component, keep the semantics, use the list that works.
 * Revisiting is a one-file change and wants a FlashList release that fixes
 * recycled-cell accessibility on the New Architecture.
 *
 * `renderSong` goes to the list as it is. Wrapped in an arrow here, it was a
 * new `renderItem` on every render of the screen, and the list redrew every
 * cell it had for it; a screen that keeps `renderSong` stable now gets a list
 * that stays still.
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
  onScroll,
  onRefresh,
  refreshing = false,
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
   * Told where the list is scrolled to, every frame: a playlist's selection
   * bar follows the bottom of its head with it (an `Animated.event`, so
   * following it is no render).
   */
  onScroll?: FlatListProps<Song>['onScroll']
  /** Pulling the list down asks for it again (`usePullToRefresh`). */
  onRefresh?: () => void
  refreshing?: boolean
}): ReactNode {
  const getItemLayout = useMemo<FlatListProps<Song>['getItemLayout']>(
    () =>
      rowHeight !== null && rowHeight > 0
        ? (_data, index) => ({ length: rowHeight, offset: rowHeight * index, index })
        : undefined,
    [rowHeight],
  )

  return (
    <FlatList
      role="table"
      aria-label={label}
      data={songs}
      keyExtractor={keyOf}
      renderItem={renderSong}
      getItemLayout={getItemLayout}
      initialNumToRender={16}
      windowSize={11}
      removeClippedSubviews
      keyboardDismissMode={keyboardDismissMode}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      scrollEnabled={scrollEnabled}
      style={style}
      contentContainerStyle={contentContainerStyle}
      ListHeaderComponent={header}
      onRefresh={onRefresh}
      refreshing={refreshing}
      ListEmptyComponent={empty as ReactElement}
      CellRendererComponent={CellRendererComponent}
      onScroll={onScroll}
      scrollEventThrottle={onScroll ? 16 : undefined}
    />
  )
}

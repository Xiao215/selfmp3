import type { ReactElement, ReactNode } from 'react'
import { FlatList, type StyleProp, type ViewStyle } from 'react-native'
import type { Song } from '@selfmp3/shared'

/**
 * A list of songs, wherever one is shown.
 *
 * A component rather than a bare list at each call site because
 * `docs/UNIVERSAL.md` names one — "FlashList v2 behind a `SongList`
 * component" — so that the choice of list can change in one file and no screen
 * knows. It also keeps the table semantics in one place: the web app's library
 * has always been a `role=table` of `role=row`s, and a row with no table around
 * it announces nothing useful.
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
 */
export function SongList({
  songs,
  renderSong,
  label,
  empty,
  contentContainerStyle,
}: {
  songs: readonly Song[]
  renderSong: (info: { item: Song; index: number }) => ReactElement | null
  /** What the table is called, e.g. "Library songs". */
  label: string
  empty?: ReactNode
  contentContainerStyle?: StyleProp<ViewStyle>
}): ReactNode {
  return (
    <FlatList
      role="table"
      aria-label={label}
      data={songs}
      keyExtractor={song => String(song.id)}
      renderItem={({ item, index }) => renderSong({ item, index })}
      initialNumToRender={16}
      windowSize={11}
      removeClippedSubviews
      keyboardDismissMode="on-drag"
      contentContainerStyle={contentContainerStyle}
      ListEmptyComponent={empty as ReactElement}
    />
  )
}

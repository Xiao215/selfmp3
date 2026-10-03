import type { ReactNode } from 'react'
import type { FlatListProps, ViewStyle } from 'react-native'

/**
 * Keeping what is drawn under a list's header at the top once the head has
 * scrolled away (`SongList`'s `pinned`), in a browser: the whole header is
 * `position: sticky` with the head's height above the top, so only what is
 * under the head shows, and the browser keeps it there in the same frame as
 * the songs. A bar moved from JavaScript after each scroll event trailed them
 * by a wheel step.
 */
type PinnedHeaderProps = Pick<
  FlatListProps<unknown>,
  'stickyHeaderIndices' | 'StickyHeaderComponent' | 'ListHeaderComponentStyle'
>

/** Nothing to tell: the header's style carries how far the head runs. */
export function PinnedHeaderScope({
  children,
}: {
  stayAfter: number
  children: ReactNode
}): ReactNode {
  return children
}

/**
 * The header sticks with the head above the top. A style React Native has no
 * type for, so it is cast; React Native Web hands it to the page.
 */
export function pinnedHeaderProps(stayAfter: number): PinnedHeaderProps {
  return {
    ListHeaderComponentStyle: {
      position: 'sticky',
      top: -stayAfter,
      zIndex: 10,
    } as unknown as ViewStyle,
  }
}

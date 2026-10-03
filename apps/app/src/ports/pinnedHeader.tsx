import { createContext, useContext, useImperativeHandle, useMemo } from 'react'
import type { ReactNode, Ref } from 'react'
import { Animated, type FlatListProps, type LayoutChangeEvent } from 'react-native'

/**
 * Keeping what is drawn under a list's header at the top once the head has
 * scrolled away (`SongList`'s `pinned`), in the same frame as the songs: a bar
 * moved from JavaScript after each scroll event trailed them.
 *
 * On a phone or a tablet the header is the scroll view's sticky header, moved
 * on the native side, that waits for the head to go before it stays. A
 * browser sticks it itself (`pinnedHeader.web.tsx`).
 */
type PinnedHeaderProps = Pick<
  FlatListProps<unknown>,
  'stickyHeaderIndices' | 'StickyHeaderComponent' | 'ListHeaderComponentStyle'
>

/** How far the header scrolls before it stays, for the sticky header below. */
const PinnedAfter = createContext(0)

/** Around the list: tells its sticky header how far the head runs. */
export function PinnedHeaderScope({
  stayAfter,
  children,
}: {
  stayAfter: number
  children: ReactNode
}): ReactNode {
  return <PinnedAfter.Provider value={stayAfter}>{children}</PinnedAfter.Provider>
}

/** The header is the list's first child, and the only one that sticks. */
const PINNED: PinnedHeaderProps = { stickyHeaderIndices: [0], StickyHeaderComponent: PinnedHeader }

/** What the list is handed; how far the head runs comes through `PinnedHeaderScope`. */
export function pinnedHeaderProps(_stayAfter: number): PinnedHeaderProps {
  return PINNED
}

/**
 * The scroll view hands its sticky header the scroll as a native value, so this
 * moves on the native side: still until the head has scrolled away, then down
 * by as much as the list scrolls, which keeps it at the top.
 */
function PinnedHeader({
  ref,
  scrollAnimatedValue,
  onLayout,
  children,
}: {
  ref?: Ref<{ setNextHeaderY: (y: number) => void }>
  scrollAnimatedValue: Animated.Value
  onLayout: (event: LayoutChangeEvent) => void
  children?: ReactNode
}): ReactNode {
  const after = Math.max(useContext(PinnedAfter), 1)
  // The scroll view asks every sticky header where the next one is; there is no next one.
  useImperativeHandle(ref, () => ({ setNextHeaderY: () => undefined }), [])
  const stay = useMemo(
    () => ({
      // Over the songs it pins above.
      zIndex: 10,
      transform: [
        {
          translateY: scrollAnimatedValue.interpolate({
            inputRange: [-1, 0, after, after + 1],
            outputRange: [0, 0, 0, 1],
          }),
        },
      ],
    }),
    [scrollAnimatedValue, after],
  )
  return (
    <Animated.View collapsable={false} onLayout={onLayout} style={stay}>
      {children}
    </Animated.View>
  )
}

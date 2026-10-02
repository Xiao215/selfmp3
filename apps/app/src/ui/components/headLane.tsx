import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { useLayout } from '../../shell/useLayout'

/**
 * Where a computer's selection bar opens on a page whose head scrolls with its
 * songs — a tag, an artist, a playlist: at the foot of the head, between it and
 * the first song.
 *
 * Its lane used to open above the whole list, and so above the head as well:
 * the head was pushed down under the bar, its light began below it, and the bar
 * was as far from the songs being ticked as the page allows (Xiao, 2026-10-02,
 * option A of the placement mock). Now the room opens inside the list at the
 * head's foot (`HeadLaneRoom`, which `SongList` puts there), and the bar rides
 * that foot as the list scrolls and stays at the top of the list once the head
 * has gone, the way a table's header stays.
 *
 * The room is above the songs in the list, so opening it moves every song below
 * it down by the bar's height even with the head scrolled away, and the bar
 * never lands on the song that was just ticked. A browser would rather keep
 * what is on screen still when something above it grows (scroll anchoring),
 * which is exactly that landing, so the list turns it off.
 *
 * The page makes one (`useHeadLane`) and hands it to the bar and to the list.
 * The Library has no use for it: its head stands above the list, so the lane's
 * usual place is already beside the songs.
 */
export interface HeadLane {
  /** How far the list has scrolled, kept by the list. */
  readonly scrollY: Animated.Value
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  /** Where the head ends, from the top of the list's content: where the room is. */
  readonly foot: number
  readonly setFoot: (y: number) => void
  /** How far the room is open, from 0 to 1 of `height`. The bar opens and shuts it. */
  readonly open: Animated.Value
  /** The bar's height in its lane, as laid out. */
  readonly height: number
  readonly setHeight: (height: number) => void
}

export function useHeadLane(): HeadLane {
  const [scrollY] = useState(() => new Animated.Value(0))
  const [open] = useState(() => new Animated.Value(0))
  // On the JavaScript side: the list is a plain FlatList, and a browser has no
  // native side to drive it from.
  const [onScroll] = useState(() =>
    Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
      useNativeDriver: false,
    }),
  )
  const [foot, setFoot] = useState(0)
  const [height, setHeight] = useState(0)
  return useMemo(
    () => ({ scrollY, onScroll, foot, setFoot, open, height, setHeight }),
    [scrollY, onScroll, foot, open, height],
  )
}

/**
 * The lane's room in the list, at the foot of the head: as tall as the bar
 * while it is up, and the one thing that moves the songs. A phone's bar floats
 * at the foot of the screen instead, so there it is nothing.
 */
export function HeadLaneRoom({ lane }: { lane: HeadLane }): ReactNode {
  const { wide } = useLayout()
  const { open, height, setFoot } = lane
  const style = useMemo(
    () => ({
      height: open.interpolate({
        inputRange: [0, 1],
        outputRange: [0, height],
        extrapolate: 'clamp' as const,
      }),
    }),
    [open, height],
  )
  if (!wide) return null
  return <Animated.View style={style} onLayout={event => setFoot(event.nativeEvent.layout.y)} />
}

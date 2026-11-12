import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Animated } from 'react-native'
import type { View } from 'react-native'
import { useNavigation, useRoute } from 'expo-router'
import type { NativeStackNavigationProp } from 'expo-router'
import { stackAnimation } from '../shell/pageStep'
import { handOffPlace, takePlaceHandoff } from './coverHandoff'
import { spring, useMotionReduced } from './motion'
import { MOVE_MS } from './motion.model'

/** The hero's transform: where it is, between the tile it came from and its place. */
interface HeroGrowStyle {
  readonly opacity: Animated.Value
  readonly transform: readonly [
    { translateX: Animated.AnimatedMultiplication<number> },
    { translateY: Animated.AnimatedMultiplication<number> },
    { scale: Animated.AnimatedAddition<number> },
  ]
}

/**
 * A page's head growing out of the tile that was pressed to open it (docs/ui-mock
 * `M2`, 2; Xiao chose D, 2026-10-04): a tag's or an artist's page from its tile
 * on Home or Tags, a playlist's from its tile on Playlists (I1 of the Oct 27
 * review).
 *
 * Without shared elements the head grows into place from where the tile was:
 * the tile hands its frame over as it is tapped (`ui/coverHandoff.ts`), the
 * hero measures its own once laid out, and the one spring carries it from the
 * one to the other — a translation between the two centres and a scale by
 * their widths — while the stack crossfades the page in around it. Opened any
 * other way (Back, an address, a row's name), there is no frame and the head
 * is simply there.
 *
 * Going back is not the opening in reverse: once the page has arrived it
 * leaves as any pushed page does, sliding off with iOS's own pop, Back and the
 * swipe alike (Xiao chose A, 2026-11-11). The crossfade it came in on, with
 * the head shrinking into the tile, read as the page being dismissed — the two
 * pages showed through each other half way.
 *
 * `heroRef`, `heroStyle` and `onHeroLayout` go on `ListHead`.
 */
export function useHeroGrow(wide: boolean): {
  heroRef: RefObject<View | null>
  heroStyle: HeroGrowStyle
  onHeroLayout: () => void
} {
  const [handed] = useState(() => takePlaceHandoff())
  const [entrance] = useState(() => new Animated.Value(handed ? 0 : 1))
  const [start] = useState(() => ({
    dx: new Animated.Value(0),
    dy: new Animated.Value(0),
    grow: new Animated.Value(0),
  }))
  const [heroStyle] = useState((): HeroGrowStyle => {
    // How far from its place the hero is, 0 to 1: still growing out of the tile.
    const left = entrance.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })
    return {
      opacity: entrance,
      transform: [
        { translateX: Animated.multiply(left, start.dx) },
        { translateY: Animated.multiply(left, start.dy) },
        { scale: Animated.add(1, Animated.multiply(left, start.grow)) },
      ],
    }
  })
  const heroRef = useRef<View>(null)
  const heroPlaced = useRef(false)
  /** The hero's way between the tile and where it is laid out now. */
  const aimAtTile = (
    tile: NonNullable<typeof handed>,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void => {
    start.dx.setValue(tile.x + tile.width / 2 - (x + width / 2))
    start.dy.setValue(tile.y + tile.height / 2 - (y + height / 2))
    start.grow.setValue(tile.width / width - 1)
  }
  /*
   * The grow waits for the navigator's crossfade to start as well as for the
   * hero to be measured. Sent at layout, it would all but land before the
   * native side began the fade, so the page would arrive with the head already
   * in place and the tile would seem not to grow at all.
   */
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>()
  const route = useRoute()
  const reduced = useMotionReduced()
  const growReady = useRef({ measured: false, fading: false })
  const growWhenReady = (): void => {
    const ready = growReady.current
    if (ready.measured && ready.fading) spring(entrance, 1)
  }
  useEffect(() => {
    if (!handed) return undefined
    const letGo = (): void => {
      growReady.current.fading = true
      growWhenReady()
    }
    const off = navigation.addListener('transitionStart', event => {
      if (!event.data.closing) letGo()
    })
    // Arrived, it takes the move a page pushed any other way has, for its way
    // out: the stack plays a screen's own move both coming and going.
    const offEnd = navigation.addListener('transitionEnd', event => {
      if (!event.data.closing) navigation.setOptions(stackAnimation(route.name, wide, reduced))
    })
    // A stack with no moves — a browser's — says nothing; nor does one asked
    // for less motion, where the spring lands at once anyway.
    const late = setTimeout(letGo, MOVE_MS.placeHandOff)
    return () => {
      off()
      offEnd()
      clearTimeout(late)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the page's arrival
  }, [])
  const onHeroLayout = (): void => {
    if (!handed || heroPlaced.current) return
    heroPlaced.current = true
    const node = heroRef.current
    if (!node) {
      growReady.current.measured = true
      growWhenReady()
      return
    }
    node.measureInWindow((x, y, width, height) => {
      if (width > 0) aimAtTile(handed, x, y, width, height)
      growReady.current.measured = true
      growWhenReady()
    })
  }

  return { heroRef, heroStyle, onHeroLayout }
}

/**
 * The tile's side of it: `ref` goes on the view round the tile's cover, and
 * `open` measures that cover, hands its frame over and then goes, so the page
 * it opens grows out of it. With nothing measured it simply goes.
 */
export function useTileHandoff(): {
  ref: RefObject<View | null>
  open: (go: () => void) => void
} {
  const ref = useRef<View>(null)
  const open = useCallback((go: () => void) => {
    const node = ref.current
    if (!node) {
      go()
      return
    }
    node.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) handOffPlace({ x, y, width, height })
      go()
    })
  }, [])
  return { ref, open }
}

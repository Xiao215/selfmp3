import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Animated } from 'react-native'
import type { View } from 'react-native'
import { useNavigation } from 'expo-router'
import type { NativeStackNavigationProp } from 'expo-router'
import { handOffPlace, takePlaceHandoff } from './coverHandoff'
import { spring } from './motion'
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
 * A page's head growing out of the tile that was pressed to open it, and back
 * into it on Back (docs/ui-mock `M2`, 2; Xiao chose D, 2026-10-04): a tag's or
 * an artist's page from its tile on Home or Tags, a playlist's from its tile on
 * Playlists (I1 of the Oct 27 review).
 *
 * Without shared elements the head grows into place from where the tile was:
 * the tile hands its frame over as it is tapped (`ui/coverHandoff.ts`), the
 * hero measures its own once laid out, and the one spring carries it from the
 * one to the other — a translation between the two centres and a scale by
 * their widths — while the stack crossfades the page in around it. Opened any
 * other way (Back, an address, a row's name), there is no frame and the head
 * is simply there.
 *
 * `heroRef`, `heroStyle` and `onHeroLayout` go on `ListHead`; `back` is the
 * page's Back, given what Back does once the hero has set off.
 */
export function useHeroGrow(wide: boolean): {
  heroRef: RefObject<View | null>
  heroStyle: HeroGrowStyle
  onHeroLayout: () => void
  back: (goBack: () => void) => void
} {
  const [handed] = useState(() => takePlaceHandoff())
  const [entrance] = useState(() => new Animated.Value(handed ? 0 : 1))
  const [start] = useState(() => ({
    dx: new Animated.Value(0),
    dy: new Animated.Value(0),
    grow: new Animated.Value(0),
  }))
  // Going back to the tile, once Back has been pressed.
  const [home] = useState(() => new Animated.Value(0))
  const [heroStyle] = useState((): HeroGrowStyle => {
    // How far from its place the hero is, 0 to 1: still growing out of the
    // tile, or on its way back into it.
    const left = Animated.add(
      entrance.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      home,
    ).interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' })
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
    // A stack with no moves — a browser's — says nothing; nor does one asked
    // for less motion, where the spring lands at once anyway.
    const late = setTimeout(letGo, MOVE_MS.placeHandOff)
    return () => {
      off()
      clearTimeout(late)
    }
    // Once, for the page's arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /*
   * Back, on a phone, from a page that grew out of its tile: the opening in
   * reverse. The hero is aimed at the tile from where it sits now — the page
   * may have scrolled — and sets off with the press: the navigator tells a
   * page that is going nothing about when its fade starts. The swipe back is
   * left to the navigator: a hand dragging the page can still change its mind.
   */
  const back = (goBack: () => void): void => {
    const node = heroRef.current
    if (!handed || wide || !node) {
      goBack()
      return
    }
    node.measureInWindow((x, y, width, height) => {
      // Scrolled out of sight, it has nothing to carry back.
      if (width > 0 && y + height > 0) {
        aimAtTile(handed, x, y, width, height)
        spring(home, 1)
      }
      goBack()
    })
  }

  return { heroRef, heroStyle, onHeroLayout, back }
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

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, useWindowDimensions, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { radius, space } from '@selfmp3/client'
import { riseWith } from '../guide/Guide'
import type { GuideHandle, GuideTarget } from '../guide/useGuide'
import { usePlayerPlaying } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { Cover } from '../../ui/components/Cover'
import { Press } from '../../ui/components/Press'
import type { CoverFrame } from '../../ui/coverHandoff'
import { ease, nativeDriver, spring, timing, useMotionReduced } from '../../ui/motion'
import { MOVE_MS } from '../../ui/motion.model'
import { artShadow } from '../../ui/surfaces'
import { useTouchTravel } from '../../ui/useTouchTravel'
import { PAUSED_BREATH, PAUSED_COVER_SCALE } from './nowPlaying.model'

/** How small the cover starts as the page opens with nowhere to have come from. */
const COVER_OPENS_AT = 0.6

/** The room the cover is centred in, where the page laid it out. */
interface CoverRoom {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

type CoverTransform = (
  | { translateX: Animated.AnimatedInterpolation<number> }
  | { translateY: Animated.AnimatedInterpolation<number> }
  | { scale: Animated.AnimatedMultiplication<number> }
)[]

/**
 * The cover, which breathes (`M1`, move 5): smaller while paused and full size
 * playing, so the page says which it is without a glyph being read. Paused, it
 * goes on breathing, slowly and a little (`PAUSED_BREATH`). Tapping it opens
 * the words, as a pull up does.
 *
 * It takes whatever height the page leaves it, so on a short phone it is the
 * cover that gives way and nothing below it is pushed off the bottom.
 */
export function BreathingCover({
  song,
  uri,
  onPress,
  opening,
  handed,
  guide,
  guideTarget,
}: {
  song: Song
  uri: string | null | undefined
  onPress: () => void
  opening: Animated.Value
  handed: CoverFrame | null
  guide: GuideHandle
  guideTarget: GuideTarget
}): ReactNode {
  const playing = usePlayerPlaying()
  // A swipe across the cover lets go as a press; only a tap opens the words.
  const touch = useTouchTravel()
  // The app's own width, not the window's (`shell/layoutSize.model.ts`).
  const { width } = useLayout()
  const window = useWindowDimensions()
  const [room, setRoom] = useState<CoverRoom | null>(null)
  // Inside the room's own padding, and never more than the room: measured, the
  // room includes `art`'s padding, so a cover sized to all of it touched the
  // head and the title, and a 120 floor in a short window ran over both.
  const size = Math.max(
    0,
    Math.floor(
      room
        ? Math.min(room.width, room.height - ART_PADDING * 2, COVER_MOST)
        : Math.min(width - space.lg * 2, 342),
    ),
  )

  const [breath] = useState(() => new Animated.Value(playing ? 1 : PAUSED_COVER_SCALE))
  useEffect(() => {
    // A pause is a settling and a play is a lift, so the two are not the same
    // move backwards: it shrinks on a curve and grows back on the spring, which
    // gives the cover the small living overshoot on play that a timed curve of
    // the same length both ways cannot.
    if (playing) spring(breath, 1)
    else timing(breath, PAUSED_COVER_SCALE, MOVE_MS.breath, undefined, { easing: ease.out })
  }, [playing, breath])

  // Paused and settled, a slow breath on top of the shrink; playing, or under
  // Reduce Motion, it lets out and holds still.
  const reduced = useMotionReduced()
  const [rest] = useState(() => new Animated.Value(1))
  useEffect(() => {
    if (playing || reduced) {
      rest.stopAnimation()
      timing(rest, 1, MOVE_MS.breath, undefined, { easing: ease.out })
      return
    }
    const half = (to: number): Animated.CompositeAnimation =>
      Animated.timing(rest, {
        toValue: to,
        duration: MOVE_MS.restBreath,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: nativeDriver,
      })
    const loop = Animated.loop(Animated.sequence([half(PAUSED_BREATH), half(1)]))
    // Once the shrink has landed, so the two are not one lurch.
    const wait = setTimeout(() => loop.start(), MOVE_MS.breath)
    return () => {
      clearTimeout(wait)
      loop.stop()
    }
  }, [playing, reduced, rest])
  const breathing = useMemo(() => Animated.multiply(breath, rest), [breath, rest])

  /*
   * The cover's travel from the mini player's (`M2`, 1), as two numbers and a
   * ratio: the nearest this app comes to the board's shared element, and it
   * needs no library, only where the other cover was.
   *
   * A scale holds a view's centre still, so the travel is centre to centre. The
   * page is rising at the same time and on the same value, and that rise has to
   * come out of these numbers: at the start the page sits a whole window height
   * below where it will rest, so the cover is carried that much further up again
   * to be left over the mini player's. Both are straight lines in the value —
   * the only shape the native driver can run — and their sum is the line the
   * cover is seen to take. At the end both are nothing, which is the cover's own
   * place, so a cover that turns up after the page has risen (the words were
   * showing when it opened) simply rests there.
   *
   * The room is measured against the page and the handed frame against the
   * window, and the two are taken to be the same: this page covers the display
   * from its top left corner, and in a browser at phone width the shell's
   * content area starts there too.
   */
  const travel = useMemo(() => {
    if (handed === null || room === null) return null
    return {
      x: handed.x + handed.size / 2 - (room.x + room.width / 2),
      y: handed.y + handed.size / 2 - (room.y + room.height / 2) - window.height,
      scale: handed.size / size,
    }
  }, [handed, room, size, window.height])

  const transform = useMemo((): CoverTransform => {
    const between = (a: number, b: number): Animated.AnimatedInterpolation<number> =>
      opening.interpolate({ inputRange: [0, 1], outputRange: [a, b] })
    // With nowhere to have come from — a lock-screen tap, an address — the cover
    // grows into place where it is. The breath multiplies into the same scale
    // either way, so a play or a pause while the page is opening compounds with
    // it rather than fighting it.
    if (travel === null)
      return [{ scale: Animated.multiply(breathing, between(COVER_OPENS_AT, 1)) }]
    return [
      { translateX: between(travel.x, 0) },
      { translateY: between(travel.y, 0) },
      { scale: Animated.multiply(breathing, between(travel.scale, 1)) },
    ]
  }, [breathing, opening, travel])

  return (
    <View
      style={styles.art}
      onLayout={event => {
        const { x, y, width: w, height: h } = event.nativeEvent.layout
        setRoom(current =>
          current?.x === x && current.y === y && current.width === w && current.height === h
            ? current
            : { x, y, width: w, height: h },
        )
      }}
    >
      {/* What the lyrics guide lights: the cover, not the room around it, and
          where it rests rather than where the guide's pull has lifted it. */}
      <View ref={guideTarget} collapsable={false}>
        <Animated.View style={guide.shown ? riseWith(guide, 24) : null} {...touch.handlers}>
          <Animated.View style={[styles.artShadow, { transform }]}>
            <Press
              depth="row"
              onPress={() => {
                if (!touch.moved()) onPress()
              }}
              accessibilityRole="button"
              accessibilityLabel="Show the lyrics"
            >
              <Cover uri={uri} title={song.album || song.title} size={size} />
            </Press>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  )
}

/** The space kept above and below the cover in its room. */
const ART_PADDING = space.lg

/**
 * The cover's largest, centred in its room: a browser just under the computer
 * width (744–819) gets this page, where the cover filled 674 of 819 (P7 A).
 * A phone never reaches it.
 */
const COVER_MOST = 520

const styles = StyleSheet.create(theme => ({
  art: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: ART_PADDING,
  },
  artShadow: { borderRadius: radius.card, ...artShadow(theme.colors) },
}))

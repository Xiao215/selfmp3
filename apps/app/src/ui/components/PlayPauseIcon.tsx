import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Animated, View } from 'react-native'
import type { ViewStyle } from 'react-native'
import { motion } from '@selfmp3/client'
import { Pause, Play } from './Icons'
import { ease, timing, useFade, useMinimumBusy, usePresence } from '../motion'
import { MOVE_MS } from '../motion.model'
import { tap } from '../haptics'

/**
 * Play or Pause, shrinking away and back through the swap: the old glyph
 * fades and shrinks on `ease.in`, the new one grows back in its place on
 * `ease.out`, `MOVE_MS.swap` in all. The two curves are what make it read as
 * "the old one leaves, the new one lands" rather than a symmetric pulse. Under
 * Reduce Motion it simply changes.
 *
 * A light tap of haptics goes with the swap (`M1`, 2): the press is answered in
 * the hand at the moment the glyph turns over. Only a phone has one.
 *
 * It used to turn a quarter as it went, which on a triangle and two bars read
 * as a spin rather than a swap (Xiao, 2026-09-21): they are the same control
 * saying two things, not two things changing places.
 *
 * Waiting on the track, it is a spinner instead — the same answer in every
 * play button there is, so the bar, the mini player and a song's page cannot
 * drift apart (Xiao, 2026-09-27). Nothing swaps while it waits: the spinner is
 * already motion, and a glyph turning over behind it was the second animation
 * for one press. The spinner crossfades with the glyph over `motion.fast` and is
 * held for at least `MOVE_MS.busyHold` once shown (`useMinimumBusy`), so a song
 * that starts at once no longer flickers glyph → spinner → glyph.
 *
 * Only the glyph; the button around it is the caller's.
 */
export function PlayPauseIcon({
  playing,
  size,
  color,
  busy = false,
}: {
  playing: boolean
  size: number
  color: string
  /** Waiting on the track: `usePlayerStalled`, which is already patient. */
  busy?: boolean
}): ReactNode {
  const [shown, setShown] = useState(playing)
  const [turn] = useState(() => new Animated.Value(1))
  const spin = useMinimumBusy(busy)
  // Kept mounted for as long as its fade out takes, so glyph and spinner
  // crossfade rather than cut. Both halves are the same length: a crossfade with
  // a shorter exit leaves a frame with neither of them on it.
  const spinner = usePresence(spin, motion.fast, motion.fast)
  const glyphShown = useFade(!spin, motion.fast, motion.fast)

  useEffect(() => {
    if (playing === shown || busy) return
    // Out to nothing, swap the glyph at the bottom of the dip, and back in.
    // Under Reduce Motion both halves land at once and the glyph just changes.
    // Stopped only if it is still on its way out: `stop()` stops the value
    // itself, which once the swap has happened would freeze the glyph coming
    // back in, half faded.
    let landed = false
    tap()
    const out = timing(
      turn,
      0,
      MOVE_MS.swap / 2,
      () => {
        landed = true
        setShown(playing)
        timing(turn, 1, MOVE_MS.swap / 2, undefined, { easing: ease.out })
      },
      { easing: ease.in },
    )
    return () => {
      // Turned round before the glyph had swapped: it is part-way out, small
      // and nearly transparent, and nothing is coming to finish the job — the
      // state it was leaving is the one showing again, so the effect that runs
      // next does nothing. Bring it back, or the button is left empty.
      if (landed) return
      out?.stop()
      timing(turn, 1, MOVE_MS.swap / 2, undefined, { easing: ease.out })
    }
  }, [playing, shown, busy, turn])

  // Built once. The glyph carries two fades at the same time — the swap's, and
  // the spinner taking its place — so they are multiplied into one opacity
  // rather than stacked as two views.
  const glyph = useMemo(
    () => ({
      transform: [{ scale: turn.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) }],
      opacity: Animated.multiply(turn, glyphShown),
    }),
    [turn, glyphShown],
  )
  const wait = useMemo(() => ({ opacity: spinner.progress }), [spinner.progress])

  return (
    <View>
      <Animated.View style={glyph}>
        {shown ? <Pause size={size} color={color} /> : <Play size={size} color={color} />}
      </Animated.View>
      {spinner.mounted ? (
        <Animated.View style={[SPINNER_LAYER, wait]} pointerEvents="none">
          <ActivityIndicator size={size > 20 ? 'large' : 'small'} color={color} />
        </Animated.View>
      ) : null}
    </View>
  )
}

/**
 * The spinner sits over the glyph rather than beside it, so the two crossfade in
 * one place and the button around them never changes size. A plain object rather
 * than a stylesheet: it takes nothing from the theme.
 */
const SPINNER_LAYER = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  alignItems: 'center',
  justifyContent: 'center',
} as const satisfies ViewStyle

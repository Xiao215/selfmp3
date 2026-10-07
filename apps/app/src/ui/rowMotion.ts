import { useMemo } from 'react'
import { Easing, FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated'
import { EASE_IN_POINTS, EASE_OUT_POINTS, MOVE_MS } from './motion.model'
import { useMotionReduced } from './motion'

/**
 * A row of a list that changes under a person's hand: it fades in where it
 * arrives and out where it leaves, and the rows around it glide to their new
 * places instead of jumping. Pressing Retry on a failed import took its row
 * out of the list in one frame, and the row below it was simply there under
 * the pointer.
 *
 * Reanimated's layout animations, for what the `Animated` moves in
 * `motion.ts` cannot do: a row's place is the layout's, not a value of ours,
 * and these measure it before and after and run the difference on the UI
 * thread (a browser runs the same with CSS). Spread onto a Reanimated
 * `Animated.View`, keyed by the row's own id; inside a `LayoutAnimationConfig
 * skipEntering`, so a list's first paint is simply there. Nothing at all
 * under Reduce Motion, the rule `motion.ts` keeps for every other move.
 */
export function useRowMotion(): {
  layout?: LinearTransition
  entering?: FadeIn
  exiting?: FadeOut
} {
  const reduced = useMotionReduced()
  return useMemo(() => {
    if (reduced) return {}
    const out = Easing.bezier(...EASE_OUT_POINTS)
    return {
      layout: LinearTransition.duration(MOVE_MS.rowMove).easing(out),
      entering: FadeIn.duration(MOVE_MS.rowIn).easing(out),
      exiting: FadeOut.duration(MOVE_MS.rowOut).easing(Easing.bezier(...EASE_IN_POINTS)),
    }
  }, [reduced])
}

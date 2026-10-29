import { useEffect, useRef, useState } from 'react'
import { Animated } from 'react-native'
import { motion } from '@selfmp3/client'
import { ease, spring, timing } from '../../ui/motion'

/** How far a view starts from and leaves to: the cover above, the words below. */
export const VIEW_TRAVEL = 48

interface ViewPresence {
  readonly mounted: boolean
  readonly style: {
    readonly opacity: Animated.Value
    readonly transform: readonly { translateY: Animated.AnimatedInterpolation<number> }[]
  }
}

/**
 * One of a phone page's two views, the cover and the words (Now Playing's,
 * and a share link's): springing in from `from` points away, leaving back to
 * it over `motion.base` on `ease.in`, and mounted until it has gone.
 *
 * `usePresence` is the app's answer for everything that arrives and leaves, and
 * both of its ways are timed. This is a thing moving in space, which the boards
 * put on the spring, so only the leaving is timed; the rest is `usePresence`,
 * including asking to be mounted in the render so an arriving view never has a
 * frame in which it is wanted and not there.
 *
 * Nothing is ever set back to 0 and played again: turning round part-way
 * retargets whichever of the two is running from where the view has got to.
 */
export function useViewPresence(shown: boolean, from: number): ViewPresence {
  const [value] = useState(() => new Animated.Value(shown ? 1 : 0))
  const [mounted, setMounted] = useState(shown)
  if (shown && !mounted) setMounted(true)
  const sent = useRef(shown)
  useEffect(() => {
    if (sent.current === shown) return
    sent.current = shown
    if (shown) spring(value, 1)
    else timing(value, 0, motion.base, () => setMounted(false), { easing: ease.in })
  }, [shown, value])
  // Built once: `from` is the view's own side and never changes.
  const [style] = useState(() => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }],
  }))
  return { mounted, style }
}

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AccessibilityInfo, Animated, Easing } from 'react-native'
import { motion } from '@selfmp3/client'
import { backOut, MOVE_MS, OVERSHOOT_S, PRESS, sessionMemory, staggerDelay } from './motion.model'

/**
 * Every move in the app goes through here (docs/ui-mock `M1`, and
 * docs/UI-MIGRATION.md, Phase 9), so that Reduce Motion is answered once and no
 * screen can forget it: under it a spring or a fade lands where it was going
 * with no time in between.
 */

let reduced = false
const listeners = new Set<() => void>()

// One subscription for the whole app, not one per button: a library of rows
// each asking the platform the same question was a listener per row.
void AccessibilityInfo.isReduceMotionEnabled().then(value => {
  reduced = value
  for (const listener of listeners) listener()
})
AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
  reduced = value
  for (const listener of listeners) listener()
})

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Whether moves are instant right now, for code outside React. */
function motionReduced(): boolean {
  return reduced
}

/**
 * Whether this device asks for less motion: Reduce Motion on an iPhone or a
 * Mac, `prefers-reduced-motion` in a browser. False until the answer arrives,
 * a frame or two after launch.
 */
export function useMotionReduced(): boolean {
  return useSyncExternalStore(subscribe, motionReduced, motionReduced)
}

/**
 * A duration, or none under Reduce Motion: for the few animations that must
 * run their own `Animated` call because what happens at the end has to happen
 * even when it is interrupted — the stage's exit changes the route there — so
 * they cannot go through `timing`, which leaves an interrupted move's end
 * alone. They still land at once when less motion is asked for.
 */
export function motionMs(ms: number): number {
  return reduced ? 0 : ms
}

/**
 * The native driver, as the rest of the app asks for it: a browser has none
 * and react-native-web runs the same animation on the JS side instead.
 */
const nativeDriver = true

/**
 * The one spring (`motion.spring`), or a jump to the end under Reduce Motion.
 * Returns what was started, so a caller can chain or stop it. `native` is
 * false for what the native driver cannot move — a width, a height — as it is
 * in `timing`; a value that moves both must be off the native driver for both,
 * since it cannot change drivers once it has been handed over.
 */
export function spring(
  value: Animated.Value,
  toValue: number,
  { native = nativeDriver }: { native?: boolean } = {},
): Animated.CompositeAnimation | null {
  if (reduced) {
    value.setValue(toValue)
    return null
  }
  const animation = Animated.spring(value, {
    toValue,
    stiffness: motion.spring.stiffness,
    damping: motion.spring.damping,
    mass: 1,
    useNativeDriver: native,
  })
  animation.start()
  return animation
}

/**
 * The curves a timed move can take. `out` is the app's ease-out, the one the
 * web's CSS has always used (`cubic-bezier(.2, .8, .2, 1)` on the boards);
 * `in` is for leaving; `overshoot` runs a little past the end and settles
 * back, for the mini player's rise and a sheet's (`motion.model.ts`).
 */
export const ease = {
  out: Easing.bezier(0.2, 0.8, 0.2, 1),
  in: Easing.bezier(0.4, 0, 1, 1),
  overshoot: backOut(OVERSHOOT_S),
} as const

interface TimingOptions {
  /** Left out, React Native's own ease-in-out, which the first callers were written against. */
  readonly easing?: (t: number) => number
  /** Milliseconds before it starts: a stagger. */
  readonly delay?: number
  /**
   * False for what the native driver cannot move — a height, a width, a
   * position — which then runs on the JavaScript side.
   */
  readonly native?: boolean
}

/**
 * A timed move, or a jump to the end under Reduce Motion. `onDone` runs when
 * it lands — at once, when there is no move — and not if it is interrupted.
 */
export function timing(
  value: Animated.Value,
  toValue: number,
  duration: number,
  onDone?: () => void,
  { easing, delay, native = nativeDriver }: TimingOptions = {},
): Animated.CompositeAnimation | null {
  if (reduced) {
    value.setValue(toValue)
    onDone?.()
    return null
  }
  const animation = Animated.timing(value, {
    toValue,
    duration,
    useNativeDriver: native,
    ...(easing ? { easing } : {}),
    ...(delay ? { delay } : {}),
  })
  animation.start(({ finished }) => {
    if (finished) onDone?.()
  })
  return animation
}

/**
 * What this session has already shown once, for the moves that are a welcome
 * rather than a response: Home's tiles, the mini player's first rise. Module
 * level, so a tab switch or a remount never plays them again.
 */
export const session = sessionMemory()

/**
 * A value that comes to 1 once, as whatever uses it mounts: the spring, from
 * 0. Already at 1 under Reduce Motion, so there is no frame of the start.
 */
export function useEntrance(): Animated.Value {
  const [value] = useState(() => new Animated.Value(reduced ? 1 : 0))
  useEffect(() => {
    spring(value, 1)
  }, [value])
  return value
}

/**
 * One of a row of things arriving (`M1`, 4): it fades up from a few points
 * below, a stagger after the one before it. `count` is how many are arriving,
 * so a long row closes up (`STAGGER_TOTAL_MS`). With `play` false it is
 * simply there; the caller decides, once, whether this paint is the one that
 * plays.
 */
export function useArrival(
  index: number,
  play: boolean,
  count?: number,
): {
  opacity: Animated.Value
  transform: { translateY: Animated.AnimatedInterpolation<number> }[]
} {
  const [value] = useState(() => new Animated.Value(play && !reduced ? 0 : 1))
  useEffect(() => {
    if (play)
      timing(value, 1, MOVE_MS.arrive, undefined, {
        easing: ease.out,
        delay: staggerDelay(index, count),
      })
  }, [play, index, count, value])
  const [style] = useState(() => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  }))
  return style
}

/**
 * Something that arrives and leaves: mounted while `shown`, and for as long
 * after as its exit takes. `progress` goes to 1 over `inMs` on `ease.out` and
 * back to 0 over `outMs` on `ease.in`; `mounted` turns false when it lands. A
 * caller that returned null the frame `shown` went false cut its thing away
 * after a move in — the mini player, a row's wash — and this is the one
 * answer for all of them: everything that arrives leaves. A curve of the
 * caller's own, for the few that overshoot on the way up.
 */
export function usePresence(
  shown: boolean,
  inMs: number,
  outMs: number,
  {
    easeIn = ease.out,
    easeOut = ease.in,
  }: { easeIn?: EasingFunction; easeOut?: EasingFunction } = {},
): { mounted: boolean; progress: Animated.Value } {
  const [progress] = useState(() => new Animated.Value(shown ? 1 : 0))
  const [mounted, setMounted] = useState(shown)
  // In the render, so the arriving thing never has a frame in which it is
  // asked for and not yet there.
  if (shown && !mounted) setMounted(true)
  const sent = useRef(shown)
  useEffect(() => {
    if (sent.current === shown) return
    sent.current = shown
    if (shown) timing(progress, 1, inMs, undefined, { easing: easeIn })
    else timing(progress, 0, outMs, () => setMounted(false), { easing: easeOut })
  }, [shown, inMs, outMs, easeIn, easeOut, progress])
  return { mounted, progress }
}

type EasingFunction = (t: number) => number

/**
 * A value that follows `shown` between 0 and 1: `inMs` on the way in and
 * `outMs` on the way out. It starts where `shown` says, so a first render
 * draws the resting state and nothing moves until `shown` changes.
 */
export function useFade(shown: boolean, inMs: number, outMs: number): Animated.Value {
  const [value] = useState(() => new Animated.Value(shown ? 1 : 0))
  // Where it was last sent, so mounting — a row scrolled into a long list —
  // starts nothing: most of the rows that use this never move at all.
  const sent = useRef(shown)
  useEffect(() => {
    if (sent.current === shown) return
    sent.current = shown
    timing(value, shown ? 1 : 0, shown ? inMs : outMs, undefined, { easing: ease.out })
  }, [shown, inMs, outMs, value])
  return value
}

/**
 * Everything pressable sinks on the spring and comes back on release: a
 * control to `PRESS.control`, a row to `PRESS.row` (`M1`, "Press"). `Press`
 * (`ui/components/Press.tsx`) is the one Pressable that carries this; reach
 * for this directly only where a Pressable cannot be wrapped.
 * Spread `handlers` onto the Pressable and put `style` on an `Animated.View`
 * around it (a Pressable's style function cannot carry an animated value).
 */
export function usePressScale(to: number = PRESS.control): {
  style: { transform: { scale: Animated.Value }[] }
  handlers: { onPressIn: () => void; onPressOut: () => void }
} {
  // Made once per component, in state rather than a ref, so render reads nothing mutable.
  const [press] = useState(() => {
    const scale = new Animated.Value(1)
    return {
      style: { transform: [{ scale }] },
      handlers: {
        onPressIn: () => void spring(scale, to),
        onPressOut: () => void spring(scale, 1),
      },
    }
  })
  return press
}

/**
 * Whether a spinner should be drawn: while `busy`, and for `MOVE_MS.busyHold`
 * after it first appeared, so a wait that is over in a moment does not flash one.
 * The hold is counted from when the spinner went up, not from when the wait
 * ended, so a long wait lets go the moment it is done.
 */
export function useMinimumBusy(busy: boolean): boolean {
  // Whether the spinner is up: from the moment `busy` is, and for the hold
  // after it stops. Set during the render `busy` turns on, so the spinner
  // is in the same frame as the wait, and let go by a timer.
  const [held, setHeld] = useState(busy)
  if (busy && !held) setHeld(true)
  const since = useRef(0)
  useEffect(() => {
    if (busy) {
      since.current = Date.now()
      return undefined
    }
    if (!held) return undefined
    const left = Math.max(0, MOVE_MS.busyHold - (Date.now() - since.current))
    const timer = setTimeout(() => setHeld(false), left)
    return () => clearTimeout(timer)
  }, [busy, held])
  return held
}

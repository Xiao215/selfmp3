import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Animated } from 'react-native'
import type { View } from 'react-native'
import { usePathname } from 'expo-router'
import { useWindowValue } from '../../shell/useLayout'
import { boxMoved, stepAfter, type Box, type GuideName } from './guide.model'
import { guidesWait, subscribeBusy } from './guideBusy'
import {
  claimGuide,
  countVisit,
  guideSeen,
  markGuideSeen,
  releaseGuide,
  useGuideMemory,
} from './guideMemory'
import { fieldFocused } from './watchBusy'

/** How long a page has to arrive before its guide darkens it. */
const SETTLE_MS = 700
/** How many more times a guide looks for what it lights before waiting for `ready` again. */
const RETRIES = 6
/**
 * How often a guide that is up looks again at where its thing is. A page can
 * still be settling when it is first measured (an iPad's Import box sat 30
 * points lower once its scroll view had taken the status bar's inset), and a
 * box grows as a list is pasted into it; nothing tells a guide either happened.
 */
const FOLLOW_MS = 400

const stayStill = (): (() => void) => () => {}

/** The ref for the View the spotlight goes round: kept apart from the handle, which is read while rendering. */
export type GuideTarget = (view: View | null) => void

export interface GuideHandle {
  readonly name: GuideName
  /** Where that View sat, in window points, when the guide came up. */
  readonly box: Box | null
  readonly shown: boolean
  /** Which step of a guide with more than one; the first tap moves on. */
  readonly step: number
  /**
   * 0 → 1 over one round of the gesture, again and again while the guide is
   * up and still at 0 otherwise. The hand follows it; a screen can move the
   * real thing with it too, so the row the hand holds lifts with the hand.
   */
  readonly demo: Animated.Value
  readonly next: (steps: number) => void
  readonly dismiss: () => void
}

/**
 * A screen's one-time guide, as the ref to put on what it lights and the
 * handle `Guide` draws from: shown once on this device (B1), when `ready`
 * says the gesture would work right now, after the page has settled, and
 * only while no other guide is up. `afterVisits` holds it back until that
 * many visits have gone by without it.
 *
 * It also waits while the hands are busy (`guideBusy`): a finger down, a row
 * being held or carried, a field being typed in, or a layer open over the
 * screen. `layers` is how many layers the screen itself is drawn in (Up next's
 * sheet is one), so its own does not count. It comes a settle after all of
 * that has stopped, so the finger letting go never lands on it.
 *
 * The ref goes on something the gesture does not move: the spotlight follows
 * it while the guide is up, and would follow the demo's pull too.
 */
export function useGuide(
  name: GuideName,
  ready: boolean,
  { afterVisits = 0, layers = 0 }: { afterVisits?: number; layers?: number } = {},
): readonly [GuideTarget, GuideHandle] {
  useGuideMemory()
  const node = useRef<View | null>(null)
  const target = useCallback((view: View | null) => {
    node.current = view
  }, [])
  const [demo] = useState(() => new Animated.Value(0))
  const [box, setBox] = useState<Box | null>(null)
  const [step, setStep] = useState(0)
  // A measure that found nothing to light (the page still sliding in, the row
  // not laid out) tries again a few times rather than waiting for `ready` to change.
  const [attempt, setAttempt] = useState(0)
  const [visitOk] = useState(
    () => afterVisits === 0 || guideSeen(name) || countVisit(name) > afterVisits,
  )
  const seen = guideSeen(name)
  const asks = ready && visitOk && !seen && box === null
  // Only a guide still to come listens: every touch would otherwise re-render
  // each screen that has ever had one.
  const busy = useSyncExternalStore(asks ? subscribeBusy : stayStill, () =>
    asks ? guidesWait(layers) : false,
  )
  const want = asks && !busy
  const lit = box !== null
  /*
   * The window's size, only while the guide is waiting to come up or is up.
   * Every screen asks for its guides, and nearly all of them have long been
   * seen: each was drawn again for every pixel a window was dragged, the
   * pages under the top one too (bug bash F056).
   */
  const watching = asks || lit
  const windowWidth = useWindowValue(window => (watching ? window.width : 0))
  const windowHeight = useWindowValue(window => (watching ? window.height : 0))

  useEffect(() => {
    if (!want) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      const view = node.current
      if (cancelled) return
      // Typing with no keyboard on screen to say so (an iPad's own keyboard).
      if (view === null || fieldFocused() || !claimGuide(name)) {
        if (attempt < RETRIES) setAttempt(now => now + 1)
        return
      }
      view.measureInWindow((x, y, width, height) => {
        // Off screen, or not laid out yet: give the turn back and try the next
        // time the screen is ready, rather than lighting nothing.
        const visible =
          width > 0 && height > 0 && y + height > 0 && y < windowHeight && x < windowWidth
        if (cancelled || !visible || guidesWait(layers)) {
          releaseGuide(name)
          if (!cancelled && attempt < RETRIES) setAttempt(now => now + 1)
          return
        }
        markGuideSeen(name)
        setBox({ x, y, width, height })
      })
    }, SETTLE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [want, name, attempt, layers, windowHeight, windowWidth])

  const shown = box !== null && step >= 0

  // What it lights moves under a guide that is up: a window resized (a
  // computer's), a page still settling, a box growing as a list is pasted in.
  // The spotlight follows rather than glowing round an empty patch.
  useEffect(() => {
    if (!shown) return undefined
    const follow = (): void =>
      node.current?.measureInWindow((x, y, width, height) => {
        if (width <= 0 || height <= 0) return
        const next = { x, y, width, height }
        setBox(now => (now === null || !boxMoved(now, next) ? now : next))
      })
    follow()
    const timer = setInterval(follow, FOLLOW_MS)
    return () => clearInterval(timer)
  }, [shown, windowWidth, windowHeight])
  /*
   * The hand stopped and put back at the start before the step changes, while
   * the row it moves is still joined to it. A row lets go of the hand on that
   * render, and on a phone a row let go mid-pull stayed where the hand had it:
   * React's own props for it already said "not moved", so nothing put it back
   * (the swipe guide's row sat half off its red Remove, and a finger could not
   * swipe it home). `Guide` starts the next step's round itself.
   */
  const settle = useCallback(() => {
    demo.stopAnimation()
    demo.setValue(0)
  }, [demo])
  // The step as the last press left it, read by the next press: giving the
  // turn back from inside a state update told every other guide mid-render.
  const stepNow = useRef(0)
  const dismiss = useCallback(() => {
    settle()
    stepNow.current = -1
    setStep(-1)
    releaseGuide(name)
  }, [name, settle])
  const next = useCallback(
    (steps: number) => {
      settle()
      const after = stepAfter(stepNow.current, steps)
      stepNow.current = after
      setStep(after)
      if (after < 0) releaseGuide(name)
    },
    [name, settle],
  )

  // A screen left with its guide up gives the turn back.
  useEffect(() => () => releaseGuide(name), [name])

  // Another page opened over the guide's (the screen stays mounted under a
  // pushed one): the guide goes with its page rather than lighting a patch of
  // the new one.
  const pathname = usePathname()
  const shownOn = useRef<string | null>(null)
  useEffect(() => {
    if (!shown) {
      shownOn.current = null
      return
    }
    if (shownOn.current === null) shownOn.current = pathname
    else if (shownOn.current !== pathname) dismiss()
  }, [shown, pathname, dismiss])

  const guide = useMemo(
    () => ({ name, box, shown, step, demo, next, dismiss }),
    [name, box, shown, step, demo, next, dismiss],
  )
  return [target, guide]
}

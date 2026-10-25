import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, useWindowDimensions } from 'react-native'
import type { View } from 'react-native'
import type { Box, GuideName } from './guide.model'
import {
  claimGuide,
  countVisit,
  guideSeen,
  markGuideSeen,
  releaseGuide,
  useGuideMemory,
} from './guideMemory'

/** How long a page has to arrive before its guide darkens it. */
const SETTLE_MS = 700
/** How many more times a guide looks for what it lights before waiting for `ready` again. */
const RETRIES = 6

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
 */
export function useGuide(
  name: GuideName,
  ready: boolean,
  { afterVisits = 0 }: { afterVisits?: number } = {},
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
  const window = useWindowDimensions()
  const seen = guideSeen(name)
  const want = ready && visitOk && !seen && box === null

  useEffect(() => {
    if (!want) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      const view = node.current
      if (cancelled) return
      if (view === null || !claimGuide(name)) {
        if (attempt < RETRIES) setAttempt(now => now + 1)
        return
      }
      view.measureInWindow((x, y, width, height) => {
        // Off screen, or not laid out yet: give the turn back and try the next
        // time the screen is ready, rather than lighting nothing.
        const visible =
          width > 0 && height > 0 && y + height > 0 && y < window.height && x < window.width
        if (cancelled || !visible) {
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
  }, [want, name, attempt, window.height, window.width])

  // A window resized under a guide (a computer's) moves what it lights; the
  // spotlight follows rather than glowing round an empty patch.
  const lit = box !== null
  useEffect(() => {
    if (!lit) return
    node.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) setBox(now => (now === null ? now : { x, y, width, height }))
    })
  }, [lit, window.width, window.height])

  const shown = box !== null && step >= 0
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
  const dismiss = useCallback(() => {
    settle()
    setStep(-1)
    releaseGuide(name)
  }, [name, settle])
  const next = useCallback(
    (steps: number) => {
      settle()
      setStep(now => {
        if (now + 1 < steps) return now + 1
        releaseGuide(name)
        return -1
      })
    },
    [name, settle],
  )

  // A screen left with its guide up gives the turn back.
  useEffect(() => () => releaseGuide(name), [name])

  const guide = useMemo(
    () => ({ name, box, shown, step, demo, next, dismiss }),
    [name, box, shown, step, demo, next, dismiss],
  )
  return [target, guide]
}

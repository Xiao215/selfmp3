import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useLayoutValue } from '../../shell/useLayout'
import { usePointerHold } from '../../ports/pointerHold'
import { setReorderHold } from '../../ports/songDrag'
import { lightTap } from '../../ports/haptics'
import { ease, spring, timing } from '../motion'
import { MOVE_MS } from '../motion.model'

/**
 * Holding a row and moving it: a finger's way to reorder a list.
 *
 * A finger has no grip to aim at — a 44-point handle in a row that is 48 tall
 * would take the title's room — so the row itself is the handle, and holding
 * it is what says "I mean to move this, not to play it". A mouse holds a row
 * the same way: there is no grip column, since a column of dots on every row
 * reads as clutter and a pointer can hold a row as well as a finger can.
 *
 * Gesture handler rather than a pan responder, which does not work on a real
 * phone. A pan responder lives in React's touch system,
 * above the platform's: the row's own `Pressable` holds the touch, and taking
 * it away mid-gesture — which is exactly what a hold has to do — depends on a
 * chain of should-set callbacks firing in the right order against a scroll
 * view that is also trying to claim the finger. Gesture handler attaches a
 * real recogniser to the row's view, so the platform arbitrates:
 * `activateAfterLongPress` waits for a still finger, and when it wins, the
 * press underneath is cancelled for us.
 *
 * A pointer holds a row through a pan responder instead, and that is not a
 * preference: gesture handler's web build recognises the first hold of a page
 * and then never activates again — reproduced at 1280 and not at 390, with
 * the song drag off and every row undraggable, so it is the recogniser and
 * not the browser's drag. A pan responder has none of the arbitration
 * trouble here that it has on a phone, because a mouse is not competing with
 * a scroll: nothing claims the pointer until the hold has already elapsed,
 * and then this takes it.
 *
 * In a browser one more thing has to be true: a row that is itself draggable
 * — a song drags onto a playlist in the sidebar — must stand its drag down
 * while this one is happening, or the browser's drag cancels the pointer
 * stream mid-move. The row is the handle for both, so it is the hold that
 * says so, at the moment it activates and before the pointer has moved:
 * `setReorderHold` in `ports/songDrag`.
 *
 * How long the hold is, for a finger and for a pointer alike, is
 * `MOVE_MS.hold`: one length for one gesture, so a row here and a tag's row
 * on the Tags page are not two different holds. A wait that says nothing is a
 * wait that reads as nothing happening, so `onHolding` tells the row when the
 * count has begun and `useLiftScale` swells it towards the lift while it runs.
 */

interface HoldToReorderProps {
  /**
   * Off where there is nothing to move: a selection under way, or a list
   * whose order is not yours to set.
   */
  enabled: boolean
  /** The row has lifted, and where across the screen the hold began. */
  onStart: (x: number) => void
  /**
   * How far it has travelled from where it started, in points. Sideways as
   * well as down: a list whose rows also leave sideways reads both, and one
   * that only reorders ignores the first.
   */
  onMove: (dx: number, dy: number) => void
  /** Let go, or taken away: the travel it ended at, and 0 when it was taken. */
  onEnd: (dx: number, dy: number) => void
  /**
   * The count has begun, or it is over: true the moment the finger or the
   * pointer goes down on a row that can be moved, false when the hold wins
   * (`onStart` has just run) and when the gesture ends, fails or is taken
   * away. `useLiftScale` is what this is for — a row that swells while the
   * hold is counted, and springs back if the hold is abandoned.
   */
  onHolding?: (holding: boolean) => void
  /**
   * How tall a row is, reported by the one row that is asked. A move is
   * counted in whole rows travelled, and this wrapper is exactly the thing
   * whose height that arithmetic means.
   */
  onLayoutHeight?: (height: number) => void
  children: ReactNode
}

export function HoldToReorder(props: HoldToReorderProps): ReactNode {
  // `dense` is a mouse on a computer.
  // A mouse in a phone-width window keeps the finger's recogniser: the gesture
  // it competes with there is the queue row's swipe, which is gesture
  // handler's own and reads the pointer stream this one would take.
  const dense = useLayoutValue(layout => layout.dense)
  return dense ? <HeldByPointer {...props} /> : <HeldByFinger {...props} />
}

/**
 * A mouse: the browser's own pointer capture, through the port. Nothing is
 * captured until the hold has elapsed, so a click still plays the song.
 */
function HeldByPointer({
  enabled,
  onStart,
  onMove,
  onEnd,
  onHolding,
  onLayoutHeight,
  children,
}: HoldToReorderProps): ReactNode {
  const ref = useRef<View>(null)
  usePointerHold(ref, {
    enabled,
    holdMs: MOVE_MS.hold,
    onStart: x => {
      setReorderHold(true)
      onStart(x)
      // After `onStart`, not before it: the row is carried now, and the swell
      // has to hand over to the full lift rather than spring back first.
      onHolding?.(false)
    },
    onMove,
    onHolding,
    onEnd: (dx, dy) => {
      setReorderHold(false)
      onEnd(dx, dy)
    },
  })
  return (
    <View
      ref={ref}
      collapsable={false}
      onLayout={
        onLayoutHeight ? event => onLayoutHeight(event.nativeEvent.layout.height) : undefined
      }
    >
      {children}
    </View>
  )
}

/** A finger: gesture handler, so the platform arbitrates against the scroll. */
function HeldByFinger({
  enabled,
  onStart,
  onMove,
  onEnd,
  onHolding,
  onLayoutHeight,
  children,
}: HoldToReorderProps): ReactNode {
  /*
   * How far the gesture has got, for a row taken away in the middle of one.
   * The song held can start playing and leave the rows that can be moved, or
   * moving can be switched off: either way the detector goes, and gesture
   * handler never calls the end of a gesture whose detector went. Nothing
   * else would say the hold was over, so the list stayed carrying a row that
   * was no longer there — its neighbours stepped aside, its scroll and its
   * swipes off — until it was shut. Read inside the handlers, which run once
   * each, so a cancelled gesture that does report later reports nothing.
   */
  const [progress] = useState(() => new HoldProgress())
  const latest = useRef({ onEnd, onHolding })
  useEffect(() => {
    latest.current = { onEnd, onHolding }
  })
  const takeAway = useCallback((): void => {
    const was = progress.over()
    if (was === 'carried') {
      setReorderHold(false)
      latest.current.onEnd(0, 0)
    }
    if (was !== 'idle') latest.current.onHolding?.(false)
  }, [progress])
  useEffect(() => {
    if (!enabled) takeAway()
  }, [enabled, takeAway])
  useEffect(() => takeAway, [takeAway])

  /*
   * Built in the render, which is gesture handler's own advice: the detector
   * compares the gesture it is given with the one it is holding and updates
   * the handlers in place, so a render in the middle of a move — and there is
   * one for every row the finger crosses — keeps the move rather than
   * dropping a recogniser and starting again. Nothing is memoised, so nothing
   * is stale either.
   */
  const hold = Gesture.Pan()
    .enabled(enabled)
    .activateAfterLongPress(MOVE_MS.hold)
    // On the JS thread: what a move changes is React state and a query cache,
    // so a worklet would only hop back for every one of them.
    .runOnJS(true)
    // The finger is down and the count has begun. `onBegin` rather than
    // `onStart`: a pan's start is the moment it wins, which is the end of the
    // wait this is feedback for.
    .onBegin(() => {
      progress.begin()
      onHolding?.(true)
    })
    .onStart(event => {
      if (!progress.carry()) return
      setReorderHold(true)
      onStart(event.absoluteX)
      // After `onStart`: the swell hands over to the lift instead of springing
      // back first.
      onHolding?.(false)
    })
    .onUpdate(event => {
      if (progress.carrying()) onMove(event.translationX, event.translationY)
    })
    // A gesture that was cancelled — the app went away, the list remounted —
    // ends where it began, so the row goes back.
    .onEnd((event, success) => {
      if (!progress.letGo()) return
      setReorderHold(false)
      if (success) onEnd(event.translationX, event.translationY)
      else onEnd(0, 0)
    })
    // Always run, whether the hold won or the finger left before it did, so a
    // swell that was counting for nothing is always taken back.
    .onFinalize(() => {
      if (progress.over() !== 'idle') onHolding?.(false)
    })

  /* A view of its own, so the recogniser has one thing to attach to whatever
     the row happens to draw. */
  const inside = (
    <View
      collapsable={false}
      onLayout={
        onLayoutHeight ? event => onLayoutHeight(event.nativeEvent.layout.height) : undefined
      }
    >
      {children}
    </View>
  )

  // No recogniser at all where there is nothing to recognise — a playlist that
  // follows tags, or a selection under way. A disabled detector is not free:
  // it still claims the pointer it is over, and in a browser that is enough to
  // stop a drag that starts inside it.
  return enabled ? <GestureDetector gesture={hold}>{inside}</GestureDetector> : inside
}

/**
 * How far one hold has got: counting, carried, or over. Its own object, read
 * and moved on by the gesture's handlers, so a hold taken away in the middle
 * — its detector gone — and the end its recogniser may still report are told
 * apart, and each end is said once.
 */
class HoldProgress {
  #phase: 'idle' | 'counting' | 'carried' = 'idle'
  begin(): void {
    this.#phase = 'counting'
  }
  /** The hold has won: false when it was taken away before it could. */
  carry(): boolean {
    if (this.#phase === 'idle') return false
    this.#phase = 'carried'
    return true
  }
  carrying(): boolean {
    return this.#phase === 'carried'
  }
  /** Let go of while carried, true then; the count's own end is still to come. */
  letGo(): boolean {
    if (this.#phase !== 'carried') return false
    this.#phase = 'counting'
    return true
  }
  /** Over, and how far it had got. */
  over(): 'idle' | 'counting' | 'carried' {
    const was = this.#phase
    this.#phase = 'idle'
    return was
  }
}

/** Which turn of holds a list is on, so a settle that ends late knows it is out of date. */
class Turns {
  #now = 0
  next(): number {
    this.#now += 1
    return this.#now
  }
  is(turn: number): boolean {
    return turn === this.#now
  }
}

/** How much a row grows while its hold is being counted, and once it is carried (`M2`, 6). */
const HOLD_SCALE = 1.02
const LIFT_SCALE = 1.04

/**
 * The scale a row wears through a whole move, and which row is wearing it.
 *
 * One list, one scale (docs/ui-mock `M2`, 6): it swells a little while the
 * hold is being counted, grows to the full lift the moment the row is carried,
 * and settles back on the spring when the row is let go — the board's "letting
 * go drops it", and where the haptic tap belongs. A wait with no feedback at
 * all reads as nothing happening for the hold's whole third of a second; the
 * swell runs on `ease.in` over the hold's own
 * length, so most of it happens in the last third of the wait — late enough
 * that a press which was only a press barely moves.
 *
 * One value rather than one per row, because only one row is ever held. Which
 * row wears it is a key of the list's choosing — a song's id, not a position,
 * since a drop reorders the list under the row and the settle has to follow
 * the song into its new place. It stays with that row until the settle is
 * over, and then no row wears it.
 */
interface LiftScale {
  /** The scale, worn by the row `wearing` names. Native driver. */
  readonly lift: Animated.Value
  /** Which row is wearing it: the key handed to `holding` or `start`. */
  readonly wearing: number | null
  /** `HoldToReorder`'s `onHolding`, for the row keyed `key`. */
  readonly holding: (key: number, holding: boolean) => void
  /** The row has lifted (`onStart`): on to the full lift. */
  readonly start: (key: number) => void
  /** Let go (`onEnd`): settles back on the spring, with the tap. */
  readonly drop: () => void
}

export function useLiftScale(): LiftScale {
  const [wearing, setWearing] = useState<number | null>(null)
  // Made once; nothing in the render reads it beyond handing it to a style.
  const [lift] = useState(() => new Animated.Value(1))
  // The one fact the callbacks need and nothing draws from: whether this hold
  // got as far as lifting the row. Written and read only inside them.
  const carried = useRef(false)
  /*
   * Which hold the scale belongs to, so a settle that ends after the next
   * hold has begun leaves that one alone.
   */
  const [turns] = useState(() => new Turns())

  const holding = useCallback(
    (key: number, down: boolean): void => {
      if (down) {
        turns.next()
        carried.current = false
        setWearing(key)
        timing(lift, HOLD_SCALE, MOVE_MS.hold, undefined, { easing: ease.in })
        return
      }
      // The row is being carried, or has just been dropped and is settling:
      // `start` and `drop` own the scale then, and this is only the end of the
      // count they no longer care about.
      if (carried.current) return
      // A hold that came to nothing — a press, a finger that moved off: the
      // swell goes back where it was and the row stops wearing anything.
      spring(lift, 1)
      setWearing(now => (now === key ? null : now))
    },
    [lift, turns],
  )

  const start = useCallback(
    (key: number): void => {
      turns.next()
      carried.current = true
      setWearing(key)
      timing(lift, LIFT_SCALE, MOVE_MS.lift, undefined, { easing: ease.out })
    },
    [lift, turns],
  )

  const drop = useCallback((): void => {
    const mine = turns.next()
    // Settled, the row stops wearing it. And if the row went as it was set
    // down — dragged out of the rail, or the held song began to play — the
    // spring was stopped with the last view wearing the value, at the full
    // lift: put back to rest, or the song came back swollen when it was
    // next added.
    spring(lift, 1, {
      onStopped: () => {
        if (!turns.is(mine)) return
        lift.setValue(1)
        setWearing(null)
      },
    })
    lightTap()
  }, [lift, turns])

  return useMemo(
    () => ({ lift, wearing, holding, start, drop }),
    [lift, wearing, holding, start, drop],
  )
}

/**
 * The step a row takes aside while another is carried past it (docs/ui-mock
 * `M2`, 6): one row up or down over `MOVE_MS.room`, so where the carried row
 * will land is a gap rather than a line, and the rows make room one at a time
 * as it passes them (`roomShift` works out which way).
 *
 * The step is taken off at once rather than played back when the move ends:
 * the list is redrawn in its new order in the same commit, and a row sliding
 * home from where it had stepped to would travel twice. What the eye follows
 * through that frame is the row that was let go, still wearing its lift and
 * settling back over the top of it (`useLiftScale`).
 */
export function useMakeRoom(
  shift: -1 | 0 | 1,
  step: number,
  /** A row is being carried; when it is let go every step comes off at once. */
  carrying: boolean,
): { transform: { translateY: Animated.Value }[] } {
  const [y] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (carrying) timing(y, shift * step, MOVE_MS.room, undefined, { easing: ease.out })
    else y.setValue(0)
  }, [carrying, shift, step, y])
  // Built once: an interpolation or a style object made in the render is a new
  // node every render.
  const [style] = useState(() => ({ transform: [{ translateY: y }] }))
  return style
}

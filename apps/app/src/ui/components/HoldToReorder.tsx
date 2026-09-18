import type { ReactNode } from 'react'
import { View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'

/**
 * Holding a row and moving it: a finger's way to reorder a list.
 *
 * A finger has no grip to aim at — a 44-point handle in a row that is 48 tall
 * would take the title's room — so the row itself is the handle, and holding
 * it is what says "I mean to move this, not to play it". Where there is a
 * pointer there is a grip instead, which needs none of this: a press on a grip
 * is already a statement of intent, and React's own responder system grants it
 * at once (`ReorderGrip` in the playlist page).
 *
 * Gesture handler rather than a pan responder, which is what this was and what
 * did not work on a real phone. A pan responder lives in React's touch system,
 * above the platform's: the row's own `Pressable` holds the touch, and taking
 * it away mid-gesture — which is exactly what a hold has to do — depends on a
 * chain of should-set callbacks firing in the right order against a scroll
 * view that is also trying to claim the finger. Gesture handler attaches a
 * real recogniser to the row's view, so the platform arbitrates:
 * `activateAfterLongPress` waits for a still finger, and when it wins, the
 * press underneath is cancelled for us.
 *
 * One file, not a port: gesture handler's own web build turns the same gesture
 * into pointer events, and a browser at phone width is where this is verified
 * (`verify/flows/playlist.spec.ts`). Nothing here reads the platform.
 *
 * In a browser one more thing has to be true: a row that is itself draggable
 * — a song drags onto a playlist in the sidebar — must stand its drag down
 * while this one is happening, or the browser's drag cancels the pointer
 * stream mid-move. That is `useNotADragSource` in `ports/songDrag`.
 */

/** How long a finger rests on a row before the row lifts to be moved. */
const HOLD_TO_MOVE_MS = 350

interface HoldToReorderProps {
  /**
   * Off where there is nothing to move: a playlist that follows tags, a
   * selection under way, or a width where the grip is the handle.
   */
  enabled: boolean
  /** The row has lifted. */
  onStart: () => void
  /** How far it has travelled from where it started, in points. */
  onMove: (dy: number) => void
  /** Let go, or taken away: the travel it ended at, and 0 when it was taken. */
  onEnd: (dy: number) => void
  /**
   * How tall a row is, reported by the one row that is asked. A move is
   * counted in whole rows travelled, and this wrapper is exactly the thing
   * whose height that arithmetic means.
   */
  onLayoutHeight?: (height: number) => void
  children: ReactNode
}

export function HoldToReorder({
  enabled,
  onStart,
  onMove,
  onEnd,
  onLayoutHeight,
  children,
}: HoldToReorderProps): ReactNode {
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
    .activateAfterLongPress(HOLD_TO_MOVE_MS)
    // On the JS thread: what a move changes is React state and a query cache,
    // so a worklet would only hop back for every one of them.
    .runOnJS(true)
    .onStart(() => onStart())
    .onUpdate(event => onMove(event.translationY))
    // A gesture that was cancelled — the app went away, the list remounted —
    // ends where it began, so the row goes back.
    .onEnd((event, success) => onEnd(success ? event.translationY : 0))

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

/**
 * Putting Now Playing away with its exit played — the computer's stage and the
 * phone's own page alike.
 *
 * The page is a route, and the router swaps routes at once: closing it from the
 * player bar or its own chevron would cut straight back to the library. The page
 * registers how it leaves while it is showing; whoever closes it goes through
 * `leaveStage`, which plays that and then navigates. With no page showing it
 * just navigates.
 *
 * Both pages register here rather than each solving it again: on a phone the
 * navigator plays nothing for this route (`shell/pageStep.ts`), so the page's
 * own sink to the foot is the whole of the move down, exactly as the desktop
 * stage's lift is (`NowPlayingScreen`, `NowPlayingStage`).
 *
 * `done` is told whether the exit landed. A stopped exit must not navigate —
 * the page is still there — and it must not leave the door shut either, so the
 * next close can start a new one.
 *
 * From the moment its exit starts the page takes no touches (`useStageLeaving`):
 * a tap a moment after the chevron landed on the leaving page's Pause, which
 * sat where the tab bar comes back, and paused the song (R2-m16).
 */

import { createValueStore } from '../state/valueStore.model'
import { useValueStore } from '../state/useValueStore'

type Leave = (done: (finished: boolean) => void) => void

let leave: Leave | null = null
/**
 * An exit already playing. The chevron, Escape, the pull and the player bar can
 * all reach `leaveStage` within a frame or two of each other, and without this
 * that would start two exits and call `router.back()` twice — one press too
 * far back through the history.
 */
const leaving = createValueStore(false)

/** Whether the page showing is on its way out, and so takes no touches. */
export function useStageLeaving(): boolean {
  return useValueStore(leaving)
}

/** Whether the page showing covers the whole app: the phone's, a native modal. */
let covering = false

/**
 * Called by the page on mount with its exit, and with null on unmount.
 * `covers` is the phone's page, presented as a modal over everything the
 * shell draws, the overlay host for dialogs included (`stageCovers`).
 */
export function setStageExit(next: Leave | null, covers = false): void {
  leave = next
  covering = next !== null && covers
  // A page arriving, or going, is not a page part-way out of the door.
  leaving.set(false)
}

/** Whether a page is up that covers the whole app, and must go before another is opened. */
export function stageCovers(): boolean {
  return covering
}

export function leaveStage(navigate: () => void): void {
  if (leave === null) {
    navigate()
    return
  }
  if (leaving.get()) return
  leaving.set(true)
  leave(finished => {
    leaving.set(false)
    if (finished) navigate()
  })
}

/**
 * Putting Now Playing away with its exit played — the computer's stage and the
 * phone's own page alike.
 *
 * The page is a route, and the router swaps routes at once: closing it from the
 * player bar or its own chevron cut straight back to the library. The page
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
 */

type Leave = (done: (finished: boolean) => void) => void

let leave: Leave | null = null
/**
 * An exit already playing. The chevron, Escape, the pull and the player bar can
 * all reach `leaveStage` within a frame or two of each other, and without this
 * that started two exits and called `router.back()` twice — one press too far
 * back through the history.
 */
let leaving = false

/** Called by the page on mount with its exit, and with null on unmount. */
export function setStageExit(next: Leave | null): void {
  leave = next
  // A page arriving, or going, is not a page part-way out of the door.
  leaving = false
}

export function leaveStage(navigate: () => void): void {
  if (leave === null) {
    navigate()
    return
  }
  if (leaving) return
  leaving = true
  leave(finished => {
    leaving = false
    if (finished) navigate()
  })
}

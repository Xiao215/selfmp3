/**
 * Putting the desktop Now Playing page away with its exit played.
 *
 * The page is a route, and the router swaps routes at once: closing it from
 * the player bar or its own chevron cut straight back to the library. The
 * page registers how it leaves while it is showing; whoever closes it goes
 * through `leaveStage`, which plays that and then navigates. With no page
 * showing it just navigates.
 */

type Leave = (then: () => void) => void

let leave: Leave | null = null

/** Called by the page on mount with its exit, and with null on unmount. */
export function setStageExit(next: Leave | null): void {
  leave = next
}

export function leaveStage(navigate: () => void): void {
  if (leave) leave(navigate)
  else navigate()
}

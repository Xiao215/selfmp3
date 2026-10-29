/**
 * Previous, play/pause and Next pressed while the player follows a room
 * (docs/features/listen-together.md): a friend's player is the host's, kept
 * in step, so a step taken here alone is undone by the next check. The room
 * says what such a press does instead — asks the host's player, or says only
 * the host may — and the press goes no further.
 *
 * Only presses — `usePlayer()`'s three, and `pressed` where a control holds
 * the bare commands — never the commands themselves, which the room's
 * provider drives the player with.
 */

type TransportStep = 'previous' | 'toggle' | 'next'

/** Takes a press, or answers false to leave it to the player. */
type Taker = (step: TransportStep) => boolean

let taker: Taker | null = null

export function setRoomTransport(next: Taker | null): void {
  taker = next
}

/** Whether the room took this press. */
function roomTakes(step: TransportStep): boolean {
  return taker?.(step) ?? false
}

/** A press of Previous, play/pause or Next: the room's when it takes it, else `run`. */
export function pressed(step: TransportStep, run: () => void): void {
  if (!roomTakes(step)) run()
}

/**
 * Previous, play/pause and Next pressed while the player follows a room
 * (docs/features/listen-together.md): a friend's player is the host's, kept
 * in step, so a step taken here alone is undone by the next check. The room
 * says what such a press does instead — asks the host's player, or says only
 * the host may — and the press goes no further.
 *
 * Only presses: the player's own commands, which the room's provider drives
 * the player with, never come here.
 */

export type TransportStep = 'previous' | 'toggle' | 'next'

/** Takes a press, or answers false to leave it to the player. */
type Taker = (step: TransportStep) => boolean

let taker: Taker | null = null

export function setRoomTransport(next: Taker | null): void {
  taker = next
}

/** Whether the room took this press. */
export function roomTakes(step: TransportStep): boolean {
  return taker?.(step) ?? false
}

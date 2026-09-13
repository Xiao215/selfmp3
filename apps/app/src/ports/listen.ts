import type { ListenAudio } from './listen.types'

/**
 * Listening before importing, on a phone: not yet.
 *
 * The web plays a preview in an audio element of its own, apart from the
 * player's queue. The phone's player is track-player, which has one queue, so a
 * preview needs a second player (`expo-audio`), a new dependency with its own
 * Stack line. Until then the review shows thumbnails without a play button.
 */
export const canListenHere = false

export function createListenAudio(): ListenAudio | null {
  return null
}

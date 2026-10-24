import { createValueStore } from '../../state/valueStore.model'
import { useValueStore } from '../../state/useValueStore'

/**
 * What a room opened from here starts with (Xiao 2026-10-14): where you
 * pressed decides it, so no song is ever in it that you did not see go in.
 *
 * - `playing`: the player's People button — the song playing, at its place.
 * - `songs`: a tag's, a playlist's or an answer's ⋯, or Ask — all of them.
 * - `empty`: Home — nothing yet; you add songs, or ask for them, after.
 */
export type RoomStart =
  | { readonly kind: 'playing' }
  | { readonly kind: 'songs'; readonly name: string; readonly songIds: readonly number[] }
  | { readonly kind: 'empty' }

const PLAYING: RoomStart = { kind: 'playing' }

/**
 * Whether the room's sheet is open (`RoomSheets`): Together — opening a room,
 * or the room once you are in one. Opened from Up next, the room's page and
 * the player; drawn once, by the shell. Adding songs is Search's (A2).
 */
const opened = createValueStore(false)
// Kept while the sheet goes down, so what it says does not change on its way out.
const starting = createValueStore<RoomStart>(PLAYING)

/** Opens the sheet; out of a room, the room it opens starts with `start`. */
export function openRoomSheet(startWith: RoomStart = PLAYING): void {
  starting.set(startWith)
  opened.set(true)
}

export function closeRoomSheet(): void {
  opened.set(false)
}

export function useRoomSheetOpen(): boolean {
  return useValueStore(opened)
}

/** What the room Together would open starts with. */
export function useRoomStart(): RoomStart {
  return useValueStore(starting)
}

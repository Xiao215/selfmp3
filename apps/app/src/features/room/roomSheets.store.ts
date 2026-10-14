import { useSyncExternalStore } from 'react'

/**
 * Which of a room's sheets is open (`RoomSheets`): Together — opening a room,
 * or the room once you are in one — and adding songs. Opened from Up next, the
 * room's page and the player; drawn once, by the shell.
 */
type RoomSheet = 'together' | 'add'

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

let open: RoomSheet | null = null
// Kept while the sheet goes down, so what it says does not change on its way out.
let start: RoomStart = PLAYING
const listeners = new Set<() => void>()

function set(next: RoomSheet | null, nextStart: RoomStart = start): void {
  if (open === next && start === nextStart) return
  open = next
  start = nextStart
  for (const listener of listeners) listener()
}

/** Opens a sheet; Together, out of a room, starts the room with `start`. */
export function openRoomSheet(sheet: RoomSheet, startWith: RoomStart = PLAYING): void {
  set(sheet, startWith)
}

export function closeRoomSheet(): void {
  set(null)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const sheetOf = (): RoomSheet | null => open
const startOf = (): RoomStart => start

export function useRoomSheet(): RoomSheet | null {
  return useSyncExternalStore(subscribe, sheetOf, sheetOf)
}

/** What the room Together would open starts with. */
export function useRoomStart(): RoomStart {
  return useSyncExternalStore(subscribe, startOf, startOf)
}

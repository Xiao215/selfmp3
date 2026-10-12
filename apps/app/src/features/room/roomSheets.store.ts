import { useSyncExternalStore } from 'react'

/**
 * Which of a room's sheets is open (`RoomSheets`): Together's start and
 * invite, adding songs, the people in it. Opened from Up next, the room's
 * page and Now Playing; drawn once, by the shell.
 */
type RoomSheet = 'together' | 'add' | 'people'

let open: RoomSheet | null = null
const listeners = new Set<() => void>()

function set(next: RoomSheet | null): void {
  if (open === next) return
  open = next
  for (const listener of listeners) listener()
}

export function openRoomSheet(sheet: RoomSheet): void {
  set(sheet)
}

export function closeRoomSheet(): void {
  set(null)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = (): RoomSheet | null => open

export function useRoomSheet(): RoomSheet | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

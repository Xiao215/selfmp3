import { useMemo, useState, useSyncExternalStore } from 'react'
import { RoomSongSchema } from '@selfmp3/shared'
import { z } from 'zod'
import { prefs } from '../../ports/prefs'
import type { PastRoom } from './room.model'

/**
 * Rooms this device was in, once they ended: Home's Recently played shows
 * them, and each has a page to save it from or get a friend's song
 * (docs/features/listen-together.md, "After"). Kept on this device, the newest
 * few.
 */

const KEY = 'room.past'
const KEPT = 8

const PastRoomSchema = z.object({
  code: z.string(),
  title: z.string(),
  endedAt: z.number(),
  // A room remembered before faces had pictures has none.
  people: z.array(
    z.object({
      name: z.string(),
      colour: z.number(),
      picture: z.string().nullable().default(null),
    }),
  ),
  shared: z.string().nullable().optional(),
  songs: z.array(
    z.object({
      song: RoomSongSchema,
      by: z.string(),
      colour: z.number(),
      picture: z.string().nullable().default(null),
      mine: z.boolean(),
    }),
  ),
})

function read(): readonly PastRoom[] {
  try {
    const parsed = z.array(PastRoomSchema).safeParse(JSON.parse(prefs.get(KEY) ?? '[]'))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

let rooms: readonly PastRoom[] = read()
const listeners = new Set<() => void>()

export function rememberPastRoom(room: PastRoom): void {
  rooms = [room, ...rooms.filter(other => other.code !== room.code)].slice(0, KEPT)
  prefs.set(KEY, JSON.stringify(rooms))
  for (const listener of listeners) listener()
}

export function forgetPastRoom(code: string): void {
  rooms = rooms.filter(other => other.code !== code)
  prefs.set(KEY, JSON.stringify(rooms))
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = (): readonly PastRoom[] => rooms

export function usePastRooms(): readonly PastRoom[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * You, in a room kept without your picture (one from before faces had them,
 * or a doorman that had not sent it): your own, from your session. Anyone
 * else keeps what the room said.
 */
export function withYourPicture<
  Face extends { readonly name: string; readonly picture: string | null },
>(face: Face, yours: string | null | undefined): Face {
  return face.name === 'You' && face.picture === null && yours ? { ...face, picture: yours } : face
}

/**
 * The key of a past room's song's cover when it was a friend's, lent by the
 * room and kept on this device as it played (RoomProvider); none for yours,
 * which your library draws.
 */
export function lentCoverKey(entry: PastRoom['songs'][number]): string[] {
  return !entry.mine && entry.song.cover ? [entry.song.cover.key] : []
}

/** How long a room stays at the front of Home's Recently played after it ends. */
const RECENT_MS = 3 * 24 * 60 * 60 * 1000

/** The rooms that ended in the last few days, newest first: Home's Recently played. */
export function useRecentRooms(): readonly PastRoom[] {
  const all = usePastRooms()
  const [now] = useState(() => Date.now())
  return useMemo(() => all.filter(room => now - room.endedAt < RECENT_MS), [all, now])
}

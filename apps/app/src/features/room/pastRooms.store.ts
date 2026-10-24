import { useMemo, useState, useSyncExternalStore } from 'react'
import { RoomSongSchema } from '@selfmp3/shared'
import { z } from 'zod'
import { prefs } from '../../ports/prefs'
import { upgradePastRooms, type PastRoom } from './room.model'

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
  people: z.array(
    z.object({ name: z.string(), colour: z.number(), picture: z.string().nullable() }),
  ),
  shared: z.string().nullable(),
  songs: z.array(
    z.object({
      song: RoomSongSchema,
      by: z.string(),
      colour: z.number(),
      picture: z.string().nullable(),
      mine: z.boolean(),
    }),
  ),
})

function read(): readonly PastRoom[] {
  try {
    const stored: unknown = JSON.parse(prefs.get(KEY) ?? '[]')
    const upgraded = upgradePastRooms(stored)
    const parsed = z.array(PastRoomSchema).safeParse(upgraded)
    if (!parsed.success) return []
    if (upgraded !== stored) prefs.set(KEY, JSON.stringify(parsed.data))
    return parsed.data
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

/** Who a room that ended is drawn as: the others who were there, or you when nobody else came. */
export function pastRoomFaces(room: PastRoom): PastRoom['people'] {
  const others = room.people.filter(person => person.name !== 'You')
  return others.length > 0 ? others : room.people
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

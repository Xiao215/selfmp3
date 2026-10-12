import { useSyncExternalStore } from 'react'
import type { Song } from '@selfmp3/shared'

/**
 * Songs that are not in this device's library, as the player plays them
 * (docs/features/listen-together.md, @selfmp3/client's roomTracks.ts): the
 * room this device is in, and a shared playlist played here.
 *
 * Whoever has them fills this as they change; the player reads it beside the
 * library, so a friend's song is a song like any other to the queue, the
 * rows and the lock screen.
 */
export interface RoomTrack {
  readonly song: Song
  /** Where it plays from when it is not yours: the doorman's lent file, or the host's server for a link. */
  readonly stream: { readonly url: string; readonly headers: Record<string, string> | null } | null
  /** Its picture: the lent cover, or a link's own. */
  readonly cover: string | null
  /** The same song in your library, which plays instead when it can. */
  readonly yours: number | null
}

/**
 * Each place songs come from that is not the library, by name: the room
 * (`room`), and a shared playlist being played here (`shared:<id>`).
 */
const sources = new Map<string, ReadonlyMap<number, RoomTrack>>()
let tracks: ReadonlyMap<number, RoomTrack> = new Map()
const listeners = new Set<() => void>()

/** The tracks one place gives, replacing what it gave before; an empty map takes them away. */
export function setTrackSource(source: string, next: ReadonlyMap<number, RoomTrack>): void {
  const before = sources.get(source)
  if (next.size === 0 && !before) return
  if (next.size === 0) sources.delete(source)
  else sources.set(source, next)
  const merged = new Map<number, RoomTrack>()
  for (const given of sources.values()) for (const [id, track] of given) merged.set(id, track)
  tracks = merged
  for (const listener of listeners) listener()
}

/** The room's tracks (features/room's RoomProvider). */
export function setRoomTracks(next: ReadonlyMap<number, RoomTrack>): void {
  setTrackSource('room', next)
}

export function roomTrack(songId: number): RoomTrack | undefined {
  return songId < 0 ? tracks.get(songId) : undefined
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = (): ReadonlyMap<number, RoomTrack> => tracks

/** The room's tracks, for a screen or the player; a new map whenever the room's songs change. */
export function useRoomTracks(): ReadonlyMap<number, RoomTrack> {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

const mergedCache = new WeakMap<
  ReadonlyMap<number, Song>,
  { tracks: ReadonlyMap<number, RoomTrack>; songs: ReadonlyMap<number, Song> }
>()

/** The library and the room's songs in one map, built once per pair. */
export function withRoomSongs(
  library: ReadonlyMap<number, Song>,
  room: ReadonlyMap<number, RoomTrack>,
): ReadonlyMap<number, Song> {
  if (room.size === 0) return library
  const cached = mergedCache.get(library)
  if (cached?.tracks === room) return cached.songs
  const songs = new Map(library)
  for (const [id, track] of room) songs.set(id, track.song)
  mergedCache.set(library, { tracks: room, songs })
  return songs
}

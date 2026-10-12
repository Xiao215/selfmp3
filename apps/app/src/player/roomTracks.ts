import { useSyncExternalStore } from 'react'
import type { Song } from '@selfmp3/shared'

/**
 * The songs of the room this device is in, as the player plays them
 * (docs/features/listen-together.md, @selfmp3/client's roomTracks.ts).
 *
 * The room's provider fills this whenever the room changes; the player reads
 * it beside the library, so a friend's song is a song like any other to the
 * queue, the rows and the lock screen. Empty outside a room.
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

let tracks: ReadonlyMap<number, RoomTrack> = new Map()
const listeners = new Set<() => void>()

export function setRoomTracks(next: ReadonlyMap<number, RoomTrack>): void {
  if (next.size === 0 && tracks.size === 0) return
  tracks = next
  for (const listener of listeners) listener()
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

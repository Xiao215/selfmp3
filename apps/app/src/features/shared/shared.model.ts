import type { SharedEntry, SharedMember, SharedPlaylist } from '@selfmp3/shared'
import { roomTrackId, roomTrackSong, yoursOf, type LibraryIndex } from '@selfmp3/client'
import type { RoomTrack } from '../../player/roomTracks'

/**
 * A shared playlist as this device shows and plays it
 * (docs/features/listen-together.md, "Shared playlists").
 */

interface SharedRow {
  readonly entry: SharedEntry
  readonly trackId: number
  readonly owner: SharedMember | undefined
  /** Yours, or anyone's when you made the playlist. */
  readonly removable: boolean
  /** Whose song it is, as its face and name, as a room's row says it. */
  readonly face: { readonly name: string; readonly colour: number } | null
  /** "You", their name, or "Someone" for an owner who has left. */
  readonly who: string
}

export function sharedRows(playlist: SharedPlaylist): SharedRow[] {
  const members = new Map(playlist.members.map(member => [member.id, member]))
  const creator = members.get(playlist.you)?.creator ?? false
  return playlist.entries.map(entry => {
    const owner = members.get(entry.owner)
    return {
      entry,
      trackId: roomTrackId(entry.id),
      owner,
      removable: creator || entry.owner === playlist.you,
      face: owner ? { name: owner.name, colour: owner.colour } : null,
      who: !owner ? 'Someone' : owner.id === playlist.you ? 'You' : owner.name,
    }
  })
}

/** Its songs as tracks the player can play here: from your own copy when you have one. */
export function sharedTracks(
  playlist: SharedPlaylist,
  file: (entryId: string, part: 'audio' | 'cover') => string,
  library: LibraryIndex,
): Map<number, RoomTrack> {
  const tracks = new Map<number, RoomTrack>()
  for (const entry of playlist.entries) {
    tracks.set(roomTrackId(entry.id), {
      song: roomTrackSong(entry),
      stream: entry.song.audio ? { url: file(entry.id, 'audio'), headers: null } : null,
      cover: entry.song.cover ? file(entry.id, 'cover') : null,
      yours: yoursOf(entry.song, library),
    })
  }
  return tracks
}

/** "Xiao, Mia and Ken · 23 songs". */
export function sharedLine(
  playlist: Pick<SharedPlaylist, 'members' | 'entries'>,
  you: string,
): string {
  const names = playlist.members.map(member => (member.id === you ? 'You' : member.name))
  const people =
    names.length <= 1
      ? (names[0] ?? 'Nobody')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const songs = playlist.entries.length
  return `${people} · ${songs} ${songs === 1 ? 'song' : 'songs'}`
}

/** Your name in a playlist, to join it with: the first of your account's name. */
export function nameToJoinWith(
  me: { name: string | null; email: string } | null | undefined,
): string {
  if (!me) return 'Me'
  const first = (me.name ?? '').trim().split(/\s+/)[0]
  return (first || me.email.split('@')[0] || 'Me').slice(0, 40)
}

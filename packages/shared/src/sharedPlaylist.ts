import { assertNever } from './exhaustive.js'
import type { RoomRefusal } from './room.js'
import type { RoomSong } from './schemas/room.js'
import {
  SHARED_MAX_ENTRIES,
  SHARED_MAX_MEMBERS,
  type SharedAction,
  type SharedDoc,
  type SharedEntry,
  type SharedMember,
  type SharedSummary,
} from './schemas/shared.js'

/**
 * A shared playlist's rules (docs/features/listen-together.md, "Shared
 * playlists"), the same on the doorman that keeps it and on every device that
 * draws it. Pure, like a room's (room.ts), and refusing the same way.
 */

function refuse(refused: RoomRefusal['refused'], message: string): RoomRefusal {
  return { refused, message }
}

export function newSharedDoc(input: {
  id: string
  name: string
  creator: { id: string; name: string; picture: string | null }
  songs: readonly { id: string; song: RoomSong }[]
  now: number
}): SharedDoc {
  return {
    id: input.id,
    name: input.name,
    createdAt: input.now,
    updatedAt: input.now,
    members: [
      {
        id: input.creator.id,
        name: input.creator.name,
        colour: 0,
        picture: input.creator.picture,
        joinedAt: input.now,
        creator: true,
      },
    ],
    entries: input.songs
      .slice(0, SHARED_MAX_ENTRIES)
      .map(({ id, song }) => ({ id, song, owner: input.creator.id, addedAt: input.now })),
  }
}

/** Someone new, with the first face colour nobody in it has. */
export function addSharedMember(
  doc: SharedDoc,
  member: { id: string; name: string; picture: string | null },
  now: number,
): SharedDoc | RoomRefusal {
  if (doc.members.length >= SHARED_MAX_MEMBERS) return refuse('full', 'this playlist is full')
  const taken = new Set(doc.members.map(other => other.colour))
  let colour = 0
  while (colour < 7 && taken.has(colour)) colour++
  const joined: SharedMember = { ...member, colour, joinedAt: now, creator: false }
  return { ...doc, members: [...doc.members, joined], updatedAt: now }
}

/** The playlist after one person's action, or why not. Never changes `doc`. */
export function applySharedAction(
  doc: SharedDoc,
  memberId: string,
  action: SharedAction,
  now: number,
  newId: () => string,
): SharedDoc | RoomRefusal {
  const member = doc.members.find(candidate => candidate.id === memberId)
  if (!member) return refuse('forbidden', 'you are not in this playlist')
  const touched = { ...doc, updatedAt: now }
  switch (action.type) {
    case 'add': {
      if (!action.song.audio || action.song.link) {
        return refuse('invalid', 'a song of yours has its audio in your bucket')
      }
      if (doc.entries.length >= SHARED_MAX_ENTRIES) return refuse('full', 'this playlist is full')
      const key = action.song.audio.key
      if (doc.entries.some(entry => entry.song.audio?.key === key)) {
        return refuse('invalid', 'that song is in this playlist already')
      }
      const entry: SharedEntry = { id: newId(), song: action.song, owner: memberId, addedAt: now }
      return { ...touched, entries: [...doc.entries, entry] }
    }
    case 'remove': {
      const entry = doc.entries.find(candidate => candidate.id === action.entryId)
      if (!entry) return refuse('missing', 'that song is not in the playlist')
      if (entry.owner !== memberId && !member.creator) {
        return refuse('forbidden', 'only whoever made it can take out someone else’s song')
      }
      return { ...touched, entries: doc.entries.filter(other => other.id !== entry.id) }
    }
    case 'move': {
      const entry = doc.entries.find(candidate => candidate.id === action.entryId)
      if (!entry) return refuse('missing', 'that song is not in the playlist')
      const rest = doc.entries.filter(other => other.id !== entry.id)
      rest.splice(Math.min(action.to, rest.length), 0, entry)
      return { ...touched, entries: rest }
    }
    case 'rename':
      if (!member.creator) return refuse('forbidden', 'only whoever made it can rename it')
      return { ...touched, name: action.name }
    case 'leave': {
      // Their songs go with them: nobody can lend them any more. Whoever made
      // it leaving hands that on to whoever joined next.
      const members = doc.members.filter(other => other.id !== memberId)
      const heir = member.creator ? members[0] : undefined
      return {
        ...touched,
        members: members.map(other =>
          other.id === heir?.id ? { ...other, creator: true } : other,
        ),
        entries: doc.entries.filter(entry => entry.owner !== memberId),
      }
    }
    default:
      return assertNever(action)
  }
}

export function sharedSummary(doc: SharedDoc): SharedSummary {
  return {
    id: doc.id,
    name: doc.name,
    people: doc.members.map(member => ({
      name: member.name,
      colour: member.colour,
      picture: member.picture,
    })),
    songs: doc.entries.length,
    updatedAt: doc.updatedAt,
  }
}

/** Whether a person may read an entry's files: they are in it, and so is the song. */
export function canReadSharedEntry(
  doc: SharedDoc,
  memberId: string,
  entryId: string,
): SharedEntry | null {
  if (!doc.members.some(member => member.id === memberId)) return null
  return doc.entries.find(entry => entry.id === entryId) ?? null
}

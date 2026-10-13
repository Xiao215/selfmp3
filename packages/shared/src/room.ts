import { assertNever } from './exhaustive.js'
import type {
  RoomAction,
  RoomDoc,
  RoomEntry,
  RoomMember,
  RoomMemberKind,
  RoomMode,
  RoomPlaying,
  RoomRights,
  RoomSong,
  RoomState,
} from './schemas/room.js'

/**
 * A room's rules, the same on the doorman that keeps it and on every device
 * that draws it (docs/features/listen-together.md). Pure: the doorman applies
 * an action here and saves what comes back; the app works out what to show
 * and what to offer from the same functions.
 */

/** People in a room at once, counting those who left. */
export const ROOM_MAX_MEMBERS = 32
/** Songs waiting at once. */
export const ROOM_MAX_WAITING = 300
/** Songs that played, kept for the list's Played part and Recently played. */
export const ROOM_MAX_PLAYED = 200
/** A room nobody has touched for this long ends by itself. */
export const ROOM_IDLE_MS = 2 * 60 * 60 * 1000

export function newRoomDoc(input: {
  code: string
  host: { id: string; name: string; picture: string | null }
  mode: RoomMode
  rights: RoomRights
  keepGoing: boolean
  now: number
}): RoomDoc {
  return {
    code: input.code,
    createdAt: input.now,
    mode: input.mode,
    rights: input.rights,
    keepGoing: input.keepGoing,
    members: [
      {
        id: input.host.id,
        name: input.host.name,
        kind: 'host',
        colour: 0,
        picture: input.host.picture,
        joinedAt: input.now,
        online: false,
        left: false,
      },
    ],
    entries: [],
    shelves: [],
    playing: null,
    want: null,
    endedAt: null,
    linkRelay: false,
    activeAt: input.now,
  }
}

export function roomHost(doc: Pick<RoomDoc, 'members'>): RoomMember | undefined {
  return doc.members.find(member => member.kind === 'host')
}

/** The room's name: whose it is. */
export function roomTitle(doc: Pick<RoomDoc, 'members'>): string {
  const host = roomHost(doc)
  return host ? `${host.name}'s room` : 'A room'
}

/** A new member, with the first face colour nobody here has. */
export function addRoomMember(
  doc: RoomDoc,
  member: {
    id: string
    name: string
    kind: Exclude<RoomMemberKind, 'host'>
    picture: string | null
  },
  now: number,
): RoomDoc | RoomRefusal {
  if (doc.endedAt !== null) return refuse('ended', 'this room has ended')
  if (doc.members.length >= ROOM_MAX_MEMBERS) return refuse('full', 'this room is full')
  const taken = new Set(doc.members.filter(other => !other.left).map(other => other.colour))
  let colour = 0
  while (colour < 7 && taken.has(colour)) colour++
  return {
    ...doc,
    members: [...doc.members, { ...member, colour, joinedAt: now, online: false, left: false }],
    activeAt: now,
  }
}

/** Entries that are neither playing nor played, in the order they were added. */
export function waitingEntries(doc: Pick<RoomDoc, 'entries' | 'playing'>): RoomEntry[] {
  return doc.entries.filter(entry => entry.playedAt === null && entry.id !== doc.playing?.entryId)
}

/** Entries that played, the latest first. */
export function playedEntries(doc: Pick<RoomDoc, 'entries'>): RoomEntry[] {
  return doc.entries
    .filter(entry => entry.playedAt !== null)
    .sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0))
}

/**
 * The order the waiting songs will play in: taking turns.
 *
 * Each person's songs wait behind their own, in the order they added them,
 * and the list deals one from each person in turn. Whose turn comes first is
 * whoever has waited longest for one of theirs to play: someone whose song is
 * playing or just played goes to the back, and someone who has had nothing
 * play yet goes first, earliest to join first. So twenty songs from one friend
 * do not push another's one to the end.
 *
 * A song the host moved (`at`) leaves the turns: the rest are dealt, then each
 * moved song goes in at the place it was put, nearest the top first.
 */
export function roomOrder(doc: Pick<RoomDoc, 'entries' | 'playing' | 'members'>): string[] {
  const waiting = waitingEntries(doc)
  const lastTurn = new Map<string, number>()
  for (const entry of doc.entries) {
    const when =
      entry.id === doc.playing?.entryId ? Number.POSITIVE_INFINITY : (entry.playedAt ?? -1)
    if (when >= 0) lastTurn.set(entry.addedBy, Math.max(lastTurn.get(entry.addedBy) ?? -1, when))
  }
  const joined = new Map(doc.members.map(member => [member.id, member.joinedAt]))

  const queues = new Map<string, RoomEntry[]>()
  for (const entry of waiting) {
    if (entry.at !== null) continue
    const queue = queues.get(entry.addedBy) ?? []
    queue.push(entry)
    queues.set(entry.addedBy, queue)
  }
  const people = [...queues.keys()].sort(
    (a, b) =>
      (lastTurn.get(a) ?? -1) - (lastTurn.get(b) ?? -1) ||
      (joined.get(a) ?? 0) - (joined.get(b) ?? 0),
  )

  const dealt: string[] = []
  for (let round = 0; dealt.length < waiting.length; round++) {
    let any = false
    for (const person of people) {
      const entry = queues.get(person)?.[round]
      if (entry) {
        dealt.push(entry.id)
        any = true
      }
    }
    if (!any) break
  }

  const moved = waiting
    .filter(entry => entry.at !== null)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.addedAt - b.addedAt)
  for (const entry of moved) dealt.splice(Math.min(entry.at ?? 0, dealt.length), 0, entry.id)
  return dealt
}

/** Seconds into the playing song at `serverNow`, on the doorman's clock. */
export function roomPosition(playing: RoomPlaying | null, serverNow: number): number {
  if (!playing) return 0
  if (playing.pausedAt !== null) return playing.pausedAt
  return Math.max(0, (serverNow - playing.startedAt) / 1000)
}

export interface RoomRefusal {
  readonly refused: 'forbidden' | 'missing' | 'full' | 'ended' | 'invalid'
  readonly message: string
}

function refuse(refused: RoomRefusal['refused'], message: string): RoomRefusal {
  return { refused, message }
}

export function isRoomRefusal<T extends object>(value: T | RoomRefusal): value is RoomRefusal {
  return 'refused' in value
}

/**
 * Whether this member may do this, by kind and by the room's rights. The
 * host may do everything; nobody may do anything once they left or the room
 * ended. Whether the thing is there to do (the entry exists) is the
 * reducer's to say.
 */
export function canAct(doc: RoomDoc, member: RoomMember, type: RoomAction['type']): boolean {
  if (doc.endedAt !== null || member.left) return false
  const host = member.kind === 'host'
  switch (type) {
    case 'leave':
      return true
    case 'add':
      return member.kind !== 'guest' && (host || doc.rights.add)
    case 'again':
    case 'fromShelf':
      return host || doc.rights.add
    case 'addLink':
      return host || (doc.rights.add && doc.rights.links)
    case 'skip':
      return host || doc.rights.skip
    case 'pause':
    case 'play':
      return host || doc.rights.pause
    case 'shelf':
      return member.kind !== 'guest'
    case 'remove':
      // Whose entry it is is checked with the entry in hand.
      return true
    case 'move':
    case 'report':
    case 'settings':
    case 'kick':
    case 'end':
      return host
    default:
      return assertNever(type)
  }
}

/**
 * The room after one member's action, or why not. `newId` names a new entry;
 * `now` is the doorman's clock. Never changes `doc`.
 */
export function applyRoomAction(
  doc: RoomDoc,
  memberId: string,
  action: RoomAction,
  now: number,
  newId: () => string,
): RoomDoc | RoomRefusal {
  const member = doc.members.find(candidate => candidate.id === memberId)
  if (!member) return refuse('forbidden', 'you are not in this room')
  if (doc.endedAt !== null) return refuse('ended', 'this room has ended')
  if (!canAct(doc, member, action.type)) {
    return refuse('forbidden', member.left ? 'you left this room' : 'the host has not allowed that')
  }
  const touched = { ...doc, activeAt: now }
  const entryById = (id: string): RoomEntry | undefined =>
    doc.entries.find(entry => entry.id === id)

  const add = (song: RoomSong, owner: string | null): RoomDoc | RoomRefusal => {
    if (waitingEntries(doc).length >= ROOM_MAX_WAITING) {
      return refuse('full', 'the list is full; let some play first')
    }
    const entry: RoomEntry = {
      id: newId(),
      song,
      addedBy: memberId,
      owner,
      from: null,
      fromPicture: null,
      addedAt: now,
      at: null,
      playedAt: null,
    }
    return { ...touched, entries: [...doc.entries, entry] }
  }

  switch (action.type) {
    case 'add':
      if (!action.song.audio || action.song.link) {
        return refuse('invalid', 'a song from your library has its audio in your bucket')
      }
      return add(action.song, memberId)
    case 'addLink':
      if (action.song.audio || !action.song.link) {
        return refuse('invalid', 'a link plays from its address')
      }
      return add({ ...action.song, cover: null, lyrics: null, uid: null }, null)
    case 'again': {
      const entry = entryById(action.entryId)
      if (!entry) return refuse('missing', 'that song is not in the room')
      return add(entry.song, entry.owner)
    }
    case 'fromShelf': {
      const shelf = doc.shelves.find(candidate => candidate.member === action.member)
      const song = shelf?.songs[action.index]
      if (!shelf || !song) return refuse('missing', 'that song is not on the shelf')
      return add(song, shelf.member)
    }
    case 'remove': {
      const entry = entryById(action.entryId)
      if (!entry || entry.playedAt !== null || entry.id === doc.playing?.entryId) {
        return refuse('missing', 'that song is not waiting')
      }
      if (entry.addedBy !== memberId && member.kind !== 'host') {
        return refuse('forbidden', 'only the host can take out someone else’s song')
      }
      return { ...touched, entries: doc.entries.filter(other => other.id !== entry.id) }
    }
    case 'move': {
      const entry = entryById(action.entryId)
      if (!entry || entry.playedAt !== null || entry.id === doc.playing?.entryId) {
        return refuse('missing', 'that song is not waiting')
      }
      // The other moved songs keep the places they were put in, so each is
      // pinned to where it stands now before this one moves among them.
      const order = roomOrder(doc).filter(id => id !== entry.id)
      order.splice(Math.min(action.to, order.length), 0, entry.id)
      const place = new Map(order.map((id, index) => [id, index]))
      return {
        ...touched,
        entries: doc.entries.map(other =>
          other.id === entry.id || (other.at !== null && place.has(other.id))
            ? { ...other, at: place.get(other.id) ?? other.at }
            : other,
        ),
      }
    }
    case 'skip':
    case 'pause':
    case 'play':
      return {
        ...touched,
        want: { seq: (doc.want?.seq ?? 0) + 1, kind: action.type, by: memberId },
      }
    case 'report': {
      const startedAt = now - action.position * 1000
      const pausedAt = action.playing ? null : action.position
      if (action.entryId === doc.playing?.entryId) {
        if (!doc.playing) return touched
        return { ...touched, playing: { ...doc.playing, startedAt, pausedAt } }
      }
      const next = action.entryId === null ? undefined : entryById(action.entryId)
      if (action.entryId !== null && !next) return refuse('missing', 'that song is not in the room')
      const entries = doc.entries.map(entry => {
        if (entry.id === doc.playing?.entryId) return { ...entry, playedAt: now }
        if (entry.id === next?.id) return { ...entry, at: null, playedAt: null }
        return entry
      })
      return {
        ...touched,
        entries: trimPlayed(entries),
        playing: next ? { entryId: next.id, startedAt, pausedAt } : null,
      }
    }
    case 'settings':
      return {
        ...touched,
        rights: action.rights ?? doc.rights,
        keepGoing: action.keepGoing ?? doc.keepGoing,
        mode: action.mode ?? doc.mode,
      }
    case 'shelf': {
      const others = doc.shelves.filter(shelf => shelf.member !== memberId)
      return {
        ...touched,
        shelves: action.shelf ? [...others, { ...action.shelf, member: memberId }] : others,
      }
    }
    case 'kick': {
      const target = doc.members.find(candidate => candidate.id === action.member)
      if (!target || target.kind === 'host') return refuse('missing', 'nobody like that to remove')
      // Someone asked to leave takes their waiting songs with them; someone
      // who left by themselves leaves theirs to play (`leave`).
      return {
        ...touched,
        members: doc.members.map(other =>
          other.id === target.id ? { ...other, left: true, online: false } : other,
        ),
        entries: doc.entries.filter(
          entry =>
            !(
              entry.addedBy === target.id &&
              entry.playedAt === null &&
              entry.id !== doc.playing?.entryId
            ),
        ),
        shelves: doc.shelves.filter(shelf => shelf.member !== target.id),
      }
    }
    case 'leave':
      if (member.kind === 'host') return { ...touched, endedAt: now }
      return {
        ...touched,
        members: doc.members.map(other =>
          other.id === memberId ? { ...other, left: true, online: false } : other,
        ),
        shelves: doc.shelves.filter(shelf => shelf.member !== memberId),
      }
    case 'end':
      return { ...touched, endedAt: now }
    default:
      return assertNever(action)
  }
}

/** Played entries past the cap go, oldest first; nothing waiting ever does. */
function trimPlayed(entries: RoomEntry[]): RoomEntry[] {
  const played = entries.filter(entry => entry.playedAt !== null)
  if (played.length <= ROOM_MAX_PLAYED) return entries
  const keep = new Set(
    played
      .sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0))
      .slice(0, ROOM_MAX_PLAYED)
      .map(entry => entry.id),
  )
  return entries.filter(entry => entry.playedAt === null || keep.has(entry.id))
}

/** The room as one member is sent it. */
export function roomStateFor(doc: RoomDoc, memberId: string, serverTime: number): RoomState {
  return { ...doc, order: roomOrder(doc), you: memberId, serverTime }
}

/**
 * Whether a member may still read an entry's files: the room is open, they
 * are in it, and the entry is in the list (waiting, playing or played).
 */
export function canReadEntry(doc: RoomDoc, memberId: string, entryId: string): RoomEntry | null {
  if (doc.endedAt !== null) return null
  const member = doc.members.find(candidate => candidate.id === memberId)
  if (!member || member.left) return null
  return doc.entries.find(entry => entry.id === entryId) ?? null
}

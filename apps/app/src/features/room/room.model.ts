import {
  canAct,
  playedEntries,
  roomPosition,
  roomTitle,
  type RoomAction,
  type RoomEntry,
  type RoomMember,
  type RoomSong,
  type RoomState,
} from '@selfmp3/shared'
import { roomTrackId, roomTrackSong, yoursOf, type LibraryIndex } from '@selfmp3/client'
import type { RoomTrack } from '../../player/roomTracks'

/**
 * What a device makes of the room it is in (docs/features/listen-together.md):
 * the rows Up next draws, the tracks the player plays, and what the host's
 * player should do when the room changes. The room's own rules are
 * packages/shared's room.ts; this is the device's side of them.
 */

// --- people ---------------------------------------------------------------------

export function memberOf(state: RoomState, id: string | null): RoomMember | undefined {
  return id === null ? undefined : state.members.find(member => member.id === id)
}

function youOf(state: RoomState): RoomMember | undefined {
  return memberOf(state, state.you)
}

export function isHost(state: RoomState): boolean {
  return youOf(state)?.kind === 'host'
}

/** May you do this, here, now. */
export function youMay(state: RoomState, type: RoomAction['type']): boolean {
  const you = youOf(state)
  return you !== undefined && canAct(state, you, type)
}

/** The people still in the room, the host first. */
export function peopleHere(state: RoomState): RoomMember[] {
  return state.members.filter(member => !member.left)
}

/** A face's letter: the first of the name, as a person would write it. */
export function initialOf(name: string): string {
  const first = [...name.trim()][0] ?? '?'
  return first.toLocaleUpperCase()
}

/** "Mia" for someone else, "You" for you. */
export function nameOf(state: RoomState, member: RoomMember | undefined): string {
  if (!member) return 'Someone'
  return member.id === state.you ? 'You' : member.name
}

/** The line under the room's name: who is here, and where it plays. */
export function roomLine(state: RoomState): string {
  const here = peopleHere(state).length
  const host = state.members.find(member => member.kind === 'host')
  const where =
    state.mode === 'everyone'
      ? 'plays on everyone’s'
      : host?.id === state.you
        ? 'plays here'
        : `plays on ${host?.name ?? 'the host'}’s`
  return `${here} here · ${where}`
}

export { roomTitle }

// --- rows -----------------------------------------------------------------------

export interface RoomRow {
  readonly entry: RoomEntry
  /** The player's id for it. */
  readonly trackId: number
  readonly by: RoomMember | undefined
  /** Whose bucket it plays from; undefined for a link. */
  readonly owner: RoomMember | undefined
  /** You may take it out: yours, or you are the host. */
  readonly removable: boolean
}

function rowOf(state: RoomState, entry: RoomEntry): RoomRow {
  const host = isHost(state)
  return {
    entry,
    trackId: roomTrackId(entry.id),
    by: memberOf(state, entry.addedBy),
    owner: memberOf(state, entry.owner),
    removable: entry.playedAt === null && (host || entry.addedBy === state.you),
  }
}

export function playingRow(state: RoomState): RoomRow | null {
  const id = state.playing?.entryId
  const entry = id ? state.entries.find(candidate => candidate.id === id) : undefined
  return entry ? rowOf(state, entry) : null
}

/** What is still to play, in the order it will. */
export function upcomingRows(state: RoomState): RoomRow[] {
  const byId = new Map(state.entries.map(entry => [entry.id, entry]))
  return state.order.flatMap(id => {
    const entry = byId.get(id)
    return entry ? [rowOf(state, entry)] : []
  })
}

/** What played, the latest first. */
export function playedRows(state: RoomState): RoomRow[] {
  return playedEntries(state).map(entry => rowOf(state, entry))
}

/** Seconds into the playing song now, on this device's clock. */
export function positionNow(state: RoomState, offset: number, now: number): number {
  return roomPosition(state.playing, now + offset)
}

// --- tracks ---------------------------------------------------------------------

interface TrackSources {
  /** A lent file's address. */
  readonly file: (entryId: string, part: 'audio' | 'cover') => string
  /** A link's stream through the host's server, or null where there is none to reach. */
  readonly link: (url: string) => string | null
  readonly library: LibraryIndex
}

/** Every song the room has, as the player plays it (player/roomTracks.ts). */
export function roomTracks(state: RoomState, sources: TrackSources): Map<number, RoomTrack> {
  const tracks = new Map<number, RoomTrack>()
  for (const entry of state.entries) {
    const song = entry.song
    const linkStream = song.link ? sources.link(song.link) : null
    tracks.set(roomTrackId(entry.id), {
      song: roomTrackSong(entry),
      stream: song.audio
        ? { url: sources.file(entry.id, 'audio'), headers: null }
        : linkStream
          ? { url: linkStream, headers: null }
          : null,
      cover: song.cover ? sources.file(entry.id, 'cover') : song.artwork,
      yours: yoursOf(song, sources.library),
    })
  }
  return tracks
}

// --- the host's player ------------------------------------------------------------

/**
 * What the host's player should do about the room as it now is.
 *
 * - `start`: nothing of the room is playing and the player is free, and the
 *   room has songs waiting: play them, from the first.
 * - `follow`: the player is on the room's song: keep what comes after it the
 *   room's list.
 * - `advance`: the player ran out on the room's last song, and a song has
 *   been added since: go on to it.
 * - `none`: the player is busy with something of your own, or there is
 *   nothing to play.
 */
type HostPlan =
  | { readonly kind: 'start'; readonly ids: readonly number[] }
  | { readonly kind: 'follow'; readonly upcoming: readonly number[] }
  | { readonly kind: 'advance'; readonly upcoming: readonly number[] }
  | { readonly kind: 'none' }

export function hostPlan(
  state: RoomState,
  player: {
    readonly currentId: number | null
    readonly playing: boolean
    /** The player stopped because its list ran out. */
    readonly ranOut: boolean
  },
): HostPlan {
  const upcoming = state.order.map(roomTrackId)
  const onRoomSong =
    player.currentId !== null &&
    state.entries.some(entry => roomTrackId(entry.id) === player.currentId)
  if (onRoomSong) {
    return player.ranOut && upcoming.length > 0
      ? { kind: 'advance', upcoming }
      : { kind: 'follow', upcoming }
  }
  if (state.playing === null && !player.playing && upcoming.length > 0) {
    return { kind: 'start', ids: upcoming }
  }
  return { kind: 'none' }
}

/** The room's entry a player's song is, or null for a song of the device's own. */
export function entryOfTrack(state: RoomState, trackId: number | null): string | null {
  if (trackId === null) return null
  return state.entries.find(entry => roomTrackId(entry.id) === trackId)?.id ?? null
}

/**
 * Whether what the host's player is doing differs from what the room says
 * enough to tell it: another song, playing against paused, or a jump in
 * position (a seek) of more than a couple of seconds.
 */
export function needsReport(
  state: RoomState,
  offset: number,
  now: number,
  player: { readonly entryId: string | null; readonly playing: boolean; readonly position: number },
): boolean {
  const playing = state.playing
  if ((playing?.entryId ?? null) !== player.entryId) return true
  if (!playing) return false
  if ((playing.pausedAt === null) !== player.playing) return true
  return Math.abs(roomPosition(playing, now + offset) - player.position) > 2
}

/** A request from a member the host's player has not acted on yet. */
export function freshWant(state: RoomState, lastSeq: number): RoomState['want'] {
  return state.want && state.want.seq > lastSeq ? state.want : null
}

// --- keep it going ------------------------------------------------------------------

/**
 * Songs to add when the list runs low, taking turns between the people whose
 * songs are in the room: from shelves, and songs that played, leaving out the
 * last few to play so nothing comes straight back. As actions the host sends.
 */
export function keepGoingPicks(
  state: RoomState,
  count: number,
  random = Math.random,
): RoomAction[] {
  const recent = new Set(
    playedEntries(state)
      .slice(0, 12)
      .map(entry => keyOf(entry.song)),
  )
  const waiting = new Set(
    state.entries.filter(entry => entry.playedAt === null).map(entry => keyOf(entry.song)),
  )
  const byPerson = new Map<string, RoomAction[]>()
  const offer = (person: string, song: RoomSong, action: RoomAction): void => {
    const key = keyOf(song)
    if (recent.has(key) || waiting.has(key)) return
    const list = byPerson.get(person) ?? []
    list.push(action)
    byPerson.set(person, list)
  }
  for (const shelf of state.shelves) {
    shelf.songs.forEach((song, index) =>
      offer(shelf.member, song, { type: 'fromShelf', member: shelf.member, index }),
    )
  }
  const seen = new Set<string>()
  for (const entry of playedEntries(state)) {
    const key = keyOf(entry.song)
    if (seen.has(key)) continue
    seen.add(key)
    offer(entry.owner ?? entry.addedBy, entry.song, { type: 'again', entryId: entry.id })
  }

  const queues = [...byPerson.values()].map(list => shuffled(list, random))
  const picks: RoomAction[] = []
  for (let round = 0; picks.length < count; round++) {
    let any = false
    for (const queue of queues) {
      const pick = queue[round]
      if (pick && picks.length < count) {
        picks.push(pick)
        any = true
      }
    }
    if (!any) break
  }
  return picks
}

function keyOf(song: RoomSong): string {
  return song.audio?.key ?? song.link ?? song.title
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items]
  for (let index = out.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1))
    const held = out[index]
    const swapped = out[other]
    if (held === undefined || swapped === undefined) continue
    out[index] = swapped
    out[other] = held
  }
  return out
}

// --- after ----------------------------------------------------------------------

/** A room that ended, as Recently played keeps it. */
export interface PastRoom {
  readonly code: string
  readonly title: string
  readonly endedAt: number
  readonly people: readonly { readonly name: string; readonly colour: number }[]
  readonly songs: readonly {
    readonly song: RoomSong
    readonly by: string
    readonly colour: number
    /** Brought by you, from your own library. */
    readonly mine: boolean
  }[]
}

/** What is worth remembering of a room: the songs that played, oldest first, and who was there. */
export function pastRoomOf(state: RoomState, now: number): PastRoom | null {
  const played = [...playedRows(state)].reverse()
  const playing = playingRow(state)
  const rows = playing ? [...played, playing] : played
  if (rows.length === 0) return null
  return {
    code: state.code,
    title: pastTitle(state),
    endedAt: state.endedAt ?? now,
    people: state.members.map(member => ({ name: nameOf(state, member), colour: member.colour })),
    songs: rows.map(row => ({
      song: row.entry.song,
      by: nameOf(state, row.by),
      colour: row.by?.colour ?? 0,
      mine: row.entry.owner === state.you,
    })),
  }
}

/** "With Mia, Ken and Ana": the others who were there. */
export function pastTitle(state: RoomState): string {
  const others = state.members.filter(member => member.id !== state.you).map(member => member.name)
  if (others.length === 0) return roomTitle(state)
  if (others.length === 1) return `With ${others[0]}`
  return `With ${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}`
}

/** The room's invite link: opens the join page, in the app or a browser. */
export function inviteLink(appUrl: string, code: string): string {
  return `${appUrl.replace(/\/+$/, '')}/join/${code}`
}

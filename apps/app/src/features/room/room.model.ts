import {
  canAct,
  playedEntries,
  plural,
  ROOM_MAX_WAITING,
  roomPosition,
  roomTitle,
  soundCentre,
  type RoomAction,
  type RoomEntry,
  type RoomMember,
  type RoomSong,
  type RoomState,
  shuffleArray,
} from '@selfmp3/shared'
import { roomTrackId, roomTrackSong, yoursOf, type LibraryIndex } from '@selfmp3/client'
import type { RoomTrack } from '../../player/roomTracks'
import type { RoomStart } from './roomSheets.store'

/**
 * What a device makes of the room it is in (docs/features/listen-together.md):
 * the rows Up next draws, the tracks the player plays, and what the host's
 * player should do when the room changes. The room's own rules are
 * packages/shared's room.ts; this is the device's side of them.
 */

/**
 * The name a guest last gave, offered again: by a room's Join, and by a
 * share link's page, which asks for the same name.
 */
export const GUEST_NAME_KEY = 'room.name'

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

/**
 * What a press of Previous, play/pause or Next on a player that follows the
 * room does (player/roomTransport.ts): the room action it asks for, or what
 * to say when it may not. Null leaves the press to the player: you host the
 * room, it plays on one speaker, or your player is not on the room's song.
 */
export function followerPress(
  state: RoomState,
  step: 'previous' | 'toggle' | 'next',
  onRoomSong: boolean,
): { readonly act: 'skip' | 'pause' | 'play' } | { readonly say: string } | null {
  if (isHost(state) || state.mode !== 'everyone' || !onRoomSong) return null
  const host = state.members.find(member => member.kind === 'host')?.name ?? 'the host'
  if (step === 'previous') return { say: 'A room only goes forward' }
  if (step === 'next') return youMay(state, 'skip') ? { act: 'skip' } : { say: `Only ${host} can skip` }
  const act = state.playing && state.playing.pausedAt === null ? 'pause' : 'play'
  return youMay(state, act) ? { act } : { say: `Only ${host} can ${act === 'pause' ? 'pause' : 'play'} the room` }
}

/** The people still in the room, the host first. */
export function peopleHere(state: RoomState): RoomMember[] {
  return state.members.filter(member => !member.left)
}

/**
 * Who came into the room since `seen` (the ids here before), leaving you out:
 * the friend whose face springs in, with a tap on the phone (M2). Nobody, the
 * first time a room is seen, since everyone in it was already there.
 */
export function arrivals(seen: ReadonlySet<string> | null, state: RoomState): RoomMember[] {
  if (seen === null) return []
  return peopleHere(state).filter(member => member.id !== state.you && !seen.has(member.id))
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

/** People named in a sentence: "Mia", "Mia and Kai", "Mia, Kai and 2 others". */
export function namesOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? 'nobody'
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`
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
  /**
   * Whose song it is, as its face and name: whoever added it, or — for a
   * shared playlist's song whose owner is not here — that owner.
   */
  readonly face: {
    readonly name: string
    readonly colour: number
    readonly picture: string | null
  } | null
  readonly who: string
}

/** A face colour for someone not in the room, the same every time for the same name. */
function colourOfName(name: string): number {
  let sum = 0
  for (const char of name) sum += char.codePointAt(0) ?? 0
  return sum % 8
}

function rowOf(state: RoomState, entry: RoomEntry): RoomRow {
  const host = isHost(state)
  const by = memberOf(state, entry.addedBy)
  return {
    entry,
    trackId: roomTrackId(entry.id),
    by,
    owner: memberOf(state, entry.owner),
    removable: entry.playedAt === null && (host || entry.addedBy === state.you),
    face: entry.from
      ? { name: entry.from, colour: colourOfName(entry.from), picture: entry.fromPicture }
      : by
        ? { name: by.name, colour: by.colour, picture: by.picture }
        : null,
    who: entry.from ?? nameOf(state, by),
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
    // A link: through this device's own way to the host's server, when it
    // has one (the host), else through the doorman once the host has said
    // where its server answers (`linkRelay`).
    const linkStream = song.link
      ? (sources.link(song.link) ?? (state.linkRelay ? sources.file(entry.id, 'audio') : null))
      : null
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
 * - `start`: nothing of the room is playing and the player is free — or the
 *   room was opened to take over from it — and the room has songs waiting:
 *   play them, from the first.
 * - `follow`: the player is on the room's song: keep what comes after it the
 *   room's list.
 * - `advance`: the player ran out on the room's last song, and a song has
 *   been added since: go on to it.
 * - `resume`: the player has nothing loaded — the app was opened again, a
 *   page reloaded — while the room is on a song: take it up where the room
 *   says it is, rather than telling the room nothing plays.
 * - `none`: the player is busy with something of your own, or there is
 *   nothing to play.
 */
type HostPlan =
  | { readonly kind: 'start'; readonly ids: readonly number[] }
  | { readonly kind: 'follow'; readonly upcoming: readonly number[] }
  | { readonly kind: 'advance'; readonly upcoming: readonly number[] }
  | { readonly kind: 'resume'; readonly ids: readonly number[] }
  | { readonly kind: 'none' }

export function hostPlan(
  state: RoomState,
  player: {
    readonly currentId: number | null
    readonly playing: boolean
    /** The player stopped because its list ran out. */
    readonly ranOut: boolean
    /** The room was opened to play over your own music (`RoomStartHint`). */
    readonly takeOver?: boolean
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
  if (player.currentId === null && state.playing !== null) {
    return { kind: 'resume', ids: [roomTrackId(state.playing.entryId), ...upcoming] }
  }
  if (state.playing === null && (!player.playing || player.takeOver) && upcoming.length > 0) {
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
 * How far the host's player may be from the room's clock before it is told.
 * On everyone's phones the others follow the room's clock to a third of a
 * second (`shouldResync`), so a host whose song started late — loading
 * after a skip — must say so, or plays behind everyone for the whole song.
 * On one speaker nobody follows the audio: only a seek is worth telling.
 */
const HOST_DRIFT_SECONDS = { everyone: 0.5, speaker: 2 } as const

/**
 * Whether what the host's player is doing differs from what the room says
 * enough to tell it: another song, playing against paused, or a position
 * off the room's clock (`HOST_DRIFT_SECONDS`).
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
  return (
    Math.abs(roomPosition(playing, now + offset) - player.position) >
    HOST_DRIFT_SECONDS[state.mode]
  )
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
 *
 * With `closeness` — how near a song sounds to what just played
 * (`soundTarget`) — each person's turn is the nearest of theirs; a song with
 * no vector comes after those that have one, in no particular order.
 */
export function keepGoingPicks(
  state: RoomState,
  count: number,
  options: {
    readonly random?: () => number
    readonly closeness?: (song: RoomSong) => number | null
  } = {},
): RoomAction[] {
  const random = options.random ?? Math.random
  const closeness = options.closeness
  const recent = new Set(
    playedEntries(state)
      .slice(0, 12)
      .map(entry => keyOf(entry.song)),
  )
  const waiting = new Set(
    state.entries.filter(entry => entry.playedAt === null).map(entry => keyOf(entry.song)),
  )
  const byPerson = new Map<string, { action: RoomAction; near: number | null }[]>()
  const offer = (person: string, song: RoomSong, action: RoomAction): void => {
    const key = keyOf(song)
    if (recent.has(key) || waiting.has(key)) return
    const list = byPerson.get(person) ?? []
    list.push({ action, near: closeness ? closeness(song) : null })
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

  const queues = [...byPerson.values()].map(list => {
    const heard = list.filter(pick => pick.near !== null)
    heard.sort((a, b) => (b.near ?? 0) - (a.near ?? 0))
    const unheard = shuffleArray(
      list.filter(pick => pick.near === null),
      random,
    )
    return [...heard, ...unheard].map(pick => pick.action)
  })
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

// --- after ----------------------------------------------------------------------

/** A room that ended, as Recently played keeps it. */
export interface PastRoom {
  readonly code: string
  readonly title: string
  readonly endedAt: number
  readonly people: readonly {
    readonly name: string
    readonly colour: number
    readonly picture: string | null
  }[]
  /** The shared playlist it was kept as, when it was (features/shared). */
  readonly shared: string | null
  readonly songs: readonly {
    readonly song: RoomSong
    readonly by: string
    readonly colour: number
    readonly picture: string | null
    /** Brought by you, from your own library. */
    readonly mine: boolean
  }[]
}

/**
 * Rooms remembered before faces had pictures, or before a room said which
 * shared playlist it was kept as, brought up to now: they have neither. Data,
 * not a second reading of the schema: the store writes the upgrade back (pastRooms.store.ts), so a
 * device's rooms are upgraded once. Anything else is handed on as it is, for
 * the schema to say.
 */
export function upgradePastRooms(stored: unknown): unknown {
  if (!Array.isArray(stored)) return stored
  let changed = false
  const pictured = (face: unknown): unknown => {
    if (!isRecord(face) || 'picture' in face) return face
    changed = true
    return { ...face, picture: null }
  }
  const rooms = stored.map((room: unknown) => {
    if (!isRecord(room)) return room
    const people: unknown = room['people']
    const songs: unknown = room['songs']
    const upgraded = {
      ...room,
      people: Array.isArray(people) ? people.map(pictured) : people,
      songs: Array.isArray(songs) ? songs.map(pictured) : songs,
    }
    if ('shared' in room) return upgraded
    changed = true
    return { ...upgraded, shared: null }
  })
  return changed ? rooms : stored
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    // Not kept as one yet: RoomProvider says, as the room ends.
    shared: null,
    people: peopleOnce(state).map(member => ({
      name: nameOf(state, member),
      colour: member.colour,
      picture: member.picture,
    })),
    songs: rows.map(row => ({
      song: row.entry.song,
      // Whose it is as the room showed it: a shared playlist's owner who was
      // not there keeps their own name and face.
      by: row.who,
      colour: row.face?.colour ?? 0,
      picture: row.face?.picture ?? null,
      mine: row.entry.owner === state.you,
    })),
  }
}

/** What a member is told when the room ends under them, or they are taken out of it. */
export function endedLine(state: RoomState, how: 'ended' | 'removed'): string {
  if (isHost(state)) return 'Your room ended'
  const title = roomTitle(state)
  return how === 'removed' ? `You were taken out of ${title}` : `${title} ended`
}

/**
 * Everyone who was in the room, once each: someone who left and came back
 * has a member record for each time, the latest kept. An earlier record of
 * your own is you, and goes.
 */
function peopleOnce(state: RoomState): RoomMember[] {
  const you = youOf(state)
  const latest = new Map<string, RoomMember>()
  for (const member of state.members) {
    if (member.id !== state.you && member.name === you?.name) continue
    latest.delete(member.name)
    latest.set(member.name, member)
  }
  return [...latest.values()]
}

function withNames(names: readonly string[], state: RoomState): string {
  if (names.length === 0) return roomTitle(state)
  if (names.length === 1) return `With ${names[0]}`
  return `With ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "With Mia, Ken and Ana": the others who were there. */
export function pastTitle(state: RoomState): string {
  return withNames(
    peopleOnce(state)
      .filter(member => member.id !== state.you)
      .map(member => member.name),
    state,
  )
}

/** "With Mia": the others a kept room is for — still here, and signed in. */
export function keptTitle(state: RoomState): string {
  return withNames(
    peopleOnce(state)
      .filter(member => member.id !== state.you && !member.left && member.kind !== 'guest')
      .map(member => member.name),
    state,
  )
}

/** The room's invite link: opens the join page, in the app or a browser. */
export function inviteLink(appUrl: string, code: string): string {
  return `${appUrl.replace(/\/+$/, '')}/join/${code}`
}

/**
 * Where the room's music is: the songs playing and just played, as one
 * packed vector (shared soundVectors.ts), from the vectors the room keeps.
 * Null when none of them has one.
 */
export function soundTarget(
  state: RoomState,
  vectors: ReadonlyMap<string, Int8Array>,
): Int8Array | null {
  const playing = playingRow(state)?.entry
  const recent = [...(playing ? [playing] : []), ...playedEntries(state)].slice(0, 3)
  const heard = recent.flatMap(entry => {
    const vector = entry.song.audio ? vectors.get(entry.song.audio.key) : undefined
    return vector ? [vector] : []
  })
  return soundCentre(heard)
}

// --- what a room starts with ------------------------------------------------------

/**
 * The songs a room opened from here starts with, as the sheet names them
 * (Xiao 2026-10-14): the song playing, from the player; a list's, from its ⋯
 * or from Ask; nothing, from Home. Only songs of your own library — a room's
 * songs are positive ids — and never more than a room keeps waiting.
 */
export function startingSongs(
  start: RoomStart,
  playing: { readonly id: number; readonly title: string } | null,
): { readonly ids: readonly number[]; readonly title: string } {
  if (start.kind === 'songs') {
    const ids = start.songIds.filter(id => id > 0).slice(0, ROOM_MAX_WAITING)
    return ids.length > 0
      ? { ids, title: `${start.name} · ${plural(ids.length, 'song', 'songs')}` }
      : { ids: [], title: 'Nothing yet' }
  }
  if (start.kind === 'playing' && playing && playing.id > 0) {
    return { ids: [playing.id], title: playing.title }
  }
  return { ids: [], title: 'Nothing yet' }
}

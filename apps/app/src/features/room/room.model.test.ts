import { describe, expect, it } from 'vitest'
import {
  addRoomMember,
  applyRoomAction,
  isRoomRefusal,
  newRoomDoc,
  roomStateFor,
  DEFAULT_ROOM_RIGHTS,
  type RoomAction,
  type RoomDoc,
  type RoomRefusal,
  type RoomSong,
  type RoomState,
  type Song,
} from '@selfmp3/shared'
import { libraryIndex, roomTrackId } from '@selfmp3/client'
import {
  entryOfTrack,
  freshWant,
  hostPlan,
  inviteLink,
  keepGoingPicks,
  needsReport,
  pastRoomOf,
  pastTitle,
  roomLine,
  roomTracks,
  upcomingRows,
  youMay,
} from './room.model'

/**
 * What a device makes of a room: the host's player following it, the rows it
 * draws, Keep it going, and what Recently played keeps when it ends.
 */

const X = 'aaaaaaaaaaaa'
const M = 'bbbbbbbbbbbb'
const A = 'dddddddddddd'

function song(n: number, extra: Partial<RoomSong> = {}): RoomSong {
  const sha = n.toString(16).padStart(2, '0').repeat(32)
  return {
    uid: sha.slice(0, 32),
    title: `Song ${n}`,
    artist: 'Someone',
    album: '',
    duration: 200,
    audio: { key: `audio/${sha}.m4a`, size: 1, mime: 'audio/mp4' },
    cover: null,
    coverTone: null,
    lyrics: null,
    sourceUrl: null,
    link: null,
    artwork: null,
    ...extra,
  }
}

let ids = 0
const newId = (): string => (++ids).toString(16).padStart(12, '0')

function ok(value: RoomDoc | RoomRefusal): RoomDoc {
  if (isRoomRefusal(value)) throw new Error(value.message)
  return value
}

function room(): RoomDoc {
  let doc = newRoomDoc({
    code: 'KQ7482',
    host: { id: X, name: 'Xiao' },
    mode: 'speaker',
    rights: DEFAULT_ROOM_RIGHTS,
    keepGoing: true,
    now: 1000,
  })
  doc = ok(addRoomMember(doc, { id: M, name: 'Mia', kind: 'friend' }, 1100))
  doc = ok(addRoomMember(doc, { id: A, name: 'Ana', kind: 'guest' }, 1200))
  return doc
}

const act = (doc: RoomDoc, who: string, action: RoomAction, now = 2000): RoomDoc =>
  ok(applyRoomAction(doc, who, action, now, newId))

const as = (doc: RoomDoc, who: string): RoomState => roomStateFor(doc, who, 5000)

describe('the host’s player', () => {
  it('starts the room when the first song comes in and nothing of its own plays', () => {
    const doc = act(room(), M, { type: 'add', song: song(1) })
    const plan = hostPlan(as(doc, X), { currentId: null, playing: false, ranOut: false })
    expect(plan).toEqual({ kind: 'start', ids: [roomTrackId(doc.entries[0]?.id ?? '')] })
  })

  it('leaves the host’s own music alone', () => {
    const doc = act(room(), M, { type: 'add', song: song(1) })
    expect(hostPlan(as(doc, X), { currentId: 42, playing: true, ranOut: false })).toEqual({
      kind: 'none',
    })
  })

  it('keeps what comes after the room’s song the room’s list, and goes on when it ran out', () => {
    let doc = act(room(), M, { type: 'add', song: song(1) })
    const first = doc.entries[0]?.id ?? ''
    doc = act(doc, X, { type: 'report', entryId: first, position: 0, playing: true })
    doc = act(doc, A, { type: 'again', entryId: first })
    const playing = { currentId: roomTrackId(first), playing: true, ranOut: false }
    const upcoming = [roomTrackId(doc.entries[1]?.id ?? '')]
    expect(hostPlan(as(doc, X), playing)).toEqual({ kind: 'follow', upcoming })
    expect(hostPlan(as(doc, X), { ...playing, playing: false, ranOut: true })).toEqual({
      kind: 'advance',
      upcoming,
    })
    expect(entryOfTrack(as(doc, X), roomTrackId(first))).toBe(first)
    expect(entryOfTrack(as(doc, X), 42)).toBeNull()
  })

  it('tells the room only what it does not already know', () => {
    let doc = act(room(), M, { type: 'add', song: song(1) })
    const first = doc.entries[0]?.id ?? ''
    doc = act(doc, X, { type: 'report', entryId: first, position: 10, playing: true }, 10_000)
    const state = as(doc, X)
    // 5 s later on the doorman's clock, 15 s in: in step.
    expect(needsReport(state, 0, 15_000, { entryId: first, playing: true, position: 15 })).toBe(
      false,
    )
    expect(needsReport(state, 0, 15_000, { entryId: first, playing: true, position: 40 })).toBe(
      true,
    )
    expect(needsReport(state, 0, 15_000, { entryId: first, playing: false, position: 15 })).toBe(
      true,
    )
    expect(needsReport(state, 0, 15_000, { entryId: null, playing: true, position: 0 })).toBe(true)
  })

  it('acts on each thing a friend asked once', () => {
    const doc = act(room(), M, { type: 'skip' })
    expect(freshWant(as(doc, X), 0)?.kind).toBe('skip')
    expect(freshWant(as(doc, X), 1)).toBeNull()
  })
})

describe('what a member sees', () => {
  it('says where it plays, from where they sit', () => {
    expect(roomLine(as(room(), X))).toBe('3 here · plays here')
    expect(roomLine(as(room(), M))).toBe('3 here · plays on Xiao’s')
  })

  it('offers a guest no songs of their own, and the host everything', () => {
    expect(youMay(as(room(), A), 'add')).toBe(false)
    expect(youMay(as(room(), A), 'addLink')).toBe(true)
    expect(youMay(as(room(), X), 'kick')).toBe(true)
    expect(youMay(as(room(), M), 'kick')).toBe(false)
  })

  it('lets you take out your own songs, and the host anyone’s', () => {
    let doc = act(room(), M, { type: 'add', song: song(1) })
    doc = act(doc, A, { type: 'again', entryId: doc.entries[0]?.id ?? '' })
    const removable = (who: string) => upcomingRows(as(doc, who)).map(row => row.removable)
    expect(removable(M)).toEqual([true, false])
    expect(removable(X)).toEqual([true, true])
  })

  it('plays a song you have from your own copy, and a link through the host’s server', () => {
    let doc = act(room(), M, { type: 'add', song: song(1) })
    doc = act(doc, A, {
      type: 'addLink',
      song: song(9, {
        uid: null,
        audio: null,
        link: 'https://youtu.be/abc',
        artwork: 'https://i.ytimg.com/a.jpg',
      }),
    })
    const yours = { id: 7, path: song(1).audio?.key ?? '', sourceUrl: null } as Song
    const tracks = roomTracks(as(doc, X), {
      file: (entryId, part) => `doorman/${entryId}/${part}`,
      link: url => `server/listen?url=${url}`,
      library: libraryIndex([yours]),
    })
    const [mias, link] = doc.entries
    expect(tracks.get(roomTrackId(mias?.id ?? ''))).toMatchObject({
      yours: 7,
      stream: { url: `doorman/${mias?.id}/audio` },
    })
    expect(tracks.get(roomTrackId(link?.id ?? ''))).toMatchObject({
      yours: null,
      stream: { url: 'server/listen?url=https://youtu.be/abc' },
      cover: 'https://i.ytimg.com/a.jpg',
    })
  })
})

describe('a link on someone else’s phone', () => {
  it('plays through the doorman once the host has said where its server is, and not before', () => {
    let doc = act(room(), A, {
      type: 'addLink',
      song: song(9, { uid: null, audio: null, link: 'https://youtu.be/abc' }),
    })
    const sources = {
      file: (entryId: string, part: 'audio' | 'cover') => `doorman/${entryId}/${part}`,
      link: () => null,
      library: libraryIndex([]),
    }
    const id = roomTrackId(doc.entries[0]?.id ?? '')
    expect(roomTracks(as(doc, M), sources).get(id)?.stream).toBeNull()
    doc = { ...doc, linkRelay: true }
    expect(roomTracks(as(doc, M), sources).get(id)?.stream?.url).toBe(
      `doorman/${doc.entries[0]?.id}/audio`,
    )
  })
})

describe('keep it going', () => {
  it('adds from shelves and what played, taking turns, and nothing that just played', () => {
    let doc = room()
    doc = act(doc, M, { type: 'shelf', shelf: { name: 'night walk', songs: [song(1), song(2)] } })
    doc = act(doc, X, { type: 'add', song: song(3) })
    const three = doc.entries[0]?.id ?? ''
    doc = act(doc, X, { type: 'report', entryId: three, position: 0, playing: true })
    const picks = keepGoingPicks(as(doc, X), 4, () => 0)
    expect(picks.every(pick => pick.type === 'fromShelf')).toBe(true)
    expect(picks).toHaveLength(2)

    doc = act(doc, X, { type: 'report', entryId: null, position: 0, playing: false })
    // Song 3 just played: it does not come straight back.
    expect(keepGoingPicks(as(doc, X), 4, () => 0).some(pick => pick.type === 'again')).toBe(false)
  })
})

describe('after the room', () => {
  it('keeps the songs that played, oldest first, and who was there', () => {
    let doc = act(room(), M, { type: 'add', song: song(1) })
    doc = act(doc, X, { type: 'add', song: song(2) })
    const [one, two] = doc.entries
    doc = act(
      doc,
      X,
      { type: 'report', entryId: one?.id ?? null, position: 0, playing: true },
      3000,
    )
    doc = act(
      doc,
      X,
      { type: 'report', entryId: two?.id ?? null, position: 0, playing: true },
      4000,
    )
    doc = act(doc, X, { type: 'end' }, 5000)
    const past = pastRoomOf(as(doc, M), 9000)
    expect(past).toMatchObject({ code: 'KQ7482', title: 'With Xiao and Ana', endedAt: 5000 })
    expect(past?.songs.map(entry => [entry.song.title, entry.by, entry.mine])).toEqual([
      ['Song 1', 'You', true],
      ['Song 2', 'Xiao', false],
    ])
  })

  it('remembers nothing of a room where nothing played', () => {
    expect(pastRoomOf(as(room(), X), 9000)).toBeNull()
  })

  it('is named after the others', () => {
    expect(pastTitle(as(room(), X))).toBe('With Mia and Ana')
  })

  it('invites to the join page', () => {
    expect(inviteLink('https://xiao215.github.io/selfmp3/', 'KQ7482')).toBe(
      'https://xiao215.github.io/selfmp3/join/KQ7482',
    )
  })
})

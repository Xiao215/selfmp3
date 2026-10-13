import { describe, expect, it } from 'vitest'
import {
  ROOM_MAX_PLAYED,
  addRoomMember,
  applyRoomAction,
  canAct,
  canReadEntry,
  isRoomRefusal,
  newRoomDoc,
  roomOrder,
  roomPosition,
  roomTitle,
  waitingEntries,
  type RoomRefusal,
} from './room.js'
import {
  DEFAULT_ROOM_RIGHTS,
  RoomActionSchema,
  RoomCodeSchema,
  RoomSongSchema,
  formatRoomCode,
  type RoomAction,
  type RoomDoc,
  type RoomSong,
} from './schemas/room.js'

/**
 * A room's rules: who may do what, and the order songs play in — taking
 * turns, so one friend adding twenty songs does not bury everyone else's.
 */

const SHA = (n: number) => n.toString(16).padStart(2, '0').repeat(32)

function song(title: string, n = 1): RoomSong {
  return {
    uid: SHA(n).slice(0, 32),
    title,
    artist: 'Someone',
    album: '',
    duration: 200,
    audio: { key: `audio/${SHA(n)}.m4a`, size: 1000, mime: 'audio/mp4' },
    cover: null,
    coverTone: null,
    lyrics: null,
    sourceUrl: null,
    link: null,
    artwork: null,
  }
}

const LINK: RoomSong = {
  ...song('From a link'),
  uid: null,
  audio: null,
  link: 'https://music.youtube.com/watch?v=abc',
  artwork: 'https://i.ytimg.com/vi/abc/hq.jpg',
}

let ids = 0
const newId = () => (++ids).toString(16).padStart(12, '0')

function ok(value: RoomDoc | RoomRefusal): RoomDoc {
  if (isRoomRefusal(value)) throw new Error(`refused: ${value.message}`)
  return value
}

/** Host X, friends M and K (signed in), guest A, joined in that order. */
function room(): RoomDoc {
  let doc = newRoomDoc({
    code: 'KQ7482',
    host: { id: 'aaaaaaaaaaaa', name: 'Xiao', picture: null },
    mode: 'speaker',
    rights: DEFAULT_ROOM_RIGHTS,
    keepGoing: true,
    now: 1000,
  })
  doc = ok(
    addRoomMember(doc, { id: 'bbbbbbbbbbbb', name: 'Mia', kind: 'friend', picture: null }, 1100),
  )
  doc = ok(
    addRoomMember(doc, { id: 'cccccccccccc', name: 'Ken', kind: 'friend', picture: null }, 1200),
  )
  doc = ok(
    addRoomMember(doc, { id: 'dddddddddddd', name: 'Ana', kind: 'guest', picture: null }, 1300),
  )
  return doc
}
const X = 'aaaaaaaaaaaa'
const M = 'bbbbbbbbbbbb'
const K = 'cccccccccccc'
const A = 'dddddddddddd'

function act(doc: RoomDoc, who: string, action: RoomAction, now = 2000): RoomDoc {
  return ok(applyRoomAction(doc, who, action, now, newId))
}

function titles(doc: RoomDoc): string[] {
  const byId = new Map(doc.entries.map(entry => [entry.id, entry.song.title]))
  return roomOrder(doc).map(id => byId.get(id) ?? '?')
}

describe('a room code', () => {
  it('reads what was typed, whatever its case and spacing, and shows it in two halves', () => {
    expect(RoomCodeSchema.parse('kq7 482')).toBe('KQ7482')
    expect(RoomCodeSchema.parse('KQ7-482')).toBe('KQ7482')
    expect(formatRoomCode('kq7482')).toBe('KQ7 482')
  })

  it('refuses letters that are easily misread', () => {
    for (const code of ['KQ0482', 'KQ1482', 'KQI482', 'KQO482', 'KQ748', 'KQ74822']) {
      expect(RoomCodeSchema.safeParse(code).success, code).toBe(false)
    }
  })
})

describe('a room song', () => {
  it('names only the bucket’s own song files', () => {
    expect(RoomSongSchema.safeParse(song('fine')).success).toBe(true)
    const sneaky = { ...song('sneaky'), audio: { key: 'snapshots/x.json', size: 1, mime: 'a/b' } }
    expect(RoomSongSchema.safeParse(sneaky).success).toBe(false)
    const outside = {
      ...song('outside'),
      audio: { key: '../other/audio.m4a', size: 1, mime: 'a/b' },
    }
    expect(RoomSongSchema.safeParse(outside).success).toBe(false)
  })
})

describe('taking turns', () => {
  it('deals one song from each person in turn, earliest to join first', () => {
    let doc = room()
    for (const title of ['K1', 'K2', 'K3', 'K4'])
      doc = act(doc, K, { type: 'add', song: song(title) })
    doc = act(doc, M, { type: 'add', song: song('M1') })
    doc = act(doc, X, { type: 'add', song: song('X1') })
    doc = act(doc, X, { type: 'add', song: song('X2') })
    expect(titles(doc)).toEqual(['X1', 'M1', 'K1', 'X2', 'K2', 'K3', 'K4'])
  })

  it('sends whoever’s song is playing to the back of the turns', () => {
    let doc = room()
    doc = act(doc, X, { type: 'add', song: song('X1') })
    doc = act(doc, X, { type: 'add', song: song('X2') })
    doc = act(doc, M, { type: 'add', song: song('M1') })
    doc = act(doc, K, { type: 'add', song: song('K1') })
    const first = roomOrder(doc)[0]
    doc = act(doc, X, { type: 'report', entryId: first ?? null, position: 0, playing: true })
    expect(titles(doc)).toEqual(['M1', 'K1', 'X2'])
  })

  it('keeps a song the host moved where it was put, out of the turns', () => {
    let doc = room()
    for (const title of ['K1', 'K2', 'K3']) doc = act(doc, K, { type: 'add', song: song(title) })
    doc = act(doc, M, { type: 'add', song: song('M1') })
    expect(titles(doc)).toEqual(['M1', 'K1', 'K2', 'K3'])
    const k3 = doc.entries.find(entry => entry.song.title === 'K3')?.id ?? ''
    doc = act(doc, X, { type: 'move', entryId: k3, to: 0 })
    expect(titles(doc)).toEqual(['K3', 'M1', 'K1', 'K2'])
    doc = act(doc, A, { type: 'again', entryId: k3 })
    expect(titles(doc)[0]).toBe('K3')
  })

  it('counts a song added from someone’s shelf as the turn of whoever added it', () => {
    let doc = room()
    doc = act(doc, M, { type: 'shelf', shelf: { name: 'night walk', songs: [song('Shelf 1')] } })
    doc = act(doc, K, { type: 'add', song: song('K1') })
    doc = act(doc, A, { type: 'fromShelf', member: M, index: 0 })
    expect(titles(doc)).toEqual(['K1', 'Shelf 1'])
    const fromShelf = doc.entries.find(entry => entry.song.title === 'Shelf 1')
    expect(fromShelf).toMatchObject({ addedBy: A, owner: M })
  })
})

describe('who may do what', () => {
  it('lets a guest add from the room and links, but not from a library they do not have', () => {
    const doc = room()
    const ana = doc.members.find(member => member.id === A)
    if (!ana) throw new Error('no Ana')
    expect(canAct(doc, ana, 'add')).toBe(false)
    expect(canAct(doc, ana, 'addLink')).toBe(true)
    expect(canAct(doc, ana, 'again')).toBe(true)
    expect(applyRoomAction(doc, A, { type: 'add', song: song('x') }, 2000, newId)).toMatchObject({
      refused: 'forbidden',
    })
  })

  it('follows the host’s rights', () => {
    let doc = room()
    doc = act(doc, X, {
      type: 'settings',
      rights: { add: true, skip: false, pause: false, links: false },
    })
    expect(applyRoomAction(doc, M, { type: 'skip' }, 2000, newId)).toMatchObject({
      refused: 'forbidden',
    })
    expect(applyRoomAction(doc, A, { type: 'addLink', song: LINK }, 2000, newId)).toMatchObject({
      refused: 'forbidden',
    })
    expect(isRoomRefusal(applyRoomAction(doc, X, { type: 'skip' }, 2000, newId))).toBe(false)
  })

  it('lets only the adder or the host take a song out', () => {
    let doc = act(room(), K, { type: 'add', song: song('K1') })
    const k1 = doc.entries[0]?.id ?? ''
    expect(applyRoomAction(doc, M, { type: 'remove', entryId: k1 }, 2000, newId)).toMatchObject({
      refused: 'forbidden',
    })
    doc = act(doc, X, { type: 'remove', entryId: k1 })
    expect(doc.entries).toEqual([])
  })

  it('lets only the host report what plays, end the room or remove someone', () => {
    const doc = room()
    for (const action of [
      { type: 'report', entryId: null, position: 0, playing: false },
      { type: 'end' },
      { type: 'kick', member: K },
      { type: 'move', entryId: 'eeeeeeeeeeee', to: 0 },
    ] as const) {
      expect(applyRoomAction(doc, M, action, 2000, newId), action.type).toMatchObject({
        refused: 'forbidden',
      })
    }
  })

  it('refuses everything once the room ended, and lends no files', () => {
    let doc = act(room(), M, { type: 'add', song: song('M1') })
    doc = act(doc, X, { type: 'end' })
    expect(canReadEntry(doc, M, doc.entries[0]?.id ?? '')).toBeNull()
    expect(applyRoomAction(doc, M, { type: 'add', song: song('M2') }, 3000, newId)).toMatchObject({
      refused: 'ended',
    })
  })

  it('ends the room when the host leaves', () => {
    expect(act(room(), X, { type: 'leave' }).endedAt).toBe(2000)
  })
})

describe('songs a room is lent', () => {
  it('keeps a song from a library to its audio, and a link to its address', () => {
    expect(applyRoomAction(room(), M, { type: 'add', song: LINK }, 2000, newId)).toMatchObject({
      refused: 'invalid',
    })
    expect(
      applyRoomAction(room(), M, { type: 'addLink', song: song('not a link') }, 2000, newId),
    ).toMatchObject({ refused: 'invalid' })
    const doc = act(room(), A, { type: 'addLink', song: LINK })
    expect(doc.entries[0]).toMatchObject({ owner: null, addedBy: A })
  })

  it('lends a friend’s song to members while it is in the room, and not to someone who left', () => {
    let doc = act(room(), M, { type: 'add', song: song('M1') })
    const m1 = doc.entries[0]?.id ?? ''
    expect(canReadEntry(doc, A, m1)?.owner).toBe(M)
    doc = act(doc, A, { type: 'leave' })
    expect(canReadEntry(doc, A, m1)).toBeNull()
  })

  it('takes the songs of someone removed out of the list, but leaves those of someone who left', () => {
    let doc = act(room(), K, { type: 'add', song: song('K1') })
    doc = act(doc, M, { type: 'add', song: song('M1') })
    expect(waitingEntries(act(doc, M, { type: 'leave' }))).toHaveLength(2)
    expect(waitingEntries(act(doc, X, { type: 'kick', member: K })).map(e => e.song.title)).toEqual(
      ['M1'],
    )
  })
})

describe('what plays', () => {
  it('moves the playing song to played when the host’s player goes on, and keeps the clock', () => {
    let doc = room()
    doc = act(doc, M, { type: 'add', song: song('M1') })
    doc = act(doc, K, { type: 'add', song: song('K1') })
    const [m1, k1] = roomOrder(doc)
    doc = act(doc, X, { type: 'report', entryId: m1 ?? null, position: 0, playing: true }, 10_000)
    expect(doc.playing).toEqual({ entryId: m1, startedAt: 10_000, pausedAt: null })
    expect(roomPosition(doc.playing, 40_000)).toBe(30)

    doc = act(doc, X, { type: 'report', entryId: m1 ?? null, position: 30, playing: false }, 41_000)
    expect(roomPosition(doc.playing, 99_000)).toBe(30)

    doc = act(doc, X, { type: 'report', entryId: k1 ?? null, position: 0, playing: true }, 50_000)
    expect(doc.entries.find(entry => entry.id === m1)?.playedAt).toBe(50_000)
    expect(roomOrder(doc)).toEqual([])
  })

  it('numbers each thing a member asks of the host’s player', () => {
    let doc = act(room(), M, { type: 'skip' })
    doc = act(doc, K, { type: 'skip' })
    expect(doc.want).toEqual({ seq: 2, kind: 'skip', by: K })
  })

  it('keeps no more than its share of played songs', () => {
    let doc = room()
    let now = 2000
    for (let index = 0; index <= ROOM_MAX_PLAYED + 5; index++) {
      doc = act(doc, X, { type: 'add', song: song(`X${index}`) }, now++)
      const entry = doc.entries[doc.entries.length - 1]
      doc = act(
        doc,
        X,
        { type: 'report', entryId: entry?.id ?? null, position: 0, playing: true },
        now++,
      )
    }
    expect(doc.entries.filter(entry => entry.playedAt !== null)).toHaveLength(ROOM_MAX_PLAYED)
  })
})

describe('the room', () => {
  it('is named after its host, and gives each person a face colour of their own', () => {
    const doc = room()
    expect(roomTitle(doc)).toBe("Xiao's room")
    expect(doc.members.map(member => member.colour)).toEqual([0, 1, 2, 3])
  })

  it('parses every action the app sends', () => {
    expect(RoomActionSchema.safeParse({ type: 'skip' }).success).toBe(true)
    expect(RoomActionSchema.safeParse({ type: 'move', entryId: 'zz', to: 0 }).success).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  addRoomMember,
  applyRoomAction,
  isRoomRefusal,
  newRoomDoc,
  roomStateFor,
  DEFAULT_ROOM_RIGHTS,
  soundCloseness,
  type RoomAction,
  type RoomDoc,
  type RoomRefusal,
  type RoomSong,
  type RoomState,
  type Song,
} from '@selfmp3/shared'
import { libraryIndex, roomTrackId } from '@selfmp3/client'
import {
  arrivals,
  namesOf,
  entryOfTrack,
  freshWant,
  hostPlan,
  inviteLink,
  keepGoingPicks,
  needsReport,
  pastRoomOf,
  pastTitle,
  libraryPicks,
  followerPress,
  keptTitle,
  endedLine,
  upgradePastRooms,
  soundTarget,
  startingSongs,
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
const MIAS_PICTURE = 'https://lh3.googleusercontent.com/a/mia'

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
    host: { id: X, name: 'Xiao', picture: null },
    mode: 'speaker',
    rights: DEFAULT_ROOM_RIGHTS,
    keepGoing: true,
    now: 1000,
  })
  doc = ok(addRoomMember(doc, { id: M, name: 'Mia', kind: 'friend', picture: MIAS_PICTURE }, 1100))
  doc = ok(addRoomMember(doc, { id: A, name: 'Ana', kind: 'guest', picture: null }, 1200))
  return doc
}

const act = (doc: RoomDoc, who: string, action: RoomAction, now = 2000): RoomDoc =>
  ok(applyRoomAction(doc, who, action, now, newId))

const as = (doc: RoomDoc, who: string): RoomState => roomStateFor(doc, who, 5000)

describe('what a room starts with', () => {
  const playing = { id: 7, title: '夜に駆ける' }
  it('is the song playing from the player, a whole list from its ⋯, and nothing from Home', () => {
    expect(startingSongs({ kind: 'playing' }, playing)).toEqual({ ids: [7], title: '夜に駆ける' })
    expect(
      startingSongs({ kind: 'songs', name: 'Night drive', songIds: [3, 4, 5] }, playing),
    ).toEqual({ ids: [3, 4, 5], title: 'Night drive · 3 songs' })
    expect(startingSongs({ kind: 'empty' }, playing)).toEqual({ ids: [], title: 'Nothing yet' })
  })

  it('never carries a friend’s song, nothing when nothing plays, and no more than a room keeps', () => {
    expect(startingSongs({ kind: 'playing' }, { id: -4, title: 'Mia’s' }).ids).toEqual([])
    expect(startingSongs({ kind: 'playing' }, null).ids).toEqual([])
    const many = Array.from({ length: 400 }, (_, n) => n + 1)
    expect(startingSongs({ kind: 'songs', name: 'All', songIds: many }, null).ids).toHaveLength(300)
  })
})

describe('who came in', () => {
  it('names a friend who joined since, never you, and nobody the first time', () => {
    const doc = room()
    const seen = new Set(doc.members.filter(member => member.id !== M).map(member => member.id))
    expect(arrivals(null, as(doc, X))).toEqual([])
    expect(arrivals(seen, as(doc, X)).map(member => member.id)).toEqual([M])
    expect(arrivals(new Set(), as(doc, X)).some(member => member.id === X)).toBe(false)
  })
})

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

  it('takes over from the host’s own music when the room was opened from a list or Home', () => {
    const doc = act(room(), M, { type: 'add', song: song(1) })
    const plan = hostPlan(as(doc, X), {
      currentId: 42,
      playing: true,
      ranOut: false,
      takeOver: true,
    })
    expect(plan).toEqual({ kind: 'start', ids: [roomTrackId(doc.entries[0]?.id ?? '')] })
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

  it('tells the room a song that started late, when everyone’s phone follows it', () => {
    let doc = act({ ...room(), mode: 'everyone' }, M, { type: 'add', song: song(1) })
    const first = doc.entries[0]?.id ?? ''
    doc = act(doc, X, { type: 'report', entryId: first, position: 0, playing: true }, 10_000)
    // 10 s on the doorman's clock, but the host's song only 8.5 s in: it loaded late.
    const late = { entryId: first, playing: true, position: 8.5 }
    expect(needsReport(as(doc, X), 0, 20_000, late)).toBe(true)
    expect(needsReport(as({ ...doc, mode: 'speaker' }, X), 0, 20_000, late)).toBe(false)
    expect(needsReport(as(doc, X), 0, 20_000, { ...late, position: 9.8 })).toBe(false)
  })

  it('takes the room’s song up where the room is, with nothing loaded after a reload', () => {
    let doc = act(room(), M, { type: 'add', song: song(1) })
    doc = act(doc, M, { type: 'add', song: song(2) })
    const [first, second] = doc.entries.map(entry => entry.id)
    doc = act(doc, X, { type: 'report', entryId: first ?? null, position: 0, playing: true })
    expect(hostPlan(as(doc, X), { currentId: null, playing: false, ranOut: false })).toEqual({
      kind: 'resume',
      ids: [roomTrackId(first ?? ''), roomTrackId(second ?? '')],
    })
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

  it('draws a signed-in friend’s face as their picture, and a guest’s as their initial', () => {
    let doc = act(room(), M, { type: 'add', song: song(1) })
    doc = act(doc, A, { type: 'again', entryId: doc.entries[0]?.id ?? '' })
    expect(upcomingRows(as(doc, X)).map(row => row.face?.picture)).toEqual([MIAS_PICTURE, null])
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

describe('a friend’s own transport, on everyone’s phones', () => {
  const playingRoom = (): RoomDoc => {
    const doc = act({ ...room(), mode: 'everyone' }, M, { type: 'add', song: song(1) })
    return act(doc, X, {
      type: 'report',
      entryId: doc.entries[0]?.id ?? null,
      position: 0,
      playing: true,
    })
  }

  it('asks the room to skip, and says only the host may pause', () => {
    const doc = playingRoom()
    expect(followerPress(as(doc, M), 'next', true)).toEqual({ act: 'skip' })
    expect(followerPress(as(doc, M), 'toggle', true)).toEqual({ say: 'Only Xiao can pause the room' })
    expect(followerPress(as(doc, M), 'previous', true)).toEqual({ say: 'A room only goes forward' })
  })

  it('leaves the press to the player for the host, one speaker, or a song of your own', () => {
    const doc = playingRoom()
    expect(followerPress(as(doc, X), 'next', true)).toBeNull()
    expect(followerPress(as({ ...doc, mode: 'speaker' }, M), 'next', true)).toBeNull()
    expect(followerPress(as(doc, M), 'next', false)).toBeNull()
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
    const picks = keepGoingPicks(as(doc, X), 4, { random: () => 0 })
    expect(picks.every(pick => pick.type === 'fromShelf')).toBe(true)
    expect(picks).toHaveLength(2)

    doc = act(doc, X, { type: 'report', entryId: null, position: 0, playing: false })
    // Song 3 just played: it does not come straight back.
    expect(
      keepGoingPicks(as(doc, X), 4, { random: () => 0 }).some(pick => pick.type === 'again'),
    ).toBe(false)
  })
})

describe('keep it going, from the host’s library', () => {
  it('brings songs of the host’s the room does not have, nearest in sound first', () => {
    const doc = act(room(), M, { type: 'add', song: song(1) })
    const library = new Map([
      [song(1).audio?.key ?? '', 1],
      [song(2).audio?.key ?? '', 2],
      [song(3).audio?.key ?? '', 3],
      [song(4).audio?.key ?? '', 4],
    ])
    const near = (key: string): number | null => (key === song(4).audio?.key ? 0.9 : null)
    const picks = libraryPicks(as(doc, X), library, 2, { closeness: near, random: () => 0 })
    expect(picks[0]).toBe(4)
    expect(picks).toHaveLength(2)
    expect(picks).not.toContain(1)
    expect(libraryPicks(as(doc, X), library, 0)).toEqual([])
  })
})

describe('keep it going, by sound', () => {
  it('gives each person’s turn to the song of theirs that sounds nearest to what just played', () => {
    const vector = (fill: number): Int8Array => new Int8Array(768).fill(fill)
    let doc = room()
    doc = act(doc, M, {
      type: 'shelf',
      shelf: { name: 'night walk', songs: [song(1), song(2), song(3)] },
    })
    doc = act(doc, X, { type: 'add', song: song(4) })
    doc = act(doc, X, {
      type: 'report',
      entryId: doc.entries[0]?.id ?? null,
      position: 0,
      playing: true,
    })
    const vectors = new Map([
      [song(4).audio?.key ?? '', vector(100)],
      [song(1).audio?.key ?? '', vector(-100)],
      [song(2).audio?.key ?? '', vector(90)],
    ])
    const target = soundTarget(as(doc, X), vectors)
    if (!target) throw new Error('no target')
    const near = (candidate: RoomSong): number | null => {
      const found = candidate.audio ? vectors.get(candidate.audio.key) : undefined
      return found ? soundCloseness(found, target) : null
    }
    const picks = keepGoingPicks(as(doc, X), 3, { closeness: near, random: () => 0 })
    // Song 2 sounds like song 4; song 1 is its opposite; song 3 was never heard.
    expect(picks.map(pick => (pick.type === 'fromShelf' ? pick.index : -1))).toEqual([1, 0, 2])
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

  it('brings rooms remembered before pictures and kept playlists up to now, once', () => {
    const song = { song: { title: 'Song 1' }, by: 'You', colour: 1, mine: true }
    const old = [{ code: 'KQ7482', people: [{ name: 'Mia', colour: 2 }], songs: [song] }]
    expect(upgradePastRooms(old)).toEqual([
      {
        code: 'KQ7482',
        shared: null,
        people: [{ name: 'Mia', colour: 2, picture: null }],
        songs: [{ ...song, picture: null }],
      },
    ])
    // Rooms already as they are now come back as the very same value: nothing to write.
    const now = upgradePastRooms(old)
    expect(upgradePastRooms(now)).toBe(now)
  })

  it('remembers nothing of a room where nothing played', () => {
    expect(pastRoomOf(as(room(), X), 9000)).toBeNull()
  })

  it('is named after the others', () => {
    expect(pastTitle(as(room(), X))).toBe('With Mia and Ana')
  })

  it('names each person once, and a kept playlist only those still here who signed in', () => {
    const K = 'eeeeeeeeeeee'
    const M2 = 'ffffffffffff'
    let doc = ok(addRoomMember(room(), { id: K, name: 'Kai', kind: 'friend', picture: null }, 1300))
    doc = act(doc, K, { type: 'leave' })
    // Mia leaves and comes back: a second member record, the same person.
    doc = act(doc, M, { type: 'leave' })
    doc = ok(addRoomMember(doc, { id: M2, name: 'Mia', kind: 'friend', picture: null }, 2100))
    expect(pastTitle(as(doc, X))).toBe('With Ana, Kai and Mia')
    expect(keptTitle(as(doc, X))).toBe('With Mia')
    // Mia's own earlier record is not someone else she was with.
    expect(pastTitle(as(doc, M2))).toBe('With Xiao, Ana and Kai')
    expect(endedLine(as(doc, M2), 'ended')).toBe("Xiao's room ended")
    expect(endedLine(as(doc, M2), 'removed')).toBe("You were taken out of Xiao's room")
    expect(endedLine(as(doc, X), 'ended')).toBe('Your room ended')
  })

  it('invites to the join page', () => {
    expect(inviteLink('https://xiao215.github.io/selfmp3/', 'KQ7482')).toBe(
      'https://xiao215.github.io/selfmp3/join/KQ7482',
    )
  })
})

describe('names in a sentence', () => {
  it('lists two or three, and counts the rest', () => {
    expect(namesOf(['Mia'])).toBe('Mia')
    expect(namesOf(['Mia', 'Kai'])).toBe('Mia and Kai')
    expect(namesOf(['Mia', 'Kai', 'Ana'])).toBe('Mia, Kai and Ana')
    expect(namesOf(['Mia', 'Kai', 'Ana', 'Leo'])).toBe('Mia, Kai and 2 others')
  })
})

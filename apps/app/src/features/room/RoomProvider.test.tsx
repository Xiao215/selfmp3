import { act, render } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { libraryIndex, roomTrackId } from '@selfmp3/client'
import {
  addRoomMember,
  applyRoomAction,
  DEFAULT_ROOM_RIGHTS,
  isRoomRefusal,
  newRoomDoc,
  roomStateFor,
  type RoomAction,
  type RoomDoc,
  type RoomRefusal,
  type RoomSong,
  type RoomState,
  type Song,
} from '@selfmp3/shared'

import { RoomProvider } from './RoomProvider'

/**
 * A follower's player on a link, whose length the room does not know: when
 * it left the link is read as it leaves, and whether the link plays here is
 * the player's own say (room.model's `followPlan` has the rest).
 */

const X = 'aaaaaaaaaaaa'
const M = 'bbbbbbbbbbbb'
const LINK = 'https://youtu.be/abc'
const START = 1_000_000

// The follower's player, as RoomProvider reads it.
let mockPlayer = { playingId: null as number | null, playing: false, ranOut: false }
let mockPosition = 0
let mockMayPlay = true
const mockListeners = new Set<() => void>()
const mockSubscribe = (listener: () => void): (() => void) => {
  mockListeners.add(listener)
  return () => mockListeners.delete(listener)
}
const mockCommands = {
  playFrom: jest.fn(),
  setUpcoming: jest.fn(),
  toggle: jest.fn(),
  seekTo: jest.fn(),
  jumpTo: jest.fn(),
  next: jest.fn(),
  getPosition: () => mockPosition,
  mayPlay: jest.fn(() => mockMayPlay),
}
jest.mock('../../player/PlayerProvider', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react')
  const usePlayerNow = (): typeof mockPlayer =>
    useSyncExternalStore(mockSubscribe, () => mockPlayer)
  return {
    usePlayerCommands: () => mockCommands,
    usePlayer: () => ({ ranOut: usePlayerNow().ranOut, queue: { index: 0 } }),
    usePlayingSongId: () => usePlayerNow().playingId,
    usePlayerPlaying: () => usePlayerNow().playing,
  }
})

// The room as this device has it.
let mockView: {
  pass: { code: string; token: string; member: string } | null
  state: RoomState | null
  offset: number
  link: 'live'
  lead: 'here'
} = { pass: null, state: null, offset: 0, link: 'live', lead: 'here' }
jest.mock('./room.store', () => ({
  useRoom: () =>
    jest
      .requireActual<typeof import('react')>('react')
      .useSyncExternalStore(mockSubscribe, () => mockView),
  currentRoom: () => mockView,
  connectRoom: () => undefined,
  keptAsOf: () => null,
  onRoomEnded: () => () => undefined,
  roomAct: () => Promise.resolve(),
  roomApi: { fileUrl: () => 'https://doorman.test/file', addVectors: () => Promise.resolve() },
  roomMayTakeOver: () => false,
  takeRoomStartHint: () => null,
}))

// Your own copy of the link, by where it came from.
let mockIndex = libraryIndex([])
jest.mock('../../ui/songsById', () => ({ useLibraryIndex: () => mockIndex }))
jest.mock('../../connection/useServerDirect', () => ({
  useServerDirect: () => ({ state: 'unknown' }),
}))
jest.mock('../../api/client', () => ({ mediaUrlFor: () => ({ importListen: () => null }) }))
jest.mock('../../replica', () => ({ library: {}, session: {} }))
jest.mock('../../offline/covers', () => ({
  holdPictures: () => undefined,
  keepLent: () => Promise.resolve(),
}))
jest.mock('./pastRooms.store', () => ({
  lentCoverKey: () => [],
  rememberPastRoom: () => undefined,
  usePastRooms: () => [],
}))
jest.mock('../../ports/haptics', () => ({ lightTap: () => undefined }))
jest.mock('../../ui/components/ToastHost', () => ({ ART: 40 }))
jest.mock('./RoomFace', () => ({ RoomFaces: () => null }))
jest.mock('expo-router', () => ({ router: { push: () => undefined } }))

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
const step = (doc: RoomDoc, who: string, action: RoomAction, now: number): RoomDoc =>
  ok(applyRoomAction(doc, who, action, now, newId))

/** Xiao's room on everyone's phones, playing a link from START; `then` is what waits after it. */
function linkRoom(then: RoomSong[]): { doc: RoomDoc; link: string; next: number | null } {
  let doc = newRoomDoc({
    code: 'KQ7482',
    host: { id: X, name: 'Xiao', picture: null },
    mode: 'everyone',
    rights: DEFAULT_ROOM_RIGHTS,
    keepGoing: false,
    now: START,
  })
  doc = ok(addRoomMember(doc, { id: M, name: 'Mia', kind: 'friend', picture: null }, START))
  doc = step(
    doc,
    X,
    { type: 'addLink', song: song(9, { uid: null, audio: null, duration: 0, link: LINK }) },
    START,
  )
  for (const each of then) doc = step(doc, X, { type: 'add', song: each }, START)
  const [link, next] = doc.entries.map(entry => entry.id)
  if (!link) throw new Error('no link')
  doc = step(doc, X, { type: 'report', entryId: link, position: 0, playing: true }, START)
  doc = { ...doc, members: doc.members.map(member => ({ ...member, online: true })) }
  return { doc, link, next: next ? roomTrackId(next) : null }
}

function tell(): void {
  for (const listener of [...mockListeners]) listener()
}
async function hear(doc: RoomDoc): Promise<void> {
  mockView = { ...mockView, state: roomStateFor(doc, M, Date.now()) }
  await act(async () => tell())
}
async function player(next: typeof mockPlayer, position: number): Promise<void> {
  mockPlayer = next
  mockPosition = position
  await act(async () => tell())
}

async function renderProvider(doc: RoomDoc): Promise<void> {
  mockView = {
    pass: { code: doc.code, token: 't', member: M },
    state: roomStateFor(doc, M, Date.now()),
    offset: 0,
    link: 'live',
    lead: 'here',
  }
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <RoomProvider>{null}</RoomProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  jest.useFakeTimers({ now: START })
  jest.clearAllMocks()
  mockIndex = libraryIndex([])
  mockMayPlay = true
})
afterEach(() => {
  jest.useRealTimers()
})

describe('a follower on a link', () => {
  it('follows the host back on it, though it heard them go back before its next check', async () => {
    // The link is the room's last song: this player runs out on it.
    const { doc, link } = linkRoom([])
    const linkId = roomTrackId(link)
    jest.setSystemTime(START + 300_000)
    mockPlayer = { playingId: linkId, playing: true, ranOut: false }
    mockPosition = 300
    await renderProvider(doc)

    jest.setSystemTime(START + 300_500)
    await player({ playingId: linkId, playing: false, ranOut: true }, 300)
    jest.setSystemTime(START + 301_000)
    await hear(
      step(doc, X, { type: 'report', entryId: link, position: 5, playing: true }, Date.now()),
    )

    expect(mockCommands.toggle).toHaveBeenCalledTimes(1)
    expect(mockCommands.seekTo).toHaveBeenCalledWith(5)
  })

  it('goes back to the link when its own copy is there but cannot play here now', async () => {
    // No relay: the link plays on Xiao's device, and on Mia's from her own
    // copy, which is not kept and cannot stream now (mobile data, say).
    const { doc, link, next } = linkRoom([song(2)])
    mockIndex = libraryIndex([{ id: 77, path: 'x', sourceUrl: LINK } as Song])
    mockMayPlay = false
    jest.setSystemTime(START + 30_000)
    mockPlayer = { playingId: next, playing: true, ranOut: false }
    mockPosition = 1
    await renderProvider(doc)
    jest.setSystemTime(START + 45_000)
    await act(async () => {
      jest.advanceTimersByTime(3000)
    })

    expect(mockCommands.mayPlay).toHaveBeenCalledWith(roomTrackId(link))
    expect(mockCommands.playFrom).toHaveBeenCalled()
  })
})

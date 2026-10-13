import {
  ROOM_IDLE_MS,
  RoomJoinedSchema,
  RoomStateSchema,
  type RoomJoined,
  type RoomSong,
  type RoomState,
} from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { APP_ORIGIN, BUCKET, ME, harness, type Harness } from './fakes.js'
import { newRoomCode } from './rooms.js'

/**
 * Rooms, as the doorman keeps them: opened by someone signed in, joined with
 * a code, and lending the songs friends bring from their own buckets to the
 * room's members — nobody else, nothing else, and only while it lasts.
 */

const SHA = 'ab'.repeat(32)
const AUDIO = `audio/${SHA}.m4a`
const FRIEND = {
  sub: '208234567890123456789',
  email: 'friend@example.com',
  name: 'Mia',
  picture: 'https://lh3.googleusercontent.com/a/mia',
}

function song(title: string, audioKey = AUDIO): RoomSong {
  return {
    uid: 'cd'.repeat(16),
    title,
    artist: 'ヨルシカ',
    album: '',
    duration: 263,
    audio: { key: audioKey, size: 10, mime: 'audio/mp4' },
    cover: null,
    coverTone: null,
    lyrics: null,
    sourceUrl: 'https://music.youtube.com/watch?v=abc',
    link: null,
    artwork: null,
  }
}

interface Setup {
  h: Harness
  host: string
  friend: string
  room: RoomJoined
}

/** Xiao opens a room; Mia is signed in with a bucket of her own holding one song. */
async function setup(): Promise<Setup> {
  const h = harness()
  const host = await h.signIn()
  expect((await h.connect(host)).status).toBe(200)
  const friend = await h.signIn(FRIEND)
  expect((await h.connect(friend, { prefix: 'mia' })).status).toBe(200)
  h.bucket.put(`mia/${AUDIO}`, '0123456789', { contentType: 'audio/mp4' })

  const response = await h.call('/v1/rooms', {
    token: host,
    json: { name: 'Xiao', mode: 'speaker' },
  })
  expect(response.status).toBe(200)
  return { h, host, friend, room: RoomJoinedSchema.parse(await response.json()) }
}

async function join(s: Setup, name: string, session?: string): Promise<RoomJoined> {
  const response = await s.h.call(`/v1/rooms/${s.room.code}/join`, {
    json: { name },
    ...(session ? { token: session } : {}),
    origin: APP_ORIGIN,
  })
  expect(response.status).toBe(200)
  return RoomJoinedSchema.parse(await response.json())
}

async function act(
  s: Setup,
  member: RoomJoined,
  action: unknown,
  session?: string,
): Promise<Response> {
  return s.h.call(`/v1/rooms/${s.room.code}/act?t=${member.token}`, {
    json: action,
    ...(session ? { token: session } : {}),
  })
}

async function state(response: Response): Promise<RoomState> {
  expect(response.status).toBe(200)
  return RoomStateSchema.parse(await response.json())
}

function file(s: Setup, member: RoomJoined, entry: string, part = 'audio', range?: string) {
  return s.h.call(`/v1/rooms/${s.room.code}/files/${entry}/${part}?t=${member.token}`, {
    ...(range ? { headers: { range } } : {}),
  })
}

describe('opening and joining a room', () => {
  it('is for someone signed in to open, and anyone with the code to join', async () => {
    const s = await setup()
    expect(s.room.state.members).toMatchObject([{ name: 'Xiao', kind: 'host' }])
    expect(
      (await s.h.call('/v1/rooms', { json: { name: 'Nobody', mode: 'speaker' } })).status,
    ).toBe(401)

    const ana = await join(s, 'Ana')
    const mia = await join(s, 'Mia', s.friend)
    expect(mia.state.members.map(member => [member.name, member.kind])).toEqual([
      ['Xiao', 'host'],
      ['Ana', 'guest'],
      ['Mia', 'friend'],
    ])
    expect(ana.state.you).toBe(ana.member)
  })

  it('shows each signed-in person’s Google picture as their face, and no guest’s', async () => {
    const s = await setup()
    expect(s.room.state.members[0]?.picture).toBe(ME.picture)
    // A picture in the body is nobody's word for anything: only a session's counts.
    const elsewhere = 'https://example.com/someone-else.png'
    const joined = async (name: string, session?: string) => {
      const response = await s.h.call(`/v1/rooms/${s.room.code}/join`, {
        json: { name, picture: elsewhere },
        ...(session ? { token: session } : {}),
      })
      return RoomJoinedSchema.parse(await response.json())
    }
    await joined('Ana')
    const mia = await joined('Mia', s.friend)
    expect(mia.state.members.map(member => [member.name, member.picture])).toEqual([
      ['Xiao', ME.picture],
      ['Ana', null],
      ['Mia', FRIEND.picture],
    ])

    // Google's address that is not https is no face.
    const plain = await s.h.signIn({ sub: '308234567890123456789', picture: 'http://x.test/k' })
    const ken = await joined('Ken', plain)
    expect(ken.state.members.at(-1)?.picture).toBeNull()
  })

  it('opens a room kept before faces had pictures, with none', async () => {
    const s = await setup()
    const stored = s.h.rooms.stored(s.room.code)
    const doc = stored.get('doc') as { members: Record<string, unknown>[] }
    for (const member of doc.members) delete member.picture
    stored.set('doc', doc)
    const opened = await state(await s.h.call(`/v1/rooms/${s.room.code}?t=${s.room.token}`))
    expect(opened.members.map(member => member.picture)).toEqual([null])
  })

  it('takes a code however it was typed, and says plainly when there is no such room', async () => {
    const s = await setup()
    const typed = `${s.room.code.slice(0, 3).toLowerCase()}-${s.room.code.slice(3)}`
    expect((await s.h.call(`/v1/rooms/${typed}/join`, { json: { name: 'Ana' } })).status).toBe(200)
    expect((await s.h.call('/v1/rooms/ZZZZZZ/join', { json: { name: 'Ana' } })).status).toBe(404)
    expect((await s.h.call('/v1/rooms/not-a-code/join', { json: { name: 'Ana' } })).status).toBe(
      404,
    )
  })

  it('lets nobody in without a member’s token', async () => {
    const s = await setup()
    expect((await s.h.call(`/v1/rooms/${s.room.code}`)).status).toBe(401)
    expect((await s.h.call(`/v1/rooms/${s.room.code}?t=${'0'.repeat(32)}`)).status).toBe(401)
    const fine = await s.h.call(`/v1/rooms/${s.room.code}?t=${s.room.token}`)
    expect((await state(fine)).code).toBe(s.room.code)
  })

  it('keeps no token as it was handed out', async () => {
    const s = await setup()
    const stored = JSON.stringify([...s.h.rooms.stored(s.room.code).values()])
    expect(stored).not.toContain(s.room.token)
    expect(stored).not.toContain(s.friend)
  })

  it('makes codes from the room alphabet only', () => {
    for (let index = 0; index < 200; index++) {
      expect(newRoomCode()).toMatch(/^[2-9A-HJKMNP-TV-Z]{6}$/)
    }
  })
})

describe('songs a friend brings', () => {
  it('are lent to the room’s members, ranges and all, from the friend’s own bucket', async () => {
    const s = await setup()
    const mia = await join(s, 'Mia', s.friend)
    const ana = await join(s, 'Ana')
    const added = await state(
      await act(s, mia, { type: 'add', song: song('ヒッチコック') }, s.friend),
    )
    const entry = added.entries[0]?.id ?? ''
    expect(added.order).toEqual([entry])

    const whole = await file(s, ana, entry)
    expect(whole.status).toBe(200)
    expect(await whole.text()).toBe('0123456789')
    const part = await file(s, s.room, entry, 'audio', 'bytes=2-4')
    expect(part.status).toBe(206)
    expect(await part.text()).toBe('234')
    const asked = s.h.bucket.requests.at(-1)?.url.pathname
    expect(asked).toBe(`/${BUCKET}/mia/${AUDIO}`)
  })

  it('may be read by the web app’s audio element, which asks with credentials', async () => {
    const s = await setup()
    const mia = await join(s, 'Mia', s.friend)
    const added = await state(await act(s, mia, { type: 'add', song: song('x') }, s.friend))
    const response = await s.h.call(
      `/v1/rooms/${s.room.code}/files/${added.entries[0]?.id ?? ''}/audio?t=${s.room.token}`,
      { origin: APP_ORIGIN },
    )
    expect(response.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN)
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('need the friend signed in as the member who joined', async () => {
    const s = await setup()
    const mia = await join(s, 'Mia', s.friend)
    expect((await act(s, mia, { type: 'add', song: song('x') })).status).toBe(401)
    // Xiao's session, with Mia's room token: it would lend Xiao's bucket as Mia's.
    expect((await act(s, mia, { type: 'add', song: song('x') }, s.host)).status).toBe(403)
    const ana = await join(s, 'Ana')
    expect((await act(s, ana, { type: 'add', song: song('x') }, s.friend)).status).toBe(403)
  })

  it('lend nothing to anyone outside the room, nor a file the song does not name', async () => {
    const s = await setup()
    const mia = await join(s, 'Mia', s.friend)
    const added = await state(await act(s, mia, { type: 'add', song: song('x') }, s.friend))
    const entry = added.entries[0]?.id ?? ''
    expect((await s.h.call(`/v1/rooms/${s.room.code}/files/${entry}/audio`)).status).toBe(401)
    expect((await file(s, s.room, entry, 'cover')).status).toBe(404)
    expect((await file(s, s.room, entry, 'snapshots')).status).toBe(404)
    expect((await file(s, s.room, 'eeeeeeeeeeee')).status).toBe(404)
  })

  it('stop being lent once the room ends', async () => {
    const s = await setup()
    const mia = await join(s, 'Mia', s.friend)
    const added = await state(await act(s, mia, { type: 'add', song: song('x') }, s.friend))
    const entry = added.entries[0]?.id ?? ''
    expect((await act(s, s.room, { type: 'end' })).status).toBe(200)
    expect((await file(s, mia, entry)).status).toBe(410)
    expect((await act(s, mia, { type: 'skip' })).status).toBe(410)
  })

  it('stop being lent to someone the host removed', async () => {
    const s = await setup()
    const mia = await join(s, 'Mia', s.friend)
    const ana = await join(s, 'Ana')
    const added = await state(await act(s, mia, { type: 'add', song: song('x') }, s.friend))
    const entry = added.entries[0]?.id ?? ''
    await state(await act(s, s.room, { type: 'kick', member: ana.member }))
    expect((await file(s, ana, entry)).status).toBe(403)
    expect((await file(s, mia, entry)).status).toBe(200)
  })
})

describe('a link a guest pastes', () => {
  const LINK = {
    ...song('From a link'),
    uid: null,
    audio: null,
    sourceUrl: 'https://youtu.be/abc',
    link: 'https://youtu.be/abc',
  }

  it('plays for everyone through the host’s server, once the host says where it is', async () => {
    const s = await setup()
    const ana = await join(s, 'Ana')
    const asked: Array<{ url: string; range: string | null }> = []
    s.h.elsewhere.set('pi.example.ts.net', request => {
      asked.push({ url: request.url, range: request.headers.get('range') })
      return new Response('abc', {
        status: 206,
        headers: { 'content-type': 'audio/webm', 'content-range': 'bytes 0-2/3' },
      })
    })
    const added = await state(await act(s, ana, { type: 'addLink', song: LINK }))
    const entry = added.entries[0]?.id ?? ''
    expect((await file(s, ana, entry)).status).toBe(404)

    const told = await s.h.call(`/v1/rooms/${s.room.code}/link-server?t=${s.room.token}`, {
      method: 'PUT',
      json: { base: 'https://pi.example.ts.net', token: 'server-secret' },
    })
    expect((await state(told)).linkRelay).toBe(true)

    const played = await file(s, ana, entry, 'audio', 'bytes=0-2')
    expect(played.status).toBe(206)
    expect(await played.text()).toBe('abc')
    expect(asked[0]?.range).toBe('bytes=0-2')
    const sent = new URL(asked[0]?.url ?? '')
    expect(sent.pathname).toBe('/api/import/listen')
    expect(sent.searchParams.get('url')).toBe('https://youtu.be/abc')
    expect(sent.searchParams.get('token')).toBe('server-secret')
  })

  it('keeps the host’s server and its token from every member', async () => {
    const s = await setup()
    const ana = await join(s, 'Ana')
    await s.h.call(`/v1/rooms/${s.room.code}/link-server?t=${s.room.token}`, {
      method: 'PUT',
      json: { base: 'https://pi.example.ts.net', token: 'server-secret' },
    })
    const seen = JSON.stringify(
      await (await s.h.call(`/v1/rooms/${s.room.code}?t=${ana.token}`)).json(),
    )
    expect(seen).not.toContain('server-secret')
    expect(seen).not.toContain('pi.example')
    const refused = await s.h.call(`/v1/rooms/${s.room.code}/link-server?t=${ana.token}`, {
      method: 'PUT',
      json: { base: 'https://evil.example', token: null },
    })
    expect(refused.status).toBe(403)
  })

  it('takes only an https address with nothing after the host', async () => {
    const s = await setup()
    for (const base of ['http://pi.example', 'https://pi.example/api', 'not a url']) {
      const response = await s.h.call(`/v1/rooms/${s.room.code}/link-server?t=${s.room.token}`, {
        method: 'PUT',
        json: { base, token: null },
      })
      expect(response.status, base).toBe(400)
    }
  })
})

describe('how the room’s songs sound', () => {
  const VECTOR = 'A'.repeat(1024)
  const OTHER = `audio/${'ef'.repeat(32)}.m4a`

  it('is told by each member for their own songs, and read by the room', async () => {
    const s = await setup()
    const mia = await join(s, 'Mia', s.friend)
    await state(await act(s, mia, { type: 'add', song: song('x') }, s.friend))
    const sent = await s.h.call(`/v1/rooms/${s.room.code}/vectors?t=${mia.token}`, {
      json: { model: 'clamp3-saas-1', vectors: { [AUDIO]: VECTOR, [OTHER]: VECTOR } },
    })
    // Mia's own song is kept; one she did not bring is not hers to describe.
    expect(await sent.json()).toEqual({ kept: 1 })
    const read = await s.h.call(`/v1/rooms/${s.room.code}/vectors?t=${s.room.token}`)
    expect(await read.json()).toEqual({ model: 'clamp3-saas-1', vectors: { [AUDIO]: VECTOR } })
  })

  it('keeps one model’s vectors, and none in the room’s state', async () => {
    const s = await setup()
    const mia = await join(s, 'Mia', s.friend)
    await state(await act(s, mia, { type: 'add', song: song('x') }, s.friend))
    await s.h.call(`/v1/rooms/${s.room.code}/vectors?t=${mia.token}`, {
      json: { model: 'clamp3-saas-1', vectors: { [AUDIO]: VECTOR } },
    })
    const other = await s.h.call(`/v1/rooms/${s.room.code}/vectors?t=${mia.token}`, {
      json: { model: 'another-model', vectors: { [AUDIO]: 'B'.repeat(1024) } },
    })
    expect(await other.json()).toEqual({ kept: 0 })
    const seen = JSON.stringify(
      await (await s.h.call(`/v1/rooms/${s.room.code}?t=${mia.token}`)).json(),
    )
    expect(seen).not.toContain(VECTOR)
  })
})

describe('a member’s socket', () => {
  it('hears the room whenever anything changes, and who is online', async () => {
    const s = await setup()
    const ana = await join(s, 'Ana')
    const opened = await s.h.call(`/v1/rooms/${s.room.code}/socket?t=${ana.token}`, {
      headers: { upgrade: 'websocket' },
    })
    expect(opened.status).toBe(200)
    const [socket] = s.h.rooms.sockets(s.room.code)
    const first = RoomStateSchema.parse(socket?.last('state')?.state)
    expect(first.members.find(member => member.id === ana.member)?.online).toBe(true)

    await act(s, s.room, { type: 'settings', keepGoing: false })
    expect(RoomStateSchema.parse(socket?.last('state')?.state).keepGoing).toBe(false)
  })

  it('answers a ping with the room’s clock', async () => {
    const s = await setup()
    await s.h.call(`/v1/rooms/${s.room.code}/socket?t=${s.room.token}`, {
      headers: { upgrade: 'websocket' },
    })
    const [socket] = s.h.rooms.sockets(s.room.code)
    if (!socket) throw new Error('no socket')
    const room = s.h.rooms.rooms.get(s.room.code)?.room
    room?.message(socket, JSON.stringify({ type: 'ping', id: 7 }))
    expect(socket.last('pong')).toEqual({ type: 'pong', id: 7, serverTime: s.h.clock.now })
  })

  it('is told and closed when its member is removed', async () => {
    const s = await setup()
    const ana = await join(s, 'Ana')
    await s.h.call(`/v1/rooms/${s.room.code}/socket?t=${ana.token}`, {
      headers: { upgrade: 'websocket' },
    })
    const [socket] = s.h.rooms.sockets(s.room.code)
    await act(s, s.room, { type: 'kick', member: ana.member })
    expect(socket?.last('gone')).toEqual({ type: 'gone', reason: 'removed' })
    expect(socket?.closed).not.toBeNull()
  })

  it('must be asked for as a WebSocket', async () => {
    const s = await setup()
    expect((await s.h.call(`/v1/rooms/${s.room.code}/socket?t=${s.room.token}`)).status).toBe(426)
  })
})

describe('a room nobody uses', () => {
  it('ends two hours after the last thing anyone did, and is forgotten ten minutes later', async () => {
    const s = await setup()
    const code = s.room.code
    expect(s.h.rooms.alarmOf(code)).toBe(s.h.clock.now + ROOM_IDLE_MS)

    s.h.clock.now += ROOM_IDLE_MS
    await s.h.rooms.ring(code)
    expect((await s.h.call(`/v1/rooms/${code}?t=${s.room.token}`)).status).toBe(410)

    s.h.clock.now += 10 * 60 * 1000
    await s.h.rooms.ring(code)
    expect(s.h.rooms.stored(code).size).toBe(0)
    expect((await s.h.call(`/v1/rooms/${code}?t=${s.room.token}`)).status).toBe(404)
  })

  it('is kept going by anything anyone does', async () => {
    const s = await setup()
    s.h.clock.now += ROOM_IDLE_MS - 1000
    await act(s, s.room, { type: 'settings', keepGoing: false })
    s.h.clock.now += 2000
    await s.h.rooms.ring(s.room.code)
    expect((await s.h.call(`/v1/rooms/${s.room.code}?t=${s.room.token}`)).status).toBe(200)
  })
})

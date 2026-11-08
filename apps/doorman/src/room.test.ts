import {
  addRoomMember,
  DEFAULT_ROOM_RIGHTS,
  newRoomDoc,
  type RoomDoc,
  RoomServerMessageSchema,
  type RoomState,
} from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { RoomObject } from './room.js'

/**
 * The room's Durable Object on the Workers runtime's own sockets, which the
 * fake rooms (fakes.ts) stand in for everywhere else.
 */

const X = 'aaaaaaaaaaaa'
const A = 'dddddddddddd'

/** A hibernating socket as the runtime lists it: its member's tag and its ready state. */
class RuntimeSocket {
  readonly sent: string[] = []
  constructor(
    readonly member: string,
    public readyState: number,
  ) {}
  send(text: string): void {
    this.sent.push(text)
  }
  close(): void {
    this.readyState = 3
  }
  /** The room as this socket was last told it. */
  lastState(): RoomState | undefined {
    for (const text of [...this.sent].reverse()) {
      const message = RoomServerMessageSchema.parse(JSON.parse(text))
      if (message.type === 'state') return message.state
    }
    return undefined
  }
}

function objectWith(sockets: RuntimeSocket[], kept?: (doc: RoomDoc) => unknown): RoomObject {
  let doc = newRoomDoc({
    code: 'KQ7482',
    host: { id: X, name: 'Xiao', picture: null },
    mode: 'everyone',
    rights: DEFAULT_ROOM_RIGHTS,
    keepGoing: true,
    now: Date.now(),
  })
  const joined = addRoomMember(
    doc,
    { id: A, name: 'Ana', kind: 'guest', picture: null },
    Date.now(),
  )
  if ('refused' in joined) throw new Error(joined.message)
  doc = joined
  const values = new Map<string, unknown>([['doc', kept ? kept(doc) : doc]])
  const state = {
    storage: {
      get: (key: string) => Promise.resolve(values.get(key)),
      put: (key: string, value: unknown) => Promise.resolve(void values.set(key, value)),
      deleteAll: () => Promise.resolve(values.clear()),
      setAlarm: () => Promise.resolve(),
    },
    getTags: (ws: RuntimeSocket) => [ws.member],
    getWebSockets: () => sockets,
    acceptWebSocket: () => undefined,
  }
  return new RoomObject(state as unknown as DurableObjectState)
}

describe('a socket the runtime closes', () => {
  it('tells everyone else its member went away, though the runtime still lists it', async () => {
    // workerd lists a socket in its own webSocketClose: closing (2), and
    // closed (3) once it is closed back.
    const host = new RuntimeSocket(X, 2)
    const ana = new RuntimeSocket(A, 1)
    const object = objectWith([host, ana])
    await object.webSocketClose(host as unknown as WebSocket, 1001, 'tab closed')
    const told = ana.lastState()
    expect(told?.members.find(member => member.id === X)?.online).toBe(false)
    expect(told?.members.find(member => member.id === A)?.online).toBe(true)
    expect(host.sent).toEqual([])
  })

  it('takes a socket that broke as one that closed', async () => {
    const host = new RuntimeSocket(X, 3)
    const ana = new RuntimeSocket(A, 1)
    await objectWith([host, ana]).webSocketError(host as unknown as WebSocket)
    expect(ana.lastState()?.members.find(member => member.id === X)?.online).toBe(false)
  })
})

describe('a room kept before wants were stamped', () => {
  it('still reads, want and all', async () => {
    const host = new RuntimeSocket(X, 3)
    const ana = new RuntimeSocket(A, 1)
    const object = objectWith([host, ana], doc => ({
      ...doc,
      want: { seq: 3, kind: 'skip', by: A },
    }))
    await object.webSocketClose(host as unknown as WebSocket, 1001, 'tab closed')
    expect(ana.lastState()?.want).toEqual({ seq: 3, kind: 'skip', by: A })
  })
})

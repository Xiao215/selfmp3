import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOORMAN_ERROR, DoormanError } from '@selfmp3/shared'

/*
 * The room's line to the doorman, over a fake socket: that a line gone quiet
 * is noticed in seconds rather than whenever the phone gets round to closing
 * it, and what a song that stopped is told when it asks (`checkRoomLink`).
 */

const PASS = { code: 'KQ7482', member: 'm1', token: 't' }

const mocks = vi.hoisted(() => ({
  prefs: new Map<string, string>(),
  kind: 'wifi' as 'wifi' | 'cellular',
  mode: 'everyone' as 'everyone' | 'speaker',
  toasts: [] as string[],
  /** What the doorman answers each action with, in turn; anything past them is refused. */
  answers: [] as Promise<unknown>[],
  /** Every action sent, with the room it was sent to. */
  acts: [] as { code: string; type: string }[],
  /** What the next join answers instead of a way in, when set. */
  refuseJoin: null as Error | null,
}))

vi.mock('../../ports/prefs', () => ({
  prefs: {
    get: (key: string) => mocks.prefs.get(key) ?? null,
    set: (key: string, value: string) => mocks.prefs.set(key, value),
  },
}))
vi.mock('../../ports/doormanUrl', () => ({ doormanUrl: 'https://doorman.example' }))
vi.mock('../guide/guideMemory', () => ({ markGuideSeen: () => undefined }))
vi.mock('../../replica', () => ({ session: { loadSession: async () => ({ token: 's' }) } }))
vi.mock('../../offline/connectionKind', () => ({ connectionKind: async () => mocks.kind }))
vi.mock('../../ui/toast', () => ({ showToast: (text: string) => mocks.toasts.push(text) }))
vi.mock('@selfmp3/client', async importActual => ({
  ...(await importActual<typeof import('@selfmp3/client')>()),
  createRoomApi: () => ({
    socketUrl: () => 'wss://doorman.example/room/socket',
    join: async (code: string) => {
      if (mocks.refuseJoin) throw mocks.refuseJoin
      return {
        ...PASS,
        code,
        state: { code, you: PASS.member, mode: mocks.mode, members: [] },
      }
    },
    state: () => new Promise(() => undefined),
    act: (pass: { code: string }, action: { type: string }) => {
      mocks.acts.push({ code: pass.code, type: action.type })
      return mocks.answers.shift() ?? Promise.reject(new Error('no answer'))
    },
  }),
}))

/** The socket the store opened last; it answers only what a test makes it. */
class FakeSocket {
  static OPEN = 1
  static last: FakeSocket | null = null
  readyState = 0
  sent: { type: string; id: number }[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) {
    FakeSocket.last = this
  }
  send(text: string): void {
    this.sent.push(JSON.parse(text) as { type: string; id: number })
  }
  close(): void {
    this.closed = true
  }
  open(): void {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }
  gone(): void {
    this.onmessage?.({ data: JSON.stringify({ type: 'gone', reason: 'ended' }) })
  }
  pong(): void {
    const ping = this.sent.at(-1)
    if (ping)
      this.onmessage?.({ data: JSON.stringify({ type: 'pong', id: ping.id, serverTime: 0 }) })
  }
}
vi.stubGlobal('WebSocket', FakeSocket)

const store = await import('./room.store')

/** Into the room, with its socket open. */
async function inRoom(): Promise<FakeSocket> {
  await store.joinRoom(PASS.code, 'Xiao')
  const socket = FakeSocket.last
  if (!socket) throw new Error('no socket opened')
  socket.open()
  return socket
}

describe('the room’s line', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.kind = 'wifi'
    mocks.mode = 'everyone'
    mocks.toasts.length = 0
    mocks.answers.length = 0
    mocks.acts.length = 0
    mocks.refuseJoin = null
  })
  afterEach(async () => {
    await store.leaveRoom()
    vi.useRealTimers()
  })

  it('takes a ping that goes unanswered as the line gone, and says Reconnecting', async () => {
    const socket = await inRoom()
    socket.pong()
    expect(store.currentRoom().link).toBe('live')

    // The next ping, into a line that went quiet.
    vi.advanceTimersByTime(10_000)
    vi.advanceTimersByTime(5_000)
    expect(store.currentRoom().link).toBe('live')
    vi.advanceTimersByTime(1_000)
    expect(store.currentRoom().link).toBe('offline')
    expect(socket.closed).toBe(true)
  })

  it('tells a song that asks whether the room still hears this device', async () => {
    const socket = await inRoom()
    socket.pong()

    const heard = store.checkRoomLink()
    socket.pong()
    await expect(heard).resolves.toBe(true)

    const unheard = store.checkRoomLink()
    vi.advanceTimersByTime(6_000)
    await expect(unheard).resolves.toBe(false)
    // Already down: no need to wait to say so.
    await expect(store.checkRoomLink()).resolves.toBe(false)
  })

  it('says so once, joining on mobile data, and nothing on Wi-Fi', async () => {
    await inRoom()
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.toasts).toEqual([])
    await store.leaveRoom()

    mocks.kind = 'cellular'
    await inRoom()
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.toasts).toEqual([
      { say: 'You’re on mobile data', under: 'A room streams every song, about 5 MB each.' },
    ])
  })

  it('keeps a newer room over the answer to an older action', async () => {
    await inRoom()
    const older = Promise.withResolvers<unknown>()
    mocks.answers.push(older.promise, Promise.resolve({ code: PASS.code, serverTime: 200 }))
    const first = store.roomAct({ type: 'skip' })
    await store.roomAct({ type: 'skip' })
    expect(store.currentRoom().state?.serverTime).toBe(200)
    // The first action's answer lands last, from before the second.
    older.resolve({ code: PASS.code, serverTime: 100 })
    await first
    expect(store.currentRoom().state?.serverTime).toBe(200)
  })

  it('does not finish the room joined after the one that said it was gone', async () => {
    const socket = await inRoom()
    socket.gone()
    await store.leaveRoom()
    await inRoom()
    vi.advanceTimersByTime(300)
    expect(store.currentRoom().pass).not.toBeNull()
  })

  it('says nothing to a remote, in a room that plays on one speaker', async () => {
    mocks.kind = 'cellular'
    mocks.mode = 'speaker'
    await inRoom()
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.toasts).toEqual([])
  })

  it('keeps the room you are in when the one you try to join has ended', async () => {
    await inRoom()
    mocks.refuseJoin = new DoormanError(410, DOORMAN_ERROR.roomEnded, 'this room has ended')
    await expect(store.joinRoom('ZZ9999', 'Xiao')).rejects.toThrow('this room has ended')
    expect(store.currentRoom().pass?.code).toBe(PASS.code)
    expect(mocks.acts).toEqual([])

    // One that lets you in: the old room hears you leave, and you are in the new one.
    mocks.refuseJoin = null
    const ended: string[] = []
    const stop = store.onRoomEnded(state => ended.push(state.code))
    await store.joinRoom('ZZ9999', 'Xiao')
    stop()
    expect(mocks.acts).toEqual([{ code: PASS.code, type: 'leave' }])
    expect(ended).toEqual([PASS.code])
    expect(store.currentRoom().pass?.code).toBe('ZZ9999')
  })
})

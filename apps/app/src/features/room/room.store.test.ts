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
  /** Whether the next join comes in as the room's host. */
  host: false,
  /** What of yours the next join's room lends from your bucket: a song you brought, or a shelf. */
  lends: null as 'songs' | 'shelf' | null,
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
        state: {
          code,
          you: PASS.member,
          mode: mocks.mode,
          members: mocks.host ? [{ id: PASS.member, kind: 'host' }] : [],
          entries: mocks.lends === 'songs' ? [{ id: 'e1', owner: PASS.member }] : [],
          shelves: mocks.lends === 'shelf' ? [{ member: PASS.member, songs: [] }] : [],
        },
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

/** Out of the room, the doorman hearing it. */
async function leave(): Promise<void> {
  mocks.answers.push(Promise.resolve(null))
  await store.leaveRoom()
}

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
    mocks.host = false
    mocks.lends = null
  })
  afterEach(async () => {
    if (store.currentRoom().pass) await leave()
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
    await leave()

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
    mocks.answers.push(
      older.promise,
      Promise.resolve({ code: PASS.code, serverTime: 200, members: [] }),
    )
    const first = store.roomAct({ type: 'skip' })
    await store.roomAct({ type: 'skip' })
    expect(store.currentRoom().state?.serverTime).toBe(200)
    // The first action's answer lands last, from before the second.
    older.resolve({ code: PASS.code, serverTime: 100, members: [] })
    await first
    expect(store.currentRoom().state?.serverTime).toBe(200)
  })

  it('does not finish the room joined after the one that said it was gone', async () => {
    const socket = await inRoom()
    socket.gone()
    await leave()
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

  it('keeps the host in the room when their end does not reach the doorman', async () => {
    mocks.host = true
    await inRoom()
    const ended: string[] = []
    const stop = store.onRoomEnded(state => ended.push(state.code))
    // Offline: the request never gets there.
    mocks.answers.push(Promise.reject(new TypeError('Failed to fetch')))
    await expect(store.leaveRoom()).rejects.toThrow('Failed to fetch')
    expect(store.currentRoom().pass?.code).toBe(PASS.code)
    expect(mocks.prefs.get('room.pass')).toContain(PASS.code)
    expect(ended).toEqual([])

    // Back online: pressed again, it is heard, and the room is over here.
    await leave()
    stop()
    expect(store.currentRoom().pass).toBeNull()
    expect(ended).toEqual([PASS.code])
  })

  it('lets a guest leave here though the doorman did not hear it', async () => {
    await inRoom()
    mocks.answers.push(Promise.reject(new TypeError('Failed to fetch')))
    await expect(store.leaveRoom()).resolves.toBe(false)
    expect(store.currentRoom().pass).toBeNull()
    expect(mocks.prefs.get('room.pass')).toBe('null')
  })

  it('keeps a friend in whose songs the room lends, when their leave does not reach the doorman', async () => {
    // Heard, the leave stops the room lending what they brought; unheard, it would go on.
    mocks.lends = 'songs'
    await inRoom()
    mocks.answers.push(Promise.reject(new TypeError('Failed to fetch')))
    await expect(store.leaveRoom()).rejects.toThrow('Failed to fetch')
    expect(store.currentRoom().pass?.code).toBe(PASS.code)

    // Off to another room: not without leaving this one first. The room it
    // got into is left again, so no member of it waits there who never comes.
    mocks.acts.length = 0
    mocks.answers.push(Promise.reject(new TypeError('Failed to fetch')))
    await expect(store.joinRoom('ZZ9999', 'Mia')).rejects.toThrow('Failed to fetch')
    expect(store.currentRoom().pass?.code).toBe(PASS.code)
    expect(mocks.acts).toEqual([
      { code: PASS.code, type: 'leave' },
      { code: 'ZZ9999', type: 'leave' },
    ])
  })

  it('keeps a friend in whose shelf the room lends from, when their leave is not heard', async () => {
    mocks.lends = 'shelf'
    await inRoom()
    mocks.answers.push(Promise.reject(new TypeError('Failed to fetch')))
    await expect(store.leaveRoom()).rejects.toThrow('Failed to fetch')
    expect(store.currentRoom().pass?.code).toBe(PASS.code)
  })

  it('lets a host go whose pass the doorman refuses outright', async () => {
    mocks.host = true
    await inRoom()
    mocks.answers.push(
      Promise.reject(
        new DoormanError(401, DOORMAN_ERROR.roomUnauthorized, 'that is not a way into this room'),
      ),
    )
    await expect(store.leaveRoom()).resolves.toBe(false)
    expect(store.currentRoom().pass).toBeNull()
  })

  it('takes a room that is already over as left', async () => {
    await inRoom()
    const ended: string[] = []
    const stop = store.onRoomEnded((state, how) => ended.push(`${state.code} ${how}`))
    mocks.answers.push(
      Promise.reject(new DoormanError(410, DOORMAN_ERROR.roomEnded, 'this room has ended')),
    )
    await store.leaveRoom()
    stop()
    expect(store.currentRoom().pass).toBeNull()
    expect(ended).toEqual([`${PASS.code} left`])
  })

  it('plays the room in one tab of a browser, and in the next once that one closes', async () => {
    const lock = `selfmp3-room ${PASS.code}`
    // Alone, this tab plays it.
    await inRoom()
    await vi.waitFor(() => expect(store.currentRoom().lead).toBe('here'))
    await leave()
    // Let go with the room: another tab may take it.
    await navigator.locks.request(lock, { ifAvailable: true }, held => expect(held).not.toBeNull())

    // Another tab of this browser plays the room already.
    const otherCloses = Promise.withResolvers<void>()
    const otherHolds = Promise.withResolvers<void>()
    void navigator.locks.request(lock, () => {
      otherHolds.resolve()
      return otherCloses.promise
    })
    await otherHolds.promise
    await inRoom()
    await vi.waitFor(() => expect(store.currentRoom().lead).toBe('elsewhere'))
    otherCloses.resolve()
    await vi.waitFor(() => expect(store.currentRoom().lead).toBe('here'))
  })

  it('keeps playing a room that ended until it has finished it, for a tab yet to hear the end', async () => {
    const lock = `selfmp3-room ${PASS.code}`
    const socket = await inRoom()
    await vi.waitFor(() => expect(store.currentRoom().lead).toBe('here'))
    socket.gone()
    // Another tab asking for it now waits on: this one still has it.
    const meanwhile = navigator.locks.request(
      lock,
      { signal: AbortSignal.timeout(200) },
      () => true,
    )
    await expect(meanwhile).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(300)
    expect(store.currentRoom().pass).toBeNull()
    const ours = navigator.locks.request(lock, { signal: AbortSignal.timeout(2000) }, () => true)
    await expect(ours).resolves.toBe(true)
  })

  it('does not take up a room that ended while another tab played it', async () => {
    const lock = `selfmp3-room ${PASS.code}`
    const otherCloses = Promise.withResolvers<void>()
    const otherHolds = Promise.withResolvers<void>()
    void navigator.locks.request(lock, () => {
      otherHolds.resolve()
      return otherCloses.promise
    })
    await otherHolds.promise
    const socket = await inRoom()
    await vi.waitFor(() => expect(store.currentRoom().lead).toBe('elsewhere'))
    // The room ends; the tab that played it lets go before this one has finished it.
    socket.gone()
    otherCloses.resolve()
    // Ours once the other tab is gone: this one, waiting before us, did not take it.
    const ours = navigator.locks.request(lock, { signal: AbortSignal.timeout(2000) }, () => true)
    await expect(ours).resolves.toBe(true)
    expect(store.currentRoom().lead).not.toBe('here')
    await vi.advanceTimersByTimeAsync(300)
    expect(store.currentRoom().pass).toBeNull()
  })
})

import { useSyncExternalStore } from 'react'
import {
  RoomServerMessageSchema,
  type RoomAction,
  type RoomCreate,
  type RoomState,
} from '@selfmp3/shared'
import {
  clockOffset,
  createRoomApi,
  RoomError,
  withClockSample,
  type ClockSample,
  type RoomPass,
} from '@selfmp3/client'
import { doormanUrl } from '../../ports/doormanUrl'
import { prefs } from '../../ports/prefs'
import { session as cloudSession } from '../../replica'

/**
 * The room this device is in, if any (docs/features/listen-together.md): its
 * pass (which room, which member, the token), the room as its socket last
 * said, and the doorman's clock as seen from here.
 *
 * One room at a time, held outside React because the socket outlives every
 * screen: Up next draws it, the room's provider plays it, and Join and Leave
 * change it from wherever they are pressed. The pass is kept on this device,
 * so an app opened again goes back into the room it was in.
 */

interface RoomView {
  readonly pass: RoomPass | null
  /** The room as it last came down the socket, or from an action's answer. */
  readonly state: RoomState | null
  /** Doorman time minus this device's, in ms. */
  readonly offset: number
  /** Whether the socket is up: a room shown while it reconnects says so. */
  readonly link: 'connecting' | 'live' | 'offline'
}

const PASS_KEY = 'room.pass'

/** How often the socket pings: the clock's samples, and a check the line is still there. */
const PING_MS = 10_000
/** The longest wait between tries at reconnecting. */
const MAX_BACKOFF_MS = 15_000

export const roomApi = createRoomApi(doormanUrl, (url, init) =>
  fetch(url, {
    ...(init?.method ? { method: init.method } : {}),
    ...(init?.headers ? { headers: init.headers } : {}),
    ...(init?.body ? { body: init.body } : {}),
  }),
)

let view: RoomView = { pass: readPass(), state: null, offset: 0, link: 'offline' }
const listeners = new Set<() => void>()
const endedListeners = new Set<(state: RoomState) => void>()

function set(next: Partial<RoomView>): void {
  view = { ...view, ...next }
  for (const listener of listeners) listener()
}

function readPass(): RoomPass | null {
  try {
    const stored: unknown = JSON.parse(prefs.get(PASS_KEY) ?? 'null')
    if (
      typeof stored === 'object' &&
      stored !== null &&
      'code' in stored &&
      'member' in stored &&
      'token' in stored &&
      typeof stored.code === 'string' &&
      typeof stored.member === 'string' &&
      typeof stored.token === 'string'
    ) {
      return { code: stored.code, member: stored.member, token: stored.token }
    }
  } catch {
    // A pass that does not read is no pass.
  }
  return null
}

export function currentRoom(): RoomView {
  return view
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = (): RoomView => view

export function useRoom(): RoomView {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Hear when a room this device was in ends, with how it ended: what Recently played keeps. */
export function onRoomEnded(listener: (state: RoomState) => void): () => void {
  endedListeners.add(listener)
  return () => endedListeners.delete(listener)
}

// --- the socket ------------------------------------------------------------------

let socket: WebSocket | null = null
let pinger: ReturnType<typeof setInterval> | null = null
let retry: ReturnType<typeof setTimeout> | null = null
let backoff = 1000
let samples: ClockSample[] = []
let pings = 0
const pingsSent = new Map<number, number>()

function closeSocket(): void {
  if (pinger) clearInterval(pinger)
  if (retry) clearTimeout(retry)
  pinger = null
  retry = null
  if (socket) {
    socket.onopen = null
    socket.onmessage = null
    socket.onclose = null
    socket.onerror = null
    try {
      socket.close()
    } catch {
      // Already closed.
    }
  }
  socket = null
}

/** Open (or reopen) the socket for the room this device is in. */
export function connectRoom(): void {
  const pass = view.pass
  closeSocket()
  if (!pass) return
  set({ link: 'connecting' })
  const opened = new WebSocket(roomApi.socketUrl(pass))
  socket = opened

  const ping = (): void => {
    if (opened.readyState !== WebSocket.OPEN) return
    const id = ++pings
    pingsSent.set(id, Date.now())
    opened.send(JSON.stringify({ type: 'ping', id }))
  }

  opened.onopen = () => {
    backoff = 1000
    set({ link: 'live' })
    ping()
    pinger = setInterval(ping, PING_MS)
  }
  opened.onmessage = event => {
    let data: unknown
    try {
      data = JSON.parse(String(event.data))
    } catch {
      return
    }
    const message = RoomServerMessageSchema.safeParse(data)
    if (!message.success) return
    switch (message.data.type) {
      case 'state':
        set({ state: message.data.state })
        return
      case 'pong': {
        const sentAt = pingsSent.get(message.data.id)
        pingsSent.delete(message.data.id)
        if (sentAt === undefined) return
        samples = withClockSample(samples, {
          sentAt,
          receivedAt: Date.now(),
          serverTime: message.data.serverTime,
        })
        set({ offset: clockOffset(samples) })
        return
      }
      case 'gone':
        // The final state follows the word, when the room ended; wait a beat
        // for it so the room is remembered as it finished.
        setTimeout(() => finish(), 300)
        return
    }
  }
  opened.onclose = () => {
    if (socket !== opened) return
    socket = null
    if (pinger) clearInterval(pinger)
    pinger = null
    if (!view.pass) return
    set({ link: 'offline' })
    retry = setTimeout(() => {
      // Asked first whether the room is still there, so a room that ended
      // while this device slept is finished rather than retried forever.
      const current = view.pass
      if (!current) return
      roomApi.state(current).then(
        state => {
          set({ state })
          connectRoom()
        },
        (error: unknown) => {
          if (error instanceof RoomError && error.gone) finish()
          else connectRoom()
        },
      )
    }, backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  }
}

/** The room is over for this device: remember it, and let it go. */
function finish(): void {
  const last = view.state
  forgetRoom()
  if (last) for (const listener of endedListeners) listener(last)
}

/** Out of the room here, without telling it: what Leave does once the room has heard. */
function forgetRoom(): void {
  closeSocket()
  samples = []
  prefs.set(PASS_KEY, 'null')
  set({ pass: null, state: null, offset: 0, link: 'offline' })
}

function enter(pass: RoomPass, state: RoomState): void {
  prefs.set(PASS_KEY, JSON.stringify(pass))
  samples = []
  set({ pass, state, offset: 0 })
  connectRoom()
}

// --- starting from what was playing ---------------------------------------------

/**
 * Where the host's player should start the room's first song: Together keeps
 * what was playing, at the place it was, and the room's provider plays the
 * room from there once it has the room's songs as tracks.
 */
let startHint: { readonly position: number; readonly autoplay: boolean } | null = null

export function setRoomStartHint(hint: { position: number; autoplay: boolean } | null): void {
  startHint = hint
}

/** The hint, once: a room's first start takes it, and later starts begin at the top. */
export function takeRoomStartHint(): { position: number; autoplay: boolean } | null {
  const hint = startHint
  startHint = null
  return hint
}

// --- what a device does ------------------------------------------------------------

/** The session this device is signed in with, if any: what lets you bring your own songs. */
async function sessionToken(): Promise<string | null> {
  const signedIn = await cloudSession.loadSession().catch(() => null)
  return signedIn?.token ?? null
}

/** Open a room: needs this device signed in. */
export async function startRoom(input: RoomCreate): Promise<RoomState> {
  const token = await sessionToken()
  if (!token) throw new RoomError(401, 'unauthorized', 'sign in to open a room')
  const joined = await roomApi.create(token, input)
  enter({ code: joined.code, member: joined.member, token: joined.token }, joined.state)
  return joined.state
}

/** Join with a code: as a friend who can bring songs when signed in, else as a guest. */
export async function joinRoom(code: string, name: string): Promise<RoomState> {
  const joined = await roomApi.join(code, name, await sessionToken())
  enter({ code: joined.code, member: joined.member, token: joined.token }, joined.state)
  return joined.state
}

/** Do something in the room; the answer is the room as it now is. */
export async function roomAct(action: RoomAction): Promise<RoomState> {
  const pass = view.pass
  if (!pass) throw new RoomError(404, 'room_missing', 'you are not in a room')
  try {
    const state = await roomApi.act(
      pass,
      action,
      action.type === 'add' ? await sessionToken() : null,
    )
    if (view.pass === pass) set({ state })
    return state
  } catch (error) {
    if (error instanceof RoomError && error.gone) finish()
    throw error
  }
}

/** Leave: the host's leaving ends the room for everyone. */
export async function leaveRoom(): Promise<void> {
  const ending = view.state
  await roomAct({ type: 'leave' }).catch(() => undefined)
  forgetRoom()
  if (ending) for (const listener of endedListeners) listener(ending)
}

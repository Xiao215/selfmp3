import { useSyncExternalStore } from 'react'
import {
  DOORMAN_ERROR,
  DoormanError,
  RoomServerMessageSchema,
  type DoormanFetch,
  type RoomAction,
  type RoomCreate,
  type RoomState,
} from '@selfmp3/shared'
import {
  clockOffset,
  createRoomApi,
  withClockSample,
  type ClockSample,
  type RoomPass,
} from '@selfmp3/client'
import { doormanUrl } from '../../ports/doormanUrl'
import { prefs } from '../../ports/prefs'
import { isHost } from './room.model'
import { connectionKind } from '../../offline/connectionKind'
import { showToast } from '../../ui/toast'
import { session as cloudSession } from '../../replica'
import { countUse } from '../usage/usage'

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
/**
 * How long a ping may go unanswered before the line is taken to be down. A
 * phone that walks out of signal keeps its socket "open" for a minute or more;
 * this is what notices sooner, so the room says Reconnecting… and a song that
 * stopped waits for it (`checkRoomLink`).
 */
const PONG_WAIT_MS = 6000
/** The longest wait between tries at reconnecting. */
const MAX_BACKOFF_MS = 15_000

/**
 * The global fetch, as packages/shared's doorman client asks for one. Its
 * shapes are structural and have no DOM in them, so the body's type is the
 * platform's to vouch for, as `cloudPlatform` does.
 */
export const plainFetch: DoormanFetch = (url, init) => fetch(url, init as RequestInit)

export const roomApi = createRoomApi(doormanUrl, plainFetch)

let view: RoomView = { pass: readPass(), state: null, offset: 0, link: 'offline' }
const listeners = new Set<() => void>()
/**
 * How a room ended for this device: it left (or, as host, ended it), the host
 * ended it (or it sat idle), or the host took this device out of it.
 */
export type RoomEnd = 'left' | 'ended' | 'removed'

const endedListeners = new Set<(state: RoomState, how: RoomEnd) => void>()

function set(next: Partial<RoomView>): void {
  view = { ...view, ...next }
  for (const listener of listeners) listener()
}

/**
 * Take a state the doorman sent for the room `pass` let this device into, if
 * this device is still in that room and the state is not older than the one
 * already held. An action's answer and the socket race each other: a change
 * someone else made can come down the socket before the answer to an earlier
 * one, and the answer must not put the room back as it was. Every state is
 * stamped with the doorman's clock as it was sent (`serverTime`), which only
 * moves forward from one change to the next.
 */
function takeState(pass: RoomPass, state: RoomState): void {
  if (view.pass !== pass) return
  if (view.state && state.serverTime < view.state.serverTime) return
  set({ state })
}

/**
 * The room is over, if it is still the one `pass` let this device into: an
 * answer or a timer that started for one room never finishes the next one,
 * nor a room already left.
 */
function finishIfStill(pass: RoomPass, how: RoomEnd): void {
  if (view.pass === pass) finish(how)
}

/** How a refusal that says the room is over for this member came about. */
function endOf(error: DoormanError): RoomEnd {
  return error.code === DOORMAN_ERROR.roomLeft ? 'removed' : 'ended'
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

export function subscribeRoom(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = (): RoomView => view

export function useRoom(): RoomView {
  return useSyncExternalStore(subscribeRoom, snapshot, snapshot)
}

/** Hear when a room this device was in ends, with how it ended: what Recently played keeps. */
export function onRoomEnded(listener: (state: RoomState, how: RoomEnd) => void): () => void {
  endedListeners.add(listener)
  return () => endedListeners.delete(listener)
}

/**
 * The shared playlist each room was kept as (`Keep as a shared playlist`), so
 * the room's page in Recently played can open it.
 */
const keptAs = new Map<string, string>()

export function noteKeptAs(code: string, shared: string): void {
  keptAs.set(code, shared)
}

export function keptAsOf(code: string): string | null {
  return keptAs.get(code) ?? null
}

// --- the socket ------------------------------------------------------------------

let socket: WebSocket | null = null
let pinger: ReturnType<typeof setInterval> | null = null
let retry: ReturnType<typeof setTimeout> | null = null
let backoff = 1000
let samples: ClockSample[] = []
let pings = 0
const pingsSent = new Map<number, number>()
/** The unanswered ping's deadline. */
let pongDue: ReturnType<typeof setTimeout> | null = null
/** A ping sent now, on the open socket; null while there is none. */
let pingNow: (() => void) | null = null
/** Who asked whether the line is up (`checkRoomLink`), told with the next pong or its loss. */
const linkWaiters = new Set<(alive: boolean) => void>()

function tellLinkWaiters(alive: boolean): void {
  for (const waiter of linkWaiters) waiter(alive)
  linkWaiters.clear()
}

/**
 * Whether the room can still hear this device, asked now: a ping, and its
 * pong or not within a few seconds. A song of the room's that stopped asks
 * this before it is skipped — a connection that dropped is waited out, a song
 * that will not play is not (player/PlayerProvider).
 */
export function checkRoomLink(): Promise<boolean> {
  if (!view.pass || view.link !== 'live' || !pingNow) return Promise.resolve(false)
  const ping = pingNow
  return new Promise(resolve => {
    linkWaiters.add(resolve)
    ping()
  })
}

function closeSocket(): void {
  if (pinger) clearInterval(pinger)
  if (retry) clearTimeout(retry)
  if (pongDue) clearTimeout(pongDue)
  pinger = null
  retry = null
  pongDue = null
  pingNow = null
  tellLinkWaiters(false)
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
    if (!pongDue) pongDue = setTimeout(lost, PONG_WAIT_MS)
  }

  opened.onopen = () => {
    backoff = 1000
    pingNow = ping
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
        takeState(pass, message.data.state)
        return
      case 'pong': {
        const sentAt = pingsSent.get(message.data.id)
        pingsSent.delete(message.data.id)
        if (sentAt === undefined) return
        if (pongDue) clearTimeout(pongDue)
        pongDue = null
        tellLinkWaiters(true)
        samples = withClockSample(samples, {
          sentAt,
          receivedAt: Date.now(),
          serverTime: message.data.serverTime,
        })
        set({ offset: clockOffset(samples) })
        return
      }
      case 'gone': {
        // The final state follows the word, when the room ended; wait a beat
        // for it so the room is remembered as it finished.
        const how = message.data.reason
        setTimeout(() => finishIfStill(pass, how), 300)
        return
      }
    }
  }
  // Closed, or a ping that went unanswered: the line is down either way.
  function lost(): void {
    if (socket !== opened) return
    socket = null
    opened.onopen = null
    opened.onmessage = null
    opened.onclose = null
    opened.onerror = null
    try {
      opened.close()
    } catch {
      // Already closed.
    }
    if (pinger) clearInterval(pinger)
    if (pongDue) clearTimeout(pongDue)
    pinger = null
    pongDue = null
    pingNow = null
    tellLinkWaiters(false)
    if (!view.pass) return
    set({ link: 'offline' })
    retry = setTimeout(() => {
      // Asked first whether the room is still there, so a room that ended
      // while this device slept is finished rather than retried forever.
      const current = view.pass
      if (!current) return
      roomApi.state(current).then(
        state => {
          if (view.pass !== current) return
          takeState(current, state)
          connectRoom()
        },
        (error: unknown) => {
          if (view.pass !== current) return
          if (error instanceof DoormanError && error.gone) finish(endOf(error))
          else connectRoom()
        },
      )
    }, backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  }
  opened.onclose = lost
}

/** The room is over for this device: remember it, and let it go. */
function finish(how: RoomEnd): void {
  const last = view.state
  forgetRoom()
  if (last) for (const listener of endedListeners) listener(last, how)
}

/** Out of the room here, without telling it: what Leave does once the room has heard. */
function forgetRoom(): void {
  closeSocket()
  samples = []
  // A room left before its first song: the next one decides afresh.
  startHint = null
  prefs.set(PASS_KEY, 'null')
  set({ pass: null, state: null, offset: 0, link: 'offline' })
}

function enter(pass: RoomPass, state: RoomState): void {
  prefs.set(PASS_KEY, JSON.stringify(pass))
  samples = []
  set({ pass, state, offset: 0 })
  connectRoom()
  void sayIfMobileData(state)
}

/**
 * Said once as you open or join a room on a phone's mobile data, where this
 * device will play the room: a room works on any connection that holds, but
 * it streams every song a friend brings, which a data plan should hear about.
 * A remote in a one-speaker room plays nothing, and a computer is never on
 * mobile data (`connectionKind`).
 */
async function sayIfMobileData(state: RoomState): Promise<void> {
  if (state.mode !== 'everyone' && !isHost(state)) return
  if ((await connectionKind()) === 'cellular') {
    showToast({
      say: 'You’re on mobile data',
      under: 'A room streams every song, about 5 MB each.',
    })
  }
}

// --- starting from what was playing ---------------------------------------------

/**
 * How the host's player should start the room's first song. Opened from the
 * player, the room keeps what was playing at the place it was; opened from a
 * list, or from Home, its first song takes over from whatever of your own was
 * playing (`takeOver`), since that is what you opened it for.
 */
export interface RoomStartHint {
  readonly position: number
  readonly autoplay: boolean
  readonly takeOver: boolean
}

let startHint: RoomStartHint | null = null

export function setRoomStartHint(hint: RoomStartHint | null): void {
  startHint = hint
}

/** Whether the room's first song may take over from your own music. */
export function roomMayTakeOver(): boolean {
  return startHint?.takeOver ?? false
}

/** The hint, once: a room's first start takes it, and later starts begin at the top. */
export function takeRoomStartHint(): RoomStartHint | null {
  const hint = startHint
  startHint = null
  return hint
}

/**
 * Whether the room's sheet is the one Start grew into, read once by the room's
 * sheet so it arrives (M1) then, and is simply there every time after.
 */
let opened = false

export function noteRoomOpened(): void {
  opened = true
}

export function takeRoomOpened(): boolean {
  const was = opened
  opened = false
  return was
}

// --- what a device does ------------------------------------------------------------

/** The session this device is signed in with, if any: what lets you bring your own songs. */
async function sessionToken(): Promise<string | null> {
  const signedIn = await cloudSession.loadSession().catch(() => null)
  return signedIn?.token ?? null
}

/**
 * One room at a time: the room this device was in hears it leave, once the
 * next one has let it in. A code that turns out dead (an ended room, an old
 * invite) is refused before anything is given up.
 */
async function leaveFor(code: string): Promise<void> {
  const pass = view.pass
  const ending = view.state
  if (!pass || pass.code === code) return
  await roomApi.act(pass, { type: 'leave' }, null).catch(() => undefined)
  if (view.pass !== pass) return
  closeSocket()
  if (ending) for (const listener of endedListeners) listener(ending, 'left')
}

/** Open a room: needs this device signed in. */
export async function startRoom(input: RoomCreate): Promise<RoomState> {
  const token = await sessionToken()
  if (!token) throw new DoormanError(401, DOORMAN_ERROR.unauthorized, 'sign in to open a room')
  const joined = await roomApi.create(token, input)
  countUse('room')
  await leaveFor(joined.code)
  enter({ code: joined.code, member: joined.member, token: joined.token }, joined.state)
  return joined.state
}

/** Join with a code: as a friend who can bring songs when signed in, else as a guest. */
export async function joinRoom(code: string, name: string): Promise<RoomState> {
  const joined = await roomApi.join(code, name, await sessionToken())
  await leaveFor(joined.code)
  enter({ code: joined.code, member: joined.member, token: joined.token }, joined.state)
  return joined.state
}

/** Do something in the room; the answer is the room as it now is. */
export async function roomAct(action: RoomAction): Promise<RoomState> {
  const pass = view.pass
  if (!pass) throw new DoormanError(404, DOORMAN_ERROR.roomMissing, 'you are not in a room')
  try {
    const state = await roomApi.act(
      pass,
      action,
      action.type === 'add' ? await sessionToken() : null,
    )
    takeState(pass, state)
    return state
  } catch (error) {
    if (error instanceof DoormanError && error.gone) finishIfStill(pass, endOf(error))
    throw error
  }
}

/** Leave: the host's leaving ends the room for everyone. */
export async function leaveRoom(): Promise<void> {
  const ending = view.state
  await roomAct({ type: 'leave' }).catch(() => undefined)
  forgetRoom()
  if (ending) for (const listener of endedListeners) listener(ending, 'left')
}

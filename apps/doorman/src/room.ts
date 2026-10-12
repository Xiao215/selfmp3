import {
  ROOM_IDLE_MS,
  RoomActionSchema,
  RoomClientMessageSchema,
  RoomDocSchema,
  RoomFilePartSchema,
  RoomJoinSchema,
  RoomMemberNameSchema,
  RoomModeSchema,
  RoomRightsSchema,
  addRoomMember,
  applyRoomAction,
  canReadEntry,
  isRoomRefusal,
  newRoomDoc,
  roomStateFor,
  type RoomDoc,
  type RoomFilePart,
  type RoomRefusal,
  type RoomServerMessage,
} from '@selfmp3/shared'
import { z } from 'zod'
import { sha256Hex } from './encoding.js'

/**
 * One room: a Durable Object per room code (docs/features/listen-together.md).
 *
 * It keeps the room (`RoomDoc`, whose rules are packages/shared's room.ts),
 * who holds which member token, and which Google account each signed-in
 * member is — the last never sent to anyone, since it is what the doorman
 * lends a member's songs by. It keeps every member's WebSocket and sends the
 * room down each one whenever anything changes.
 *
 * Only the Worker talks to it (rooms.ts), over plain requests to
 * `https://room/...`; a member's socket is the Worker's request handed on.
 * The Worker has already checked whatever needs a session, and says whose it
 * was in `sub`.
 *
 * A room ends when its host ends it, leaves, or nobody has done anything for
 * two hours. Ten minutes after it ends — long enough for every member to have
 * heard — the alarm forgets it entirely: the doorman keeps nothing of a room
 * that is over, and lends no file from it.
 */

/** How long an ended room is kept, so a member who was away can still hear it ended. */
const ENDED_KEPT_MS = 10 * 60 * 1000

/** What the room keeps that no member is sent. */
interface Secrets {
  /** sha256(token) → member id. */
  readonly tokens: Record<string, string>
  /** Member id → the Google account they joined signed in as. */
  readonly subs: Record<string, string>
}

const EMPTY_SECRETS: Secrets = { tokens: {}, subs: {} }

/** A member's socket, as the room sees it. */
export interface RoomSocket {
  readonly member: string
  send(text: string): void
  close(code: number, reason: string): void
}

/**
 * What the room needs from the runtime: its storage, its alarm and its
 * sockets. The Durable Object class gives it Cloudflare's; the tests, theirs.
 */
interface RoomRuntime {
  readonly storage: {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
    deleteAll(): Promise<void>
    setAlarm(when: number): Promise<void>
  }
  /** Take this upgrade request as the member's socket, and answer it. */
  accept(request: Request, member: string): Response
  sockets(): readonly RoomSocket[]
  now(): number
}

const CreateRequestSchema = z.object({
  code: z.string(),
  sub: z.string().min(1),
  name: RoomMemberNameSchema,
  mode: RoomModeSchema,
  rights: RoomRightsSchema,
  keepGoing: z.boolean(),
})
export type CreateRequest = z.infer<typeof CreateRequestSchema>

const JoinRequestSchema = RoomJoinSchema.extend({ sub: z.string().min(1).nullable() })
export type JoinRequest = z.infer<typeof JoinRequestSchema>

const ActRequestSchema = z.object({
  action: RoomActionSchema,
  sub: z.string().min(1).nullable(),
})
export type ActRequest = z.infer<typeof ActRequestSchema>

/** Whose bucket a lent file comes from, and its key there. */
export const LentFileSchema = z.object({ sub: z.string(), key: z.string() })
type LentFile = z.infer<typeof LentFileSchema>

const STATUS: Readonly<Record<RoomRefusal['refused'], number>> = {
  forbidden: 403,
  missing: 404,
  full: 409,
  ended: 410,
  invalid: 400,
}

function answer(status: number, code: string, error: string): Response {
  return Response.json({ error, code }, { status })
}

function refusal(refused: RoomRefusal): Response {
  return answer(STATUS[refused.refused], `room_${refused.refused}`, refused.message)
}

export class Room {
  readonly #runtime: RoomRuntime
  readonly #newId: () => string
  readonly #newToken: () => string

  constructor(
    runtime: RoomRuntime,
    ids: { readonly newId?: () => string; readonly newToken?: () => string } = {},
  ) {
    this.#runtime = runtime
    this.#newId = ids.newId ?? (() => randomHex(6))
    this.#newToken = ids.newToken ?? (() => randomHex(16))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    try {
      switch (`${request.method} ${url.pathname}`) {
        case 'POST /create':
          return await this.#create(CreateRequestSchema.parse(await request.json()))
        case 'POST /join':
          return await this.#join(JoinRequestSchema.parse(await request.json()))
        case 'GET /state':
          return await this.#state(url)
        case 'POST /act':
          return await this.#act(url, ActRequestSchema.parse(await request.json()))
        case 'GET /socket':
          return await this.#socket(request, url)
        case 'GET /file':
          return await this.#file(url)
        default:
          return answer(404, 'not_found', 'no such endpoint')
      }
    } catch (error) {
      if (error instanceof z.ZodError)
        return answer(400, 'bad_request', 'that is not a room request')
      throw error
    }
  }

  /** A message on a member's socket: only ever a ping, answered with the room's clock. */
  message(socket: RoomSocket, text: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    const message = RoomClientMessageSchema.safeParse(parsed)
    if (!message.success) return
    send(socket, { type: 'pong', id: message.data.id, serverTime: this.#runtime.now() })
  }

  /** A socket closed: the others hear that its member went quiet. */
  async closed(): Promise<void> {
    const doc = await this.#doc()
    if (doc && doc.endedAt === null) this.#broadcast(doc)
  }

  /** Two hours with nothing done ends the room; ten minutes after it ends, it is forgotten. */
  async alarm(): Promise<void> {
    const doc = await this.#doc()
    const now = this.#runtime.now()
    if (!doc) return
    if (doc.endedAt !== null) {
      if (now >= doc.endedAt + ENDED_KEPT_MS) return this.#forget()
      return this.#runtime.storage.setAlarm(doc.endedAt + ENDED_KEPT_MS)
    }
    if (now >= doc.activeAt + ROOM_IDLE_MS) {
      return this.#save({ ...doc, endedAt: now }, null)
    }
    return this.#runtime.storage.setAlarm(doc.activeAt + ROOM_IDLE_MS)
  }

  async #create(input: CreateRequest): Promise<Response> {
    if (await this.#doc()) return answer(409, 'room_taken', 'that code is in use')
    const now = this.#runtime.now()
    const member = this.#newId()
    const token = this.#newToken()
    const doc = newRoomDoc({
      code: input.code,
      host: { id: member, name: input.name },
      mode: input.mode,
      rights: input.rights,
      keepGoing: input.keepGoing,
      now,
    })
    const secrets: Secrets = {
      tokens: { [await sha256Hex(token)]: member },
      subs: { [member]: input.sub },
    }
    await this.#runtime.storage.put('secrets', secrets)
    await this.#save(doc, null)
    return Response.json({ code: doc.code, member, token, state: this.#stateFor(doc, member) })
  }

  async #join(input: JoinRequest): Promise<Response> {
    const doc = await this.#doc()
    if (!doc) return answer(404, 'room_missing', 'no room has that code')
    const secrets = await this.#secrets()
    const now = this.#runtime.now()
    const member = this.#newId()
    const token = this.#newToken()
    const joined = addRoomMember(
      doc,
      { id: member, name: input.name, kind: input.sub ? 'friend' : 'guest' },
      now,
    )
    if (isRoomRefusal(joined)) return refusal(joined)
    await this.#runtime.storage.put<Secrets>('secrets', {
      tokens: { ...secrets.tokens, [await sha256Hex(token)]: member },
      subs: input.sub ? { ...secrets.subs, [member]: input.sub } : secrets.subs,
    })
    await this.#save(joined, null)
    return Response.json({ code: doc.code, member, token, state: this.#stateFor(joined, member) })
  }

  async #state(url: URL): Promise<Response> {
    const found = await this.#member(url)
    if (found instanceof Response) return found
    return Response.json(this.#stateFor(found.doc, found.member))
  }

  async #act(url: URL, input: ActRequest): Promise<Response> {
    const found = await this.#member(url, { ended: true })
    if (found instanceof Response) return found
    const { doc, member } = found
    if (input.action.type === 'add') {
      // A song from a library is lent from the bucket of whoever adds it, so
      // the Worker must have seen them signed in as the member who joined.
      const secrets = await this.#secrets()
      if (!input.sub || secrets.subs[member] !== input.sub) {
        return answer(403, 'room_forbidden', 'sign in as yourself to bring your songs')
      }
    }
    const next = applyRoomAction(doc, member, input.action, this.#runtime.now(), this.#newId)
    if (isRoomRefusal(next)) return refusal(next)
    await this.#save(next, input.action.type === 'kick' ? input.action.member : null)
    return Response.json(this.#stateFor(next, member))
  }

  async #socket(request: Request, url: URL): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return answer(426, 'upgrade_required', 'open this as a WebSocket')
    }
    const found = await this.#member(url)
    if (found instanceof Response) return found
    const response = this.#runtime.accept(request, found.member)
    // Everyone else hears this member come online, and the member hears the room.
    this.#broadcast(found.doc)
    return response
  }

  /** `GET /file?t=&entry=&part=`: where a member may read one of a song's files from. */
  async #file(url: URL): Promise<Response> {
    const found = await this.#member(url)
    if (found instanceof Response) return found
    const part = RoomFilePartSchema.safeParse(url.searchParams.get('part'))
    const entry = canReadEntry(found.doc, found.member, url.searchParams.get('entry') ?? '')
    if (!part.success || !entry || entry.owner === null) {
      return answer(404, 'room_missing', 'that song is not in the room')
    }
    const key = keyOf(entry.song, part.data)
    const sub = (await this.#secrets()).subs[entry.owner]
    if (!key || !sub) return answer(404, 'room_missing', 'that song has no such file')
    const body: LentFile = { sub, key }
    return Response.json(body)
  }

  /** The member the token in the address names, in a room still going. */
  async #member(
    url: URL,
    options: { ended?: boolean } = {},
  ): Promise<{ doc: RoomDoc; member: string } | Response> {
    const doc = await this.#doc()
    if (!doc) return answer(404, 'room_missing', 'no room has that code')
    const token = url.searchParams.get('t') ?? ''
    const member = /^[0-9a-f]{32}$/.test(token)
      ? (await this.#secrets()).tokens[await sha256Hex(token)]
      : undefined
    const who = doc.members.find(candidate => candidate.id === member)
    if (!member || !who) return answer(401, 'room_unauthorized', 'that is not a way into this room')
    if (who.left) return answer(403, 'room_left', 'you are no longer in this room')
    if (doc.endedAt !== null && !options.ended)
      return answer(410, 'room_ended', 'this room has ended')
    return { doc, member }
  }

  async #doc(): Promise<RoomDoc | null> {
    const stored = await this.#runtime.storage.get<unknown>('doc')
    if (stored === undefined) return null
    const parsed = RoomDocSchema.safeParse(stored)
    return parsed.success ? parsed.data : null
  }

  async #secrets(): Promise<Secrets> {
    return (await this.#runtime.storage.get<Secrets>('secrets')) ?? EMPTY_SECRETS
  }

  /**
   * Keep the room, tell every socket, and set the alarm for whichever comes
   * first: two idle hours, or forgetting an ended room. `removed` is a member
   * just asked to leave, whose socket is told so and closed.
   */
  async #save(doc: RoomDoc, removed: string | null): Promise<void> {
    await this.#runtime.storage.put('doc', doc)
    await this.#runtime.storage.setAlarm(
      doc.endedAt !== null ? doc.endedAt + ENDED_KEPT_MS : doc.activeAt + ROOM_IDLE_MS,
    )
    for (const socket of this.#runtime.sockets()) {
      if (doc.endedAt !== null || socket.member === removed) {
        send(socket, { type: 'gone', reason: doc.endedAt !== null ? 'ended' : 'removed' })
        if (doc.endedAt !== null)
          send(socket, { type: 'state', state: this.#stateFor(doc, socket.member) })
        socket.close(1000, doc.endedAt !== null ? 'the room ended' : 'removed from the room')
      }
    }
    if (doc.endedAt === null) this.#broadcast(doc)
  }

  #broadcast(doc: RoomDoc): void {
    for (const socket of this.#runtime.sockets()) {
      send(socket, { type: 'state', state: this.#stateFor(doc, socket.member) })
    }
  }

  /** The room as `member` is sent it, with who has a socket open right now. */
  #stateFor(doc: RoomDoc, member: string) {
    const online = new Set(this.#runtime.sockets().map(socket => socket.member))
    const withPresence: RoomDoc = {
      ...doc,
      members: doc.members.map(other => ({
        ...other,
        online: !other.left && online.has(other.id),
      })),
    }
    return roomStateFor(withPresence, member, this.#runtime.now())
  }

  async #forget(): Promise<void> {
    for (const socket of this.#runtime.sockets()) socket.close(1000, 'the room ended')
    await this.#runtime.storage.deleteAll()
  }
}

/** The key of the file a part names, or null when the song has none. */
function keyOf(song: RoomDoc['entries'][number]['song'], part: RoomFilePart): string | null {
  switch (part) {
    case 'audio':
      return song.audio?.key ?? null
    case 'cover':
      return song.cover?.key ?? null
    case 'lyrics':
      return song.lyrics?.key ?? null
    case 'romanized':
      return song.lyrics?.romanized ?? null
  }
}

function send(socket: RoomSocket, message: RoomServerMessage): void {
  try {
    socket.send(JSON.stringify(message))
  } catch {
    // A socket that closed between being listed and being written to; it
    // hears the room again when it reconnects.
  }
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * The Durable Object class, exported from index.ts by the name wrangler.toml
 * binds (`Room`). It hands the runtime's storage, alarm and hibernating
 * WebSockets to a `Room`: a room with nobody doing anything costs nothing
 * while its sockets wait.
 */
export class RoomObject {
  readonly #state: DurableObjectState
  readonly #room: Room

  constructor(state: DurableObjectState) {
    this.#state = state
    const socketOf = (ws: WebSocket): RoomSocket => ({
      member: state.getTags(ws)[0] ?? '',
      send: text => ws.send(text),
      close: (code, reason) => ws.close(code, reason),
    })
    this.#room = new Room({
      storage: {
        get: key => state.storage.get(key),
        put: (key, value) => state.storage.put(key, value),
        deleteAll: () => state.storage.deleteAll(),
        setAlarm: when => state.storage.setAlarm(when),
      },
      accept: (_request, member) => {
        const pair = new WebSocketPair()
        state.acceptWebSocket(pair[1], [member])
        return new Response(null, { status: 101, webSocket: pair[0] })
      },
      sockets: () => state.getWebSockets().map(socketOf),
      now: () => Date.now(),
    })
  }

  fetch(request: Request): Promise<Response> {
    return this.#room.fetch(request)
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') return
    this.#room.message(
      {
        member: this.#state.getTags(ws)[0] ?? '',
        send: text => ws.send(text),
        close: (code, reason) => ws.close(code, reason),
      },
      message,
    )
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason)
    } catch {
      // Already closed.
    }
    await this.#room.closed()
  }

  alarm(): Promise<void> {
    return this.#room.alarm()
  }
}

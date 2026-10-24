import {
  DOORMAN_ERROR,
  type DoormanErrorCode,
  ROOM_IDLE_MS,
  RoomActionSchema,
  RoomClientMessageSchema,
  RoomDocSchema,
  RoomFilePartSchema,
  RoomJoinSchema,
  MemberPictureSchema,
  RoomMemberNameSchema,
  RoomModeSchema,
  ROOM_MAX_VECTORS,
  ROOM_VECTORS_AT_ONCE,
  RoomLinkServerSchema,
  RoomVectorsSchema,
  RoomRightsSchema,
  RoomSongSchema,
  ROOM_MAX_WAITING,
  waitingEntries,
  addRoomMember,
  applyRoomAction,
  canReadEntry,
  isRoomRefusal,
  newRoomDoc,
  roomStateFor,
  type RoomDoc,
  type RoomFilePart,
  type RoomLinkServer,
  type RoomVectors,
  type RoomRefusal,
  type RoomServerMessage,
} from '@selfmp3/shared'
import { z } from 'zod'
import { secureHex, sha256Hex } from './encoding.js'

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
  /** Where the host's server answers from the internet, for playing links (`RoomLinkServer`). */
  readonly linkServer?: RoomLinkServer
  /** Entry id → the account a shared playlist's song is lent from, when its owner is not in the room. */
  readonly entrySubs?: Record<string, string>
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
  /** The session's, never the request's (rooms.ts). */
  picture: MemberPictureSchema.nullable(),
  mode: RoomModeSchema,
  rights: RoomRightsSchema,
  keepGoing: z.boolean(),
})
export type CreateRequest = z.infer<typeof CreateRequestSchema>

const JoinRequestSchema = RoomJoinSchema.extend({
  sub: z.string().min(1).nullable(),
  picture: MemberPictureSchema.nullable(),
})
export type JoinRequest = z.infer<typeof JoinRequestSchema>

const ActRequestSchema = z.object({
  action: RoomActionSchema,
  sub: z.string().min(1).nullable(),
})
export type ActRequest = z.infer<typeof ActRequestSchema>

const LinkServerRequestSchema = z.object({ server: RoomLinkServerSchema })

/** A shared playlist's songs coming into the room, each with whose account lends it. */
const ImportSchema = z.object({
  items: z
    .array(
      z.object({
        song: RoomSongSchema,
        sub: z.string().min(1),
        name: RoomMemberNameSchema,
        picture: MemberPictureSchema.nullable(),
      }),
    )
    .max(500),
})
type Import = z.infer<typeof ImportSchema>

/** The room as a shared playlist would keep it. */
export const KeepableSchema = z.object({
  members: z.array(
    z.object({
      sub: z.string(),
      name: RoomMemberNameSchema,
      picture: MemberPictureSchema.nullable(),
    }),
  ),
  items: z.array(z.object({ song: RoomSongSchema, sub: z.string() })),
})
type Keepable = z.infer<typeof KeepableSchema>
type LinkServerRequest = z.infer<typeof LinkServerRequestSchema>

/** Whose bucket a lent file comes from, and its key there. */
/**
 * Where a lent file comes from: a key in its owner's bucket, or — for a link —
 * the host's server's stream of it, token and all, which only the Worker sees.
 */
export const LentFileSchema = z.union([
  z.object({ sub: z.string(), key: z.string() }),
  z.object({ listen: z.string().url() }),
])
type LentFile = z.infer<typeof LentFileSchema>

/** A refusal's code, by what was refused. */
const ROOM_REFUSED: Readonly<Record<RoomRefusal['refused'], DoormanErrorCode>> = {
  forbidden: DOORMAN_ERROR.roomForbidden,
  missing: DOORMAN_ERROR.roomMissing,
  full: DOORMAN_ERROR.roomFull,
  ended: DOORMAN_ERROR.roomEnded,
  invalid: DOORMAN_ERROR.roomInvalid,
}

const STATUS: Readonly<Record<RoomRefusal['refused'], number>> = {
  forbidden: 403,
  missing: 404,
  full: 409,
  ended: 410,
  invalid: 400,
}

function answer(status: number, code: DoormanErrorCode, error: string): Response {
  return Response.json({ error, code }, { status })
}

function refusal(refused: RoomRefusal): Response {
  return answer(STATUS[refused.refused], ROOM_REFUSED[refused.refused], refused.message)
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
    this.#newId = ids.newId ?? (() => secureHex(6))
    this.#newToken = ids.newToken ?? (() => secureHex(16))
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
        case 'GET /vectors':
          return await this.#vectors(url)
        case 'POST /vectors':
          return await this.#addVectors(url, RoomVectorsSchema.parse(await request.json()))
        case 'GET /keepable':
          return await this.#keepable(url)
        case 'POST /import':
          return await this.#import(url, ImportSchema.parse(await request.json()))
        case 'POST /link-server':
          return await this.#linkServer(url, LinkServerRequestSchema.parse(await request.json()))
        default:
          return answer(404, DOORMAN_ERROR.notFound, 'no such endpoint')
      }
    } catch (error) {
      if (error instanceof z.ZodError)
        return answer(400, DOORMAN_ERROR.badRequest, 'that is not a room request')
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
    if (await this.#doc()) return answer(409, DOORMAN_ERROR.roomTaken, 'that code is in use')
    const now = this.#runtime.now()
    const member = this.#newId()
    const token = this.#newToken()
    const doc = newRoomDoc({
      code: input.code,
      host: { id: member, name: input.name, picture: input.picture },
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
    if (!doc) return answer(404, DOORMAN_ERROR.roomMissing, 'no room has that code')
    const secrets = await this.#secrets()
    const now = this.#runtime.now()
    const member = this.#newId()
    const token = this.#newToken()
    const joined = addRoomMember(
      doc,
      {
        id: member,
        name: input.name,
        kind: input.sub ? 'friend' : 'guest',
        // A guest has no session, so no picture: only a signed-in friend's shows.
        picture: input.sub ? input.picture : null,
      },
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
        return answer(403, DOORMAN_ERROR.roomForbidden, 'sign in as yourself to bring your songs')
      }
    }
    const next = applyRoomAction(doc, member, input.action, this.#runtime.now(), this.#newId)
    if (isRoomRefusal(next)) return refusal(next)
    await this.#save(next, input.action.type === 'kick' ? input.action.member : null)
    return Response.json(this.#stateFor(next, member))
  }

  async #socket(request: Request, url: URL): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return answer(426, DOORMAN_ERROR.upgradeRequired, 'open this as a WebSocket')
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
    if (!part.success || !entry) {
      return answer(404, DOORMAN_ERROR.roomMissing, 'that song is not in the room')
    }
    const secrets = await this.#secrets()
    const lentFrom = secrets.entrySubs?.[entry.id]
    if (entry.owner === null && lentFrom) {
      const key = keyOf(entry.song, part.data)
      if (!key) return answer(404, DOORMAN_ERROR.roomMissing, 'that song has no such file')
      const body: LentFile = { sub: lentFrom, key }
      return Response.json(body)
    }
    if (entry.owner === null) {
      // A link: played through the host's server, when it said where that is.
      const server = secrets.linkServer
      if (!entry.song.link || part.data !== 'audio' || !server) {
        return answer(404, DOORMAN_ERROR.roomMissing, 'that link plays on the host’s device only')
      }
      const query = new URLSearchParams({ url: entry.song.link })
      if (server.token) query.set('token', server.token)
      const lent: LentFile = { listen: `${server.base}/api/import/listen?${query.toString()}` }
      return Response.json(lent)
    }
    const key = keyOf(entry.song, part.data)
    const sub = secrets.subs[entry.owner]
    if (!key || !sub) return answer(404, DOORMAN_ERROR.roomMissing, 'that song has no such file')
    const body: LentFile = { sub, key }
    return Response.json(body)
  }

  /**
   * What keeping the room as a shared playlist takes (sharedRoutes.ts): its
   * signed-in people, and every song with the account it is lent from. The
   * host's to ask.
   */
  async #keepable(url: URL): Promise<Response> {
    const found = await this.#member(url, { ended: true })
    if (found instanceof Response) return found
    const { doc, member } = found
    if (doc.members.find(other => other.id === member)?.kind !== 'host') {
      return answer(403, DOORMAN_ERROR.roomForbidden, 'only the host keeps the room')
    }
    const secrets = await this.#secrets()
    const body: Keepable = {
      members: doc.members.flatMap(other => {
        const sub = secrets.subs[other.id]
        return sub && !other.left ? [{ sub, name: other.name, picture: other.picture }] : []
      }),
      items: doc.entries.flatMap(entry => {
        const sub = entry.owner ? secrets.subs[entry.owner] : secrets.entrySubs?.[entry.id]
        return sub && entry.song.audio ? [{ song: entry.song, sub }] : []
      }),
    }
    return Response.json(body)
  }

  /**
   * A shared playlist's songs, into the room (sharedRoutes.ts checked that the
   * host is one of its people): each lent from its owner's account, named by
   * them though they are not here. The host's to do.
   */
  async #import(url: URL, input: Import): Promise<Response> {
    const found = await this.#member(url)
    if (found instanceof Response) return found
    const { doc, member } = found
    if (doc.members.find(other => other.id === member)?.kind !== 'host') {
      return answer(403, DOORMAN_ERROR.roomForbidden, 'only the host plays a shared playlist here')
    }
    const now = this.#runtime.now()
    const room = Math.max(0, ROOM_MAX_WAITING - waitingEntries(doc).length)
    const secrets = await this.#secrets()
    const entrySubs = { ...secrets.entrySubs }
    const added = input.items.slice(0, room).map(item => {
      const id = this.#newId()
      entrySubs[id] = item.sub
      return {
        id,
        song: item.song,
        addedBy: member,
        owner: null,
        from: item.name,
        fromPicture: item.picture,
        addedAt: now,
        at: null,
        playedAt: null,
      }
    })
    await this.#runtime.storage.put<Secrets>('secrets', { ...secrets, entrySubs })
    const next = { ...doc, entries: [...doc.entries, ...added], activeAt: now }
    await this.#save(next, null)
    return Response.json(this.#stateFor(next, member))
  }

  /** How the room's songs sound, for the host's Keep it going. */
  async #vectors(url: URL): Promise<Response> {
    const found = await this.#member(url)
    if (found instanceof Response) return found
    const kept = (await this.#runtime.storage.get<RoomVectors>('vectors')) ?? null
    const body: RoomVectors = kept ?? { model: '', vectors: {} }
    return Response.json(body)
  }

  /**
   * A member's vectors for their own songs — ones they brought or put on a
   * shelf — so nobody can say how someone else's songs sound. One model per
   * room: vectors from another are not comparable, and are left out.
   */
  async #addVectors(url: URL, input: RoomVectors): Promise<Response> {
    const found = await this.#member(url)
    if (found instanceof Response) return found
    const { doc, member } = found
    const theirs = new Set<string>()
    for (const entry of doc.entries) {
      if (entry.owner === member && entry.song.audio) theirs.add(entry.song.audio.key)
    }
    for (const shelf of doc.shelves) {
      if (shelf.member !== member) continue
      for (const song of shelf.songs) if (song.audio) theirs.add(song.audio.key)
    }
    const offered = Object.entries(input.vectors)
    if (offered.length > ROOM_VECTORS_AT_ONCE) {
      return answer(413, DOORMAN_ERROR.tooLarge, 'send fewer vectors at once')
    }
    const kept = (await this.#runtime.storage.get<RoomVectors>('vectors')) ?? {
      model: input.model,
      vectors: {},
    }
    if (kept.model !== input.model) return Response.json({ kept: 0 })
    const vectors = { ...kept.vectors }
    let added = 0
    for (const [key, value] of offered) {
      if (!theirs.has(key) || key in vectors) continue
      if (Object.keys(vectors).length >= ROOM_MAX_VECTORS) break
      vectors[key] = value
      added++
    }
    await this.#runtime.storage.put<RoomVectors>('vectors', { model: kept.model, vectors })
    return Response.json({ kept: added })
  }

  /** The host saying where its server answers from the internet, or that it no longer does. */
  async #linkServer(url: URL, input: LinkServerRequest): Promise<Response> {
    const found = await this.#member(url)
    if (found instanceof Response) return found
    const host = found.doc.members.find(member => member.id === found.member)
    if (host?.kind !== 'host')
      return answer(403, DOORMAN_ERROR.roomForbidden, 'only the host plays links')
    const secrets = await this.#secrets()
    await this.#runtime.storage.put<Secrets>('secrets', {
      ...secrets,
      linkServer: input.server,
    })
    const doc = { ...found.doc, linkRelay: input.server !== null, activeAt: this.#runtime.now() }
    await this.#save(doc, null)
    return Response.json(this.#stateFor(doc, found.member))
  }

  /** The member the token in the address names, in a room still going. */
  async #member(
    url: URL,
    options: { ended?: boolean } = {},
  ): Promise<{ doc: RoomDoc; member: string } | Response> {
    const doc = await this.#doc()
    if (!doc) return answer(404, DOORMAN_ERROR.roomMissing, 'no room has that code')
    const token = url.searchParams.get('t') ?? ''
    const member = /^[0-9a-f]{32}$/.test(token)
      ? (await this.#secrets()).tokens[await sha256Hex(token)]
      : undefined
    const who = doc.members.find(candidate => candidate.id === member)
    if (!member || !who)
      return answer(401, DOORMAN_ERROR.roomUnauthorized, 'that is not a way into this room')
    if (who.left) return answer(403, DOORMAN_ERROR.roomLeft, 'you are no longer in this room')
    if (doc.endedAt !== null && !options.ended)
      return answer(410, DOORMAN_ERROR.roomEnded, 'this room has ended')
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
export function keyOf(song: RoomDoc['entries'][number]['song'], part: RoomFilePart): string | null {
  switch (part) {
    case 'audio':
      return song.audio?.key ?? null
    case 'cover':
      return song.cover?.key ?? null
    case 'lyrics':
      return song.lyrics?.key ?? null
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

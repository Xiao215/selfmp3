import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RoomActionSchema,
  RoomCodeSchema,
  RoomCreateSchema,
  RoomFilePartSchema,
  RoomIdSchema,
  RoomJoinSchema,
} from '@selfmp3/shared'
import { Bucket } from './bucket.js'
import { requireSession, type Context } from './context.js'
import { relayRead } from './files.js'
import { DoormanError, json, methodNotAllowed, notFound, readJson } from './http.js'
import { LentFileSchema, type ActRequest, type CreateRequest, type JoinRequest } from './room.js'
import { bearerToken, type Session } from './sessions.js'

/**
 * Rooms: listening together (docs/features/listen-together.md; the contract is
 * packages/shared's schemas/room.ts). Each room is a Durable Object named by
 * its code (room.ts); these routes check what needs checking at the door —
 * a session, a body, a code — and hand the rest to it.
 *
 * The one thing a room does with anyone's bucket is lend a song's files to
 * the room's members: the room says whose bucket and which key, and only for
 * a song in the room, to a member, while it is open; the doorman reads it
 * from that bucket the way it reads a device's own.
 */

const ROOMS = '/v1/rooms'

/** Codes tried before giving up on finding a free one: 729 million to choose from. */
const CODE_TRIES = 5

export async function rooms(ctx: Context): Promise<Response> {
  const namespace = ctx.env.ROOMS
  if (!namespace) throw notFound('this doorman keeps no rooms')
  const parts = ctx.url.pathname.slice(ROOMS.length).split('/').filter(Boolean)
  const method = ctx.request.method

  if (parts.length === 0) {
    if (method !== 'POST') return methodNotAllowed(['POST'])
    return create(ctx, namespace)
  }

  const code = RoomCodeSchema.safeParse(parts[0])
  if (!code.success) throw notFound('no room has that code')
  const room = namespace.get(namespace.idFromName(code.data))
  const token = ctx.url.searchParams.get('t') ?? ''
  const ask = (path: string, init?: RequestInit): Promise<Response> =>
    room.fetch(`https://room${path}`, init)
  const withToken = (path: string, extra: Record<string, string> = {}): string =>
    `${path}?${new URLSearchParams({ t: token, ...extra }).toString()}`

  const [, action, entry, part, ...rest] = parts
  if (action === undefined) {
    if (method !== 'GET') return methodNotAllowed(['GET'])
    return relayed(await ask(withToken('/state')))
  }
  if (action === 'join' && entry === undefined) {
    if (method !== 'POST') return methodNotAllowed(['POST'])
    const body = await readJson(ctx.request, RoomJoinSchema)
    const session = await optionalSession(ctx)
    const join: JoinRequest = { name: body.name, sub: session?.sub ?? null }
    return relayed(await ask('/join', post(join)))
  }
  if (action === 'act' && entry === undefined) {
    if (method !== 'POST') return methodNotAllowed(['POST'])
    const body = await readJson(ctx.request, ActBodySchema)
    // Bringing a song from a library needs whoever brings it signed in: it
    // will be lent from their bucket. Nothing else does.
    const session = body.type === 'add' ? await requireSession(ctx) : null
    const act: ActRequest = { action: body, sub: session?.sub ?? null }
    return relayed(await ask(withToken('/act'), post(act)))
  }
  if (action === 'socket' && entry === undefined) {
    if (method !== 'GET') return methodNotAllowed(['GET'])
    return room.fetch(new Request(`https://room${withToken('/socket')}`, ctx.request))
  }
  if (action === 'files' && entry !== undefined && part !== undefined && rest.length === 0) {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(['GET', 'HEAD'])
    if (!RoomIdSchema.safeParse(entry).success || !RoomFilePartSchema.safeParse(part).success) {
      throw notFound('that song is not in the room')
    }
    const lent = await ask(withToken('/file', { entry, part }))
    if (!lent.ok) return relayed(lent)
    const file = LentFileSchema.parse(await lent.json())
    const target = await ctx.accounts.bucket(file.sub)
    if (!target) throw notFound('that song’s owner has no bucket connected any more')
    return relayRead(ctx, new Bucket(target, ctx.bucketDeps), file.key, method)
  }
  throw notFound()
}

/** The room's answer, passed on as JSON the doorman's own way: never cached. */
async function relayed(response: Response): Promise<Response> {
  return json(await response.json(), response.status)
}

/** Room actions arrive as the action itself; the session that brings a song comes from its header. */
const ActBodySchema = RoomActionSchema

async function create(ctx: Context, namespace: DurableObjectNamespace): Promise<Response> {
  const session = await requireSession(ctx)
  const body = await readJson(ctx.request, RoomCreateSchema)
  for (let attempt = 0; attempt < CODE_TRIES; attempt++) {
    const code = newRoomCode()
    const create: CreateRequest = {
      code,
      sub: session.sub,
      name: body.name,
      mode: body.mode,
      rights: body.rights,
      keepGoing: body.keepGoing,
    }
    const response = await namespace
      .get(namespace.idFromName(code))
      .fetch('https://room/create', post(create))
    if (response.status !== 409) return relayed(response)
    await response.body?.cancel()
  }
  throw new DoormanError(503, 'room_codes', 'could not find a free room code; try again')
}

/** The session the request brings, when it brings one. A token that is no good is said so. */
async function optionalSession(ctx: Context): Promise<Session | null> {
  if (!bearerToken(ctx.request)) return null
  return requireSession(ctx)
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/** Six letters from the room alphabet, each as likely as the others. */
export function newRoomCode(): string {
  const size = ROOM_CODE_ALPHABET.length
  // A byte at or past the last whole multiple of the alphabet would favour its first letters.
  const fair = 256 - (256 % size)
  let code = ''
  while (code.length < ROOM_CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH))) {
      if (byte < fair && code.length < ROOM_CODE_LENGTH) code += ROOM_CODE_ALPHABET[byte % size]
    }
  }
  return code
}

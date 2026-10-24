import {
  DOORMAN_ERROR,
  DOORMAN_PATHS,
  DoormanError,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RoomActionSchema,
  RoomCodeSchema,
  RoomCreateSchema,
  RoomFilePartSchema,
  RoomIdSchema,
  RoomJoinSchema,
  RoomLinkServerSchema,
  RoomVectorsSchema,
  SharedFromRoomSchema,
  SharedKeepSchema,
  STREAM_RELAYED_HEADERS,
  relayedRange,
} from '@selfmp3/shared'
import { requireSession, type Context } from './context.js'
import { lentAnswer, optionalSession, post, readLent, relayed } from './doRelay.js'
import { methodNotAllowed, notFound, readJson } from './http.js'
import {
  KeepableSchema,
  LentFileSchema,
  type ActRequest,
  type CreateRequest,
  type JoinRequest,
} from './room.js'
import { LentSongsSchema } from './shared.js'
import { newSharedId, rememberShared, sharedObject } from './sharedRoutes.js'
import { facePicture } from './sessions.js'

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

const ROOMS = DOORMAN_PATHS.rooms

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
    const join: JoinRequest = {
      name: body.name,
      sub: session?.sub ?? null,
      picture: session ? facePicture(session) : null,
    }
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
    const answer = await room.fetch(new Request(`https://room${withToken('/socket')}`, ctx.request))
    // Every answer but the socket itself is made again as the doorman's own.
    return answer.status === 101 ? answer : relayed(answer)
  }
  if (action === 'files' && entry !== undefined && part !== undefined && rest.length === 0) {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(['GET', 'HEAD'])
    if (!RoomIdSchema.safeParse(entry).success || !RoomFilePartSchema.safeParse(part).success) {
      throw notFound('that song is not in the room')
    }
    const lent = await ask(withToken('/file', { entry, part }))
    if (!lent.ok) return relayed(lent)
    const file = LentFileSchema.parse(await lent.json())
    return lentAnswer(
      'listen' in file
        ? await listenThrough(ctx, file.listen, method)
        : await readLent(ctx, file, method, 'that song’s owner has no bucket connected any more'),
    )
  }
  if (action === 'vectors' && entry === undefined) {
    if (method === 'GET') return relayed(await ask(withToken('/vectors')))
    if (method !== 'POST') return methodNotAllowed(['GET', 'POST'])
    const body = await readJson(ctx.request, RoomVectorsSchema, VECTORS_MAX_BYTES)
    return relayed(await ask(withToken('/vectors'), post(body)))
  }
  if (action === 'keep' && entry === undefined) {
    // The room, kept as a shared playlist: everyone in it who signed in has it.
    if (method !== 'POST') return methodNotAllowed(['POST'])
    const session = await requireSession(ctx)
    const body = await readJson(ctx.request, SharedKeepSchema)
    const keepable = await ask(withToken('/keepable'))
    if (!keepable.ok) return relayed(keepable)
    const room = KeepableSchema.parse(await keepable.json())
    const id = newSharedId()
    const made = await sharedObject(ctx, id).fetch(
      'https://shared/create-from',
      post({
        id,
        name: body.name,
        creator: session.sub,
        members: room.members,
        items: room.items,
      }),
    )
    if (made.ok) {
      for (const member of room.members) await rememberShared(ctx, member.sub, id)
    }
    return relayed(made)
  }
  if (action === 'from-shared' && entry === undefined) {
    // A shared playlist's songs into the room, lent from each owner's bucket.
    if (method !== 'POST') return methodNotAllowed(['POST'])
    const session = await requireSession(ctx)
    const body = await readJson(ctx.request, SharedFromRoomSchema)
    const lent = await sharedObject(ctx, body.shared).fetch(
      `https://shared/lend?sub=${encodeURIComponent(session.sub)}`,
    )
    if (!lent.ok) return relayed(lent)
    const songs = LentSongsSchema.parse(await lent.json())
    return relayed(await ask(withToken('/import'), post(songs)))
  }
  if (action === 'link-server' && entry === undefined) {
    if (method !== 'PUT') return methodNotAllowed(['PUT'])
    const server = await readJson(ctx.request, RoomLinkServerSchema)
    return relayed(await ask(withToken('/link-server'), post({ server })))
  }
  throw notFound()
}

/** Three hundred packed vectors, a kilobyte each, and their keys. */
const VECTORS_MAX_BYTES = 400 * 1024

/**
 * A link's audio, from the host's server's own stream of it
 * (apps/server's `/api/import/listen`): ranges passed on, and the answer
 * handed back as it comes. The address carries the server's token, so it is
 * the room's to make and only ever fetched here.
 */
async function listenThrough(
  ctx: Context,
  address: string,
  method: 'GET' | 'HEAD',
): Promise<Response> {
  const headers = new Headers()
  const range = relayedRange(ctx.request.headers.get('range'))
  if (range !== null) headers.set('range', range)
  let upstream: Response
  try {
    upstream = await ctx.fetch(address, { method: 'GET', headers, cache: 'no-store' })
  } catch {
    throw new DoormanError(
      502,
      DOORMAN_ERROR.linkUnreachable,
      'the host’s server cannot be reached',
    )
  }
  if (!upstream.ok) {
    await upstream.body?.cancel()
    throw new DoormanError(
      502,
      DOORMAN_ERROR.linkUnplayable,
      'the host’s server could not play that link',
    )
  }
  const out = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  for (const name of STREAM_RELAYED_HEADERS) {
    const value = upstream.headers.get(name)
    if (value !== null) out.set(name, value)
  }
  if (method === 'HEAD') {
    await upstream.body?.cancel()
    return new Response(null, { status: upstream.status, headers: out })
  }
  return new Response(upstream.body, { status: upstream.status, headers: out })
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
      picture: facePicture(session),
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
  throw new DoormanError(503, DOORMAN_ERROR.roomCodes, 'could not find a free room code; try again')
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

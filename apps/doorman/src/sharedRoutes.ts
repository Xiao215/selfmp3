import {
  DOORMAN_PATHS,
  SharedActionSchema,
  SharedCreateSchema,
  SharedIdSchema,
  SharedJoinSchema,
  RoomFilePartSchema,
  RoomIdSchema,
  type SharedSummary,
} from '@selfmp3/shared'
import { requireSession, type Context } from './context.js'
import {
  BucketFileSchema,
  idIndex,
  lentAnswer,
  post,
  readLent,
  relayed,
  summariesOf,
  type IdIndex,
} from './doRelay.js'
import { json, methodNotAllowed, notFound, readJson } from './http.js'
import { secureHex } from './encoding.js'
import { facePicture, type Session } from './sessions.js'

/**
 * Shared playlists (docs/features/listen-together.md, "Shared playlists"; the
 * contract is packages/shared's schemas/shared.ts). Each is a Durable Object
 * named by its id (shared.ts); these routes check the session, keep each
 * account's list of the playlists it is in, and lend songs' files.
 *
 * The list is a KV value per account (doRelay.ts's `idIndex`): it changes
 * only when someone makes, joins or leaves a playlist, and every entry in it
 * is checked with the playlist itself before it is shown.
 */

const SHARED = DOORMAN_PATHS.shared

/** The playlists an account is in, as KV keeps them. */
function sharedIndex(ctx: Context, sub: string): IdIndex {
  return idIndex(ctx, `shared:${sub}`, SharedIdSchema)
}

export function rememberShared(ctx: Context, sub: string, id: string): Promise<void> {
  return sharedIndex(ctx, sub).remember(id)
}

export function sharedObject(ctx: Context, id: string): DurableObjectStub {
  const namespace = ctx.env.SHARED
  if (!namespace) throw notFound('this doorman keeps no shared playlists')
  return namespace.get(namespace.idFromName(id))
}

export function newSharedId(): string {
  return secureHex(8)
}

export async function shared(ctx: Context): Promise<Response> {
  if (!ctx.env.SHARED) throw notFound('this doorman keeps no shared playlists')
  const parts = ctx.url.pathname.slice(SHARED.length).split('/').filter(Boolean)
  const method = ctx.request.method

  if (parts.length === 0) {
    if (method === 'GET') return list(ctx, await requireSession(ctx))
    if (method !== 'POST') return methodNotAllowed(['GET', 'POST'])
    const session = await requireSession(ctx)
    const body = await readJson(ctx.request, SharedCreateSchema)
    const id = newSharedId()
    const made = await sharedObject(ctx, id).fetch(
      'https://shared/create',
      post({ ...body, id, sub: session.sub, picture: facePicture(session) }),
    )
    if (made.ok) await rememberShared(ctx, session.sub, id)
    return relayed(made)
  }

  const id = SharedIdSchema.safeParse(parts[0])
  if (!id.success) throw notFound('no such playlist')
  const object = sharedObject(ctx, id.data)
  const [, action, entry, part, ...rest] = parts

  if (action === 'files' && entry !== undefined && part !== undefined && rest.length === 0) {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(['GET', 'HEAD'])
    if (!RoomIdSchema.safeParse(entry).success || !RoomFilePartSchema.safeParse(part).success) {
      throw notFound('that song is not in the playlist')
    }
    const query = new URLSearchParams({ t: ctx.url.searchParams.get('t') ?? '', entry, part })
    const lent = await object.fetch(`https://shared/file?${query.toString()}`)
    if (!lent.ok) return relayed(lent)
    const file = BucketFileSchema.parse(await lent.json())
    return lentAnswer(
      await readLent(ctx, file, method, 'that song’s owner has no bucket connected any more'),
    )
  }

  const session = await requireSession(ctx)
  if (action === undefined) {
    if (method !== 'GET') return methodNotAllowed(['GET'])
    const query = new URLSearchParams({ sub: session.sub })
    const picture = facePicture(session)
    if (picture !== null) query.set('picture', picture)
    const viewed = await object.fetch(`https://shared/view?${query.toString()}`)
    if (viewed.status === 403 || viewed.status === 404) {
      await sharedIndex(ctx, session.sub).forget(id.data)
    }
    return relayed(viewed)
  }
  if (action === 'join' && entry === undefined) {
    if (method !== 'POST') return methodNotAllowed(['POST'])
    const body = await readJson(ctx.request, SharedJoinSchema)
    const joined = await object.fetch(
      'https://shared/join',
      post({ ...body, sub: session.sub, picture: facePicture(session) }),
    )
    if (joined.ok) await rememberShared(ctx, session.sub, id.data)
    return relayed(joined)
  }
  if (action === 'act' && entry === undefined) {
    if (method !== 'POST') return methodNotAllowed(['POST'])
    const body = await readJson(ctx.request, SharedActionSchema)
    const done = await object.fetch('https://shared/act', post({ sub: session.sub, action: body }))
    if (body.type === 'leave' && done.ok) await sharedIndex(ctx, session.sub).forget(id.data)
    return relayed(done)
  }
  throw notFound()
}

/**
 * `GET /v1/shared`: the playlists you are in, newest change first. Left, or
 * gone: off the list.
 */
async function list(ctx: Context, session: Session): Promise<Response> {
  const summaries = await summariesOf<SharedSummary>(sharedIndex(ctx, session.sub), id =>
    sharedObject(ctx, id).fetch(`https://shared/summary?sub=${encodeURIComponent(session.sub)}`),
  )
  summaries.sort((a, b) => b.updatedAt - a.updatedAt)
  return json(summaries)
}

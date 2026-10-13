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
import { z } from 'zod'
import { Bucket } from './bucket.js'
import { requireSession, type Context } from './context.js'
import { relayRead } from './files.js'
import { json, methodNotAllowed, notFound, readJson } from './http.js'
import { secureHex } from './encoding.js'
import { facePicture, type Session } from './sessions.js'

/**
 * Shared playlists (docs/features/listen-together.md, "Shared playlists"; the
 * contract is packages/shared's schemas/shared.ts). Each is a Durable Object
 * named by its id (shared.ts); these routes check the session, keep each
 * account's list of the playlists it is in, and lend songs' files.
 *
 * The list is a KV value per account: it changes only when someone makes,
 * joins or leaves a playlist, a few times a day at most, which KV's free
 * writes cover; and every entry in it is checked with the playlist itself
 * before it is shown.
 */

const SHARED = DOORMAN_PATHS.shared

/** The playlists an account is in, as KV keeps them. */
const IndexSchema = z.array(SharedIdSchema)

function indexKey(sub: string): string {
  return `shared:${sub}`
}

async function sharedIds(ctx: Context, sub: string): Promise<string[]> {
  const stored = await ctx.env.KV.get(indexKey(sub))
  if (!stored) return []
  try {
    const parsed = IndexSchema.safeParse(JSON.parse(stored))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

export async function rememberShared(ctx: Context, sub: string, id: string): Promise<void> {
  const ids = await sharedIds(ctx, sub)
  if (ids.includes(id)) return
  await ctx.env.KV.put(indexKey(sub), JSON.stringify([id, ...ids].slice(0, 200)))
}

async function forgetShared(ctx: Context, sub: string, id: string): Promise<void> {
  const ids = await sharedIds(ctx, sub)
  if (!ids.includes(id)) return
  await ctx.env.KV.put(indexKey(sub), JSON.stringify(ids.filter(other => other !== id)))
}

export function sharedObject(ctx: Context, id: string): DurableObjectStub {
  const namespace = ctx.env.SHARED
  if (!namespace) throw notFound('this doorman keeps no shared playlists')
  return namespace.get(namespace.idFromName(id))
}

export function newSharedId(): string {
  return secureHex(8)
}

export function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/** The object's answer, the doorman's way: JSON, never cached, its headers changeable. */
async function relayed(response: Response): Promise<Response> {
  if (response.status === 204) return new Response(null, { status: 204 })
  return json(await response.json(), response.status)
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
    const file = z.object({ sub: z.string(), key: z.string() }).parse(await lent.json())
    const target = await ctx.accounts.bucket(file.sub)
    if (!target) throw notFound('that song’s owner has no bucket connected any more')
    const response = await relayRead(ctx, new Bucket(target, ctx.bucketDeps), file.key, method)
    // As a room's files are (rooms.ts): the web app's audio element asks with credentials.
    response.headers.set('access-control-allow-credentials', 'true')
    return response
  }

  const session = await requireSession(ctx)
  if (action === undefined) {
    if (method !== 'GET') return methodNotAllowed(['GET'])
    const query = new URLSearchParams({ sub: session.sub })
    const picture = facePicture(session)
    if (picture !== null) query.set('picture', picture)
    const viewed = await object.fetch(`https://shared/view?${query.toString()}`)
    if (viewed.status === 403 || viewed.status === 404)
      await forgetShared(ctx, session.sub, id.data)
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
    if (body.type === 'leave' && done.ok) await forgetShared(ctx, session.sub, id.data)
    return relayed(done)
  }
  throw notFound()
}

/** `GET /v1/shared`: the playlists you are in, newest change first. */
async function list(ctx: Context, session: Session): Promise<Response> {
  const summaries: SharedSummary[] = []
  for (const id of await sharedIds(ctx, session.sub)) {
    const answer = await sharedObject(ctx, id).fetch(
      `https://shared/summary?sub=${encodeURIComponent(session.sub)}`,
    )
    if (answer.ok) summaries.push(await answer.json())
    else {
      await answer.body?.cancel()
      // Left, or gone: off the list.
      if (answer.status === 403 || answer.status === 404) await forgetShared(ctx, session.sub, id)
    }
  }
  summaries.sort((a, b) => b.updatedAt - a.updatedAt)
  return json(summaries)
}

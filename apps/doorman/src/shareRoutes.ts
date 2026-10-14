import {
  DOORMAN_ERROR,
  DOORMAN_PATHS,
  DoormanError,
  RoomFilePartSchema,
  RoomIdSchema,
  ShareActionSchema,
  ShareAskBodySchema,
  ShareCreateSchema,
  ShareIdSchema,
  type ShareSummary,
} from '@selfmp3/shared'
import { z } from 'zod'
import { Bucket } from './bucket.js'
import { requireSession, type Context } from './context.js'
import { secureHex } from './encoding.js'
import { relayRead } from './files.js'
import { json, methodNotAllowed, notFound, readJson } from './http.js'
import { ShareFileSchema } from './share.js'
import { bearerToken, facePicture, type Session } from './sessions.js'

/**
 * Share links (docs/features/share-links.md; the contract is
 * packages/shared's schemas/share.ts). Each is a Durable Object named by its
 * id (share.ts); these routes check the session where one is needed, keep
 * each account's two lists — the links it sent and the ones it opened — and
 * lend songs' files.
 *
 * Each list is a KV value per account, written only when a link is made, is
 * first opened by that account, or is taken off it: a few times a day at most.
 * Every entry is checked with the link itself before it is shown, and one the
 * link no longer knows is dropped.
 */

const SHARE = DOORMAN_PATHS.share

const IndexSchema = z.array(ShareIdSchema)

/** Whether the link opened was the opener's own, which is no friend's link to remember. */
const YoursSchema = z.object({ yours: z.boolean() })

type Side = 'out' | 'in'

/** The most links one list keeps. */
const INDEX_MAX = 200

function indexKey(side: Side, sub: string): string {
  return `share-${side}:${sub}`
}

async function linkIds(ctx: Context, side: Side, sub: string): Promise<string[]> {
  const stored = await ctx.env.KV.get(indexKey(side, sub))
  if (!stored) return []
  try {
    const parsed = IndexSchema.safeParse(JSON.parse(stored))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

async function remember(ctx: Context, side: Side, sub: string, id: string): Promise<void> {
  const ids = await linkIds(ctx, side, sub)
  if (ids.includes(id)) return
  await ctx.env.KV.put(indexKey(side, sub), JSON.stringify([id, ...ids].slice(0, INDEX_MAX)))
}

async function forget(ctx: Context, side: Side, sub: string, id: string): Promise<void> {
  const ids = await linkIds(ctx, side, sub)
  if (!ids.includes(id)) return
  await ctx.env.KV.put(indexKey(side, sub), JSON.stringify(ids.filter(other => other !== id)))
}

export function shareObject(ctx: Context, id: string): DurableObjectStub {
  const namespace = ctx.env.SHARES
  if (!namespace) throw notFound('this doorman keeps no share links')
  return namespace.get(namespace.idFromName(id))
}

function post(body: unknown): RequestInit {
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

/** The session the request brings, when it brings one. A token that is no good is said so. */
async function optionalSession(ctx: Context): Promise<Session | null> {
  if (!bearerToken(ctx.request)) return null
  return requireSession(ctx)
}

/** What a signed-in person is called on a link's page: the first of their account's name. */
function nameOf(session: Session): string {
  const first = (session.name ?? '').trim().split(/\s+/)[0]
  return (first || session.email.split('@')[0] || 'Someone').slice(0, 40)
}

/** A range that starts at the file's first byte, or none: the start of a play. */
function fromStart(range: string | null): boolean {
  return range === null || /^bytes=0-/.test(range.trim())
}

export async function share(ctx: Context): Promise<Response> {
  if (!ctx.env.SHARES) throw notFound('this doorman keeps no share links')
  const parts = ctx.url.pathname.slice(SHARE.length).split('/').filter(Boolean)
  const method = ctx.request.method

  if (parts.length === 0) {
    const session = await requireSession(ctx)
    if (method === 'GET') return list(ctx, session, 'out')
    if (method !== 'POST') return methodNotAllowed(['GET', 'POST'])
    const body = await readJson(ctx.request, ShareCreateSchema, CREATE_MAX_BYTES)
    // A link lends from your bucket, so there has to be one.
    if (!(await ctx.accounts.bucket(session.sub))) {
      throw new DoormanError(409, DOORMAN_ERROR.noStorage, 'connect your bucket first')
    }
    const id = secureHex(8)
    const made = await shareObject(ctx, id).fetch(
      'https://share/create',
      post({ ...body, id, sub: session.sub, picture: facePicture(session) }),
    )
    if (made.ok) await remember(ctx, 'out', session.sub, id)
    return relayed(made)
  }

  if (parts.length === 1 && parts[0] === 'received') {
    if (method !== 'GET') return methodNotAllowed(['GET'])
    return list(ctx, await requireSession(ctx), 'in')
  }

  const id = ShareIdSchema.safeParse(parts[0])
  if (!id.success) throw notFound('no such link')
  const object = shareObject(ctx, id.data)
  const key = ctx.url.searchParams.get('k') ?? ''
  const [, action, entry, part, ...rest] = parts

  if (action === undefined) {
    if (method !== 'GET') return methodNotAllowed(['GET'])
    const session = await optionalSession(ctx)
    const opened = await object.fetch(
      'https://share/open',
      post({
        key,
        sub: session?.sub ?? '',
        name: session ? nameOf(session) : null,
        visitor: ctx.url.searchParams.get('v'),
      }),
    )
    if (opened.ok && session) {
      const body = YoursSchema.safeParse(await opened.clone().json())
      if (body.success && !body.data.yours) await remember(ctx, 'in', session.sub, id.data)
    }
    return relayed(opened)
  }

  if (action === 'files' && entry !== undefined && part !== undefined && rest.length === 0) {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(['GET', 'HEAD'])
    if (!RoomIdSchema.safeParse(entry).success || !RoomFilePartSchema.safeParse(part).success) {
      throw notFound('that song is not in this link')
    }
    const query = new URLSearchParams({ k: key, entry, part })
    const lent = await object.fetch(`https://share/file?${query.toString()}`)
    if (!lent.ok) return relayed(lent)
    const file = ShareFileSchema.parse(await lent.json())
    const target = await ctx.accounts.bucket(file.sub)
    if (!target) throw notFound('whoever sent it has no bucket connected any more')
    let response: Response
    try {
      response = await relayRead(ctx, new Bucket(target, ctx.bucketDeps), file.key, method)
    } catch (error) {
      // The song left its sender's library: the link says so from now on.
      if (part === 'audio' && error instanceof DoormanError && error.status === 404) {
        await object
          .fetch('https://share/gone', post({ entry }))
          .then(answer => answer.body?.cancel())
      }
      throw error
    }
    if (part === 'audio' && method === 'GET' && response.ok) {
      const range = ctx.request.headers.get('range')
      await object
        .fetch('https://share/played', post({ entry, fromStart: fromStart(range) }))
        .then(answer => answer.body?.cancel())
    }
    // As a room's files are (rooms.ts): the web app's audio element asks with credentials.
    response.headers.set('access-control-allow-credentials', 'true')
    return response
  }

  if (action === 'ask' && entry === undefined) {
    if (method !== 'POST') return methodNotAllowed(['POST'])
    const session = await optionalSession(ctx)
    const body = await readJson(ctx.request, ShareAskBodySchema)
    // Signed in, you ask as yourself; a guest gives a name.
    const name = session ? nameOf(session) : body.name
    return relayed(
      await object.fetch('https://share/ask', post({ key, sub: session?.sub ?? '', name })),
    )
  }

  if (action === 'act' && entry === undefined) {
    if (method !== 'POST') return methodNotAllowed(['POST'])
    const session = await requireSession(ctx)
    const body = await readJson(ctx.request, ShareActionSchema)
    const done = await object.fetch('https://share/act', post({ sub: session.sub, action: body }))
    if (body.type === 'forget' && done.ok) {
      await forget(ctx, 'out', session.sub, id.data)
      await forget(ctx, 'in', session.sub, id.data)
    }
    return relayed(done)
  }

  throw notFound()
}

/** A hundred songs, each a few hundred bytes of names and keys. */
const CREATE_MAX_BYTES = 256 * 1024

/** `GET /v1/share` and `/v1/share/received`: your links, newest first. */
async function list(ctx: Context, session: Session, side: Side): Promise<Response> {
  const summaries: ShareSummary[] = []
  for (const id of await linkIds(ctx, side, session.sub)) {
    const answer = await shareObject(ctx, id).fetch(
      `https://share/summary?sub=${encodeURIComponent(session.sub)}`,
    )
    if (answer.ok) summaries.push(await answer.json())
    else {
      await answer.body?.cancel()
      // Forgotten, or taken off: off the list.
      if (answer.status === 403 || answer.status === 404) await forget(ctx, side, session.sub, id)
    }
  }
  summaries.sort((a, b) => b.createdAt - a.createdAt)
  return json(summaries)
}

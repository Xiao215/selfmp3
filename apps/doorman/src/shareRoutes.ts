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
  ShareLinkSchema,
  ShareSummarySchema,
  shareSongKey,
  SHARE_KEPT_MS,
  SHARE_LIMIT_MS,
  type RoomSong,
  type ShareCreate,
  type ShareSummary,
} from '@selfmp3/shared'
import { z } from 'zod'
import { requireSession, type Context } from './context.js'
import {
  BucketFileSchema,
  idIndex,
  lentAnswer,
  optionalSession,
  post,
  readLent,
  relayed,
  summariesOf,
  type IdIndex,
} from './doRelay.js'
import { secureHex, sha256Hex } from './encoding.js'
import { json, methodNotAllowed, notFound, readJson } from './http.js'
import { facePicture, type Session } from './sessions.js'

/**
 * Share links (docs/features/share-links.md; the contract is
 * packages/shared's schemas/share.ts). Each is a Durable Object named by its
 * id (share.ts); these routes check the session where one is needed, keep
 * each account's two lists — the links it sent and the ones it opened — and
 * lend songs' files.
 *
 * Each list is a KV value per account (doRelay.ts's `idIndex`), written only
 * when a link is made, is first opened by that account, or is taken off it.
 * Every entry is checked with the link itself before it is shown, and one the
 * link no longer knows is dropped.
 *
 * Sharing the same songs again under the same name gives back the same link
 * (`share-same:<sub>:<sha256>`), shared again if it ran out. One its sender
 * ended, or whose songs left the bucket, is not brought back: a new link is
 * made instead. The way back to a link lasts as long as the link can, so it
 * is put again whenever the link is shared again, from either way in. Shared
 * from a line of its song, it is still the same link: it remembers the line,
 * and the address says where to start (`?t=0:42`).
 */

const SHARE = DOORMAN_PATHS.share

/** Whether the link opened was the opener's own, which is no friend's link to remember. */
const YoursSchema = z.object({ yours: z.boolean() })

type Side = 'out' | 'in'

/** The links an account sent (`out`), or opened (`in`). */
function linkIndex(ctx: Context, side: Side, sub: string): IdIndex {
  return idIndex(ctx, `share-${side}:${sub}`, ShareIdSchema)
}

/** A link lives at most a month from when it was last shared, and its card ninety days more. */
const SAME_TTL_SECONDS = Math.ceil((SHARE_LIMIT_MS + SHARE_KEPT_MS) / 1000)

/**
 * What makes two shares the same: who, what it is called, and which songs, in
 * any order. A link's own entries give the same key as the songs it was made
 * from: sharing again swaps a song only for one with the same `shareSongKey`.
 */
async function sameKey(
  sub: string,
  body: Pick<ShareCreate, 'kind' | 'name'> & { songs: readonly RoomSong[] },
): Promise<string> {
  const songs = body.songs.map(shareSongKey)
  const hash = await sha256Hex(JSON.stringify([body.kind, body.name, songs.sort()]))
  return `share-same:${sub}:${hash}`
}

/**
 * The link these songs were shared as before, while it can still be: as it
 * is while it plays, shared again once it ran out. Null when there is none,
 * or it was ended by its sender or by its songs leaving the bucket.
 */
async function sharedBefore(
  ctx: Context,
  sub: string,
  same: string,
  body: Pick<ShareCreate, 'songs' | 'line'>,
): Promise<Response | null> {
  const id = ShareIdSchema.safeParse(await ctx.env.KV.get(same))
  if (!id.success) return null
  const object = shareObject(ctx, id.data)
  const answer = await object.fetch(`https://share/summary?sub=${encodeURIComponent(sub)}`)
  if (!answer.ok) {
    await answer.body?.cancel()
    return null
  }
  const before = ShareSummarySchema.parse(await answer.json())
  if (!before.yours) return null
  await linkIndex(ctx, 'out', sub).remember(before.id)
  if (before.ended && before.ended.why !== 'idle' && before.ended.why !== 'limit') return null
  // Its songs as the library has them now: a file renamed since is lent by
  // its new name. And the line it is shared from this time, if one.
  const latest = await object.fetch(
    'https://share/songs',
    post({ sub, songs: body.songs, line: body.line }),
  )
  await latest.body?.cancel()
  if (!latest.ok) return null
  if (!before.ended) {
    // Its sender opening it: the link as it is, nothing counted.
    return object.fetch(
      'https://share/open',
      post({ key: before.key, sub, name: null, visitor: null }),
    )
  }
  const renewed = await object.fetch('https://share/act', post({ sub, action: { type: 'renew' } }))
  if (!renewed.ok) {
    await renewed.body?.cancel()
    return null
  }
  // Its new month starts now: the way back to it lasts as long as the link can.
  await ctx.env.KV.put(same, before.id, { expirationTtl: SAME_TTL_SECONDS })
  return renewed
}

export function shareObject(ctx: Context, id: string): DurableObjectStub {
  const namespace = ctx.env.SHARES
  if (!namespace) throw notFound('this doorman keeps no share links')
  return namespace.get(namespace.idFromName(id))
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
    const same = await sameKey(session.sub, body)
    const before = await sharedBefore(ctx, session.sub, same, body)
    if (before) return relayed(before)
    const id = secureHex(8)
    const made = await shareObject(ctx, id).fetch(
      'https://share/create',
      post({ ...body, id, sub: session.sub, picture: facePicture(session) }),
    )
    if (made.ok) {
      await linkIndex(ctx, 'out', session.sub).remember(id)
      await ctx.env.KV.put(same, id, { expirationTtl: SAME_TTL_SECONDS })
    }
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
      if (body.success && !body.data.yours) {
        await linkIndex(ctx, 'in', session.sub).remember(id.data)
      }
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
    const file = BucketFileSchema.parse(await lent.json())
    let response: Response
    try {
      response = await readLent(ctx, file, method, 'whoever sent it')
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
      // Written down after the answer, as a read is counted (tally.ts): the
      // song starts playing without waiting on the link's own storage.
      const range = ctx.request.headers.get('range')
      ctx.waitUntil(
        object
          .fetch('https://share/played', post({ entry, fromStart: fromStart(range) }))
          .then(answer => answer.body?.cancel()),
      )
    }
    return lentAnswer(response)
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
      await linkIndex(ctx, 'out', session.sub).forget(id.data)
      await linkIndex(ctx, 'in', session.sub).forget(id.data)
    }
    if (body.type === 'renew' && done.ok) {
      // Its new month starts now: the way back to it lasts as long as the link can.
      const renewed = ShareLinkSchema.parse(await done.clone().json())
      const same = await sameKey(session.sub, {
        kind: renewed.kind,
        name: renewed.name,
        songs: renewed.entries.map(each => each.song),
      })
      await ctx.env.KV.put(same, renewed.id, { expirationTtl: SAME_TTL_SECONDS })
    }
    return relayed(done)
  }

  throw notFound()
}

/** A hundred songs, each a few hundred bytes of names and keys. */
const CREATE_MAX_BYTES = 256 * 1024

/**
 * `GET /v1/share` and `/v1/share/received`: your links, newest first.
 * Forgotten, or taken off: off the list.
 */
async function list(ctx: Context, session: Session, side: Side): Promise<Response> {
  const summaries = await summariesOf<ShareSummary>(linkIndex(ctx, side, session.sub), id =>
    shareObject(ctx, id).fetch(`https://share/summary?sub=${encodeURIComponent(session.sub)}`),
  )
  summaries.sort((a, b) => b.createdAt - a.createdAt)
  return json(summaries)
}

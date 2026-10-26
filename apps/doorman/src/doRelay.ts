import {
  DOORMAN_ERROR,
  DoormanError,
  type DoormanErrorCode,
  type RoomRefusal,
} from '@selfmp3/shared'
import { z } from 'zod'
import { Bucket, BucketError } from './bucket.js'
import { requireSession, type Context } from './context.js'
import { relayRead } from './files.js'
import { JSON_HEADERS, notFound } from './http.js'
import { bearerToken, type Session } from './sessions.js'

/**
 * What rooms, shared playlists and share links have in common, both sides of
 * the wall between the Worker and their Durable Objects.
 *
 * Each of the three is a Durable Object (room.ts, shared.ts, share.ts) that
 * only the Worker talks to (rooms.ts, sharedRoutes.ts, shareRoutes.ts), over
 * plain JSON requests. The Worker checks what needs a session, hands the rest
 * on, and passes the object's answer back as its own; and when the object
 * says a song's file may be lent, it reads that file from its owner's bucket.
 * Those steps are the same for all three, so they are written once, here.
 */

/** A JSON body posted to a Durable Object. */
export function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/**
 * The object's answer, passed on the doorman's way: JSON, never cached, its
 * headers changeable. An answer from a Durable Object has headers that cannot
 * be changed, and every answer gets the CORS headers added (doorman.ts), so it
 * is made again as the doorman's own — around the same body, passed through
 * unread: a share link of a thousand songs is a megabyte or two of JSON, and
 * reading it only to write it out again is the Worker's time for nothing.
 */
export function relayed(response: Response): Response {
  if (response.status === 204) return new Response(null, { status: 204 })
  return new Response(response.body, { status: response.status, headers: JSON_HEADERS })
}

/** The session the request brings, when it brings one. A token that is no good is said so. */
export async function optionalSession(ctx: Context): Promise<Session | null> {
  if (!bearerToken(ctx.request)) return null
  return requireSession(ctx)
}

/** Which bucket, and which key in it: what an object says a lent file is read by. */
export const BucketFileSchema = z.object({ sub: z.string(), key: z.string() })
type BucketFile = z.infer<typeof BucketFileSchema>

/**
 * A song's file, lent: read from its owner's bucket the way a device reads its
 * own (`relayRead`), and counted as lent. `owner` is who that is, as the
 * friend asking would put it ("whoever sent it"): what is said when they have
 * no bucket connected any more, or their bucket's allowance for the day is
 * used up. That second is said as the friend's own news, not Backblaze's
 * (raise it under Caps & Alerts…), which is the owner's to act on — and under
 * a code of its own, so the friend's device does not take its own bucket for
 * capped.
 */
export async function readLent(
  ctx: Context,
  file: BucketFile,
  method: 'GET' | 'HEAD',
  owner: string,
): Promise<Response> {
  const target = await ctx.accounts.bucket(file.sub)
  if (!target) throw notFound(`${owner} has no bucket connected any more`)
  try {
    return await relayRead(ctx, new Bucket(target, ctx.bucketDeps), file.key, method, 'lent')
  } catch (error) {
    if (!(error instanceof BucketError) || error.kind !== 'cap') throw error
    throw new DoormanError(
      502,
      DOORMAN_ERROR.lenderCapExceeded,
      `${owner.charAt(0).toUpperCase()}${owner.slice(1)} has run out of their daily quota`,
    )
  }
}

/**
 * A lent file's answer, readable by the web app's audio element. It asks with
 * credentials (apps/app's engine.web.ts), which a browser lets it read only
 * when the answer says so, besides naming the origin (cors.ts does that for
 * every answer). The doorman keeps no cookies, so there is nothing more this
 * lets through.
 */
export function lentAnswer(response: Response): Response {
  response.headers.set('access-control-allow-credentials', 'true')
  return response
}

/**
 * One account's list of ids in KV: the shared playlists it is in, the links
 * it sent or opened. Written only when one is added or taken off — a few
 * times a day at most, which KV's free writes cover — and every id in it is
 * checked with its object before it is shown (`summariesOf`).
 */
export interface IdIndex {
  /** The ids, newest first; none when the value is missing or not a list of ids. */
  ids(): Promise<string[]>
  /** Put one first, unless it is already there. */
  remember(id: string): Promise<void>
  /** Take these off, in one write; nothing is written when none of them is there. */
  forget(...ids: string[]): Promise<void>
}

/** The most ids one list keeps. */
const INDEX_MAX = 200

export function idIndex(ctx: Context, key: string, schema: z.ZodType<string>): IdIndex {
  const ListSchema = z.array(schema)
  const ids = async (): Promise<string[]> => {
    const stored = await ctx.env.KV.get(key)
    if (!stored) return []
    try {
      const parsed = ListSchema.safeParse(JSON.parse(stored))
      return parsed.success ? parsed.data : []
    } catch {
      return []
    }
  }
  return {
    ids,
    remember: async id => {
      const held = await ids()
      if (held.includes(id)) return
      await ctx.env.KV.put(key, JSON.stringify([id, ...held].slice(0, INDEX_MAX)))
    },
    forget: async (...gone) => {
      const held = await ids()
      if (!gone.some(id => held.includes(id))) return
      await ctx.env.KV.put(key, JSON.stringify(held.filter(id => !gone.includes(id))))
    },
  }
}

/**
 * Each id in a list as its object sums it up, all asked at once. One the
 * object no longer knows, or no longer counts this account in (404, 403), is
 * taken off the list; one that failed some other way is left for next time.
 */
export async function summariesOf<T>(
  index: IdIndex,
  summary: (id: string) => Promise<Response>,
): Promise<T[]> {
  const answers = await Promise.all(
    (await index.ids()).map(async id => {
      const answer = await summary(id)
      if (answer.ok) return { id, found: (await answer.json()) as T, gone: false }
      await answer.body?.cancel()
      return { id, found: null, gone: answer.status === 403 || answer.status === 404 }
    }),
  )
  await index.forget(...answers.filter(each => each.gone).map(each => each.id))
  return answers.flatMap(each => (each.found === null ? [] : [each.found]))
}

/** The status a refusal answers with, by what was refused: the same for all three objects. */
const REFUSAL_STATUS: Readonly<Record<RoomRefusal['refused'], number>> = {
  forbidden: 403,
  missing: 404,
  full: 409,
  ended: 410,
  invalid: 400,
}

/** An object's error answer, as the Worker passes it on (`relayed`). */
export function answer(status: number, code: DoormanErrorCode, error: string): Response {
  return Response.json({ error, code }, { status })
}

/** A refusal (packages/shared's room.ts), answered with its status and the object's own code for it. */
export function refusalAnswer(
  refused: RoomRefusal,
  codes: Readonly<Record<RoomRefusal['refused'], DoormanErrorCode>>,
): Response {
  return answer(REFUSAL_STATUS[refused.refused], codes[refused.refused], refused.message)
}

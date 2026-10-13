import {
  DOORMAN_ERROR,
  DOORMAN_PATHS,
  DoormanError,
  DoormanGrantRequestSchema,
  type DoormanGrant,
  type DoormanGrantMade,
  type DoormanGrants,
} from '@selfmp3/shared'
import { z } from 'zod'
import { requireSession, type Context } from './context.js'
import { forbidden, json, methodNotAllowed, notFound, readJson } from './http.js'
import { secureHex } from './encoding.js'
import { getRecord, putRecord } from './kv.js'
import type { Session } from './sessions.js'

/**
 * Grants: the sessions an account gives a server (docs/features/shared-server.md).
 *
 * A server that works for several people imports, publishes and analyses for
 * each of them while none of their devices is open, so it needs a way into
 * each one's bucket that does not end when a phone signs out. A grant is that
 * way: a session like a device's, with the server's name on it and no 180-day
 * end, listed under the account so it can be seen and taken back.
 *
 *   grants:<sub>   [{ id, server, name, createdAt, hash }]   for good
 *
 * `hash` is the session's key, so ending a grant ends its session without the
 * token ever being kept. Making a grant costs two KV writes and ending one two;
 * a server asks for one once per account, when that account joins it.
 *
 * Only a device's session can make a grant. A grant making grants would let a
 * server hand the account on to another without anyone being asked.
 */

/** More than anyone has servers. A new grant for a server already listed replaces it. */
const MAX_GRANTS = 20

const StoredGrantSchema = z.object({
  id: z.string(),
  server: z.string(),
  name: z.string(),
  createdAt: z.string(),
  hash: z.string(),
})
type StoredGrant = z.infer<typeof StoredGrantSchema>

const StoredGrantsSchema = z.array(StoredGrantSchema)

const GRANTS = DOORMAN_PATHS.grants

/** `/v1/grants` and `/v1/grants/<id>`. */
export async function grants(ctx: Context): Promise<Response> {
  const path = ctx.url.pathname
  const method = ctx.request.method
  if (path === GRANTS) {
    if (method === 'GET') return list(ctx)
    if (method === 'POST') return make(ctx)
    return methodNotAllowed(['GET', 'POST'])
  }
  const id = path.slice(GRANTS.length + 1)
  if (!/^[0-9a-f]{16}$/.test(id)) throw notFound('no such grant')
  if (method === 'DELETE') return end(ctx, id)
  return methodNotAllowed(['DELETE'])
}

/** `POST /v1/grants` — a grant for the server named, made with a device's session. */
async function make(ctx: Context): Promise<Response> {
  const session = await requireSession(ctx)
  if (session.grant !== undefined) throw forbidden('a server cannot pass its grant on')
  const request = await readJson(ctx.request, DoormanGrantRequestSchema)

  const stored = await read(ctx, session.sub)
  // One grant a server: asking again replaces the one it had, which then ends.
  const replaced = stored.filter(grant => grant.server === request.server)
  const kept = stored.filter(grant => grant.server !== request.server)
  if (kept.length >= MAX_GRANTS) {
    throw new DoormanError(
      409,
      DOORMAN_ERROR.tooManyGrants,
      'remove a server before adding another',
    )
  }

  const id = secureHex(8)
  const { token } = await ctx.sessions.create(session, id)
  const grant: StoredGrant = {
    id,
    server: request.server,
    name: request.name,
    createdAt: new Date(ctx.now()).toISOString(),
    hash: await ctx.sessions.hashOf(token),
  }
  await write(ctx, session.sub, [...kept, grant])
  for (const old of replaced) await ctx.sessions.endByHash(old.hash)

  const body: DoormanGrantMade = { grant: shown(grant), token }
  return json(body, 201)
}

/** `GET /v1/grants` — every server the account has let in. */
async function list(ctx: Context): Promise<Response> {
  const session = await requireSession(ctx)
  const body: DoormanGrants = { grants: (await read(ctx, session.sub)).map(shown) }
  return json(body)
}

/**
 * `DELETE /v1/grants/<id>` — take a grant back. A device does it from
 * Settings; a server does it with its own grant when it lets the account go.
 */
async function end(ctx: Context, id: string): Promise<Response> {
  const session = await requireSession(ctx)
  const stored = await read(ctx, session.sub)
  const grant = stored.find(candidate => candidate.id === id)
  if (!grant) throw notFound('no such grant')
  await write(
    ctx,
    session.sub,
    stored.filter(candidate => candidate.id !== id),
  )
  await ctx.sessions.endByHash(grant.hash)
  return new Response(null, { status: 204 })
}

/**
 * Forget every grant the account made, when it signs out everywhere: their
 * sessions are already refused by then (context.ts), and a list of servers
 * that can no longer get in would only mislead. A read, and a write only when
 * there was a list: most accounts never let a server in.
 */
export async function forgetGrants(ctx: Context, sub: Session['sub']): Promise<void> {
  if ((await read(ctx, sub)).length > 0) await ctx.env.KV.delete(grantsKey(sub))
}

function read(ctx: Context, sub: Session['sub']): Promise<StoredGrant[]> {
  return getRecord(ctx.env.KV, grantsKey(sub), StoredGrantsSchema).then(found => found ?? [])
}

async function write(ctx: Context, sub: Session['sub'], list: StoredGrant[]): Promise<void> {
  if (list.length === 0) await ctx.env.KV.delete(grantsKey(sub))
  else await putRecord(ctx.env.KV, grantsKey(sub), list)
}

/** A grant as anyone may see it: everything but the session's hash. */
function shown(grant: StoredGrant): DoormanGrant {
  return { id: grant.id, server: grant.server, name: grant.name, createdAt: grant.createdAt }
}

function grantsKey(sub: string): string {
  return `grants:${sub}`
}

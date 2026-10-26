import {
  DoormanAccessUpdateSchema,
  type DoormanAccess,
  type DoormanAccessUpdate,
} from '@selfmp3/shared'
import { recall, remember, type BoundedCache } from './boundedCache.js'
import type { Context } from './context.js'
import { forbidden, json, methodNotAllowed, readJson } from './http.js'
import { getRecord, putRecord, type KvStore } from './kv.js'
import { requireSession } from './context.js'
import { bearerToken } from './sessions.js'
import { DAYS_KEPT, tallyOf } from './tally.js'

/**
 * Who may sign in: the doorman's owners, and the list they keep
 * (docs/features/shared-server.md, "Who may sign in").
 *
 *   OWNER_EMAILS   a secret: who may change the list, and is always let in
 *   access         in KV: { anyone, emails } — everyone, or these addresses
 *
 * The list is kept where the owner can change it — the admin page's People
 * tab (docs/features/admin.md) — rather than in a secret only `wrangler` can set.
 * Owners are a secret all the same: whoever deploys the doorman decides who
 * runs it, and an owner off the list would be an owner locked out.
 *
 * Asked on every signed-in request, so each Worker instance remembers the list
 * for a minute (boundedCache.ts). A change reaches the instance that made it at
 * once, and the others within the minute, as with signing out.
 */

const ACCESS_KEY = 'access'

/** Nobody but the owners, until an owner says otherwise. */
const NOBODY: DoormanAccessUpdate = { anyone: false, emails: [] }

export type AccessCache = BoundedCache<DoormanAccessUpdate>

export class Access {
  readonly #kv: KvStore
  readonly #owners: ReadonlySet<string>
  readonly #now: () => number
  readonly #cache: AccessCache

  constructor(kv: KvStore, owners: string | undefined, now: () => number, cache: AccessCache) {
    this.#kv = kv
    this.#owners = addresses(owners)
    this.#now = now
    this.#cache = cache
  }

  isOwner(email: string): boolean {
    return this.#owners.has(normal(email))
  }

  /** Whether this Google address may sign in, and go on using a session it has. */
  async allows(email: string): Promise<boolean> {
    if (this.isOwner(email)) return true
    const list = await this.#list()
    return list.anyone || list.emails.includes(normal(email))
  }

  /** Whether nobody at all may sign in, so a sign-in can say so before the trip to Google. */
  async nobody(): Promise<boolean> {
    if (this.#owners.size > 0) return false
    const list = await this.#list()
    return !list.anyone && list.emails.length === 0
  }

  async read(): Promise<DoormanAccess> {
    return { ...(await this.#list()), owners: [...this.#owners] }
  }

  /** The list replaced, whole. One KV write. */
  async write(update: DoormanAccessUpdate): Promise<DoormanAccess> {
    // An owner on the list is noise: they are let in anyway.
    const emails = [...new Set(update.emails.map(normal))].filter(email => !this.isOwner(email))
    const list = { anyone: update.anyone, emails }
    await putRecord(this.#kv, ACCESS_KEY, list)
    remember(this.#cache, ACCESS_KEY, list, this.#now())
    return { ...list, owners: [...this.#owners] }
  }

  async #list(): Promise<DoormanAccessUpdate> {
    const now = this.#now()
    const cached = recall(this.#cache, ACCESS_KEY, now)
    if (cached) return cached
    const list = (await getRecord(this.#kv, ACCESS_KEY, DoormanAccessUpdateSchema)) ?? NOBODY
    remember(this.#cache, ACCESS_KEY, list, now)
    return list
  }
}

/**
 * The owner: the admin key (ADMIN_TOKEN, a secret the owner's own server holds
 * for its admin page, docs/features/admin.md), or the owner signed in on a
 * device of their own. A server's grant is a session in the owner's name too,
 * but it is the server's, and a server may not decide who signs in or read
 * what the doorman counts: any server the owner ever let in could, otherwise.
 */
export async function requireOwner(ctx: Context): Promise<void> {
  const token = bearerToken(ctx.request)
  if (token && (await isAdminKey(ctx.env.ADMIN_TOKEN, token))) return
  const session = await requireSession(ctx)
  if (session.grant !== undefined) throw forbidden('a server cannot do this with its grant')
  if (!ctx.access.isOwner(session.email)) throw forbidden('only the owner can do this')
}

/** Whether `token` is the admin key, compared in constant time; never when none is set. */
async function isAdminKey(key: string | undefined, token: string): Promise<boolean> {
  const set = key?.trim() ?? ''
  if (set.length < 32) return false
  const digest = (text: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const [a, b] = (await Promise.all([digest(set), digest(token)])).map(d => new Uint8Array(d))
  // Every byte looked at, whatever the first difference: equal-length digests, so no early out.
  let differ = 0
  for (let i = 0; i < 32; i += 1) differ |= (a?.[i] ?? 0) ^ (b?.[i] ?? 0)
  return differ === 0
}

/** `GET /v1/access` and `PUT /v1/access`: the list, for an owner only. */
export async function access(ctx: Context): Promise<Response> {
  await requireOwner(ctx)
  if (ctx.request.method === 'GET') return json(await ctx.access.read())
  if (ctx.request.method === 'PUT') {
    return json(await ctx.access.write(await readJson(ctx.request, DoormanAccessUpdateSchema)))
  }
  return methodNotAllowed(['GET', 'PUT'])
}

/** `GET /v1/stats?days=N`: what the doorman counted, for an owner only. */
export async function stats(ctx: Context): Promise<Response> {
  await requireOwner(ctx)
  const asked = Number(ctx.url.searchParams.get('days') ?? '30')
  const days = Number.isInteger(asked) ? Math.min(Math.max(asked, 1), DAYS_KEPT) : 30
  return json(await tallyOf(ctx).days(days))
}

function normal(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * OWNER_EMAILS as lower-cased addresses. Google addresses are not
 * case-sensitive, and what someone types into a secret may not match what
 * Google says letter for letter.
 */
function addresses(value: string | undefined): ReadonlySet<string> {
  const found = new Set<string>()
  for (const entry of (value ?? '').split(/[\s,]+/)) if (entry) found.add(normal(entry))
  return found
}

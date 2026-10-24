import {
  DoormanAccessRequestSchema,
  DoormanAccessRequestsSchema,
  DoormanStatsSchema,
  type DoormanAccessRequest,
  type DoormanAccessRequests,
  type DoormanStats,
} from '@selfmp3/shared'
import { z } from 'zod'
import type { Context } from './context.js'

/**
 * What the doorman counts for its owner's admin page (docs/features/admin.md):
 * reads by folder and by app, and sign-ins, a day at a time; and the addresses
 * Google signed in that were not on the list, for a week.
 *
 * Totals only. A day's counts carry no account, so nothing here can be broken
 * down by person later; an address asking to be let in is the one name kept,
 * because letting it in is the point.
 *
 * One Durable Object for the whole doorman (`TALLY`, named `all`), for the same
 * reasons as the change counter (changes.ts): strongly consistent, and on the
 * free plan, where KV's thousand writes a day would not last a busy morning.
 * Counting never holds up the request it counts: it runs after the answer, and
 * a counter that cannot be reached loses a count rather than a read.
 */

/** Days of counts kept: a year, and a little more so a year back always has its whole first week. */
export const DAYS_KEPT = 400
/** How long someone who was turned away is remembered. */
const ASKED_KEPT_MS = 7 * 24 * 60 * 60 * 1000

const AddSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  names: z.array(z.string().min(1).max(64)).min(1).max(32),
})
const AskedSchema = z.object({ email: z.string().min(3).max(254), at: z.string() })

interface Tally {
  /** Add one to each name, for today. After the answer; never fails the caller. */
  count(...names: string[]): void
  /** The last `days` days of counts, oldest first. */
  days(days: number): Promise<DoormanStats>
  /** Remember that this address was turned away. After the answer, like `count`. */
  asked(email: string): void
  /** Who was turned away in the last week, latest first. */
  requests(): Promise<DoormanAccessRequests>
  /** Forget these addresses: let in, or dismissed. */
  forget(emails: readonly string[]): Promise<void>
}

/** The doorman's tally, through the Worker's binding; one that counts nothing when there is none. */
export function tallyOf(ctx: Context): Tally {
  const namespace = ctx.env.TALLY
  if (!namespace) return NO_TALLY
  const stub = namespace.get(namespace.idFromName('all'))
  const ask = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await stub.fetch(`https://tally${path}`, init)
    if (!response.ok) throw new Error(`the tally answered ${response.status}`)
    return response.status === 204 ? null : response.json()
  }
  const post = (path: string, body: unknown): Promise<unknown> =>
    ask(path, { method: 'POST', body: JSON.stringify(body) })
  const today = (): string => utcDay(ctx.now())
  return {
    count: (...names) => {
      if (names.length > 0) ctx.waitUntil(post('/add', { day: today(), names }))
    },
    days: async days => {
      const from = utcDay(ctx.now() - (days - 1) * DAY_MS)
      const keep = utcDay(ctx.now() - DAYS_KEPT * DAY_MS)
      return DoormanStatsSchema.parse(await ask(`/days?from=${from}&keep=${keep}`))
    },
    asked: email => {
      ctx.waitUntil(post('/asked', { email, at: new Date(ctx.now()).toISOString() }))
    },
    requests: async () => {
      const since = new Date(ctx.now() - ASKED_KEPT_MS).toISOString()
      return DoormanAccessRequestsSchema.parse(
        await ask(`/asked?since=${encodeURIComponent(since)}`),
      )
    },
    forget: async emails => {
      if (emails.length > 0) await post('/forget', { emails })
    },
  }
}

const NO_TALLY: Tally = {
  count: () => undefined,
  days: () => Promise.resolve({ days: [] }),
  asked: () => undefined,
  requests: () => Promise.resolve({ requests: [] }),
  forget: () => Promise.resolve(),
}

const DAY_MS = 24 * 60 * 60 * 1000

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** As much of a Durable Object's storage as the tally asks. */
interface TallyStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list<T>(options: { prefix: string }): Promise<Map<string, T>>
}

type DayCounts = Record<string, number>

/**
 * The Durable Object class, exported from index.ts as `Tally`. A day is one
 * stored value (`day:<date>`, its counts by name) and a turned-away address
 * is another (`asked:<email>`). Old ones are let go when they are next read.
 */
export class TallyObject {
  readonly #storage: TallyStorage

  constructor(state: { readonly storage: TallyStorage }) {
    this.#storage = state.storage
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const route = `${request.method} ${url.pathname}`
    if (route === 'POST /add') {
      const { day, names } = AddSchema.parse(await request.json())
      const key = `day:${day}`
      const counts = (await this.#storage.get<DayCounts>(key)) ?? {}
      for (const name of names) counts[name] = (counts[name] ?? 0) + 1
      await this.#storage.put(key, counts)
      return new Response(null, { status: 204 })
    }
    if (route === 'GET /days') {
      const from = url.searchParams.get('from') ?? ''
      const oldest = url.searchParams.get('keep') ?? ''
      const stored = await this.#storage.list<DayCounts>({ prefix: 'day:' })
      const days: DoormanStats['days'] = []
      for (const [key, counts] of stored) {
        const day = key.slice('day:'.length)
        if (day < oldest) await this.#storage.delete(key)
        else if (day >= from) days.push({ day, counts })
      }
      days.sort((a, b) => a.day.localeCompare(b.day))
      return Response.json({ days })
    }
    if (route === 'POST /asked') {
      const { email, at } = AskedSchema.parse(await request.json())
      const key = `asked:${email.trim().toLowerCase()}`
      const known = await this.#storage.get<DoormanAccessRequest>(key)
      const next: DoormanAccessRequest = known
        ? { ...known, tries: known.tries + 1, lastAt: at }
        : { email: email.trim().toLowerCase(), tries: 1, firstAt: at, lastAt: at }
      await this.#storage.put(key, next)
      return new Response(null, { status: 204 })
    }
    if (route === 'GET /asked') {
      const since = url.searchParams.get('since') ?? ''
      const stored = await this.#storage.list<unknown>({ prefix: 'asked:' })
      const requests: DoormanAccessRequest[] = []
      for (const [key, value] of stored) {
        const parsed = DoormanAccessRequestSchema.safeParse(value)
        if (!parsed.success || parsed.data.lastAt < since) await this.#storage.delete(key)
        else requests.push(parsed.data)
      }
      requests.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
      return Response.json({ requests })
    }
    if (route === 'POST /forget') {
      const { emails } = z
        .object({ emails: z.array(z.string()).max(500) })
        .parse(await request.json())
      for (const email of emails) await this.#storage.delete(`asked:${email.trim().toLowerCase()}`)
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 404 })
  }
}

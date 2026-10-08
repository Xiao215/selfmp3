import { DoormanChangesSchema, type DoormanChanges } from '@selfmp3/shared'

/**
 * Each account's change counter: how a device asks "has anything a look would
 * find changed since I last listed?" without listing (docs/SYNC.md, "Caps").
 *
 * A look lists `log/` and `snapshots/`, and the bucket counts every listing
 * against a daily allowance; a device with the app open looked every minute or
 * so, two listings a time, which on its own came close to the whole of it. The
 * doorman sees every write and delete a device or a signed-in server makes, so
 * it can count the ones in those two folders and answer the question for free.
 *
 * The count lives in a Durable Object, one per account: strongly consistent
 * where KV is not (a counter read a minute stale is a change missed), and on
 * the free plan, which KV's thousand writes a day would not be for a busy day
 * of plays. A Durable Object handles one request at a time, and the storage
 * calls inside it do not let another in, so a read and a write of the count
 * are one step.
 *
 * The value is `<epoch>.<count>`. The epoch is chosen when the counter starts,
 * and only then, so if its storage were ever lost it starts again under a new
 * epoch and matches nothing a device holds.
 */

export interface ChangeCounter {
  /** Where the counter stands. */
  read(): Promise<string>
  /** Move it on by one, and say where it was and where it is now. */
  bump(): Promise<{ readonly before: string; readonly after: string }>
}

/** The account's counter, through the Worker's binding. */
export function changeCounter(namespace: DurableObjectNamespace, sub: string): ChangeCounter {
  const stub = namespace.get(namespace.idFromName(sub))
  const ask = async (path: string, method: string): Promise<unknown> => {
    const response = await stub.fetch(`https://changes${path}`, { method })
    if (!response.ok) throw new Error(`the change counter answered ${response.status}`)
    return response.json()
  }
  return {
    read: async () => DoormanChangesSchema.parse(await ask('/', 'GET')).changes,
    bump: async () => {
      const moved = (await ask('/bump', 'POST')) as { before?: unknown; after?: unknown }
      return {
        before: DoormanChangesSchema.shape.changes.parse(moved.before),
        after: DoormanChangesSchema.shape.changes.parse(moved.after),
      }
    },
  }
}

/** What a Durable Object's storage is asked here: two values, read and written. */
interface CounterStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
}

/**
 * The Durable Object class. Exported from index.ts by the name wrangler.toml
 * binds (`Changes`); it holds one account's counter and nothing else — no
 * address, no key, not even whose it is beyond the id it was reached by.
 */
export class ChangesObject {
  readonly #storage: CounterStorage

  constructor(state: { readonly storage: CounterStorage }) {
    this.#storage = state.storage
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/' && request.method === 'GET') {
      const body: DoormanChanges = { changes: format(await this.#current()) }
      return Response.json(body)
    }
    if (path === '/bump' && request.method === 'POST') {
      const current = await this.#current()
      const next = { epoch: current.epoch, count: current.count + 1 }
      await this.#storage.put('count', next.count)
      return Response.json({ before: format(current), after: format(next) })
    }
    return new Response(null, { status: 404 })
  }

  async #current(): Promise<{ epoch: string; count: number }> {
    let epoch = await this.#storage.get<string>('epoch')
    if (!epoch) {
      epoch = newEpoch()
      await this.#storage.put('epoch', epoch)
      await this.#storage.put('count', 0)
      return { epoch, count: 0 }
    }
    return { epoch, count: (await this.#storage.get<number>('count')) ?? 0 }
  }
}

function format(counter: { epoch: string; count: number }): string {
  return `${counter.epoch}.${counter.count}`
}

function newEpoch(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

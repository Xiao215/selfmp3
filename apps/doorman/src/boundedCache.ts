/**
 * The small caches a Worker instance keeps between requests.
 *
 * Each one saves a KV read, and the free plan counts those: a device fetching
 * a hundred files would otherwise look its session and its bucket up a hundred
 * times. They live as long as the instance, which is why they are bounded —
 * nothing here ever expires on its own, and an instance that ran for a day
 * would hold every account that passed through it.
 *
 * Full means emptied, not evicted one at a time. There is no ordering worth
 * keeping for entries that are only good for a minute anyway, and the cost of
 * being wrong is one extra KV read per live device rather than a stale answer.
 *
 * A minute is also the longest a sign-out can take to be felt by an instance
 * that already had the session in hand — no worse than KV itself, which may
 * take as long to tell its other copies about a delete.
 */

const LIMIT = 500

/** How long a remembered value stays good. */
const CACHE_MS = 60_000

interface Remembered<Value> {
  readonly value: Value
  readonly until: number
}

/** A cache whose entries go stale by themselves. */
export type BoundedCache<Value> = Map<string, Remembered<Value>>

/** Put something in a cache that may never grow past its bound. */
export function keep<Value>(cache: Map<string, Value>, key: string, value: Value): void {
  if (cache.size >= LIMIT) cache.clear()
  cache.set(key, value)
}

/** The same, for the next minute. */
export function remember<Value>(
  cache: BoundedCache<Value>,
  key: string,
  value: Value,
  now: number,
): void {
  keep(cache, key, { value, until: now + CACHE_MS })
}

/** What was remembered under `key`, while it is still fresh. */
export function recall<Value>(
  cache: BoundedCache<Value>,
  key: string,
  now: number,
): Value | undefined {
  const found = cache.get(key)
  return found && found.until > now ? found.value : undefined
}

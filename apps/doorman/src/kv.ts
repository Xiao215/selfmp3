import type { ZodType, ZodTypeDef } from 'zod'

/**
 * The KV namespace, as much of it as the doorman uses.
 *
 * Cloudflare's `KVNamespace` has this shape (and much more), so the binding is
 * passed in as it is; tests hand in a map with expiry. Keys:
 *
 *   attempt:<attempt>    a Google sign-in, waiting for its code      10 minutes
 *   session:<sha256>     a signed-in device                          180 days
 *   bucket:<sub>         a Google account's bucket, sealed           for good
 *   signout:<sub>        when the account last signed out everywhere for good
 *
 * The free plan allows about a thousand writes a day and a hundred thousand
 * reads, so writes are kept to the moments something really changes. Nothing
 * is written before Google has vouched for an address on the list; a whole
 * sign-in costs three writes (deletes count as writes), and using the
 * library none.
 *
 * KV is eventually consistent. A change is seen at once where it was made and
 * within about a minute everywhere else, which is why nothing here depends on
 * two requests from different places agreeing to the second.
 */
export interface KvStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

/** A stored record, or null when it is missing or not the shape it should be. */
export async function getRecord<Output>(
  kv: KvStore,
  key: string,
  schema: ZodType<Output, ZodTypeDef, unknown>,
): Promise<Output | null> {
  const text = await kv.get(key)
  if (text === null) return null
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = schema.safeParse(data)
  return parsed.success ? parsed.data : null
}

export async function putRecord(
  kv: KvStore,
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> {
  await kv.put(
    key,
    JSON.stringify(value),
    ttlSeconds === undefined ? undefined : { expirationTtl: ttlSeconds },
  )
}

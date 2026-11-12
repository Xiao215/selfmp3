import type { z } from 'zod'

/**
 * A value this device kept as JSON (a pref, a draft), read back through its
 * schema, or null: nothing kept, not JSON at all (half-written, or edited by
 * hand in `localStorage`), or a shape this build does not write. What is on a
 * disk is not to be trusted, and a remembered value is never worth failing
 * over.
 *
 * Generic over the schema, so a field with a default reads as always there
 * (packages/client's `request` says why).
 */
export function readStored<S extends z.ZodTypeAny>(
  raw: string | null,
  schema: S,
): z.output<S> | null {
  if (raw === null) return null
  try {
    const read = schema.safeParse(JSON.parse(raw))
    return read.success ? read.data : null
  } catch {
    return null
  }
}

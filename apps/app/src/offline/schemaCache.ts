import type { z } from 'zod'

import type { RecordStore } from './recordStore'

/**
 * Something the server said, kept on this device for when it cannot be asked:
 * a song's words, its motion curve, a playlist's members, the library itself.
 *
 * Four of these were written twice, a phone's over files and a browser's over
 * IndexedDB, and the eight copies drifted: only the browser remembered what it
 * had seen kept, a phone's read could throw where its other calls could not,
 * and a browser's clear could fail sign-out where a phone's could not. Here
 * the rules are written once over a store (`recordStore.ts`, a twin), and the
 * caches themselves are one line each (`caches.ts`).
 *
 * Parsed back through the same schema the answer was checked with, and dropped
 * when it does not parse: what is on a disk is not to be trusted, and a record
 * from an older shape is fetched afresh rather than crashing a screen on the
 * field it lacks. Nothing here fails: a cache that cannot be read, written or
 * cleared is a slower or less offline app, never a broken one.
 */
export interface SchemaCache<Value> {
  /**
   * Whether a record is kept, without reading it where the store can say so
   * cheaply: the catch-up pass asks after every downloaded song on every
   * library change. A record known to be here is a set lookup after that.
   */
  has(id: number | string): Promise<boolean>
  read(id: number | string): Promise<Value | null>
  write(id: number | string, value: Value): void
  /** Forget them all: signing out, where another account's ids would collide. */
  clear(): Promise<void>
}

export function createSchemaCache<Value>(
  store: RecordStore,
  schema: z.ZodType<Value, z.ZodTypeDef, unknown>,
): SchemaCache<Value> {
  /**
   * Ids written or read back whole by this page or app. Only what is known to
   * be there: a record that is missing or stale is read, and fetched, again.
   */
  const kept = new Set<string>()

  return {
    async has(id) {
      if (kept.has(String(id))) return true
      return store.has(String(id)).catch(() => false)
    },

    async read(id) {
      const key = String(id)
      try {
        const raw = await store.read(key)
        if (raw === null) {
          // Gone behind this page's back: the system clearing room, another tab.
          kept.delete(key)
          return null
        }
        const parsed = schema.safeParse(raw)
        if (parsed.success) {
          kept.add(key)
          return parsed.data
        }
      } catch {
        // Half-written, or not JSON at all: as good as none.
      }
      // Kept, but not as anything this app can use: let go, so the next pass
      // fetches it rather than counting it as here.
      kept.delete(key)
      await store.remove(key).catch(() => undefined)
      return null
    },

    write(id, value) {
      const key = String(id)
      void store.write(key, value).then(
        () => kept.add(key),
        () => undefined,
      )
    },

    async clear() {
      // The set first, so nothing asked meanwhile is told a record is still here.
      kept.clear()
      await store.clear().catch(() => undefined)
    },
  }
}

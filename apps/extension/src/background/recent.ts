import { linkIdentity } from '@selfmp3/shared'
import { z } from 'zod'
import type { KeyValueStore } from './store.js'

/**
 * The imports this extension started lately, so one can be undone.
 *
 * Undo takes a song out of the library, and a content script is treated as
 * the YouTube page it runs in (bridge.ts). So the page may undo only what
 * this extension itself put in, and only for a while: naming any video would
 * otherwise be a way to delete any song. A song that came from the phone, the
 * app or an import older than this is removed in self.mp3 itself.
 *
 * Each is kept with the side it went through — a server's address, or the
 * bucket's — because a song's id is that side's: a job's song id means nothing
 * to the bucket, and a bucket request's ids nothing to the server.
 */

const KEY = 'recent-imports'

/** How long after it was started an import can still be undone from here. */
const UNDO_FOR_MS = 60 * 60_000

const RecentSchema = z.object({
  /** When it was started, in ms. */
  at: z.number(),
  /** Which side it went through: a server's `baseUrl`, or the bucket's stand-in. */
  where: z.string(),
  /** The server's job for it, through a server. */
  jobId: z.string().nullable(),
  /** The bucket's request for it, through the bucket. */
  uid: z.string().nullable(),
  /**
   * Taken back out. Kept rather than dropped, because the queue still holds
   * the finished job, and without this the pill and the popup would read it
   * as "Added" again.
   */
  undone: z.boolean().default(false),
})
export type RecentImport = z.infer<typeof RecentSchema>

const RecentsSchema = z.record(RecentSchema)

function current(value: unknown, now: number): Record<string, RecentImport> {
  const parsed = RecentsSchema.safeParse(value)
  if (!parsed.success) return {}
  // Anything past its time is dropped whenever the record is written.
  return Object.fromEntries(
    Object.entries(parsed.data).filter(([, each]) => now - each.at < UNDO_FOR_MS),
  )
}

export function recentImports(store: KeyValueStore, now: () => number = Date.now) {
  return {
    /** Write down an import this extension just started, by its link. */
    async remember(
      url: string,
      started: Pick<RecentImport, 'where' | 'jobId' | 'uid'>,
    ): Promise<void> {
      const key = linkIdentity(url)
      if (!key) return
      await store.update(KEY, value => ({
        ...current(value, now()),
        [key]: { ...started, at: now(), undone: false },
      }))
    },

    /** The import of this link this extension started within the hour, undone or not. */
    async find(url: string): Promise<RecentImport | null> {
      const key = linkIdentity(url)
      if (!key) return null
      return current(await store.read(KEY), now())[key] ?? null
    },

    /** Taken back out: not to be undone twice, nor read as added again. */
    async undone(url: string): Promise<void> {
      const key = linkIdentity(url)
      if (!key) return
      await store.update(KEY, value => {
        const kept = current(value, now())
        const was = kept[key]
        return was ? { ...kept, [key]: { ...was, undone: true } } : kept
      })
    },
  }
}

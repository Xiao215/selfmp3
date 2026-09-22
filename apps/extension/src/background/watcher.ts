import type { ImportJob, ImportQueue } from '@selfmp3/shared'
import { z } from 'zod'
import { badgeText, finished, noticeFor, stillGoing, type Batch } from './jobs.model.js'
import type { KeyValueStore } from './store.js'

/**
 * The toolbar badge and the notification when a batch is done (F1).
 *
 * Chrome stops the worker when it has been idle, so this cannot be a timer and
 * nothing else: while it is awake it reads the queue every couple of seconds,
 * and an alarm — 30 seconds is Chrome's floor — wakes it if it was stopped. The
 * batches live in IndexedDB for the same reason.
 */

const KEY = 'batches'
export const ALARM = 'watch-queue'
const AWAKE_POLL_MS = 2_000
/** Chrome's smallest alarm, in minutes. */
export const ALARM_MINUTES = 0.5
/** A batch nothing has been heard about for this long is dropped. */
const STALE_MS = 24 * 60 * 60_000
/**
 * This many reads in a row failing ends the 2 s polling; the alarm carries on.
 *
 * While the server is away every poll fails, and a worker kept polling is a
 * worker Chrome never stops — each tick would keep its idle timer from running
 * out. Three misses tell a server asleep from one slow answer.
 */
export const GIVE_UP_AFTER = 3

const BatchSchema = z.object({
  id: z.string(),
  jobIds: z.array(z.string()),
  label: z.string().nullable(),
  startedAt: z.string(),
})
const BatchesSchema = z.array(BatchSchema)

interface WatcherDeps {
  readonly store: KeyValueStore
  /**
   * The server's queue, read plainly: nothing here may count as the popup
   * being opened, or the watcher would clear its own `!` on every tick.
   */
  readonly queue: () => Promise<ImportQueue>
  readonly badge: (text: string) => void | Promise<void>
  readonly notify: (notice: { title: string; message: string }) => void
  /** Overridable so a test needs no clock. */
  readonly now?: () => Date
}

interface Watcher {
  /** Remember what an import started, so the badge and the notice are about it. */
  add(jobs: readonly ImportJob[], label: string | null): Promise<void>
  /** Read the queue once: update the badge, announce anything that finished. */
  tick(): Promise<void>
  /** The popup was opened: a failure has been seen, so the badge goes quiet. */
  seen(): Promise<void>
  /** Keep ticking while this worker is awake and something of ours is going. */
  follow(): void
}

export function createWatcher({
  store,
  queue,
  badge,
  notify,
  now = () => new Date(),
}: WatcherDeps): Watcher {
  let failed = false
  let following = false
  /** What the badge last counted, so `seen` can redraw it without another read. */
  let going = 0
  /** Reads that failed since the last one that did not. */
  let misses = 0

  const read = async (): Promise<Batch[]> => {
    const parsed = BatchesSchema.safeParse(await store.read(KEY))
    return parsed.success ? parsed.data : []
  }

  const write = (batches: readonly Batch[]): Promise<void> => store.write(KEY, batches)

  async function tick(): Promise<void> {
    const remembered = await read()
    // Age is judged before the queue is asked, so a server that stays away
    // cannot keep a batch — and the polling for it — alive past a day.
    const stale = now().getTime() - STALE_MS
    const batches = remembered.filter(batch => new Date(batch.startedAt).getTime() > stale)
    if (batches.length !== remembered.length) await write(batches)
    if (batches.length === 0) {
      going = 0
      await badge(badgeText(0, failed))
      return
    }

    let current: ImportQueue
    try {
      current = await queue()
    } catch {
      // The server is asleep or the token has gone: leave the badge as it is
      // rather than saying the imports vanished.
      misses += 1
      return
    }
    misses = 0

    for (const batch of finished(current, batches)) {
      if (batch.failed.length > 0) failed = true
      const notice = noticeFor(batch)
      if (notice) notify(notice)
    }

    const left = batches.filter(batch => !finished(current, [batch]).length)
    if (left.length !== batches.length) await write(left)
    going = stillGoing(current, left)
    await badge(badgeText(going, failed))
  }

  return {
    async add(jobs, label) {
      if (jobs.length === 0) return
      const batches = await read()
      await write([
        ...batches,
        {
          id: jobs[0]?.id ?? String(now().getTime()),
          jobIds: jobs.map(job => job.id),
          label,
          startedAt: now().toISOString(),
        },
      ])
      going += jobs.length
      await badge(badgeText(going, failed))
      this.follow()
    },

    tick,

    // The popup asks for the queue every second while it is open: redrawing the
    // badge from what the last read counted keeps that from doubling the reads.
    async seen() {
      failed = false
      await badge(badgeText(going, false))
    },

    follow() {
      if (following) return
      following = true
      misses = 0
      const again = (): void => {
        void (async () => {
          let more = false
          try {
            await tick()
            // A server that has missed a few answers is asleep: the alarm
            // keeps looking every 30 s, and this worker may stop.
            more = misses < GIVE_UP_AFTER && (await read()).length > 0
          } catch {
            // IndexedDB failing to answer is no reason to stop watching: it
            // may simply have been busy for that one moment.
            more = true
          }
          if (more) setTimeout(again, AWAKE_POLL_MS)
          else following = false
        })()
      }
      setTimeout(again, AWAKE_POLL_MS)
    },
  }
}

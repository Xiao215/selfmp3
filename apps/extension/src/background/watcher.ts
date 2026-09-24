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
/** How long the alarm's ticks are waiting, and until when (`Pace`). */
const PACE_KEY = 'watch-pace'
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

/**
 * How long the alarm's ticks wait after each read that found nothing new: a
 * step further each time, and back to every alarm once something happens.
 *
 * Every read finds the route first, and finding the route reads the bucket,
 * which counts each listing against a daily allowance. A batch the queue
 * could not finish — the server's uploads refused for a day — kept the badge
 * reading every thirty seconds for the whole day, and that alone was the
 * allowance. The first reads come at every alarm, as an import that is
 * moving deserves; twenty minutes between reads is still a badge that
 * catches up.
 */
const PACE_MS = [0, 0, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 20 * 60_000]

const BatchSchema = z.object({
  id: z.string(),
  jobIds: z.array(z.string()),
  label: z.string().nullable(),
  startedAt: z.string(),
})
const BatchesSchema = z.array(BatchSchema)

const PaceSchema = z.object({
  /** Reads in a row that found nothing new: the index into `PACE_MS`. */
  quiet: z.number().int().nonnegative(),
  /** The alarm's ticks before this time read nothing. */
  dueAt: z.number(),
})
type Pace = z.infer<typeof PaceSchema>

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
  /**
   * Read the queue once: update the badge, announce anything that finished.
   * From the alarm, only when the pace allows; `forced` is the awake polling,
   * which stops on its own (`follow`).
   */
  tick(forced?: boolean): Promise<void>
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

  const parse = (stored: unknown): Batch[] => {
    const parsed = BatchesSchema.safeParse(stored)
    return parsed.success ? parsed.data : []
  }

  const read = async (): Promise<Batch[]> => parse(await store.read(KEY))

  const readPace = async (): Promise<Pace> => {
    const parsed = PaceSchema.safeParse(await store.read(PACE_KEY))
    return parsed.success ? parsed.data : { quiet: 0, dueAt: 0 }
  }
  /** Nothing new this read: the next alarm ticks wait a step longer. */
  const slowDown = async (pace: Pace): Promise<void> => {
    const quiet = Math.min(pace.quiet + 1, PACE_MS.length - 1)
    await store.write(PACE_KEY, { quiet, dueAt: now().getTime() + (PACE_MS[quiet] ?? 0) })
  }
  const resetPace = async (): Promise<void> => {
    await store.remove(PACE_KEY)
  }

  /**
   * Change the batch list in one IndexedDB transaction, never by reading it,
   * deciding, and writing the decision back. A tick holds its decision across
   * a request to the server — fifteen seconds, when the server is slow — and
   * an import started in that gap is written into the same key by `add`. A
   * write of what the tick had read would have quietly dropped it.
   */
  const change = async (apply: (current: Batch[]) => Batch[]): Promise<Batch[]> =>
    parse(await store.update(KEY, current => apply(parse(current))))

  async function tick(forced = false): Promise<void> {
    // Age is judged before the queue is asked, so a server that stays away
    // cannot keep a batch — and the polling for it — alive past a day.
    const stale = now().getTime() - STALE_MS
    const batches = await change(remembered =>
      remembered.filter(batch => new Date(batch.startedAt).getTime() > stale),
    )
    if (batches.length === 0) {
      going = 0
      await badge(badgeText(0, failed))
      return
    }

    const pace = await readPace()
    if (!forced && now().getTime() < pace.dueAt) return

    let current: ImportQueue
    try {
      current = await queue()
    } catch {
      // The server is asleep or the token has gone: leave the badge as it is
      // rather than saying the imports vanished.
      misses += 1
      await slowDown(pace)
      return
    }
    misses = 0

    const done = finished(current, batches)
    for (const batch of done) {
      if (batch.failed.length > 0) failed = true
      const notice = noticeFor(batch)
      if (notice) notify(notice)
    }

    const doneIds = new Set(done.map(each => each.batch.id))
    const left =
      doneIds.size === 0
        ? batches
        : await change(current => current.filter(batch => !doneIds.has(batch.id)))
    const before = going
    going = stillGoing(current, left)
    await badge(badgeText(going, failed))
    if (done.length > 0 || going !== before) await resetPace()
    else await slowDown(pace)
  }

  return {
    async add(jobs, label) {
      if (jobs.length === 0) return
      await change(batches => [
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
      await resetPace()
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
            await tick(true)
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

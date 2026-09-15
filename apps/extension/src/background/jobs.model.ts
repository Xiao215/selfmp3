import type { ImportJob, ImportQueue } from '@selfmp3/shared'

/**
 * Batches: what one click started, and what to say when it is done.
 *
 * The toolbar badge and the notification are about *your* imports, not about
 * everything the server happens to be doing — a phone's share and a scan both
 * add jobs nobody at this computer asked for. So each import the extension
 * starts is remembered by its job ids, and only those are counted and reported
 * on (docs/EXTENSION.md, "The watcher").
 *
 * Everything here is pure; the worker's side of it is watcher.ts.
 */

export interface Batch {
  readonly id: string
  readonly jobIds: readonly string[]
  /** The playlist or page the import came from, when it had a name. */
  readonly label: string | null
  readonly startedAt: string
}

const terminal = (job: ImportJob): boolean =>
  job.status === 'done' || job.status === 'error' || job.status === 'cancelled'

/** The jobs of `batches`, in the order the queue gave them. */
export function jobsOf(queue: ImportQueue, batches: readonly Batch[]): ImportJob[] {
  const wanted = new Set(batches.flatMap(batch => batch.jobIds))
  return queue.jobs.filter(job => wanted.has(job.id))
}

/** How many of this extension's imports are still going. */
export function stillGoing(queue: ImportQueue, batches: readonly Batch[]): number {
  return jobsOf(queue, batches).filter(job => !terminal(job)).length
}

/**
 * What the badge says: nothing while there is nothing of ours to watch, the
 * count while imports run, and `!` once one has failed, until the popup is
 * opened.
 */
export function badgeText(going: number, failed: boolean): string {
  if (going > 0) return String(going)
  return failed ? '!' : ''
}

export interface FinishedBatch {
  readonly batch: Batch
  readonly added: readonly ImportJob[]
  readonly failed: readonly ImportJob[]
  readonly cancelled: readonly ImportJob[]
}

/** The batches whose every job has finished, one way or another. */
export function finished(queue: ImportQueue, batches: readonly Batch[]): FinishedBatch[] {
  const byId = new Map(queue.jobs.map(job => [job.id, job]))
  const done: FinishedBatch[] = []
  for (const batch of batches) {
    const jobs = batch.jobIds.map(id => byId.get(id)).filter((job): job is ImportJob => !!job)
    // A job the server has forgotten (its history cleared) counts as finished,
    // but a batch nothing is known about is left alone rather than announced.
    if (jobs.length === 0 || !jobs.every(terminal)) continue
    done.push({
      batch,
      added: jobs.filter(job => job.status === 'done'),
      failed: jobs.filter(job => job.status === 'error'),
      cancelled: jobs.filter(job => job.status === 'cancelled'),
    })
  }
  return done
}

const songs = (count: number): string => `${count} ${count === 1 ? 'song' : 'songs'}`

/**
 * What a finished batch is announced as: one song by name, several by count,
 * and what did not make it either way. Null when there is nothing to say —
 * a batch you cancelled yourself.
 */
export function noticeFor(batch: FinishedBatch): { title: string; message: string } | null {
  const { added, failed } = batch
  if (added.length === 0 && failed.length === 0) return null

  const title =
    added.length === 0
      ? `${songs(failed.length)} couldn’t be downloaded`
      : added.length === 1
        ? `${added[0]?.title ?? 'A song'} added`
        : `${songs(added.length)} added`

  const parts: string[] = []
  if (batch.batch.label) parts.push(batch.batch.label)
  else if (added.length === 1 && added[0]?.artist) parts.push(added[0].artist)
  if (added.length > 0 && failed.length > 0) {
    parts.push(
      failed.length === 1 ? '1 couldn’t be downloaded' : `${failed.length} couldn’t be downloaded`,
    )
  }
  if (added.length === 0 && failed.length > 0) {
    parts.push(failed[0]?.error ?? 'The server did not say why.')
  }
  return { title, message: parts.join(' · ') }
}

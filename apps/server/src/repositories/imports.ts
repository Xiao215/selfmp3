import crypto from 'node:crypto'
import {
  ImportStatusSchema,
  ImportStepSchema,
  type ImportEnqueueItem,
  type ImportJob,
  type ImportStatus,
  type ImportStep,
} from '@selfmp3/shared'
import type { Db } from '../db/index.js'

/**
 * The import queue, persisted.
 *
 * Keeping jobs in SQLite rather than a Map means a queue of forty downloads
 * survives a server restart, and the phone can open the import screen cold and
 * immediately see what is happening.
 */

interface ImportJobRow {
  id: string
  url: string
  status: string
  step: string
  progress: number | null
  title: string
  artist: string
  album: string
  thumbnail: string | null
  duration: number
  error: string | null
  song_id: number | null
  attempts: number
  tag_ids: string
  playlist_id: number | null
  position: number
  created_at: string
  updated_at: string
}

function toJob(row: ImportJobRow): ImportJob {
  let tagIds: number[] = []
  try {
    const parsed: unknown = JSON.parse(row.tag_ids)
    if (Array.isArray(parsed)) tagIds = parsed.filter((n): n is number => Number.isInteger(n))
  } catch {
    // A malformed tag list just means no tags, never a broken queue.
  }

  return {
    id: row.id,
    url: row.url,
    // A row from a build that knew other names reads as failed and waiting,
    // never as a broken queue.
    status: ImportStatusSchema.catch('error').parse(row.status),
    step: ImportStepSchema.catch('waiting').parse(row.step),
    progress: row.progress,
    title: row.title,
    artist: row.artist,
    album: row.album,
    thumbnail: row.thumbnail,
    duration: row.duration,
    error: row.error,
    songId: row.song_id,
    attempts: row.attempts,
    tagIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class ImportRepository {
  readonly #db: Db

  readonly #insert
  readonly #byId
  readonly #open
  readonly #finished
  readonly #nextQueued
  readonly #countByStatus
  readonly #update
  readonly #resetRunning
  readonly #deleteFinished
  readonly #maxPosition

  constructor(db: Db) {
    this.#db = db

    this.#insert = db.prepare(`
      INSERT INTO import_jobs (id, url, title, artist, album, thumbnail, duration, tag_ids, playlist_id, position)
      VALUES (@id, @url, @title, @artist, @album, @thumbnail, @duration, @tagIds, @playlistId, @position)
    `)

    this.#byId = db.prepare<[string], ImportJobRow>('SELECT * FROM import_jobs WHERE id = ?')

    /*
     * Every open job, what needs a person first: failed before waiting, since
     * a queue of three hundred songs with fifty that failed to upload once
     * showed only the queue, and the failures surfaced when Pause all emptied
     * it. Open jobs are bounded by what was asked for, so all of them come
     * (to a ceiling no one reaches); the finished ones are history and are
     * read apart (`#finished`), newest first, up to the caller's limit. One
     * list cut off at a hundred rows showed a big day's history as nothing.
     */
    this.#open = db.prepare<[], ImportJobRow>(`
      SELECT * FROM import_jobs
       WHERE status <> 'done'
       ORDER BY CASE status
                  WHEN 'running'   THEN 0
                  WHEN 'error'     THEN 1
                  WHEN 'queued'    THEN 2
                  ELSE 3
                END,
                position, created_at DESC
       LIMIT 1000
    `)
    this.#finished = db.prepare<[number], ImportJobRow>(`
      SELECT * FROM import_jobs
       WHERE status = 'done'
       ORDER BY updated_at DESC, position DESC
       LIMIT ?
    `)

    this.#nextQueued = db.prepare<[], ImportJobRow>(`
      SELECT * FROM import_jobs
       WHERE status = 'queued'
       ORDER BY position, created_at
       LIMIT 1
    `)

    this.#countByStatus = db.prepare<[string], { n: number }>(
      'SELECT COUNT(*) AS n FROM import_jobs WHERE status = ?',
    )

    this.#update = db.prepare(`
      UPDATE import_jobs
         SET status     = COALESCE(@status, status),
             step       = COALESCE(@step, step),
             progress   = CASE WHEN @progressSet = 1 THEN @progress ELSE progress END,
             title      = COALESCE(@title, title),
             artist     = COALESCE(@artist, artist),
             album      = COALESCE(@album, album),
             duration   = COALESCE(@duration, duration),
             error      = CASE WHEN @errorSet = 1 THEN @error ELSE error END,
             song_id    = COALESCE(@songId, song_id),
             attempts   = COALESCE(@attempts, attempts),
             updated_at = datetime('now')
       WHERE id = @id
    `)

    // A job left 'running' by a crash is requeued rather than lost.
    this.#resetRunning = db.prepare(
      "UPDATE import_jobs SET status = 'queued', step = 'waiting', progress = NULL WHERE status = 'running'",
    )

    this.#deleteFinished = db.prepare(
      "DELETE FROM import_jobs WHERE status IN ('done','error','cancelled') AND updated_at < datetime('now', ?)",
    )

    this.#maxPosition = db.prepare<[], { max: number | null }>(
      'SELECT MAX(position) AS max FROM import_jobs',
    )
  }

  enqueue(
    items: readonly ImportEnqueueItem[],
    tagIds: readonly number[],
    playlistId: number | null,
  ): ImportJob[] {
    const tagJson = JSON.stringify([...tagIds])
    const run = this.#db.transaction(() => {
      let position = (this.#maxPosition.get()?.max ?? -1) + 1
      const created: ImportJob[] = []
      for (const item of items) {
        const id = crypto.randomUUID()
        this.#insert.run({
          id,
          url: item.url,
          title: item.title,
          artist: item.artist,
          album: item.album,
          thumbnail: item.thumbnail,
          duration: item.duration,
          tagIds: tagJson,
          playlistId,
          position: position++,
        })
        const row = this.#byId.get(id)
        if (row) created.push(toJob(row))
      }
      return created
    })
    return run()
  }

  byId(id: string): ImportJob | null {
    const row = this.#byId.get(id)
    return row ? toJob(row) : null
  }

  /** Every open job, then the newest `limit` finished ones. */
  recent(limit = 100): ImportJob[] {
    return [...this.#open.all(), ...this.#finished.all(limit)].map(toJob)
  }

  /** The next queued job, in the order they were asked for. */
  claimNext(): ImportJob | null {
    const run = this.#db.transaction(() => {
      const row = this.#nextQueued.get()
      if (!row) return null
      this.#db
        .prepare(
          "UPDATE import_jobs SET status = 'running', step = 'resolving', attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?",
        )
        .run(row.id)
      const claimed = this.#byId.get(row.id)
      return claimed ? toJob(claimed) : null
    })
    return run()
  }

  update(
    id: string,
    changes: {
      status?: ImportStatus
      step?: ImportStep
      progress?: number | null
      title?: string
      artist?: string
      album?: string
      duration?: number
      error?: string | null
      songId?: number
      attempts?: number
    },
  ): void {
    this.#update.run({
      id,
      status: changes.status ?? null,
      step: changes.step ?? null,
      progress: changes.progress ?? null,
      progressSet: changes.progress !== undefined ? 1 : 0,
      title: changes.title ?? null,
      artist: changes.artist ?? null,
      album: changes.album ?? null,
      duration: changes.duration ?? null,
      error: changes.error ?? null,
      errorSet: changes.error !== undefined ? 1 : 0,
      songId: changes.songId ?? null,
      attempts: changes.attempts ?? null,
    })
  }

  playlistFor(id: string): number | null {
    return this.#byId.get(id)?.playlist_id ?? null
  }

  counts(): { running: number; queued: number; done: number } {
    return {
      running: this.#countByStatus.get('running')?.n ?? 0,
      queued: this.#countByStatus.get('queued')?.n ?? 0,
      done: this.#countByStatus.get('done')?.n ?? 0,
    }
  }

  /**
   * Cancel a job that has not started adding its song. Past the download the
   * song is moved into the library, tagged and uploaded; a cancel marked then
   * was written over when the job finished anyway, and the song was added all
   * the same.
   */
  cancel(id: string): boolean {
    const info = this.#db
      .prepare(
        `UPDATE import_jobs SET status = 'cancelled', step = 'finished', updated_at = datetime('now')
          WHERE id = ?
            AND (status = 'queued' OR (status = 'running' AND step IN ('resolving','downloading')))`,
      )
      .run(id)
    return info.changes > 0
  }

  retry(id: string): boolean {
    const info = this.#db
      .prepare(
        "UPDATE import_jobs SET status = 'queued', step = 'waiting', error = NULL, progress = NULL, updated_at = datetime('now') WHERE id = ? AND status IN ('error','cancelled')",
      )
      .run(id)
    return info.changes > 0
  }

  /**
   * Pause all: call off every job `cancel` would take, in one statement, and
   * name the ones it took so the downloads among them can be stopped. The
   * same line is drawn as for one job — a song past its download is added
   * anyway.
   */
  cancelAll(): string[] {
    return this.#db
      .prepare<[], { id: string }>(
        `UPDATE import_jobs SET status = 'cancelled', step = 'finished', updated_at = datetime('now')
          WHERE status = 'queued' OR (status = 'running' AND step IN ('resolving','downloading'))
          RETURNING id`,
      )
      .all()
      .map(row => row.id)
  }

  /**
   * Resume all: what Pause all called off goes back in the queue, in the
   * order it was asked for. A job that failed on its own is left as it is,
   * with its reason, for its own Retry.
   */
  retryCancelled(): number {
    return this.#db
      .prepare(
        "UPDATE import_jobs SET status = 'queued', step = 'waiting', error = NULL, progress = NULL, updated_at = datetime('now') WHERE status = 'cancelled'",
      )
      .run().changes
  }

  /**
   * Clear the jobs that added their song: the list "Clear" sits beside. A
   * failed or paused job stays, with its reason and its Retry — Clear once
   * took those too, and a person tidying the day's arrivals lost the paused
   * half of their queue with them. Each has its own Dismiss (`dismiss`).
   */
  clearFinished(): number {
    return this.#db.prepare("DELETE FROM import_jobs WHERE status = 'done'").run().changes
  }

  /**
   * Drop one job that is not moving — failed, or paused — for good. A job
   * still queued or running is cancelled first (ImportQueueService.remove),
   * and a done one goes with Clear. A song a failed upload left on this
   * server is not touched: the cloud sync still sends it up by itself
   * (cloudSync.ts).
   */
  dismiss(id: string): boolean {
    const info = this.#db
      .prepare("DELETE FROM import_jobs WHERE id = ? AND status IN ('error','cancelled')")
      .run(id)
    return info.changes > 0
  }

  /** Called at boot: nothing can still be running if the process just started. */
  resetOrphaned(): number {
    return this.#resetRunning.run().changes
  }

  /** Housekeeping so the table cannot grow without bound. */
  pruneOlderThanDays(days: number): number {
    return this.#deleteFinished.run(`-${days} days`).changes
  }

  /**
   * Finish jobs that gave up at the upload step and whose songs have since
   * reached the bucket after all. Call it once a snapshot is published: the
   * song was already in the library on this server, and now every other device
   * can see it too.
   */
  finishUploaded(): number {
    return this.#db
      .prepare(
        `UPDATE import_jobs
            SET status = 'done', step = 'finished', progress = 100, error = NULL,
                updated_at = datetime('now')
          WHERE status = 'error' AND step = 'uploading'
            AND song_id IN (SELECT song_id FROM cloud_songs)`,
      )
      .run().changes
  }

  /** The links of every job queued or running, for a preview to say which songs are already coming. */
  pendingUrls(): string[] {
    return this.#db
      .prepare<[], { url: string }>(
        "SELECT url FROM import_jobs WHERE status IN ('queued','running')",
      )
      .all()
      .map(row => row.url)
  }

  /** True when this URL is already queued or running, to avoid duplicates. */
  isPending(url: string): boolean {
    const row = this.#db
      .prepare<[string], { n: number }>(
        "SELECT COUNT(*) AS n FROM import_jobs WHERE url = ? AND status IN ('queued','running')",
      )
      .get(url)
    return (row?.n ?? 0) > 0
  }
}

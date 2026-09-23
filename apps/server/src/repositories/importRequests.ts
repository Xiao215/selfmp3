import { CloudImportSchema, type CloudImport } from '@selfmp3/shared'
import type { Db } from '../db/index.js'

type ImportRequestState = CloudImport['state']

export interface ImportRequest {
  readonly uid: string
  readonly url: string
  readonly tagUids: readonly string[]
  readonly playlistUid: string | null
  readonly requestedBy: string
  readonly requestedAt: string
  readonly state: ImportRequestState
  readonly title: string | null
  readonly songUids: readonly string[]
  readonly error: string | null
  readonly updatedAt: string
}

interface RequestRow {
  uid: string
  url: string
  tag_uids: string
  playlist_uid: string | null
  requested_by: string
  requested_at: string
  state: string
  title: string | null
  song_uids: string
  error: string | null
  updated_at: string
}

function uidList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function toRequest(row: RequestRow): ImportRequest {
  return {
    uid: row.uid,
    url: row.url,
    tagUids: uidList(row.tag_uids),
    playlistUid: row.playlist_uid,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    state: CloudImportSchema.shape.state.catch('failed').parse(row.state),
    title: row.title,
    songUids: uidList(row.song_uids),
    error: row.error,
    updatedAt: row.updated_at,
  }
}

/**
 * Links other devices asked this server to import (docs/SYNC.md): recorded when
 * their logs are read, worked on by the import queue, and published with how
 * they went.
 */
export class ImportRequestRepository {
  readonly #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  byUid(uid: string): ImportRequest | null {
    const row = this.#db
      .prepare<[string], RequestRow>('SELECT * FROM import_requests WHERE uid = ?')
      .get(uid)
    return row ? toRequest(row) : null
  }

  /** A request, the first time it is seen. True when it was new. */
  record(request: {
    uid: string
    url: string
    tagUids: readonly string[]
    playlistUid: string | null
    requestedBy: string
    requestedAt: string
  }): boolean {
    return (
      this.#db
        .prepare(
          `INSERT INTO import_requests (uid, url, tag_uids, playlist_uid, requested_by, requested_at, updated_at)
           VALUES (@uid, @url, @tagUids, @playlistUid, @requestedBy, @requestedAt, @requestedAt)
           ON CONFLICT (uid) DO NOTHING`,
        )
        .run({ ...request, tagUids: JSON.stringify(request.tagUids) }).changes > 0
    )
  }

  /**
   * Called off. A request not yet looked at simply goes; one that is being
   * worked on loses the songs still waiting to download. True when it changed.
   */
  cancel(uid: string, at: string): boolean {
    const changed = this.#db
      .prepare(
        `UPDATE import_requests SET state = 'cancelled', updated_at = MAX(updated_at, ?)
          WHERE uid = ? AND state IN ('waiting','working')`,
      )
      .run(at, uid).changes
    if (changed > 0) {
      this.#db
        .prepare(
          `UPDATE import_jobs SET status = 'cancelled', step = 'finished', updated_at = datetime('now')
            WHERE request_uid = ? AND status = 'queued'`,
        )
        .run(uid)
    }
    return changed > 0
  }

  /** Requests no device that can fetch has looked at yet, oldest first. */
  waiting(): ImportRequest[] {
    return this.#db
      .prepare<[], RequestRow>(
        "SELECT * FROM import_requests WHERE state = 'waiting' ORDER BY requested_at",
      )
      .all()
      .map(toRequest)
  }

  /** Its songs are queued: they are these jobs. */
  startWorking(uid: string, title: string | null, jobIds: readonly string[]): void {
    this.#db.transaction(() => {
      this.#db
        .prepare(
          `UPDATE import_requests SET state = 'working', title = ?, updated_at = datetime('now')
            WHERE uid = ? AND state = 'waiting'`,
        )
        .run(title, uid)
      const link = this.#db.prepare('UPDATE import_jobs SET request_uid = ? WHERE id = ?')
      for (const id of jobIds) link.run(uid, id)
    })()
  }

  finish(
    uid: string,
    outcome: {
      state: 'done' | 'failed'
      title: string | null
      songUids: readonly string[]
      error: string | null
    },
  ): void {
    this.#db
      .prepare(
        `UPDATE import_requests
            SET state = @state, title = COALESCE(@title, title), song_uids = @songUids,
                error = @error, updated_at = datetime('now')
          WHERE uid = @uid AND state IN ('waiting','working')`,
      )
      .run({ uid, ...outcome, songUids: JSON.stringify(outcome.songUids) })
  }

  /**
   * Requests whose jobs have all finished, settled as done or failed. Kept
   * here rather than worked out from the jobs each time, so clearing the
   * finished jobs from the queue does not lose how a request went.
   */
  settle(): number {
    const working = this.#db
      .prepare<[], RequestRow>("SELECT * FROM import_requests WHERE state = 'working'")
      .all()
    let settled = 0
    for (const request of working) {
      const jobs = this.#db
        .prepare<[string], { status: string; error: string | null; song_uid: string | null }>(
          `SELECT j.status, j.error, s.uid AS song_uid
             FROM import_jobs j LEFT JOIN songs s ON s.id = j.song_id
            WHERE j.request_uid = ?`,
        )
        .all(request.uid)
      if (jobs.some(job => job.status === 'queued' || job.status === 'running')) continue
      const songUids = jobs.flatMap(job =>
        job.status === 'done' && job.song_uid ? [job.song_uid] : [],
      )
      const failure = jobs.find(job => job.status === 'error')?.error ?? null
      this.finish(request.uid, {
        state: songUids.length > 0 || !failure ? 'done' : 'failed',
        title: null,
        songUids: [...uidList(request.song_uids), ...songUids],
        error: songUids.length > 0 ? null : failure,
      })
      settled++
    }
    return settled
  }

  /** The requests every device should know about: the last week's, newest first. */
  recent(days = 7, limit = 100): ImportRequest[] {
    return this.#db
      .prepare<[string, number], RequestRow>(
        `SELECT * FROM import_requests WHERE requested_at >= datetime('now', ?)
          ORDER BY requested_at DESC LIMIT ?`,
      )
      .all(`-${days} days`, limit)
      .map(toRequest)
  }
}

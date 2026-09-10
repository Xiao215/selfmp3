import {
  SmartRulesSchema,
  type CreatePlaylist,
  type Playlist,
  type SmartRules,
  type UpdatePlaylist,
} from '@selfmp3/shared'
import type { Db } from '../db/index.js'
import type { PlaylistRow } from '../db/rows.js'
import { compileSmartRules } from '../services/smartPlaylist.js'

/**
 * Playlists, both kinds.
 *
 * A manual playlist stores an ordered list of song ids. A smart playlist
 * stores a rule set and resolves to song ids on demand, so it stays correct as
 * the library changes without anyone having to refresh it.
 */
export class PlaylistRepository {
  readonly #db: Db

  readonly #all
  readonly #byId
  readonly #insert
  readonly #delete
  readonly #items
  readonly #maxPosition
  readonly #insertItem
  readonly #removeItem
  readonly #clearItems

  constructor(db: Db) {
    this.#db = db

    this.#all = db.prepare<[], PlaylistRow>(`
      SELECT p.*,
             (SELECT COUNT(*) FROM playlist_items WHERE playlist_id = p.id) AS song_count,
             (SELECT COALESCE(SUM(s.duration), 0)
                FROM playlist_items pi JOIN songs s ON s.id = pi.song_id
               WHERE pi.playlist_id = p.id) AS total_duration
      FROM playlists p
      ORDER BY p.pinned DESC, p.name COLLATE NOCASE
    `)

    this.#byId = db.prepare<[number], PlaylistRow>(`
      SELECT p.*,
             (SELECT COUNT(*) FROM playlist_items WHERE playlist_id = p.id) AS song_count,
             (SELECT COALESCE(SUM(s.duration), 0)
                FROM playlist_items pi JOIN songs s ON s.id = pi.song_id
               WHERE pi.playlist_id = p.id) AS total_duration
      FROM playlists p WHERE p.id = ?
    `)

    this.#insert = db.prepare(`
      INSERT INTO playlists (name, description, kind, rules)
      VALUES (@name, @description, @kind, @rules)
    `)

    this.#delete = db.prepare('DELETE FROM playlists WHERE id = ?')

    this.#items = db.prepare<[number], { song_id: number }>(`
      SELECT pi.song_id
        FROM playlist_items pi
        JOIN songs s ON s.id = pi.song_id
       WHERE pi.playlist_id = ? AND s.missing = 0
       ORDER BY pi.position, pi.rowid
    `)

    this.#maxPosition = db.prepare<[number], { max: number | null }>(
      'SELECT MAX(position) AS max FROM playlist_items WHERE playlist_id = ?',
    )

    this.#insertItem = db.prepare(`
      INSERT INTO playlist_items (playlist_id, song_id, position)
      VALUES (?, ?, ?)
      ON CONFLICT (playlist_id, song_id) DO NOTHING
    `)

    this.#removeItem = db.prepare(
      'DELETE FROM playlist_items WHERE playlist_id = ? AND song_id = ?',
    )
    this.#clearItems = db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?')
  }

  /**
   * Parse stored rules defensively. A rule set written by a newer version, or
   * hand-edited in the database, must not take the whole playlist list down.
   */
  #parseRules(raw: string | null): SmartRules | null {
    if (!raw) return null
    try {
      const parsed = SmartRulesSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  #toPlaylist(row: PlaylistRow): Playlist {
    const kind = row.kind === 'smart' ? 'smart' : 'manual'
    const rules = kind === 'smart' ? this.#parseRules(row.rules) : null

    // A smart playlist's counts come from evaluating its rules, not from the
    // (always empty) items table.
    let songCount = row.song_count ?? 0
    let totalDuration = row.total_duration ?? 0
    if (kind === 'smart' && rules) {
      const stats = this.#smartStats(rules)
      songCount = stats.count
      totalDuration = stats.duration
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      kind,
      rules,
      songCount,
      totalDuration,
      pinned: row.pinned === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  #smartStats(rules: SmartRules): { count: number; duration: number } {
    const { sql, params } = compileSmartRules(rules)
    const row = this.#db
      .prepare<unknown[], { count: number; duration: number | null }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(duration), 0) AS duration
           FROM songs WHERE id IN (${sql})`,
      )
      .get(...params)
    return { count: row?.count ?? 0, duration: row?.duration ?? 0 }
  }

  all(): Playlist[] {
    return this.#all.all().map(row => this.#toPlaylist(row))
  }

  byId(id: number): Playlist | null {
    const row = this.#byId.get(id)
    return row ? this.#toPlaylist(row) : null
  }

  create(input: CreatePlaylist): Playlist {
    const info = this.#insert.run({
      name: input.name,
      description: input.description,
      kind: input.kind,
      rules: input.rules ? JSON.stringify(input.rules) : null,
    })
    const created = this.byId(Number(info.lastInsertRowid))
    if (!created) throw new Error('failed to create playlist')
    return created
  }

  update(id: number, patch: UpdatePlaylist): Playlist | null {
    const assignments: string[] = []
    const values: Record<string, unknown> = { id }

    if (patch.name !== undefined) {
      assignments.push('name = @name')
      values['name'] = patch.name
    }
    if (patch.description !== undefined) {
      assignments.push('description = @description')
      values['description'] = patch.description
    }
    if (patch.rules !== undefined) {
      assignments.push('rules = @rules')
      values['rules'] = patch.rules ? JSON.stringify(patch.rules) : null
    }
    if (patch.pinned !== undefined) {
      assignments.push('pinned = @pinned')
      values['pinned'] = patch.pinned ? 1 : 0
    }

    if (assignments.length > 0) {
      this.#db
        .prepare(
          `UPDATE playlists SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = @id`,
        )
        .run(values)
    }
    return this.byId(id)
  }

  delete(id: number): void {
    this.#delete.run(id)
  }

  /** Ordered song ids, resolving smart rules on the fly. */
  songIds(playlist: Playlist): number[] {
    if (playlist.kind === 'smart') {
      if (!playlist.rules) return []
      const { sql, params } = compileSmartRules(playlist.rules)
      return this.#db
        .prepare<unknown[], { id: number }>(sql)
        .all(...params)
        .map(row => row.id)
    }
    return this.#items.all(playlist.id).map(row => row.song_id)
  }

  /** Append or insert songs, keeping positions dense and ordered. */
  add(playlistId: number, songIds: readonly number[], position?: number): void {
    const run = this.#db.transaction(() => {
      if (position === undefined) {
        let next = (this.#maxPosition.get(playlistId)?.max ?? -1) + 1
        for (const songId of songIds) this.#insertItem.run(playlistId, songId, next++)
        return
      }

      // Inserting in the middle: rebuild the order rather than shuffling
      // positions in place, which is simpler to reason about and cheap at
      // playlist scale.
      const existing = this.#items.all(playlistId).map(row => row.song_id)
      const incoming = songIds.filter(id => !existing.includes(id))
      const clamped = Math.min(Math.max(position, 0), existing.length)
      const merged = [...existing.slice(0, clamped), ...incoming, ...existing.slice(clamped)]
      this.#clearItems.run(playlistId)
      merged.forEach((songId, index) => this.#insertItem.run(playlistId, songId, index))
    })
    run()
    this.#touch(playlistId)
  }

  remove(playlistId: number, songId: number): void {
    this.#removeItem.run(playlistId, songId)
    this.#touch(playlistId)
  }

  /**
   * Replace the order wholesale.
   *
   * Ids that are not currently in the playlist are ignored, and ids the client
   * did not mention are appended in their existing order — so a stale client
   * reordering an old view cannot silently delete tracks.
   */
  reorder(playlistId: number, songIds: readonly number[]): void {
    const run = this.#db.transaction(() => {
      const existing = this.#items.all(playlistId).map(row => row.song_id)
      const existingSet = new Set(existing)
      const ordered = songIds.filter(id => existingSet.has(id))
      const orderedSet = new Set(ordered)
      const leftovers = existing.filter(id => !orderedSet.has(id))
      const merged = [...ordered, ...leftovers]

      this.#clearItems.run(playlistId)
      merged.forEach((songId, index) => this.#insertItem.run(playlistId, songId, index))
    })
    run()
    this.#touch(playlistId)
  }

  #touch(id: number): void {
    this.#db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(id)
  }

  /** Playlists that contain a given song. Used by the song context menu. */
  containing(songId: number): number[] {
    return this.#db
      .prepare<[number], { playlist_id: number }>(
        'SELECT playlist_id FROM playlist_items WHERE song_id = ?',
      )
      .all(songId)
      .map(row => row.playlist_id)
  }
}

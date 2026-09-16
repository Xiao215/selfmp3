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
 * A manual playlist stores an ordered list of song ids. A live playlist
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
  readonly #everyItem
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

    /*
     * Every row, missing songs included.
     *
     * `#items` hides songs whose file is gone, which is right for playing a
     * playlist and wrong for rewriting one: `add` and `reorder` clear the
     * playlist and write back what they read, so reading the hidden version
     * would drop every missing song on the way through. A missing song is
     * usually an unplugged drive, and it comes back.
     */
    this.#everyItem = db.prepare<[number], { song_id: number }>(`
      SELECT song_id
        FROM playlist_items
       WHERE playlist_id = ?
       ORDER BY position, rowid
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
    const kind = row.kind === 'live' ? 'live' : 'manual'
    const rules = kind === 'live' ? this.#parseRules(row.rules) : null

    // A live playlist's counts come from evaluating its rules, not from the
    // (always empty) items table.
    let songCount = row.song_count ?? 0
    let totalDuration = row.total_duration ?? 0
    if (kind === 'live' && rules) {
      const stats = this.#liveStats(rules)
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
      lastPlayedAt: row.last_played_at ?? null,
    }
  }

  #liveStats(rules: SmartRules): { count: number; duration: number } {
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

  /** A playlist made on another device: its uid, and dated by when it was made there. */
  insertSynced(input: {
    uid: string
    name: string
    description: string
    kind: 'manual' | 'live'
    rules: SmartRules | null
    pinned: boolean
    createdAt: string
  }): number {
    const info = this.#db
      .prepare(
        `INSERT INTO playlists (uid, name, description, kind, rules, pinned, created_at, updated_at)
         VALUES (@uid, @name, @description, @kind, @rules, @pinned, @createdAt, @createdAt)`,
      )
      .run({
        ...input,
        rules: input.rules ? JSON.stringify(input.rules) : null,
        pinned: input.pinned ? 1 : 0,
      })
    return Number(info.lastInsertRowid)
  }

  /**
   * For an edit from another device, dated by when it was made there rather
   * than when it arrived. The methods above date an edit "now" themselves;
   * this comes after them and says otherwise.
   */
  setUpdatedAt(id: number, updatedAt: string): void {
    this.#db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(updatedAt, id)
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

  /**
   * Note that the playlist was just started. Leaves `updated_at` alone:
   * playing a list is not editing it, and sync reads that column as "changed".
   */
  markPlayed(id: number): void {
    this.#db.prepare("UPDATE playlists SET last_played_at = datetime('now') WHERE id = ?").run(id)
  }

  /** Ordered song ids, resolving a live playlist's rules on the fly. */
  songIds(playlist: Playlist): number[] {
    if (playlist.kind === 'live') {
      if (!playlist.rules) return []
      const { sql, params } = compileSmartRules(playlist.rules)
      return this.#db
        .prepare<unknown[], { id: number }>(sql)
        .all(...params)
        .map(row => row.id)
    }
    return this.#items.all(playlist.id).map(row => row.song_id)
  }

  /**
   * A playlist's songs as a snapshot should carry them (docs/SYNC.md): every
   * one, whether or not this server holds its file.
   *
   * `songIds` leaves out a song whose file is gone, which is right for playing
   * and wrong for publishing. A song missing from this disk may still have its
   * audio in the bucket — a server that took the library on from the bucket has
   * a whole library of them — and it is still in the playlist on every other
   * device. Publishing the player's view would quietly take it out of the
   * playlist everywhere because of one server's disk. The snapshot narrows to
   * songs the bucket really has itself (services/cloudSnapshot.ts), which is
   * the filter that belongs here.
   */
  snapshotSongIds(playlist: Playlist): number[] {
    if (playlist.kind === 'live') {
      if (!playlist.rules) return []
      const { sql, params } = compileSmartRules(playlist.rules, { includeMissing: true })
      return this.#db
        .prepare<unknown[], { id: number }>(sql)
        .all(...params)
        .map(row => row.id)
    }
    return this.#everyItem.all(playlist.id).map(row => row.song_id)
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
      const existing = this.#everyItem.all(playlistId).map(row => row.song_id)
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
   * Take several songs out at once. Returns how many were actually in it.
   *
   * One transaction, so a multi-select removal is one atomic edit of the
   * playlist rather than a visible cascade of single removals.
   */
  removeMany(playlistId: number, songIds: readonly number[]): number {
    if (songIds.length === 0) return 0
    const run = this.#db.transaction((ids: readonly number[]) => {
      let affected = 0
      for (const songId of ids) affected += this.#removeItem.run(playlistId, songId).changes
      return affected
    })
    const affected = run([...new Set(songIds)])
    this.#touch(playlistId)
    return affected
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
      const existing = this.#everyItem.all(playlistId).map(row => row.song_id)
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
}

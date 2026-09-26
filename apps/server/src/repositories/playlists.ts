import {
  SmartRulesSchema,
  playlistRules,
  type PlaylistRules,
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
    // A live row whose rules will not parse reads as a manual playlist with
    // nothing in it: visible, harmless, and the one shape a live playlist
    // without rules cannot be.
    const shape = playlistRules(
      row.kind === 'live' ? 'live' : 'manual',
      row.kind === 'live' ? this.#parseRules(row.rules) : null,
    )

    // A live playlist's counts come from evaluating its rules, not from the
    // (always empty) items table.
    let songCount = row.song_count ?? 0
    let totalDuration = row.total_duration ?? 0
    if (shape.kind === 'live') {
      const stats = this.#liveStats(shape.rules)
      songCount = stats.count
      totalDuration = stats.duration
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      ...shape,
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
  insertSynced(
    input: {
      uid: string
      name: string
      description: string
      pinned: boolean
      createdAt: string
    } & PlaylistRules,
  ): number {
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

  /**
   * Stop a playlist following its tags, keeping every song it has right now.
   *
   * The songs a live playlist shows are the answer to its rules, worked out on
   * every read and stored nowhere — so switching it off without writing them
   * down first would empty it. This resolves them once, writes them as the
   * playlist's own items in the order they were in, and only then changes the
   * kind. One transaction: a crash half-way through would otherwise leave a
   * playlist that is neither.
   */
  stopFollowing(playlist: Playlist): void {
    if (playlist.kind !== 'live') return
    const keep = this.songIds(playlist)
    this.#db.transaction(() => {
      this.#clearItems.run(playlist.id)
      keep.forEach((songId, index) => this.#insertItem.run(playlist.id, songId, index))
      this.#db
        .prepare(
          "UPDATE playlists SET kind = 'manual', rules = NULL, updated_at = datetime('now') WHERE id = ?",
        )
        .run(playlist.id)
    })()
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
      const matched = this.#db
        .prepare<unknown[], { id: number }>(sql)
        .all(...params)
        .map(row => row.id)
      return this.#inKeptOrder(playlist.id, matched)
    }
    return this.#items.all(playlist.id).map(row => row.song_id)
  }

  /**
   * The rule's answer, in the order you put it in.
   *
   * A playlist that follows tags can still be reordered by hand (Xiao,
   * 2026-09-21): the order you dragged it into is kept in the playlist's own
   * items and wins, and songs the rule has matched since — which have no place
   * in it yet — follow at the end in the rule's own order. A song that stops
   * matching keeps its stored place silently, so tagging it again puts it back
   * where you had it rather than at the bottom.
   */
  #inKeptOrder(playlistId: number, matched: readonly number[]): number[] {
    const place = new Map<number, number>()
    for (const row of this.#items.all(playlistId)) place.set(row.song_id, place.size)
    if (place.size === 0) return [...matched]
    const kept: number[] = []
    const rest: number[] = []
    for (const id of matched) (place.has(id) ? kept : rest).push(id)
    kept.sort((a, b) => (place.get(a) ?? 0) - (place.get(b) ?? 0))
    return [...kept, ...rest]
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
   *
   * A playlist that follows tags has no items of its own until the first time
   * it is put in an order by hand, so "currently in the playlist" there is the
   * rule's own answer; without that the first reorder filtered every id away
   * and stored nothing.
   */
  reorder(playlistId: number, songIds: readonly number[]): void {
    const playlist = this.byId(playlistId)
    const run = this.#db.transaction(() => {
      const existing =
        playlist && playlist.kind === 'live'
          ? this.songIds(playlist)
          : this.#items.all(playlistId).map(row => row.song_id)
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

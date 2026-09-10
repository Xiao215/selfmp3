import { hueFromString, type Tag } from '@selfmp3/shared'
import type { Db } from '../db/index.js'
import { toTag, type TagRow } from '../db/rows.js'

export class TagRepository {
  readonly #db: Db

  readonly #all
  readonly #byId
  readonly #byName
  readonly #insert
  readonly #delete
  readonly #clearSongTags
  readonly #linkSongTag
  readonly #unlinkSongTag

  constructor(db: Db) {
    this.#db = db

    // The tag list always carries its song count; the sidebar needs it and a
    // second round trip per tag would be silly.
    this.#all = db.prepare<[], TagRow>(`
      SELECT t.*, (SELECT COUNT(*) FROM song_tags WHERE tag_id = t.id) AS song_count
      FROM tags t
      ORDER BY t.name COLLATE NOCASE
    `)

    this.#byId = db.prepare<[number], TagRow>(`
      SELECT t.*, (SELECT COUNT(*) FROM song_tags WHERE tag_id = t.id) AS song_count
      FROM tags t WHERE t.id = ?
    `)

    this.#byName = db.prepare<[string], TagRow>(`
      SELECT t.*, (SELECT COUNT(*) FROM song_tags WHERE tag_id = t.id) AS song_count
      FROM tags t WHERE t.name = ? COLLATE NOCASE
    `)

    this.#insert = db.prepare('INSERT INTO tags (name, hue) VALUES (?, ?)')
    this.#delete = db.prepare('DELETE FROM tags WHERE id = ?')
    this.#clearSongTags = db.prepare('DELETE FROM song_tags WHERE song_id = ?')
    this.#linkSongTag = db.prepare(
      'INSERT OR IGNORE INTO song_tags (song_id, tag_id) VALUES (?, ?)',
    )
    this.#unlinkSongTag = db.prepare('DELETE FROM song_tags WHERE song_id = ? AND tag_id = ?')
  }

  all(): Tag[] {
    return this.#all.all().map(toTag)
  }

  byId(id: number): Tag | null {
    const row = this.#byId.get(id)
    return row ? toTag(row) : null
  }

  byName(name: string): Tag | null {
    const row = this.#byName.get(name)
    return row ? toTag(row) : null
  }

  /**
   * Create a tag, or return the existing one if the name is already taken.
   *
   * Idempotent on purpose: two devices creating "chill" at the same moment
   * should end up with one tag, not an error the user has to think about.
   */
  create(name: string, hue?: number): Tag {
    const existing = this.byName(name)
    if (existing) return existing

    this.#insert.run(name, hue ?? hueFromString(name.toLowerCase()))
    const created = this.byName(name)
    if (!created) throw new Error(`failed to create tag ${JSON.stringify(name)}`)
    return created
  }

  update(id: number, changes: { name?: string; hue?: number }): Tag | null {
    const assignments: string[] = []
    const values: Record<string, unknown> = { id }
    if (changes.name !== undefined) {
      assignments.push('name = @name')
      values['name'] = changes.name
    }
    if (changes.hue !== undefined) {
      assignments.push('hue = @hue')
      values['hue'] = changes.hue
    }
    if (assignments.length > 0) {
      this.#db.prepare(`UPDATE tags SET ${assignments.join(', ')} WHERE id = @id`).run(values)
    }
    return this.byId(id)
  }

  /** Deleting a tag cascades to `song_tags` but never touches the songs. */
  delete(id: number): void {
    this.#delete.run(id)
  }

  /** Replace a song's tags wholesale. Caller wraps this in a transaction. */
  setSongTags(songId: number, tagIds: readonly number[]): void {
    this.#clearSongTags.run(songId)
    for (const tagId of tagIds) this.#linkSongTag.run(songId, tagId)
  }

  addToSong(songId: number, tagId: number): void {
    this.#linkSongTag.run(songId, tagId)
  }

  removeFromSong(songId: number, tagId: number): void {
    this.#unlinkSongTag.run(songId, tagId)
  }

  /** Apply or remove one tag across many songs in a single transaction. */
  bulk(songIds: readonly number[], tagId: number, action: 'add' | 'remove'): number {
    const statement = action === 'add' ? this.#linkSongTag : this.#unlinkSongTag
    const run = this.#db.transaction((ids: readonly number[]) => {
      let affected = 0
      for (const songId of ids) affected += statement.run(songId, tagId).changes
      return affected
    })
    return run(songIds)
  }

  exists(ids: readonly number[]): number[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.#db
      .prepare<number[], { id: number }>(`SELECT id FROM tags WHERE id IN (${placeholders})`)
      .all(...ids)
    return rows.map(row => row.id)
  }
}

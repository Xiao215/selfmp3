import type { Db } from '../db/index.js'
import { fromBlob, toBlob } from '../sound/vectors.js'

/**
 * All SQL that touches `song_sound_vectors`. Like the features table, the
 * queue is the table: a song is waiting while it has no row from the current
 * model, newest songs first.
 */
export class SoundVectorsRepository {
  readonly #upsert
  readonly #delete
  readonly #all
  readonly #has
  readonly #pending
  readonly #countPending
  readonly #countHeard

  constructor(db: Db) {
    this.#upsert = db.prepare<[number, string, Buffer | null]>(`
      INSERT INTO song_sound_vectors (song_id, model, vector, made_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT (song_id) DO UPDATE SET
        model   = excluded.model,
        vector  = excluded.vector,
        made_at = excluded.made_at
    `)
    this.#delete = db.prepare<[number]>('DELETE FROM song_sound_vectors WHERE song_id = ?')
    this.#all = db.prepare<[string], { song_id: number; vector: Buffer }>(
      'SELECT song_id, vector FROM song_sound_vectors WHERE model = ? AND vector IS NOT NULL',
    )
    this.#has = db.prepare<[number, string], { n: number }>(
      'SELECT COUNT(*) AS n FROM song_sound_vectors WHERE song_id = ? AND model = ?',
    )
    const pendingWhere = `
      NOT EXISTS (SELECT 1 FROM song_sound_vectors v WHERE v.song_id = s.id AND v.model = ?)
    `
    this.#pending = db.prepare<[string, number], { id: number }>(
      `SELECT s.id FROM songs s WHERE ${pendingWhere} ORDER BY s.added_at DESC, s.id DESC LIMIT ?`,
    )
    this.#countPending = db.prepare<[string], { n: number }>(
      `SELECT COUNT(*) AS n FROM songs s WHERE ${pendingWhere}`,
    )
    this.#countHeard = db.prepare<[string], { n: number }>(
      'SELECT COUNT(*) AS n FROM song_sound_vectors WHERE model = ? AND vector IS NOT NULL',
    )
  }

  /** A song's vector, or null for one that could not be heard. */
  upsert(songId: number, model: string, vector: Float32Array | null): void {
    this.#upsert.run(songId, model, vector ? toBlob(vector) : null)
  }

  delete(songId: number): void {
    this.#delete.run(songId)
  }

  /** Every song this model has heard, by song id. */
  all(model: string): Map<number, Float32Array> {
    const out = new Map<number, Float32Array>()
    for (const row of this.#all.iterate(model)) {
      const vector = fromBlob(row.vector)
      if (vector) out.set(row.song_id, vector)
    }
    return out
  }

  /** Whether this model has had its say on the song: a vector, or a row saying it could not. */
  has(songId: number, model: string): boolean {
    return (this.#has.get(songId, model)?.n ?? 0) > 0
  }

  /** The next song waiting, newest first, passing over the ones in `skip`. */
  nextPending(model: string, skip: ReadonlySet<number> = new Set()): number | null {
    const rows = this.#pending.all(model, skip.size + 1)
    return rows.find(row => !skip.has(row.id))?.id ?? null
  }

  countPending(model: string): number {
    return this.#countPending.get(model)?.n ?? 0
  }

  countHeard(model: string): number {
    return this.#countHeard.get(model)?.n ?? 0
  }
}

import type { Db } from '../db/index.js'
import type { SoundPackEntry } from '../sound/pack.js'
import { fromBlob, toBlob } from '../sound/vectors.js'

/**
 * All SQL that touches `song_sound_vectors`. Like the features table, the
 * queue is the table: a song is waiting while it has no row from the current
 * model, newest songs first.
 */
export class SoundVectorsRepository {
  readonly #db: Db
  readonly #upsert
  readonly #delete
  readonly #all
  readonly #has
  readonly #pending
  readonly #countPending
  readonly #countHeard
  readonly #inBucket
  readonly #inBucketSignature
  readonly #restore

  constructor(db: Db) {
    this.#db = db
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

    // Only songs whose audio is in the bucket: the file names each by its key.
    const inBucket = `
      FROM song_sound_vectors v JOIN cloud_songs c ON c.song_id = v.song_id
     WHERE v.model = ?`
    this.#inBucket = db.prepare<[string], { audio_key: string; vector: Buffer | null }>(
      `SELECT c.audio_key, v.vector ${inBucket}`,
    )
    this.#inBucketSignature = db.prepare<
      [string],
      { n: number; latest: string | null; ids: number | null }
    >(`SELECT COUNT(*) AS n, MAX(v.made_at) AS latest, SUM(v.song_id) AS ids ${inBucket}`)
    // Every song with that audio, unless this model has had its say on it already.
    this.#restore = db.prepare<{ model: string; audioKey: string; vector: Buffer | null }>(`
      INSERT INTO song_sound_vectors (song_id, model, vector, made_at)
      SELECT c.song_id, @model, @vector, datetime('now')
        FROM cloud_songs c
       WHERE c.audio_key = @audioKey
         AND NOT EXISTS (
           SELECT 1 FROM song_sound_vectors v WHERE v.song_id = c.song_id AND v.model = @model
         )
      ON CONFLICT (song_id) DO UPDATE SET
        model   = excluded.model,
        vector  = excluded.vector,
        made_at = excluded.made_at
    `)
  }

  /** What the bucket's copy of the vectors holds (sound/pack.ts): each song with its audio up. */
  inBucket(model: string): SoundPackEntry[] {
    return this.#inBucket.all(model).map(row => ({ audioKey: row.audio_key, vector: row.vector }))
  }

  /**
   * Changes whenever `inBucket` would: a song heard, heard again, given up
   * on, removed, or its audio first put in the bucket. Cheap: no vector read.
   */
  inBucketSignature(model: string): string {
    const row = this.#inBucketSignature.get(model)
    return `${row?.n ?? 0}:${row?.latest ?? ''}:${row?.ids ?? 0}`
  }

  /**
   * Vectors from the bucket, for every song here with that audio that this
   * model has not had its say on. A song heard here keeps what it has.
   * Returns how many songs were given one.
   */
  restore(model: string, entries: readonly SoundPackEntry[]): number {
    return this.#db.transaction(() => {
      let restored = 0
      for (const { audioKey, vector } of entries) {
        restored += this.#restore.run({ model, audioKey, vector }).changes
      }
      return restored
    })()
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

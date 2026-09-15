import type { AudioFeatures } from '@selfmp3/shared'
import type { Db } from '../db/index.js'
import { toAudioFeatures, type AudioFeaturesRow } from '../db/rows.js'

/**
 * All SQL that touches `song_audio_features` lives here.
 *
 * The analyser is pull-based: it asks `nextPending` for one song at a time,
 * so the queue is the table itself and survives a restart for free.
 */

export interface NewFeatures {
  bpm: number | null
  energy: number | null
  loudnessLufs: number | null
  key: string | null
  camelot: string | null
  danceability: number | null
  version: number
}

export class AudioFeaturesRepository {
  readonly #bySong
  readonly #upsert
  readonly #delete
  readonly #deleteAll
  readonly #nextPending
  readonly #countPending

  constructor(db: Db) {
    this.#bySong = db.prepare<[number], AudioFeaturesRow>(
      'SELECT * FROM song_audio_features WHERE song_id = ?',
    )

    this.#upsert = db.prepare(`
      INSERT INTO song_audio_features (
        song_id, bpm, energy, loudness_lufs, key, camelot, danceability, analyzed_at, version
      ) VALUES (
        @songId, @bpm, @energy, @loudnessLufs, @key, @camelot, @danceability, datetime('now'), @version
      )
      ON CONFLICT (song_id) DO UPDATE SET
        bpm           = excluded.bpm,
        energy        = excluded.energy,
        loudness_lufs = excluded.loudness_lufs,
        key           = excluded.key,
        camelot       = excluded.camelot,
        danceability  = excluded.danceability,
        analyzed_at   = excluded.analyzed_at,
        version       = excluded.version
    `)

    this.#delete = db.prepare('DELETE FROM song_audio_features WHERE song_id = ?')
    this.#deleteAll = db.prepare('DELETE FROM song_audio_features')

    // A song is pending when it has no row, or a row from an older algorithm.
    // Missing files are skipped: there is nothing to decode.
    const pendingWhere = `
      s.missing = 0
      AND NOT EXISTS (
        SELECT 1 FROM song_audio_features f WHERE f.song_id = s.id AND f.version >= ?
      )
    `
    this.#nextPending = db.prepare<[number], { id: number }>(
      `SELECT s.id FROM songs s WHERE ${pendingWhere} ORDER BY s.added_at DESC, s.id DESC LIMIT 1`,
    )
    this.#countPending = db.prepare<[number], { n: number }>(
      `SELECT COUNT(*) AS n FROM songs s WHERE ${pendingWhere}`,
    )
  }

  bySong(songId: number): AudioFeatures | null {
    const row = this.#bySong.get(songId)
    return row ? toAudioFeatures(row) : null
  }

  upsert(songId: number, features: NewFeatures): void {
    this.#upsert.run({ songId, ...features })
  }

  delete(songId: number): void {
    this.#delete.run(songId)
  }

  /** Forget everything, so the next run re-analyses the whole library. */
  deleteAll(): number {
    return this.#deleteAll.run().changes
  }

  nextPending(version: number): number | null {
    return this.#nextPending.get(version)?.id ?? null
  }

  countPending(version: number): number {
    return this.#countPending.get(version)?.n ?? 0
  }
}

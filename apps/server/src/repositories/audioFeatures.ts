import type { AudioFeatures } from '@selfmp3/shared'
import type { Db } from '../db/index.js'
import { toAudioFeatures, type AudioFeaturesRow } from '../db/rows.js'

/**
 * All SQL that touches `song_audio_features` lives here.
 *
 * The analyser is pull-based: it asks `nextPending` for one song at a time,
 * so the queue is the table itself and survives a restart for free.
 */

interface NewFeatures {
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
  readonly #insertSynced
  readonly #delete
  readonly #deleteAll
  readonly #nextPending
  readonly #countPending
  readonly #isAnalysed

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

    this.#insertSynced = db.prepare(`
      INSERT INTO song_audio_features (
        song_id, bpm, energy, loudness_lufs, key, camelot, danceability, analyzed_at, version
      ) VALUES (
        @songId, @bpm, @energy, @loudnessLufs, @key, @camelot, @danceability, @analyzedAt, @version
      )
      ON CONFLICT (song_id) DO NOTHING
    `)

    this.#delete = db.prepare('DELETE FROM song_audio_features WHERE song_id = ?')
    this.#deleteAll = db.prepare('DELETE FROM song_audio_features')

    // A song is pending when it has no row, or a row from an older algorithm.
    // Whether its audio is on this disk is not asked here: analysis fetches it
    // from the bucket when it is not (services/analysis.ts).
    const pendingWhere = `
      NOT EXISTS (
        SELECT 1 FROM song_audio_features f WHERE f.song_id = s.id AND f.version >= ?
      )
    `
    this.#isAnalysed = db.prepare<[number, number], { n: number }>(
      'SELECT COUNT(*) AS n FROM song_audio_features WHERE song_id = ? AND version >= ?',
    )
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

  /**
   * Features another device analysed, as they arrived (services/cloudAdopt.ts).
   * `analyzed_at` is the time on the device that did the work, not now: a
   * snapshot this server republishes has to say what it was told, and the
   * version is what decides whether this song is analysed again.
   */
  insertSynced(songId: number, features: NewFeatures & { analyzedAt: string }): void {
    this.#insertSynced.run({ songId, ...features })
  }

  delete(songId: number): void {
    this.#delete.run(songId)
  }

  /** Forget everything, so the next run re-analyses the whole library. */
  deleteAll(): number {
    return this.#deleteAll.run().changes
  }

  /**
   * Whether analysis has had its say on this song at this version — a result,
   * or a row that records it could not be read. Either way there is nothing
   * left that needs the audio on this disk, which is what the cloud pass asks
   * before it lets the local copy go.
   */
  isAnalysed(songId: number, version: number): boolean {
    return (this.#isAnalysed.get(songId, version)?.n ?? 0) > 0
  }

  nextPending(version: number): number | null {
    return this.#nextPending.get(version)?.id ?? null
  }

  countPending(version: number): number {
    return this.#countPending.get(version)?.n ?? 0
  }
}

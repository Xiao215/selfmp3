import type { Db } from '../db/index.js'

/** The sound map as last folded (sound/soundMap.ts). */
export interface StoredSoundMap {
  /** The vectors it was folded from, as `SoundService.packSignature` puts it; empty for one read from the bucket. */
  readonly sig: string
  /** The file, as `encodeSoundMap` writes it. */
  readonly data: string
  /** When it was folded or read, as an ISO time. */
  readonly madeAt: string
}

export class SoundMapRepository {
  readonly #get
  readonly #save
  readonly #clear
  readonly #audioKeys
  readonly #songCount

  constructor(db: Db) {
    this.#get = db.prepare<[], { sig: string; data: string; made_at: string }>(
      'SELECT sig, data, made_at FROM sound_map WHERE id = 1',
    )
    this.#save = db.prepare(`
      INSERT INTO sound_map (id, sig, data, made_at) VALUES (1, @sig, @data, @madeAt)
      ON CONFLICT (id) DO UPDATE SET
        sig = excluded.sig, data = excluded.data, made_at = excluded.made_at
    `)
    this.#clear = db.prepare('DELETE FROM sound_map')
    this.#audioKeys = db.prepare<[], { song_id: number; audio_key: string }>(
      'SELECT c.song_id, c.audio_key FROM cloud_songs c JOIN songs s ON s.id = c.song_id',
    )
    this.#songCount = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM songs')
  }

  get(): StoredSoundMap | null {
    const row = this.#get.get()
    return row ? { sig: row.sig, data: row.data, madeAt: row.made_at } : null
  }

  save(map: StoredSoundMap): void {
    this.#save.run(map)
  }

  clear(): void {
    this.#clear.run()
  }

  /** Each song whose audio is in the bucket, with its audio's key: how the map names it. */
  audioKeys(): { songId: number; audioKey: string }[] {
    return this.#audioKeys.all().map(row => ({ songId: row.song_id, audioKey: row.audio_key }))
  }

  songCount(): number {
    return this.#songCount.get()?.n ?? 0
  }
}

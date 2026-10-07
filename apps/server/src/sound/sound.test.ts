import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { song } from '../ai/fixtures/library.js'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { SoundVectorsRepository } from '../repositories/soundVectors.js'
import type { SoundModel } from './clamp3.js'
import { SOUND_MODEL, SoundModelFiles } from './models.js'
import { decodeWindows, SoundService } from './sound.js'
import { SOUND_DIMENSIONS, SOUND_SAMPLE_RATE, unit } from './vectors.js'

const logger = createLogger('silent')
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

/** A vector pointing mostly along one axis, a little along another. */
function toward(axis: number, lean = 0, other = (axis + 1) % SOUND_DIMENSIONS): Float32Array {
  const v = new Float32Array(SOUND_DIMENSIONS)
  v[axis] = 1
  v[other] = lean
  return unit(v)
}

/** A model that hears every clip as axis 9 and reads each word as its own axis. */
class FakeModel implements SoundModel {
  heard: number[] = []
  readonly words: Record<string, Float32Array> = { calm: toward(0), loud: toward(1) }
  hearClip(pcm: Float32Array): Promise<Float32Array> {
    this.heard.push(pcm.length)
    return Promise.resolve(toward(9))
  }
  readText(text: string): Promise<Float32Array> {
    return Promise.resolve(this.words[text] ?? toward(5))
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
}

describe('SoundService', () => {
  let dataDir: string
  let db: Database.Database
  let vectors: SoundVectorsRepository
  let model: FakeModel

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-sound-'))
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db, logger)
    const insert = db.prepare('INSERT INTO songs (id, path, title, added_at) VALUES (?, ?, ?, ?)')
    for (const id of [1, 2, 3, 4]) insert.run(id, `song-${id}.m4a`, `Song ${id}`, `2026-09-0${id}`)
    vectors = new SoundVectorsRepository(db)
    model = new FakeModel()
  })
  afterEach(() => {
    db.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  /** A service whose model files are an empty list in a folder that exists: always to hand. */
  const service = (enabled = true): SoundService => {
    const config = { dataDir, sound: { enabled, models: dataDir, threads: 1 } }
    return new SoundService({
      config,
      vectors,
      logger,
      files: new SoundModelFiles({ config, logger, files: [] }),
      makeModel: () => model,
    })
  }

  it('says what it is doing, and how many songs are heard and to go', async () => {
    const sound = service()
    expect(sound.status()).toEqual({ state: 'waiting', heard: 0, pending: 4, message: null })
    expect(await sound.prepare()).toBe(true)
    vectors.upsert(1, SOUND_MODEL.name, toward(0))
    vectors.upsert(2, SOUND_MODEL.name, null)
    expect(sound.status()).toEqual({ state: 'ready', heard: 1, pending: 2, message: null })
    // Newest first, and never a song it has had its say on.
    expect(sound.nextPending()).toBe(4)
  })

  it('stays off when switched off, and fetches nothing', async () => {
    const sound = service(false)
    expect(await sound.prepare()).toBe(false)
    expect(sound.status()).toEqual({ state: 'off', heard: 0, pending: 0, message: null })
    expect(sound.nextPending()).toBeNull()
    expect(await sound.match('calm', [1, 2])).toBeNull()
  })

  it('orders songs by how well they sound like the words', async () => {
    const sound = service()
    vectors.upsert(1, SOUND_MODEL.name, toward(0, 0.2))
    vectors.upsert(2, SOUND_MODEL.name, toward(1))
    vectors.upsert(3, SOUND_MODEL.name, toward(0))
    const scores = await sound.match('calm', [1, 2, 3, 4])
    // Song 4 has not been heard, so it has no score.
    expect([...scores!.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)).toEqual([3, 1, 2])
  })

  it('has nothing to rank with until a song has been heard', async () => {
    expect(await service().match('calm', [1, 2])).toBeNull()
  })

  it('finds the songs that sound most like one, nudged by shared tags and the artist', () => {
    const sound = service()
    vectors.upsert(1, SOUND_MODEL.name, toward(0))
    vectors.upsert(2, SOUND_MODEL.name, toward(0, 0.3))
    vectors.upsert(3, SOUND_MODEL.name, toward(0, 0.25))
    const seed = song(1, { artist: 'HOYO-MiX', tagIds: [7] })
    const library = [
      seed,
      song(2, { artist: 'Someone' }),
      song(3, { artist: 'HOYO-MiX', tagIds: [7] }),
      song(4),
    ]
    // 3 sounds a touch further than 2, but shares the tag and the artist.
    const similar = sound.similar(seed, library, 10, [library[3]!, library[1]!])
    expect(similar!.map(s => s.id)).toEqual([3, 2, 4])
    expect(sound.similar(library[3]!, library, 10, [])).toBeNull()
  })

  it('forgets a song whose file changed, and records one it could not hear', () => {
    const sound = service()
    vectors.upsert(1, SOUND_MODEL.name, toward(0))
    expect(sound.has(1)).toBe(true)
    sound.forget(1)
    expect(sound.has(1)).toBe(false)
    sound.markUnhearable(1)
    expect(sound.has(1)).toBe(true)
    expect(sound.closeTo(1, [1, 2])).toBeNull()
  })

  it('lets the vector go with its song', () => {
    vectors.upsert(1, SOUND_MODEL.name, toward(0))
    db.prepare('DELETE FROM songs WHERE id = 1').run()
    expect(vectors.has(1, SOUND_MODEL.name)).toBe(false)
  })

  describe.skipIf(!hasFfmpeg)('hearing a file', () => {
    /** A tone of this many seconds, as a file ffmpeg can read. */
    const tone = (seconds: number): string => {
      const file = path.join(dataDir, `tone-${seconds}.wav`)
      spawnSync('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=440:duration=${seconds}`,
        file,
      ])
      return file
    }

    it('decodes three ten-second windows at 24 kHz, back to back', async () => {
      expect((await decodeWindows(tone(60), 60)).length).toBe(30 * SOUND_SAMPLE_RATE)
      // A song no longer than the windows is heard whole, once.
      expect((await decodeWindows(tone(12), 12)).length).toBe(12 * SOUND_SAMPLE_RATE)
    })

    it('keeps what the model heard as the song’s vector', async () => {
      const sound = service()
      await sound.prepare()
      await sound.hear(2, tone(60), 60)
      expect(model.heard).toEqual([30 * SOUND_SAMPLE_RATE])
      expect(vectors.all(SOUND_MODEL.name).get(2)).toEqual(toward(9))
      expect(sound.closeTo(2, [1, 2])).toEqual(new Map())
    })
  })
})

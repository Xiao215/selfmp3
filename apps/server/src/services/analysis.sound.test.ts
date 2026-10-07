import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { ANALYSIS_VERSION } from '@selfmp3/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { song } from '../ai/fixtures/library.js'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { AudioFeaturesRepository } from '../repositories/audioFeatures.js'
import type { SongRepository } from '../repositories/songs.js'
import { SoundVectorsRepository } from '../repositories/soundVectors.js'
import type { SoundModel } from '../sound/clamp3.js'
import { SOUND_MODEL, SoundModelFiles } from '../sound/models.js'
import { SoundService } from '../sound/sound.js'
import { SOUND_DIMENSIONS, unit } from '../sound/vectors.js'
import type { StorageDriver } from '../storage/driver.js'
import { AnalysisService } from './analysis.js'
import type { ImportQueueService } from './importQueue.js'
import type { MotionStore } from './motionStore.js'
import type { ScannerService } from './scanner.js'

const logger = createLogger('silent')
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

/**
 * The analysis loop's second half: once every song has its tempo and key, it
 * has each one heard by the listening model, from the copy here or the bucket.
 */
describe.skipIf(!hasFfmpeg)('analysis, hearing', () => {
  let dir: string
  let db: Database.Database
  let vectors: SoundVectorsRepository
  let heard: number

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-hear-'))
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db, logger)
    vectors = new SoundVectorsRepository(db)
    heard = 0
    spawnSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=duration=40',
      path.join(dir, 'here.wav'),
    ])
  })
  afterEach(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  /** Songs 1 (here) and 2 (only in the bucket, or nowhere), both analysed already. */
  function loop(bucket: Buffer | Error | null, enabled = true): Promise<AnalysisService> {
    const insert = db.prepare('INSERT INTO songs (id, path, title, duration) VALUES (?, ?, ?, 40)')
    insert.run(1, 'here.wav', 'Here')
    insert.run(2, 'gone.wav', 'Gone')
    const features = new AudioFeaturesRepository(db)
    for (const id of [1, 2]) {
      features.upsert(id, {
        bpm: null,
        energy: null,
        loudnessLufs: null,
        key: null,
        camelot: null,
        danceability: null,
        version: ANALYSIS_VERSION,
      })
    }
    const config = { dataDir: dir, sound: { enabled, models: dir, threads: 1 } }
    const model: SoundModel = {
      hearClip: () => {
        heard++
        const v = new Float32Array(SOUND_DIMENSIONS)
        v[heard] = 1
        return Promise.resolve(unit(v))
      },
      readText: () => Promise.reject(new Error('not asked')),
      close: () => Promise.resolve(),
    }
    const sound = new SoundService({
      config,
      vectors,
      logger,
      files: new SoundModelFiles({ config, logger, files: [] }),
      makeModel: () => model,
    })
    return new Promise(resolve => {
      const analysis: AnalysisService = new AnalysisService({
        config: config as never,
        storage: {
          exists: (key: string) => Promise.resolve(key === 'here.wav'),
          localPath: (key: string) => path.join(dir, key),
          read: () => Promise.reject(new Error('not asked')),
        } as unknown as StorageDriver,
        songs: {
          byId: (id: number) =>
            song(id, { path: id === 1 ? 'here.wav' : 'gone.wav', duration: 40 }),
        } as unknown as SongRepository,
        audioFeatures: features,
        motion: {
          delete: () => Promise.resolve(),
          write: () => Promise.resolve(),
        } as unknown as MotionStore,
        scanner: { isRunning: false } as ScannerService,
        importQueue: { activeCount: 0 } as ImportQueueService,
        fetchAudio: () =>
          bucket instanceof Error ? Promise.reject(bucket) : Promise.resolve(bucket),
        sound,
        logger,
        onProgress: (_done, finished) => {
          if (finished) resolve(analysis)
        },
      })
      analysis.kick()
    })
  }

  it('hears every song, fetching the one whose copy is only in the bucket', async () => {
    const analysis = await loop(fs.readFileSync(path.join(dir, 'here.wav')))
    expect(heard).toBe(2)
    expect(vectors.all(SOUND_MODEL.name).size).toBe(2)
    expect(analysis.status().sound).toEqual({ state: 'ready', heard: 2, pending: 0, message: null })
    // The fetched copy went with the song it was fetched for.
    expect(fs.readdirSync(path.join(dir, 'incoming'))).toEqual([])
  })

  it('records a song it cannot get at all, so it is not tried forever', async () => {
    const analysis = await loop(null)
    expect(heard).toBe(1)
    expect(vectors.has(2, SOUND_MODEL.name)).toBe(true)
    expect(analysis.status().sound).toMatchObject({ heard: 1, pending: 0 })
  })

  it('waits for a bucket that did not answer, rather than giving the song up', async () => {
    const analysis = await loop(new Error('the bucket is over its daily cap'))
    expect(heard).toBe(1)
    expect(vectors.has(2, SOUND_MODEL.name)).toBe(false)
    expect(analysis.status().sound).toMatchObject({ heard: 1, pending: 1 })
    analysis.stop()
  })

  it('hears nothing when the model is switched off', async () => {
    const analysis = await loop(null, false)
    expect(heard).toBe(0)
    expect(analysis.status().sound).toEqual({ state: 'off', heard: 0, pending: 0, message: null })
  })
})

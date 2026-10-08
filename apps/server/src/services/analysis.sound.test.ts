import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { ANALYSIS_VERSION } from '@selfmp3/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { song } from '../ai/fixtures/library.js'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { AudioFeaturesRepository } from '../repositories/audioFeatures.js'
import { BucketDownloadsRepository } from '../repositories/bucketDownloads.js'
import type { SongRepository } from '../repositories/songs.js'
import { SoundVectorsRepository } from '../repositories/soundVectors.js'
import type { SoundModel } from '../sound/clamp3.js'
import { SOUND_MODEL, SoundModelFiles } from '../sound/models.js'
import { SoundService } from '../sound/sound.js'
import { SOUND_DIMENSIONS, unit } from '../sound/vectors.js'
import type { StorageDriver } from '../storage/driver.js'
import { AnalysisService } from './analysis.js'
import { analyzePcm } from './dsp.js'
import type { ImportQueueService } from './importQueue.js'
import type { MotionStore } from './motionStore.js'
import type { ScannerService } from './scanner.js'

const logger = createLogger('silent')
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

/**
 * The analysis loop's second half: once every song has its tempo and key, it
 * has each one heard by the listening model, from the copy here or the bucket.
 * And what it costs the bucket: a song whose copy here has gone is one of the
 * day's downloads, counted across restarts.
 */
describe.skipIf(!hasFfmpeg)('analysis, hearing', () => {
  let dir: string
  let db: Database.Database
  let vectors: SoundVectorsRepository
  let heard: number
  let fetched: number
  let finishes: number

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-hear-'))
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db, logger)
    vectors = new SoundVectorsRepository(db)
    heard = 0
    fetched = 0
    finishes = 0
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

  /**
   * Songs 1 (here) and 2 (only in the bucket, or nowhere), analysed already
   * unless `analysed` says not; resolves once the loop has nothing left to do.
   */
  async function loop(
    bucket: Buffer | Error | null,
    { enabled = true, analysed = true }: { enabled?: boolean; analysed?: boolean } = {},
  ): Promise<AnalysisService> {
    const insert = db.prepare(
      'INSERT OR IGNORE INTO songs (id, path, title, duration) VALUES (?, ?, ?, 40)',
    )
    insert.run(1, 'here.wav', 'Here')
    insert.run(2, 'gone.wav', 'Gone')
    const features = new AudioFeaturesRepository(db)
    for (const id of analysed ? [1, 2] : []) {
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
    {
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
        fetchAudio: () => {
          fetched++
          return bucket instanceof Error ? Promise.reject(bucket) : Promise.resolve(bucket)
        },
        sound,
        downloads: new BucketDownloadsRepository(db),
        // The DSP itself, in this thread: a worker cannot load it from source.
        analyzePcm: (pcm, rate) => Promise.resolve(analyzePcm(pcm, rate)),
        logger,
        onProgress: (_done, finished) => {
          if (finished) finishes++
        },
      })
      analysis.kick()
      await vi.waitFor(() => expect(analysis.status().running).toBe(false), { timeout: 10_000 })
      return analysis
    }
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
    const analysis = await loop(null, { enabled: false })
    expect(heard).toBe(0)
    expect(analysis.status().sound).toEqual({ state: 'off', heard: 0, pending: 0, message: null })
  })

  it('says nothing to the devices when it ran and found nothing to analyse', async () => {
    const analysis = await loop(fs.readFileSync(path.join(dir, 'here.wav')))
    expect(heard).toBe(2)
    // Heard, not analysed: nothing the devices hold has changed.
    expect(finishes).toBe(0)
    analysis.kick()
    await vi.waitFor(() => expect(analysis.status().running).toBe(false))
    expect(finishes).toBe(0)
  })

  it('analyses a song from the bucket, and says so once at the end', async () => {
    const analysis = await loop(fs.readFileSync(path.join(dir, 'here.wav')), { analysed: false })
    expect(new AudioFeaturesRepository(db).isAnalysed(2, ANALYSIS_VERSION)).toBe(true)
    // Analysed and heard from the one download, and that one counted for the day.
    expect(fetched).toBe(1)
    const today = new Date().toISOString().slice(0, 10)
    expect(new BucketDownloadsRepository(db).spentOn(today)).toBe(1)
    expect(heard).toBe(2)
    expect(finishes).toBe(1)
    expect(analysis.status()).toMatchObject({ failed: 0 })
  })

  it('does not record a song as broken when the bucket would not give it', async () => {
    const analysis = await loop(new Error('the bucket is over its daily cap'), { analysed: false })
    // Song 1 is analysed from the copy here; song 2 waits for the bucket.
    const features = new AudioFeaturesRepository(db)
    expect(features.isAnalysed(1, ANALYSIS_VERSION)).toBe(true)
    expect(features.isAnalysed(2, ANALYSIS_VERSION)).toBe(false)
    expect(analysis.status()).toMatchObject({ failed: 0, pending: 1 })
    analysis.stop()
  })

  it('stops downloading for the day once the day’s downloads are spent, restart or not', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const downloads = new BucketDownloadsRepository(db)
    for (let i = 0; i < 1_000; i++) downloads.spend(today)

    // As a new run of the server would find it: the count is the database's.
    const analysis = await loop(fs.readFileSync(path.join(dir, 'here.wav')), { analysed: false })
    expect(fetched).toBe(0)
    const features = new AudioFeaturesRepository(db)
    expect(features.isAnalysed(1, ANALYSIS_VERSION)).toBe(true)
    expect(features.isAnalysed(2, ANALYSIS_VERSION)).toBe(false)
    expect(vectors.has(2, SOUND_MODEL.name)).toBe(false)
    analysis.stop()
  })
})

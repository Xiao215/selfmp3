import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CloudSnapshotSchema,
  formatHlc,
  logFile,
  logKey,
  newestSnapshotKey,
  snapshotKey,
  parseEndpoint,
  type Change,
  type CloudConnect,
  type CloudPlaylist,
  type CloudSnapshot,
  type CloudSong,
  type CloudTag,
  type DoormanClaimResult,
  type DoormanMe,
} from '@selfmp3/shared'
import type { Config } from '../config.js'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { CloudError, type CloudStore } from '../bucket/store.js'
import { MemoryCloudStore } from '../bucket/memoryStore.js'
import { AudioFeaturesRepository } from '../repositories/audioFeatures.js'
import { CloudRepository } from '../repositories/cloud.js'
import { MotionStore } from './motionStore.js'
import { ImportRepository } from '../repositories/imports.js'
import { PlaylistRepository } from '../repositories/playlists.js'
import { SongRepository } from '../repositories/songs.js'
import { StatsRepository } from '../repositories/stats.js'
import { SyncRepository } from '../repositories/sync.js'
import { TagRepository } from '../repositories/tags.js'
import { LocalStorageDriver } from '../storage/local.js'
import { CloudAdopt } from './cloudAdopt.js'
import { CloudIngest } from './cloudIngest.js'
import { CloudRestore } from './cloudRestore.js'
import { CloudSyncService, type Doorman } from './cloudSync.js'
import { SyncClock } from './localEdits.js'
import { CoverService } from './covers.js'
import { LyricsService } from './lyrics.js'
import { MetadataService } from './metadata.js'
import { ScannerService } from './scanner.js'

/**
 * Publishing to the bucket, against a real library folder, a database built
 * from the real migrations, and a bucket in memory. What matters: every file
 * goes up once, under its hash; a snapshot says what is up there and nothing
 * that is not; and a server that loses the connection picks up where it left off.
 */

const sha = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex')

const CONNECT: CloudConnect = {
  endpoint: 's3.us-west-004.backblazeb2.com',
  bucket: 'my-music',
  prefix: 'selfmp3',
  keyId: '004abcdef0123456789',
  applicationKey: 'K004-secret',
}

describe('CloudSyncService', () => {
  let root: string
  let dataDir: string
  let db: Database.Database
  let songs: SongRepository
  let tags: TagRepository
  let playlists: PlaylistRepository
  let imports: ImportRepository
  let cloud: CloudRepository
  let syncRepo: SyncRepository
  let ingest: CloudIngest
  let adopt: CloudAdopt
  let restore: CloudRestore
  let scanner: ScannerService
  let covers: CoverService
  let buckets: Map<string, MemoryCloudStore>
  let bucket: MemoryCloudStore
  let sync: CloudSyncService
  let clock: number

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-cloud-lib-'))
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-cloud-data-'))
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    const logger = createLogger('silent')
    migrate(db, logger)

    songs = new SongRepository(db)
    tags = new TagRepository(db)
    playlists = new PlaylistRepository(db)
    imports = new ImportRepository(db)
    cloud = new CloudRepository(db)
    syncRepo = new SyncRepository(db)
    ingest = new CloudIngest({
      db,
      songs,
      tags,
      playlists,
      stats: new StatsRepository(db),
      sync: syncRepo,
      clock: new SyncClock({
        deviceId: () => cloud.deviceId('mac'),
        latest: () => syncRepo.latestStamp(),
        now: () => clock,
      }),
      logger,
    })
    const storage = new LocalStorageDriver(root)
    covers = new CoverService({ dataDir } as Config, songs, logger)
    adopt = new CloudAdopt({
      db,
      songs,
      tags,
      playlists,
      features: new AudioFeaturesRepository(db),
      cloud,
      sync: syncRepo,
      storage,
      clock: new SyncClock({
        deviceId: () => cloud.deviceId('mac'),
        latest: () => syncRepo.latestStamp(),
        now: () => clock,
      }),
      logger,
    })
    const lyricsService = new LyricsService(storage, logger, () =>
      Promise.reject(new Error('offline')),
    )
    scanner = new ScannerService({
      config: { dataDir } as Config,
      storage,
      songs,
      metadata: new MetadataService(storage, logger),
      lyrics: lyricsService,
      covers,
      logger,
    })
    restore = new CloudRestore({
      cloud,
      storage,
      covers,
      lyrics: lyricsService,
      scanner: () => scanner,
      logger,
    })

    bodies = new Map()

    // One bucket per name, so a test can point the server somewhere else.
    buckets = new Map()
    bucket = new MemoryCloudStore()
    buckets.set(CONNECT.bucket, bucket)
    clock = Date.parse('2026-09-11T10:00:00Z')

    sync = new CloudSyncService({
      cloud,
      songs,
      tags,
      playlists,
      imports,
      storage,
      covers,
      lyrics: new LyricsService(storage, logger, () => Promise.reject(new Error('offline'))),
      metadata: new MetadataService(storage, logger),
      logger,
      sync: syncRepo,
      ingest,
      adopt,
      restore,
      openStore: connection => {
        let store = buckets.get(connection.bucket)
        if (!store) {
          store = new MemoryCloudStore()
          buckets.set(connection.bucket, store)
        }
        return store
      },
      debounceMs: 5,
      // A second apart per call, so every snapshot gets a name of its own.
      now: () => new Date((clock += 1000)),
    })
  })

  /** Services a test made besides `sync`, stopped with it. */
  const extras: CloudSyncService[] = []

  afterEach(async () => {
    for (const service of [sync, ...extras.splice(0)]) {
      service.stop()
      await service.whenSettled()
    }
    db.close()
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  /** A song whose file is really in the library folder. */
  const addSong = (name: string, content: string, fields: { lyrics?: string } = {}): number => {
    const key = `${name}/${name}.m4a`
    fs.mkdirSync(path.join(root, name), { recursive: true })
    fs.writeFileSync(path.join(root, key), content)
    if (fields.lyrics !== undefined)
      fs.writeFileSync(path.join(root, `${name}/${name}.lrc`), fields.lyrics)
    const stat = fs.statSync(path.join(root, key))
    const [artist = '', title = name] = name.split(' - ')
    return songs.insert({
      path: key,
      title,
      artist,
      album: '',
      albumArtist: '',
      trackNo: null,
      year: null,
      duration: 200,
      sizeBytes: stat.size,
      mime: 'audio/mp4',
      mtimeMs: Math.floor(stat.mtimeMs),
      hasArt: false,
      artExt: null,
      lyricsKind: fields.lyrics === undefined ? 'none' : 'synced',
      sourceUrl: null,
    })
  }

  const connect = async (input: Partial<CloudConnect> = {}): Promise<void> => {
    await sync.connect({ ...CONNECT, ...input })
    await sync.whenIdle()
  }

  const pass = async (): Promise<void> => {
    await sync.syncNow()
    await sync.whenIdle()
  }

  const snapshotKeys = (store = bucket): string[] => store.keys('snapshots/')

  const latest = (store = bucket): CloudSnapshot => {
    const key = newestSnapshotKey(snapshotKeys(store))
    const object = key ? store.objects.get(key) : undefined
    if (!object) throw new Error('no snapshot in the bucket')
    expect(object.contentEncoding).toBe('gzip')
    return CloudSnapshotSchema.parse(JSON.parse(gunzipSync(object.body).toString('utf8')))
  }

  const uidOf = (songId: number): string =>
    (db.prepare('SELECT uid FROM songs WHERE id = ?').get(songId) as { uid: string }).uid

  // --- A bucket somebody else's device filled ---------------------------------

  /** A uid, from anything memorable. */
  const uid = (seed: string): string => sha(seed).slice(0, 32)

  /** The bytes behind each key another device's library names. */
  let bodies: Map<string, Buffer>

  /**
   * A file in their bucket, named the way the bucket names files: by the
   * SHA-256 of its bytes. The key has to really be the hash, or nothing that
   * depends on two devices arriving at the same name for the same bytes — which
   * is most of this — is being tested at all.
   */
  const theirFile = (
    folder: string,
    content: string,
    extension: string,
  ): { key: string; size: number } => {
    const body = Buffer.from(content)
    const key = `${folder}/${sha(body)}${extension}`
    bodies.set(key, body)
    return { key, size: body.length }
  }

  /** One song as another device published it, with as much or as little on it as wanted. */
  const theirSong = (name: string, over: Partial<CloudSong> = {}): CloudSong => {
    const [artist = '', title = name] = name.split(' - ')
    return {
      uid: uid(name),
      title,
      artist,
      album: '',
      albumArtist: '',
      trackNo: null,
      year: null,
      duration: 210,
      audio: { ...theirFile('audio', `their audio of ${name}`, '.m4a'), mime: 'audio/mp4' },
      cover: null,
      lyrics: null,
      instrumental: false,
      loved: false,
      playCount: 0,
      skipCount: 0,
      lastPlayedAt: null,
      addedAt: '2025-06-01 12:00:00',
      sourceUrl: null,
      tagUids: [],
      audioFeatures: null,
      ...over,
    }
  }

  /** A whole snapshot, as another device would have left it. */
  const theirSnapshot = (input: {
    songs?: readonly CloudSong[]
    tags?: readonly CloudTag[]
    playlists?: readonly CloudPlaylist[]
    device?: string
    at?: string
  }): CloudSnapshot =>
    CloudSnapshotSchema.parse({
      format: 1,
      writtenAt: input.at ?? '2026-01-01T00:00:00.000Z',
      writtenBy: input.device ?? 'iphone-0b7d44a1',
      upTo: {},
      songs: input.songs ?? [],
      tags: input.tags ?? [],
      playlists: input.playlists ?? [],
    })

  /**
   * Put that library in the bucket: the snapshot, gzipped as a real one is, and
   * the files it names. `withoutAudio` leaves a song's audio out, which is what
   * a bucket looks like when a file was deleted by hand from under it.
   */
  const seedBucket = (
    snapshot: CloudSnapshot,
    options: {
      store?: MemoryCloudStore
      withoutAudio?: readonly string[]
      /** False to leave the body as plain JSON, the way fetch hands one over. */
      gzip?: boolean
    } = {},
  ): string => {
    const store = options.store ?? bucket
    const key = snapshotKey(new Date(snapshot.writtenAt), snapshot.writtenBy)
    const json = Buffer.from(JSON.stringify(snapshot))
    store.objects.set(key, {
      body: options.gzip === false ? json : gzipSync(json),
      contentType: 'application/json',
      contentEncoding: 'gzip',
    })
    const put = (fileKey: string, size: number, contentType: string): void => {
      store.objects.set(fileKey, {
        body: bodies.get(fileKey) ?? Buffer.alloc(size, 9),
        contentType,
      })
    }
    for (const song of snapshot.songs) {
      if (!options.withoutAudio?.includes(song.uid)) {
        put(song.audio.key, song.audio.size, song.audio.mime)
      }
      if (song.cover) put(song.cover.key, song.cover.size, 'image/jpeg')
      if (song.lyrics) put(song.lyrics.key, song.lyrics.size, 'text/plain')
    }
    return key
  }

  /** What the library here holds, as uids, whatever state each song's file is in. */
  const uidsHere = (): string[] =>
    (db.prepare('SELECT uid FROM songs ORDER BY uid').all() as { uid: string }[]).map(
      row => row.uid,
    )

  describe('connecting', () => {
    it('marks a new bucket as self.mp3’s, then publishes the library', async () => {
      addSong('Aurora Lane - Sunrise', 'audio-sunrise')
      await connect()

      const format = JSON.parse(bucket.objects.get('format.json')?.body.toString() ?? 'null')
      expect(format).toMatchObject({ app: 'self.mp3', format: 1 })
      expect(latest().songs).toHaveLength(1)
      expect(sync.status()).toMatchObject({
        connected: true,
        state: 'idle',
        songs: { total: 1, inCloud: 1 },
        lastError: null,
      })
    })

    it('never sends the key back', async () => {
      await connect()
      const status = JSON.stringify(sync.status())
      expect(status).not.toContain(CONNECT.applicationKey)
      expect(status).not.toContain(CONNECT.keyId)
      expect(sync.status().target).toMatchObject({
        endpoint: 'https://s3.us-west-004.backblazeb2.com',
        region: 'us-west-004',
        bucket: 'my-music',
        prefix: 'selfmp3',
      })
    })

    it('refuses a bucket set up by a newer version, and saves nothing', async () => {
      bucket.objects.set('format.json', {
        body: Buffer.from(
          JSON.stringify({ app: 'self.mp3', format: 2, createdAt: '', createdBy: 'x' }),
        ),
        contentType: 'application/json',
      })
      await expect(sync.connect(CONNECT)).rejects.toThrow(/newer version/)
      expect(cloud.connection()).toBeNull()
      expect(sync.connected).toBe(false)
    })

    it('refuses a folder that already holds something else’s format.json', async () => {
      bucket.objects.set('format.json', { body: Buffer.from('{"hello":1}'), contentType: 'x' })
      await expect(sync.connect(CONNECT)).rejects.toThrow(/not self\.mp3/)
    })

    it('says so when the bucket cannot be reached, and saves nothing', async () => {
      bucket.goOffline()
      await expect(sync.connect(CONNECT)).rejects.toBeInstanceOf(CloudError)
      expect(cloud.connection()).toBeNull()
    })

    it('rejects an endpoint that is not an address', async () => {
      await expect(sync.connect({ ...CONNECT, endpoint: 'my bucket' })).rejects.toThrow(
        /not an address/,
      )
    })

    it('needs a region where the address does not say it', async () => {
      await expect(
        sync.connect({ ...CONNECT, endpoint: 'https://abc.r2.cloudflarestorage.com' }),
      ).rejects.toThrow(/region/)
      await sync.connect({
        ...CONNECT,
        endpoint: 'https://abc.r2.cloudflarestorage.com',
        region: 'auto',
      })
      expect(cloud.connection()?.region).toBe('auto')
    })

    it('picks the connection up again at startup', async () => {
      addSong('Aurora Lane - Sunrise', 'audio-sunrise')
      await connect()
      sync.stop()

      const again = new CloudSyncService({
        cloud,
        songs,
        tags,
        playlists,
        imports,
        storage: new LocalStorageDriver(root),
        covers,
        lyrics: new LyricsService(new LocalStorageDriver(root), createLogger('silent')),
        metadata: new MetadataService(new LocalStorageDriver(root), createLogger('silent')),
        logger: createLogger('silent'),
        openStore: () => bucket,
      })
      again.start()
      await again.whenIdle()
      expect(again.status()).toMatchObject({ connected: true, songs: { inCloud: 1 } })
      again.stop()
    })
  })

  describe('uploading', () => {
    it('puts audio, cover and lyrics up under the hashes of their bytes', async () => {
      const words = '[00:01.00] line one\n[00:05.00] line two'
      const id = addSong('YOASOBI - Gunjou', 'audio-gunjou', { lyrics: words })
      await covers.save(id, Buffer.alloc(2048, 7), '.jpg')
      await connect()

      const audio = `audio/${sha('audio-gunjou')}.m4a`
      const cover = `covers/${sha(Buffer.alloc(2048, 7))}.jpg`
      const lyrics = `lyrics/${sha(words)}.lrc`
      expect(bucket.keys('audio/')).toEqual([audio])
      expect(bucket.keys('covers/')).toEqual([cover])
      expect(bucket.keys('lyrics/')).toEqual([lyrics])
      expect(bucket.objects.get(audio)?.contentType).toBe('audio/mp4')
      expect(bucket.objects.get(cover)?.contentType).toBe('image/jpeg')

      const [song] = latest().songs
      expect(song).toMatchObject({
        uid: uidOf(id),
        title: 'Gunjou',
        artist: 'YOASOBI',
        audio: { key: audio, size: 'audio-gunjou'.length, mime: 'audio/mp4' },
        cover: { key: cover, size: 2048 },
        lyrics: { key: lyrics, kind: 'synced' },
      })
    })

    it('sends a file once, however many passes and however many songs share it', async () => {
      addSong('A - One', 'same-bytes')
      addSong('B - Two', 'same-bytes')
      await connect()
      await pass()
      await pass()

      const audioPuts = bucket.puts.filter(key => key.startsWith('audio/'))
      expect(audioPuts).toEqual([`audio/${sha('same-bytes')}.m4a`])
      expect(latest().songs).toHaveLength(2)
    })

    it('does not write a snapshot that would say what the last one said', async () => {
      addSong('A - One', 'one')
      await connect()
      const before = snapshotKeys()
      await pass()
      expect(snapshotKeys()).toEqual(before)
    })

    it('uploads only what changed: a new cover, not the audio again', async () => {
      const id = addSong('A - One', 'one')
      await connect()
      const puts = bucket.puts.length

      await covers.save(id, Buffer.alloc(1024, 3), '.png')
      await pass()

      const sent = bucket.puts.slice(puts)
      expect(sent.filter(key => key.startsWith('audio/'))).toEqual([])
      expect(sent.filter(key => key.startsWith('covers/'))).toEqual([
        `covers/${sha(Buffer.alloc(1024, 3))}.png`,
      ])
      expect(latest().songs[0]?.cover?.key).toMatch(/\.png$/)
    })

    it('uploads a changed audio file again, once the scan has seen it change', async () => {
      const id = addSong('A - One', 'first version')
      await connect()

      const file = path.join(root, 'A - One/A - One.m4a')
      fs.writeFileSync(file, 'second, longer version')
      const stat = fs.statSync(file)
      songs.updateScanned({
        id,
        duration: 200,
        sizeBytes: stat.size,
        mime: 'audio/mp4',
        mtimeMs: Math.floor(stat.mtimeMs) + 1,
        lyricsKind: 'none',
      })
      await pass()

      expect(latest().songs[0]?.audio.key).toBe(`audio/${sha('second, longer version')}.m4a`)
    })

    it('picks up lyrics written next to a song after it was uploaded', async () => {
      addSong('A - One', 'one')
      await connect()
      expect(latest().songs[0]?.lyrics).toBeNull()

      fs.writeFileSync(path.join(root, 'A - One/A - One.txt'), 'just the words')
      await pass()

      expect(latest().songs[0]?.lyrics).toMatchObject({
        key: `lyrics/${sha('just the words')}.txt`,
        kind: 'plain',
      })
    })

    /*
     * Romaji is made on the server, which has the dictionaries, and goes up beside
     * the words, so a device signed in to the cloud gets the same lyrics answer
     * the server itself gives.
     */
    describe('romaji', () => {
      const JAPANESE = '[00:01.00]夜に駆ける\n[00:05.00]沈むように溶けてゆくように'

      /** A sync whose romanizer answers `answer()`, counting how often it is asked. */
      const withRomanizer = (answer: (text: string) => string[] | null) => {
        const asked = { count: 0 }
        const service = new CloudSyncService({
          cloud,
          songs,
          tags,
          playlists,
          imports,
          storage: new LocalStorageDriver(root),
          covers,
          lyrics: new LyricsService(new LocalStorageDriver(root), createLogger('silent')),
          metadata: new MetadataService(new LocalStorageDriver(root), createLogger('silent')),
          logger: createLogger('silent'),
          openStore: () => bucket,
          romanize: (_songId, text) => {
            asked.count++
            return Promise.resolve(answer(text))
          },
        })
        extras.push(service)
        const run = async (): Promise<void> => {
          if (service.connected) await service.syncNow()
          else await service.connect(CONNECT)
          await service.whenIdle()
        }
        return { asked, run }
      }

      it('puts the romanized lines up beside the words, and the snapshot names them', async () => {
        const lines = ['yoru ni kakeru', 'shizumu you ni tokete yuku you ni']
        addSong('YOASOBI - Yoru ni Kakeru', 'audio-yoru', { lyrics: JAPANESE })
        const { run } = withRomanizer(() => lines)
        await run()

        const romanized = `lyrics/${sha(JSON.stringify(lines))}.json`
        expect(bucket.keys('lyrics/')).toEqual([`lyrics/${sha(JAPANESE)}.lrc`, romanized].sort())
        expect(bucket.objects.get(romanized)?.contentType).toBe('application/json')
        expect(JSON.parse(bucket.objects.get(romanized)?.body.toString() ?? 'null')).toEqual(lines)
        expect(latest().songs[0]?.lyrics).toMatchObject({
          key: `lyrics/${sha(JAPANESE)}.lrc`,
          kind: 'synced',
          romanized,
        })
      })

      it('tries Japanese words again on the next pass when their romaji could not be made', async () => {
        let lines: string[] | null = null
        addSong('YOASOBI - Yoru ni Kakeru', 'audio-yoru', { lyrics: JAPANESE })
        const { asked, run } = withRomanizer(() => lines)
        await run()
        expect(latest().songs[0]?.lyrics?.romanized).toBeNull()
        const before = asked.count

        lines = ['yoru ni kakeru', 'shizumu you ni tokete yuku you ni']
        await run()

        expect(asked.count).toBeGreaterThan(before)
        expect(latest().songs[0]?.lyrics?.romanized).toBe(
          `lyrics/${sha(JSON.stringify(lines))}.json`,
        )
      })

      it('does not ask again for words that need no romaji', async () => {
        addSong('A - One', 'one', { lyrics: '[00:01.00] just the words' })
        const { asked, run } = withRomanizer(() => null)
        await run()
        const once = asked.count
        await run()

        expect(asked.count).toBe(once)
        expect(latest().songs[0]?.lyrics?.romanized).toBeNull()
      })
    })

    /*
     * A song's motion curve is made by analysis, which usually finishes after
     * the song's first upload. The pass has to notice it appearing, put it up
     * once beside the words, and name it in the snapshot.
     */
    describe('motion curves', () => {
      const CURVE = {
        rate: 20,
        duration: 0.2,
        loudness: Uint8Array.from([0, 64, 128, 255]),
        onset: Uint8Array.from([255, 0, 0, 10]),
      }

      /** A sync that reads curves from a store in this test's data directory. */
      const withMotion = () => {
        const store = new MotionStore({ dataDir }, createLogger('silent'))
        const service = new CloudSyncService({
          cloud,
          songs,
          tags,
          playlists,
          imports,
          storage: new LocalStorageDriver(root),
          covers,
          lyrics: new LyricsService(new LocalStorageDriver(root), createLogger('silent')),
          metadata: new MetadataService(new LocalStorageDriver(root), createLogger('silent')),
          logger: createLogger('silent'),
          openStore: () => bucket,
          motion: store,
        })
        extras.push(service)
        const run = async (): Promise<void> => {
          if (service.connected) await service.syncNow()
          else await service.connect(CONNECT)
          await service.whenIdle()
        }
        const keyOf = (songId: number): string =>
          `lyrics/${sha(fs.readFileSync(path.join(dataDir, 'motion', `${songId}.json`)))}.json`
        return { store, run, keyOf }
      }

      it('puts up a curve that appears after the song was uploaded, and the snapshot names it', async () => {
        const id = addSong('A - One', 'one')
        const { store, run, keyOf } = withMotion()
        await run()
        expect(latest().songs[0]?.motion ?? null).toBeNull()

        await store.write(id, CURVE)
        await run()

        const key = keyOf(id)
        expect(latest().songs[0]?.motion).toBe(key)
        expect(bucket.objects.get(key)?.contentType).toBe('application/json')
        expect(JSON.parse(bucket.objects.get(key)?.body.toString() ?? 'null')).toEqual({
          version: 1,
          rate: 20,
          duration: 0.2,
          loudness: Buffer.from([0, 64, 128, 255]).toString('base64'),
          onset: Buffer.from([255, 0, 0, 10]).toString('base64'),
        })
      })

      it('does not send an unchanged curve again, and sends a new one after re-analysis', async () => {
        const id = addSong('A - One', 'one')
        const { store, run, keyOf } = withMotion()
        await store.write(id, CURVE)
        await run()
        const first = keyOf(id)
        const puts = bucket.puts.length

        await run()
        expect(JSON.stringify(bucket.puts.slice(puts))).not.toContain(first)

        await store.write(id, { ...CURVE, loudness: Uint8Array.from([9, 9, 9, 9]) })
        await run()
        const second = keyOf(id)
        expect(second).not.toBe(first)
        expect(latest().songs[0]?.motion).toBe(second)
        expect(bucket.objects.has(second)).toBe(true)
      })

      it('uploads a curve the bucket lost again', async () => {
        const id = addSong('A - One', 'one')
        const { store, run, keyOf } = withMotion()
        await store.write(id, CURVE)
        await run()
        expect(cloud.reconcileFiles(new Map())).toBeGreaterThan(0)

        await run()
        expect(latest().songs[0]?.motion).toBe(keyOf(id))
      })
    })

    it('publishes an edit that changes no file at all', async () => {
      const id = addSong('A - One', 'one')
      await connect()
      const puts = bucket.puts.length

      const tag = tags.create('chill')
      tags.addToSong(id, tag.id)
      await pass()

      expect(bucket.puts.slice(puts).every(key => key.startsWith('snapshots/'))).toBe(true)
      const snapshot = latest()
      const tagUid = snapshot.tags.find(t => t.name === 'chill')?.uid
      expect(tagUid).toMatch(/^[0-9a-f]{32}$/)
      expect(snapshot.songs[0]?.tagUids).toEqual([tagUid])
    })
  })

  describe('what a snapshot says', () => {
    it('leaves out a song that is not up yet', async () => {
      addSong('A - One', 'one')
      await connect()

      bucket.goOffline()
      addSong('B - Two', 'two')
      await pass()
      bucket.comeBack()

      expect(latest().songs.map(song => song.title)).toEqual(['One'])
    })

    it('keeps a song whose file has gone missing here: the bucket still has it', async () => {
      const id = addSong('A - One', 'one')
      addSong('B - Two', 'two')
      await connect()

      songs.markMissing(songs.byId(id)?.path ?? '')
      await pass()
      expect(latest().songs).toHaveLength(2)
      // And it is not one of the songs waiting to be fetched back: this server
      // had that file and lost it, which is not the same as never having had
      // it, and only the second is this server's to go and get.
      expect(sync.status().songs).toEqual({ total: 1, inCloud: 1, waiting: 0 })
    })

    it('lets a song go once it is forgotten for good', async () => {
      const id = addSong('A - One', 'one')
      addSong('B - Two', 'two')
      await connect()

      songs.delete(id)
      await pass()
      expect(latest().songs.map(song => song.title)).toEqual(['Two'])
    })

    it('carries playlists by uid, in order, live ones with their rules and their songs', async () => {
      const one = addSong('A - One', 'one')
      const two = addSong('B - Two', 'two')
      const chill = tags.create('chill')
      tags.addToSong(two, chill.id)

      const mix = playlists.create({ name: 'Mix', description: '', kind: 'manual', rules: null })
      playlists.add(mix.id, [two, one])
      playlists.create({
        name: 'Chill',
        description: '',
        kind: 'live',
        rules: {
          match: 'all',
          rules: [{ field: 'tag', op: 'has', tagId: chill.id }],
          orderBy: 'addedAt',
          order: 'desc',
          limit: null,
        },
      })
      await connect()

      const snapshot = latest()
      const tagUid = snapshot.tags[0]?.uid
      const manual = snapshot.playlists.find(p => p.name === 'Mix')
      const live = snapshot.playlists.find(p => p.name === 'Chill')
      expect(manual?.songUids).toEqual([uidOf(two), uidOf(one)])
      expect(manual?.rules).toBeNull()
      expect(live?.rules?.rules).toEqual([{ field: 'tag', op: 'has', tagUid }])
      expect(live?.songUids).toEqual([uidOf(two)])
    })

    it('keeps its three newest snapshots, and never touches another device’s', async () => {
      const id = addSong('A - One', 'one')
      // A real snapshot of an empty library, not `{}`. Before publishing, the
      // server both reads the newest snapshot to see how big the library is and
      // takes on what is in it — so a stand-in here has to be a whole snapshot,
      // not a placeholder.
      const theirs = seedBucket(theirSnapshot({}))
      await connect()

      for (const loved of [true, false, true, false, true]) {
        songs.patch(id, { loved })
        await pass()
      }

      const keys = snapshotKeys()
      expect(keys).toContain(theirs)
      expect(keys.filter(key => key !== theirs)).toHaveLength(3)
    })

    /**
     * Another device's snapshot of a library far larger than this server's,
     * and whose audio the bucket no longer holds.
     *
     * The guard is a backstop rather than the front line now: a bucket whose
     * library can be taken on *is* taken on, and publishing afterwards loses
     * nothing, which is what the next block is about. What is left for the
     * guard is a bucket whose library could not be taken on — here because none
     * of the audio is in it, so no adopted song has a file to point at and this
     * server would publish its own one song as the whole library.
     */
    const largerLibraryIn = (store: MemoryCloudStore, gzip = true): string => {
      const songsThere = Array.from({ length: 20 }, (_, index) => theirSong(`They - ${index}`))
      return seedBucket(theirSnapshot({ songs: songsThere }), {
        store,
        gzip,
        withoutAudio: songsThere.map(song => song.uid),
      })
    }

    it('refuses just the same when the bucket hands the snapshot back decoded', async () => {
      /*
       * The same library, handed back the way the real bucket hands it back.
       *
       * `MemoryCloudStore` returns the exact bytes it was given, so a snapshot
       * put gzipped comes back gzipped. The doorman store does not: it reads
       * the body through Node's fetch, which decompresses by `Content-Encoding`
       * before the server sees a byte. So in production this guard was always
       * handed plain JSON, always threw trying to gunzip it, and always took
       * the throw as "never mind" — which is how a 52-song library was replaced
       * by a 1-song one on a real bucket. The fake was the only reason the
       * older test passed. Everything that reads a snapshot goes through the
       * one decoder now, so adoption inherits the fix rather than repeating it.
       */
      addSong('A - One', 'one')
      const theirs = largerLibraryIn(bucket, false)
      await connect()

      expect(snapshotKeys()).toEqual([theirs])
      expect(sync.status().lastError).toContain('refused to publish')
    })

    it('refuses rather than publishing when it cannot read the newest snapshot', async () => {
      // Not a snapshot at all. "I cannot see the library" must never be taken
      // as "there is no library": zero is the count that lets this server win.
      // Adoption stops first now, with the same answer for the same reason.
      addSong('A - One', 'one')
      const theirs = snapshotKey(new Date('2026-01-01T00:00:00Z'), 'iphone-0b7d44a1')
      bucket.objects.set(theirs, {
        body: Buffer.from('<html>a login page from a proxy</html>'),
        contentType: 'application/json',
        contentEncoding: 'gzip',
      })

      await connect()

      expect(snapshotKeys()).toEqual([theirs])
      expect(sync.status().lastError).toContain('could not read it')
      // And nothing was half-taken-on from a snapshot it could not make sense of.
      expect(songs.all()).toHaveLength(1)
    })

    it('refuses to publish over a larger library, on every pass, and keeps saying why', async () => {
      addSong('A - One', 'one')
      const theirs = largerLibraryIn(bucket)
      await connect()

      expect(snapshotKeys()).toEqual([theirs])
      expect(sync.status()).toMatchObject({ state: 'error' })
      expect(sync.status().lastError).toContain('refused to publish')

      // The next pass asks again, rather than taking the first answer as done.
      await pass()
      expect(snapshotKeys()).toEqual([theirs])
      expect(sync.status().lastError).toContain('refused to publish')
    })

    it('checks a bucket it moves to, not only the first', async () => {
      addSong('A - One', 'one')
      await connect()
      const other = new MemoryCloudStore()
      buckets.set('their-music', other)
      const theirs = largerLibraryIn(other)

      await connect({ bucket: 'their-music' })

      expect(snapshotKeys(other)).toEqual([theirs])
      expect(sync.status().lastError).toContain('refused to publish')
    })
  })

  /**
   * A server signing in to a bucket that already has a library in it.
   *
   * Refusing to publish over it was only half an answer — it stopped the
   * library being wiped and left "set self.mp3 up on a new Mac and get my
   * library back" with nowhere to go. So the server reads the newest snapshot
   * and takes on every song in it that it does not have, before it writes a
   * word of its own.
   */
  describe('taking on the library already in the bucket', () => {
    const TAG = { uid: 'a'.repeat(32), name: 'train', hue: 40 }

    /** Three songs, a tag, and a manual playlist: enough for every part to matter. */
    const theirLibrary = (): CloudSnapshot => {
      const first = theirSong('YOASOBI - Gunjou', {
        tagUids: [TAG.uid],
        loved: true,
        playCount: 12,
        skipCount: 3,
        lastPlayedAt: '2026-08-01 10:00:00',
        sourceUrl: 'https://www.youtube.com/watch?v=abc',
        year: 2020,
        trackNo: 4,
        album: 'THE BOOK',
        albumArtist: 'YOASOBI',
        duration: 245.5,
        cover: theirFile('covers', 'their cover of Gunjou', '.jpg'),
        lyrics: {
          ...theirFile('lyrics', '[00:01.00] their words', '.lrc'),
          kind: 'synced',
          romanized: null,
        },
        audioFeatures: {
          bpm: 128,
          energy: 0.8,
          loudnessLufs: -7.5,
          key: 'A minor',
          camelot: '8A',
          danceability: 0.6,
          analyzedAt: '2026-02-03 04:05:06',
          version: 3,
        },
      })
      const second = theirSong('Aurora Lane - Sunrise', { tagUids: [TAG.uid], instrumental: true })
      const third = theirSong('Nova - Dusk')
      return theirSnapshot({
        songs: [first, second, third],
        tags: [TAG],
        playlists: [
          {
            uid: 'b'.repeat(32),
            name: 'Mix',
            description: 'the good ones',
            kind: 'manual',
            rules: null,
            pinned: true,
            songUids: [third.uid, first.uid],
            createdAt: '2025-01-01 00:00:00',
            updatedAt: '2025-07-04 09:00:00',
          },
        ],
      })
    }

    /** What the server publishes, with the parts only this device decides stripped off. */
    const asPublished = (): Pick<CloudSnapshot, 'songs' | 'tags' | 'playlists'> => {
      const { songs: published, tags: publishedTags, playlists: publishedLists } = latest()
      const byUid = <T extends { uid: string }>(items: readonly T[]): T[] =>
        [...items].sort((a, b) => a.uid.localeCompare(b.uid))
      return {
        songs: byUid(published),
        tags: byUid(publishedTags),
        playlists: byUid(publishedLists),
      }
    }

    it('takes on a whole library, and republishes exactly what it was handed', async () => {
      const theirs = theirLibrary()
      seedBucket(theirs)

      await connect()

      // Not "the same number of rows": the same library. Every uid, every tag
      // on every song, every play count, every stamped field, the playlist and
      // its order — handed back to the bucket as it was found.
      expect(asPublished()).toEqual({
        songs: [...theirs.songs].sort((a, b) => a.uid.localeCompare(b.uid)),
        tags: theirs.tags,
        playlists: theirs.playlists,
      })
      expect(sync.status()).toMatchObject({ state: 'idle', lastError: null })
    })

    it('does not upload a file the bucket already has', async () => {
      seedBucket(theirLibrary())
      await connect()
      // Every put in this pass is the server's own snapshot and format.json.
      expect(bucket.puts.filter(key => key.startsWith('audio/'))).toEqual([])
      expect(bucket.puts.filter(key => key.startsWith('covers/'))).toEqual([])
      expect(bucket.puts.filter(key => key.startsWith('lyrics/'))).toEqual([])
    })

    it('keeps the songs it already had, and adds only the rest', async () => {
      // The overlap is by uid: this server's own song is one of the bucket's.
      const mine = addSong('Nova - Dusk', 'dusk')
      const theirs = theirLibrary()
      db.prepare('UPDATE songs SET uid = ? WHERE id = ?').run(uid('Nova - Dusk'), mine)
      seedBucket(theirs)

      await connect()

      // Three in the bucket, one of them already here: three, not four.
      expect(uidsHere()).toEqual(theirs.songs.map(song => song.uid).sort())
      expect(songs.byId(mine)).toMatchObject({
        path: 'Nova - Dusk/Nova - Dusk.m4a',
        missing: false,
      })
      expect(latest().songs).toHaveLength(3)
    })

    it('leaves a song it already has exactly as it was', async () => {
      const mine = addSong('Nova - Dusk', 'dusk')
      db.prepare('UPDATE songs SET uid = ?, title = ?, loved = 1 WHERE id = ?').run(
        uid('Nova - Dusk'),
        'Dusk (my name for it)',
        mine,
      )
      seedBucket(theirLibrary())

      await connect()

      // The snapshot is not a change with a stamp, so it cannot win an edit.
      expect(songs.byId(mine)).toMatchObject({ title: 'Dusk (my name for it)', loved: true })
    })

    it('adopts nothing the second time, and makes no second row for anything', async () => {
      seedBucket(theirLibrary())
      await connect()
      const after = uidsHere()
      const paths = songs.all().map(song => song.path)

      // Including the way a person asks for it by hand, which starts over.
      await sync.syncNow({ verify: true })
      await sync.whenIdle()
      await pass()

      expect(uidsHere()).toEqual(after)
      expect(songs.all().map(song => song.path)).toEqual(paths)
      expect(tags.all()).toHaveLength(1)
      expect(playlists.all()).toHaveLength(1)
    })

    it('makes the row for a song the bucket has no audio for, and does not publish it', async () => {
      const theirs = theirLibrary()
      const lost = theirs.songs[1]
      seedBucket(theirs, { withoutAudio: [lost?.uid ?? ''] })

      await connect()

      // The row is worth having: its tags, its plays and its place in a
      // playlist are all still true, and the audio may come back.
      expect(uidsHere()).toEqual(theirs.songs.map(song => song.uid).sort())
      expect(songs.all().find(song => song.title === 'Sunrise')).toMatchObject({ missing: true })
      // But nothing points a device at a file nobody can download.
      expect(
        latest()
          .songs.map(song => song.uid)
          .sort(),
      ).toEqual(
        theirs.songs
          .filter(song => song.uid !== lost?.uid)
          .map(song => song.uid)
          .sort(),
      )
    })

    it('keeps an adopted song through a scan, and through forgetting missing songs', async () => {
      // Adopted directly, so the songs are still waiting for their files when
      // the scan runs — which is the state being tested, and not one a test
      // that also let the fetching run could be sure of.
      const theirs = theirLibrary()
      for (const song of theirs.songs) cloud.recordFile(song.audio.key, song.audio.size)
      await adopt.adopt(theirs)
      const before = uidsHere()

      await scanner.scan()

      // A scan marks a song whose file is not there `missing`; it never deletes
      // the row. An adopted song is already missing, so a scan is a no-op on it
      // — which is what makes it safe to leave one waiting for its audio.
      expect(uidsHere()).toEqual(before)
      expect(songs.all().every(song => song.missing)).toBe(true)

      // Nor does "forget missing songs" take them. They are missing because
      // their audio has not been fetched yet, which is a library being
      // restored and not a library that is gone. Forgetting it would throw
      // away the songs, their tags and their play history all at once.
      expect(await scanner.purgeMissing()).toBe(0)
      expect(uidsHere()).toEqual(before)
    })

    it('publishes nothing at all if it could not take the library on first', async () => {
      // An import finishing is the other way into `#publish`, and it used to go
      // straight there. A snapshot the server cannot make sense of has to stop
      // that path too, or a half-adopted library publishes after all — the
      // original bug, wearing a hat.
      const id = addSong('A - One', 'one')
      const theirs = snapshotKey(new Date('2026-01-01T00:00:00Z'), 'iphone-0b7d44a1')
      bucket.objects.set(theirs, {
        body: Buffer.from('<html>a login page from a proxy</html>'),
        contentType: 'application/json',
      })
      await connect()

      await expect(sync.uploadSong(id)).rejects.toThrow(/could not read it/)
      expect(snapshotKeys()).toEqual([theirs])
    })

    it('publishes this server’s library, unmerged, when told to publish anyway', async () => {
      process.env['SELFMP3_PUBLISH_ANYWAY'] = '1'
      try {
        addSong('A - One', 'one')
        seedBucket(theirLibrary())
        await connect()

        // The escape hatch is total: it is how you say "this server's library
        // is the one I want everywhere", and merging the bucket's in first
        // would be the opposite of that.
        expect(songs.all()).toHaveLength(1)
        expect(latest().songs).toHaveLength(1)
      } finally {
        delete process.env['SELFMP3_PUBLISH_ANYWAY']
      }
    })
  })

  /**
   * And then fetching those songs' files back out of the bucket.
   *
   * Adoption gives a new server the library; this gives it the music. It runs
   * behind the pass rather than inside it, so what is tested here is mostly
   * about stopping in the middle: a run that is interrupted has to cost
   * nothing, and a run over a library that is already here has to download
   * nothing at all.
   */
  describe('fetching the files of a library taken on', () => {
    const WORDS = '[00:01.00] line one\n[00:05.00] line two'

    const withFiles = (): CloudSnapshot => {
      const song = theirSong('YOASOBI - Gunjou', {
        cover: theirFile('covers', 'their cover of Gunjou', '.jpg'),
        lyrics: { ...theirFile('lyrics', WORDS, '.lrc'), kind: 'synced', romanized: null },
      })
      return theirSnapshot({ songs: [song, theirSong('Nova - Dusk')] })
    }

    /** Connect, and let the fetching a pass starts run to the end. */
    const settle = async (): Promise<void> => {
      await connect()
      await sync.whenSettled()
    }

    const inLibrary = (key: string): boolean => fs.existsSync(path.join(root, key))

    it('brings the audio, the cover and the words down, and the song is no longer missing', async () => {
      seedBucket(withFiles())

      await settle()

      const song = songs.all().find(one => one.title === 'Gunjou')
      expect(song).toMatchObject({ missing: false, hasArt: true })
      expect(inLibrary('YOASOBI - Gunjou/YOASOBI - Gunjou.m4a')).toBe(true)
      // Timed words come down as a `.lrc` beside the audio, where the server
      // reads its own lyrics from — no different from a song imported here.
      expect(
        fs.readFileSync(path.join(root, 'YOASOBI - Gunjou/YOASOBI - Gunjou.lrc'), 'utf8'),
      ).toBe(WORDS)
      expect(sync.status().songs).toMatchObject({ waiting: 0 })
    })

    it('does not send back what it just fetched', async () => {
      const theirs = withFiles()
      seedBucket(theirs)
      await settle()
      const before = bucket.puts.length

      // The files are named by the hash of their bytes, so the same bytes
      // written here make the same keys: the pass finds the bucket already has
      // every one of them and sends nothing.
      await pass()

      expect(bucket.puts.slice(before).filter(key => !key.startsWith('snapshots/'))).toEqual([])
      // And the snapshot still names exactly the files it was handed.
      expect(
        latest()
          .songs.map(song => song.audio.key)
          .sort(),
      ).toEqual(theirs.songs.map(song => song.audio.key).sort())
    })

    it('picks up where it was stopped, and fetches nothing twice', async () => {
      seedBucket(withFiles())
      await connect()
      sync.stop()
      await sync.whenSettled()
      const fetchedFirstTime = [...bucket.gets]

      // A restart: the queue is a query, so there is nothing to carry over.
      const again = new CloudRestore({
        cloud,
        storage: new LocalStorageDriver(root),
        covers,
        lyrics: new LyricsService(new LocalStorageDriver(root), createLogger('silent')),
        scanner: () => scanner,
        logger: createLogger('silent'),
      })
      bucket.gets.length = 0
      again.start(bucket, () => true)
      await again.whenIdle()

      // Whatever the first run finished, the second did not fetch again; and
      // between them every song is here.
      expect(bucket.gets.filter(key => fetchedFirstTime.includes(key))).toEqual([])
      expect(songs.all().every(song => !song.missing)).toBe(true)
      expect(again.waiting()).toBe(0)
    })

    it('downloads nothing at all the second time over a finished library', async () => {
      seedBucket(withFiles())
      await settle()

      bucket.gets.length = 0
      restore.start(bucket, () => true)
      await restore.whenIdle()

      expect(bucket.gets).toEqual([])
    })

    it('leaves a song whose audio the bucket has not, and carries on with the rest', async () => {
      const theirs = withFiles()
      const lost = theirs.songs[0]
      seedBucket(theirs, { withoutAudio: [lost?.uid ?? ''] })

      await settle()

      expect(songs.all().find(song => song.title === 'Gunjou')).toMatchObject({ missing: true })
      expect(songs.all().find(song => song.title === 'Dusk')).toMatchObject({ missing: false })
    })

    it('says how it is going while it runs, and stops saying when it is done', async () => {
      seedBucket(withFiles())
      await connect()

      // Two songs adopted, neither fetched yet, because the pass does not wait.
      expect(sync.status().songs.waiting).toBe(2)

      await sync.whenSettled()
      expect(sync.status()).toMatchObject({ songs: { waiting: 0 }, restoring: null })
    })

    it('never fetches a song this server had and lost', async () => {
      const id = addSong('A - One', 'one')
      await connect()
      await sync.whenSettled()
      fs.rmSync(path.join(root, 'A - One/A - One.m4a'))
      songs.markMissing('A - One/A - One.m4a')

      bucket.gets.length = 0
      await pass()
      await sync.whenSettled()

      // An unplugged drive is not an invitation to re-download the library.
      expect(bucket.gets.filter(key => key.startsWith('audio/'))).toEqual([])
      expect(songs.byId(id)).toMatchObject({ missing: true })
    })
  })

  describe('changes from other devices', () => {
    const PHONE = 'iphone-0b7d44a1'
    const LAPTOP = 'web-3f9a2c1d'
    const stamp = (seconds: number, device = PHONE): string =>
      formatHlc({ ms: Date.parse('2026-09-11T09:00:00Z') + seconds * 1000, counter: 0, device })

    const writeLog = (device: string, seq: number, changes: unknown[]): void => {
      const file = { ...logFile(device, seq, [], new Date('2026-09-11T09:00:00Z')), changes }
      bucket.objects.set(logKey(device, seq), {
        body: Buffer.from(JSON.stringify(file)),
        contentType: 'application/json',
      })
    }

    it('folds them in, and the snapshot says how far it read', async () => {
      const id = addSong('A - One', 'one')
      await connect()
      const uid = uidOf(id)
      writeLog(PHONE, 1, [
        { type: 'songEdited', hlc: stamp(1), uid, fields: { title: 'Uno', loved: true } },
      ] satisfies Change[])
      writeLog(PHONE, 2, [
        { type: 'tagCreated', hlc: stamp(2), uid: 'a'.repeat(32), name: 'train', hue: 40 },
        { type: 'songTagged', hlc: stamp(3), uid, tagUid: 'a'.repeat(32), on: true },
      ] satisfies Change[])

      await pass()

      expect(songs.byId(id)).toMatchObject({ title: 'Uno', loved: true })
      const snapshot = latest()
      expect(snapshot.upTo).toEqual({ [PHONE]: 2 })
      expect(snapshot.tags).toEqual([{ uid: 'a'.repeat(32), name: 'train', hue: 40 }])
      expect(snapshot.songs[0]).toMatchObject({
        title: 'Uno',
        tagUids: ['a'.repeat(32)],
        stamps: { title: stamp(1), loved: stamp(1) },
        tagStamps: { ['a'.repeat(32)]: stamp(3) },
      })
      expect(sync.status()).toMatchObject({ state: 'idle', lastError: null })

      // Read once: editing here afterwards is not undone by reading them again.
      songs.patch(id, { title: 'One again' })
      await pass()
      expect(songs.byId(id)?.title).toBe('One again')
    })

    it('stops at a change this build does not know, and still reads the other devices', async () => {
      const id = addSong('A - One', 'one')
      await connect()
      const uid = uidOf(id)
      writeLog(PHONE, 1, [{ type: 'songEdited', hlc: stamp(1), uid, fields: { title: 'Uno' } }])
      writeLog(PHONE, 2, [{ type: 'songRated', hlc: stamp(2), uid, stars: 5 }])
      writeLog(PHONE, 3, [{ type: 'songEdited', hlc: stamp(3), uid, fields: { year: 1999 } }])
      writeLog(LAPTOP, 1, [
        { type: 'songEdited', hlc: stamp(4, LAPTOP), uid, fields: { loved: true } },
      ])

      await pass()

      expect(songs.byId(id)).toMatchObject({ title: 'Uno', loved: true, year: null })
      expect(latest().upTo).toEqual({ [PHONE]: 1, [LAPTOP]: 1 })
      expect(sync.status()).toMatchObject({ state: 'error' })
      expect(sync.status().lastError).toMatch(/Update this server/)
    })

    it('takes a song another device removed out, and keeps the file it was told to keep', async () => {
      const id = addSong('A - One', 'one')
      addSong('B - Two', 'two')
      await connect()
      const removed: unknown[] = []
      sync.onIngested = result => {
        removed.push(...result.removed)
      }
      writeLog(PHONE, 1, [{ type: 'songRemoved', hlc: stamp(1), uid: uidOf(id) }])

      await pass()

      expect(removed).toEqual([{ id, path: 'A - One/A - One.m4a', deleteFile: false }])
      expect(latest().songs.map(song => song.title)).toEqual(['Two'])
    })

    /*
     * "Remove from my list" and "destroy the file" are different answers, and
     * a phone in cloud mode asks the same question the server does. Whichever was
     * given has to survive the trip.
     */
    it('says to take the file away when that is what was asked for', async () => {
      const id = addSong('A - One', 'one')
      await connect()
      const removed: unknown[] = []
      sync.onIngested = result => {
        removed.push(...result.removed)
      }
      writeLog(PHONE, 1, [{ type: 'songRemoved', hlc: stamp(1), uid: uidOf(id), deleteFile: true }])

      await pass()

      expect(removed).toEqual([{ id, path: 'A - One/A - One.m4a', deleteFile: true }])
    })

    it('does not mind a file that went between the listing and reading it', async () => {
      const id = addSong('A - One', 'one')
      await connect()
      writeLog(PHONE, 1, [
        { type: 'songEdited', hlc: stamp(1), uid: uidOf(id), fields: { title: 'Uno' } },
      ])
      const read = bucket.get.bind(bucket)
      bucket.get = key => (key === logKey(PHONE, 1) ? Promise.resolve(null) : read(key))

      await pass()

      expect(songs.byId(id)?.title).toBe('One')
      expect(sync.status()).toMatchObject({ state: 'idle', lastError: null })
      expect(latest().upTo).toEqual({})
    })

    it('notices a change written while the server sits idle', async () => {
      sync.stop()
      const id = addSong('A - One', 'one')
      const watcher = new CloudSyncService({
        cloud,
        songs,
        tags,
        playlists,
        imports,
        storage: new LocalStorageDriver(root),
        covers,
        lyrics: new LyricsService(new LocalStorageDriver(root), createLogger('silent')),
        metadata: new MetadataService(new LocalStorageDriver(root), createLogger('silent')),
        logger: createLogger('silent'),
        sync: syncRepo,
        ingest,
        openStore: () => bucket,
        debounceMs: 5,
        logPollMs: 20,
        now: () => new Date((clock += 1000)),
      })
      extras.push(watcher)
      await watcher.connect(CONNECT)
      await watcher.whenIdle()

      writeLog(PHONE, 1, [
        { type: 'songEdited', hlc: stamp(1), uid: uidOf(id), fields: { loved: true } },
      ])
      for (let tries = 0; tries < 100 && !songs.byId(id)?.loved; tries++) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      await watcher.whenIdle()

      expect(songs.byId(id)?.loved).toBe(true)
      expect(latest().upTo).toEqual({ [PHONE]: 1 })
    })
  })

  describe('losing the connection', () => {
    it('stops the pass, says why, and finishes the job when the bucket is back', async () => {
      addSong('A - One', 'one')
      bucket.goOffline()
      await expect(sync.connect(CONNECT)).rejects.toThrow(/Could not reach/)

      // Connected while online; the connection dropped afterwards.
      bucket.comeBack()
      await connect()
      bucket.goOffline()
      addSong('B - Two', 'two')
      await pass()
      expect(sync.status()).toMatchObject({ state: 'error', songs: { total: 2, inCloud: 1 } })
      expect(sync.status().lastError).toMatch(/Could not reach/)

      bucket.comeBack()
      await pass()
      expect(sync.status()).toMatchObject({ state: 'idle', lastError: null, songs: { inCloud: 2 } })
      expect(latest().songs).toHaveLength(2)
    })

    it('marks an import done that gave up waiting to upload, once its song is up', async () => {
      await connect()
      const id = addSong('A - One', 'one')
      const [job] = imports.enqueue(
        [
          {
            url: 'https://youtu.be/x',
            title: 'One',
            artist: 'A',
            album: '',
            thumbnail: null,
            duration: 0,
          },
        ],
        [],
        null,
      )
      if (!job) throw new Error('no job')
      imports.update(job.id, { status: 'error', step: 'uploading', songId: id, error: 'offline' })

      await pass()
      expect(imports.byId(job.id)).toMatchObject({ status: 'done', step: 'finished', error: null })
    })
  })

  describe('a bucket that lost files', () => {
    it('notices when checked, and puts those songs up again', async () => {
      addSong('A - One', 'one')
      addSong('B - Two', 'two')
      await connect()

      // Deleted by hand in the provider's console, say.
      bucket.objects.delete(`audio/${sha('one')}.m4a`)
      const puts = bucket.puts.length
      await sync.syncNow({ verify: true })
      await sync.whenIdle()

      expect(bucket.puts.slice(puts)).toContain(`audio/${sha('one')}.m4a`)
      expect(bucket.puts.slice(puts)).not.toContain(`audio/${sha('two')}.m4a`)
      expect(bucket.keys('audio/')).toHaveLength(2)
    })

    it('fills an emptied bucket back in, format.json and all', async () => {
      addSong('A - One', 'one')
      await connect()

      bucket.objects.clear()
      await sync.syncNow({ verify: true })
      await sync.whenIdle()

      expect(bucket.keys()).toEqual(
        expect.arrayContaining(['format.json', `audio/${sha('one')}.m4a`]),
      )
      expect(latest().songs).toHaveLength(1)
    })

    it('trusts what it knows between checks, so an ordinary pass lists nothing', async () => {
      addSong('A - One', 'one')
      await connect()
      bucket.objects.delete(`audio/${sha('one')}.m4a`)
      const puts = bucket.puts.length
      await pass()
      expect(bucket.puts.slice(puts).filter(key => key.startsWith('audio/'))).toEqual([])
    })
  })

  describe('uploadSong, the last step of an import', () => {
    it('puts one song up and publishes a snapshot that has it', async () => {
      await connect()
      const id = addSong('A - One', 'one')

      await sync.uploadSong(id)
      expect(latest().songs.map(song => song.uid)).toEqual([uidOf(id)])
    })

    it('throws when the song cannot be put up, so the import is not called done', async () => {
      await connect()
      const id = addSong('A - One', 'one')
      bucket.goOffline()
      await expect(sync.uploadSong(id)).rejects.toThrow(/Could not reach/)
    })

    it('does nothing with no bucket connected', async () => {
      const id = addSong('A - One', 'one')
      await expect(sync.uploadSong(id)).resolves.toBeUndefined()
      expect(bucket.puts).toEqual([])
    })
  })

  describe('pointing somewhere else', () => {
    it('uploads the library again to a different bucket', async () => {
      addSong('A - One', 'one')
      await connect()
      await connect({ bucket: 'another-bucket' })

      const other = buckets.get('another-bucket')
      expect(other?.keys('audio/')).toEqual([`audio/${sha('one')}.m4a`])
      expect(latest(other).songs).toHaveLength(1)
    })

    it('keeps what it knows when only the key changes', async () => {
      addSong('A - One', 'one')
      await connect()
      const puts = bucket.puts.length
      await connect({ keyId: '004-new-key-id', applicationKey: 'K004-new' })
      expect(bucket.puts.slice(puts).filter(key => key.startsWith('audio/'))).toEqual([])
    })

    it('disconnecting leaves the bucket as it is', async () => {
      addSong('A - One', 'one')
      await connect()
      const keys = bucket.keys()
      sync.disconnect()
      expect(bucket.keys()).toEqual(keys)
      expect(sync.status()).toMatchObject({ connected: false, state: 'off', target: null })
      expect(cloud.connection()).toBeNull()
    })
  })

  describe('signing in through the doorman', () => {
    /**
     * The doorman as the server sees it: Google "finishes" a sign-in when a test
     * says so, each session belongs to an account, and an account's bucket is
     * one of the memory buckets above, by name.
     */
    class FakeDoorman implements Doorman {
      readonly url = 'https://doorman.test'
      /** attempt → the session Google's sign-in produced, once it has. */
      readonly finished = new Map<string, string>()
      readonly accounts = new Map<string, DoormanMe>()
      readonly signedOut: string[] = []
      /** attempt → the code shown once Google finished, for a doorman that asks for one. */
      readonly codes = new Map<string, string>()
      meFailure: CloudError | null = null

      finish(
        attempt: string,
        token: string,
        storage: DoormanMe['storage'] = null,
        code?: string,
      ): void {
        this.accounts.set(token, { email: 'me@example.com', name: 'Me', picture: null, storage })
        this.finished.set(attempt, token)
        if (code) this.codes.set(attempt, code)
      }

      claim(attempt: string, code?: string): Promise<DoormanClaimResult> {
        const token = this.finished.get(attempt)
        const me = token ? this.accounts.get(token) : undefined
        if (!token || !me) {
          return code === undefined
            ? Promise.resolve({ status: 'pending' })
            : Promise.reject(new CloudError('other', 'wrong code'))
        }
        const wanted = this.codes.get(attempt)
        if (wanted !== undefined && code === undefined) return Promise.resolve({ status: 'code' })
        if (wanted !== undefined && code !== wanted) {
          // A wrong code ends the attempt.
          this.finished.delete(attempt)
          return Promise.reject(new CloudError('other', 'That isn’t the code. Start again.'))
        }
        this.finished.delete(attempt)
        return Promise.resolve({ status: 'signed-in', token, me })
      }

      me(token: string): Promise<DoormanMe> {
        if (this.meFailure) return Promise.reject(this.meFailure)
        const me = this.accounts.get(token)
        return me ? Promise.resolve(me) : Promise.reject(new CloudError('auth', 'signed out'))
      }

      connectStorage(token: string, input: CloudConnect): Promise<DoormanMe> {
        const me = this.accounts.get(token)
        if (!me) return Promise.reject(new CloudError('auth', 'signed out'))
        const next: DoormanMe = {
          ...me,
          storage: {
            endpoint: parseEndpoint(input.endpoint)?.url ?? input.endpoint,
            region: 'us-west-004',
            bucket: input.bucket,
            prefix: input.prefix,
            keyIdHint: `${input.keyId.slice(0, 6)}…`,
          },
        }
        this.accounts.set(token, next)
        return Promise.resolve(next)
      }

      signOut(token: string): Promise<void> {
        this.signedOut.push(token)
        return Promise.resolve()
      }

      store(token: string): CloudStore {
        const bucketName = this.accounts.get(token)?.storage?.bucket ?? ''
        let store = buckets.get(bucketName)
        if (!store) {
          store = new MemoryCloudStore()
          buckets.set(bucketName, store)
        }
        return store
      }
    }

    const STORAGE: NonNullable<DoormanMe['storage']> = {
      endpoint: 'https://s3.us-west-004.backblazeb2.com',
      region: 'us-west-004',
      bucket: CONNECT.bucket,
      prefix: 'selfmp3',
      keyIdHint: '004abc…',
    }
    const ATTEMPT = 'c'.repeat(32)

    const withDoorman = (doorman: FakeDoorman, now = () => new Date((clock += 1000))) => {
      const storage = new LocalStorageDriver(root)
      const logger = createLogger('silent')
      const service = new CloudSyncService({
        cloud,
        songs,
        tags,
        playlists,
        imports,
        storage,
        covers,
        lyrics: new LyricsService(storage, logger, () => Promise.reject(new Error('offline'))),
        metadata: new MetadataService(storage, logger),
        logger,
        openStore: connection => {
          let store = buckets.get(connection.bucket)
          if (!store) {
            store = new MemoryCloudStore()
            buckets.set(connection.bucket, store)
          }
          return store
        },
        doormanUrl: doorman.url,
        openDoorman: () => doorman,
        debounceMs: 5,
        signInPollMs: 1,
        now,
      })
      extras.push(service)
      return service
    }

    const signIn = async (service: CloudSyncService): Promise<void> => {
      service.beginSignIn(ATTEMPT)
      await service.whenSignedIn()
      await service.whenIdle()
    }

    it('asks for the code Google’s sign-in ended with, and claims the session with it', async () => {
      const doorman = new FakeDoorman()
      const service = withDoorman(doorman)

      service.beginSignIn(ATTEMPT)
      doorman.finish(ATTEMPT, 'session-1', STORAGE, '4F7K2QXM')
      for (let tries = 0; tries < 100 && !service.status().signInNeedsCode; tries++) {
        await new Promise(resolve => setTimeout(resolve, 2))
      }
      // Starting the attempt was not enough: without the code, no session.
      expect(service.status()).toMatchObject({
        signingIn: true,
        signInNeedsCode: true,
        account: null,
      })

      await service.enterSignInCode('4F7K2QXM')
      await service.whenIdle()
      expect(service.status()).toMatchObject({
        signingIn: false,
        signInNeedsCode: false,
        account: { email: 'me@example.com' },
        connected: true,
      })
    })

    it('ends the sign-in on a wrong code, and says so', async () => {
      const doorman = new FakeDoorman()
      const service = withDoorman(doorman)

      service.beginSignIn(ATTEMPT)
      doorman.finish(ATTEMPT, 'session-1', STORAGE, '4F7K2QXM')
      for (let tries = 0; tries < 100 && !service.status().signInNeedsCode; tries++) {
        await new Promise(resolve => setTimeout(resolve, 2))
      }
      await expect(service.enterSignInCode('AAAAAAAA')).rejects.toThrow(/isn’t the code/)
      expect(service.status()).toMatchObject({ signingIn: false, account: null, connected: false })
      // And the right code afterwards finds nothing to claim.
      await expect(service.enterSignInCode('4F7K2QXM')).rejects.toThrow(/Start it again/)
    })

    it('waits for Google, then publishes to the bucket that belongs to the account', async () => {
      addSong('A - One', 'one')
      const doorman = new FakeDoorman()
      const service = withDoorman(doorman)

      service.beginSignIn(ATTEMPT)
      expect(service.status()).toMatchObject({ signingIn: true, account: null })
      doorman.finish(ATTEMPT, 'session-1', STORAGE)
      await service.whenSignedIn()
      await service.whenIdle()

      expect(service.status()).toMatchObject({
        doormanUrl: 'https://doorman.test',
        signingIn: false,
        account: { email: 'me@example.com' },
        connected: true,
        target: { bucket: CONNECT.bucket, prefix: 'selfmp3' },
        songs: { total: 1, inCloud: 1 },
      })
      expect(latest().songs).toHaveLength(1)
      // The session is kept for the next start, never a bucket key.
      expect(cloud.doormanSession()).toMatchObject({ token: 'session-1', email: 'me@example.com' })
      expect(cloud.connection()).toBeNull()
    })

    it('asks a new account to connect its bucket, then publishes to it', async () => {
      addSong('A - One', 'one')
      const doorman = new FakeDoorman()
      const service = withDoorman(doorman)
      doorman.finish(ATTEMPT, 'session-1')
      await signIn(service)
      expect(service.status()).toMatchObject({
        account: { email: 'me@example.com' },
        connected: false,
      })

      await service.connectStorage(CONNECT)
      await service.whenIdle()
      expect(service.status()).toMatchObject({ connected: true, songs: { inCloud: 1 } })
      expect(latest().songs).toHaveLength(1)
    })

    it('carries on after a restart with the account it was signed in to', async () => {
      addSong('A - One', 'one')
      const doorman = new FakeDoorman()
      doorman.finish(ATTEMPT, 'session-1', STORAGE)
      await signIn(withDoorman(doorman))
      const puts = bucket.puts.length

      const again = withDoorman(doorman)
      again.start()
      await again.whenIdle()
      expect(again.status()).toMatchObject({
        connected: true,
        account: { email: 'me@example.com' },
      })
      // Nothing is sent twice: the bookkeeping belongs to the same bucket.
      expect(bucket.puts.slice(puts).filter(key => key.startsWith('audio/'))).toEqual([])
    })

    it('uploads everything again when the account’s bucket has changed', async () => {
      addSong('A - One', 'one')
      const doorman = new FakeDoorman()
      doorman.finish(ATTEMPT, 'session-1', STORAGE)
      await signIn(withDoorman(doorman))

      // Swapped for another bucket from another device.
      doorman.accounts.set('session-1', {
        email: 'me@example.com',
        name: 'Me',
        picture: null,
        storage: { ...STORAGE, bucket: 'new-bucket' },
      })
      const again = withDoorman(doorman)
      again.start()
      await new Promise(resolve => setTimeout(resolve, 20))
      await again.whenIdle()
      expect(buckets.get('new-bucket')?.keys('audio/')).toEqual([`audio/${sha('one')}.m4a`])
    })

    it('says so when the doorman no longer knows the session', async () => {
      const doorman = new FakeDoorman()
      doorman.finish(ATTEMPT, 'session-1', STORAGE)
      await signIn(withDoorman(doorman))

      doorman.meFailure = new CloudError('auth', 'Your Google sign-in has expired.')
      const again = withDoorman(doorman)
      again.start()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(again.status()).toMatchObject({ state: 'error', lastError: /expired/ })
    })

    it('stops publishing, rather than retrying, when the session is refused mid-way', async () => {
      addSong('A - One', 'one')
      const doorman = new FakeDoorman()
      doorman.finish(ATTEMPT, 'session-1', STORAGE)
      const service = withDoorman(doorman)
      await signIn(service)

      bucket.failure = new CloudError('auth', 'Your Google sign-in has expired.')
      addSong('B - Two', 'two')
      await service.syncNow()
      await service.whenIdle()
      expect(service.status()).toMatchObject({
        connected: false,
        state: 'error',
        account: { email: 'me@example.com' },
        lastError: 'Your Google sign-in has expired.',
      })
    })

    it('gives up waiting after ten minutes', async () => {
      let time = Date.parse('2026-09-11T10:00:00Z')
      const service = withDoorman(new FakeDoorman(), () => new Date(time))
      service.beginSignIn(ATTEMPT)
      time += 11 * 60_000
      await service.whenSignedIn()
      expect(service.status()).toMatchObject({ signingIn: false, account: null })
    })

    it('signs out when disconnected, and forgets the session', async () => {
      const doorman = new FakeDoorman()
      doorman.finish(ATTEMPT, 'session-1', STORAGE)
      const service = withDoorman(doorman)
      await signIn(service)

      service.disconnect()
      expect(doorman.signedOut).toEqual(['session-1'])
      expect(service.status()).toMatchObject({ account: null, connected: false, state: 'off' })
      expect(cloud.doormanSession()).toBeNull()
    })

    it('lets a direct connection replace the sign-in', async () => {
      const doorman = new FakeDoorman()
      doorman.finish(ATTEMPT, 'session-1', STORAGE)
      const service = withDoorman(doorman)
      await signIn(service)

      await service.connect({ ...CONNECT, bucket: 'direct-bucket' })
      await service.whenIdle()
      expect(service.status()).toMatchObject({ account: null, target: { bucket: 'direct-bucket' } })
      expect(cloud.doormanSession()).toBeNull()
    })

    it('refuses to sign in with no doorman set up', () => {
      expect(() => sync.beginSignIn(ATTEMPT)).toThrow(/No doorman/)
      expect(sync.status().doormanUrl).toBeNull()
    })
  })
})

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CloudSnapshotSchema,
  newestSnapshotKey,
  snapshotKey,
  parseEndpoint,
  type CloudConnect,
  type CloudSnapshot,
  type DoormanClaimResult,
  type DoormanMe,
} from '@selfmp3/shared'
import type { Config } from '../config.js'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { CloudError, type CloudStore } from '../cloud/store.js'
import { MemoryCloudStore } from '../cloud/memoryStore.js'
import { CloudRepository } from '../repositories/cloud.js'
import { ImportRepository } from '../repositories/imports.js'
import { PlaylistRepository } from '../repositories/playlists.js'
import { SongRepository } from '../repositories/songs.js'
import { TagRepository } from '../repositories/tags.js'
import { LocalStorageDriver } from '../storage/local.js'
import { CloudSyncService, type Doorman } from './cloudSync.js'
import { CoverService } from './covers.js'
import { LyricsService } from './lyrics.js'
import { MetadataService } from './metadata.js'

/**
 * Publishing to the bucket, against a real library folder, a database built
 * from the real migrations, and a bucket in memory. What matters: every file
 * goes up once, under its hash; a snapshot says what is up there and nothing
 * that is not; and a Mac that loses the connection picks up where it left off.
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
    const storage = new LocalStorageDriver(root)
    covers = new CoverService({ dataDir } as Config, songs, logger)

    // One bucket per name, so a test can point the Mac somewhere else.
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
      await service.whenIdle()
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
      expect(sync.status().songs).toEqual({ total: 1, inCloud: 1 })
    })

    it('lets a song go once it is forgotten for good', async () => {
      const id = addSong('A - One', 'one')
      addSong('B - Two', 'two')
      await connect()

      songs.delete(id)
      await pass()
      expect(latest().songs.map(song => song.title)).toEqual(['Two'])
    })

    it('carries playlists by uid, in order, smart ones with their rules and their songs', async () => {
      const one = addSong('A - One', 'one')
      const two = addSong('B - Two', 'two')
      const chill = tags.create('chill')
      tags.addToSong(two, chill.id)

      const mix = playlists.create({ name: 'Mix', description: '', kind: 'manual', rules: null })
      playlists.add(mix.id, [two, one])
      playlists.create({
        name: 'Chill',
        description: '',
        kind: 'smart',
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
      const smart = snapshot.playlists.find(p => p.name === 'Chill')
      expect(manual?.songUids).toEqual([uidOf(two), uidOf(one)])
      expect(manual?.rules).toBeNull()
      expect(smart?.rules?.rules).toEqual([{ field: 'tag', op: 'has', tagUid }])
      expect(smart?.songUids).toEqual([uidOf(two)])
    })

    it('keeps its three newest snapshots, and never touches another device’s', async () => {
      const id = addSong('A - One', 'one')
      const theirs = snapshotKey(new Date('2026-01-01T00:00:00Z'), 'iphone-0b7d44a1')
      bucket.objects.set(theirs, { body: Buffer.from('{}'), contentType: 'application/json' })
      await connect()

      for (const loved of [true, false, true, false, true]) {
        songs.patch(id, { loved })
        await pass()
      }

      const keys = snapshotKeys()
      expect(keys).toContain(theirs)
      expect(keys.filter(key => key !== theirs)).toHaveLength(3)
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
     * The doorman as the Mac sees it: Google "finishes" a sign-in when a test
     * says so, each session belongs to an account, and an account's bucket is
     * one of the memory buckets above, by name.
     */
    class FakeDoorman implements Doorman {
      readonly url = 'https://doorman.test'
      /** attempt → the session Google's sign-in produced, once it has. */
      readonly finished = new Map<string, string>()
      readonly accounts = new Map<string, DoormanMe>()
      readonly signedOut: string[] = []
      meFailure: CloudError | null = null

      finish(attempt: string, token: string, storage: DoormanMe['storage'] = null): void {
        this.accounts.set(token, { email: 'me@example.com', name: 'Me', picture: null, storage })
        this.finished.set(attempt, token)
      }

      claim(attempt: string): Promise<DoormanClaimResult> {
        const token = this.finished.get(attempt)
        const me = token ? this.accounts.get(token) : undefined
        if (!token || !me) return Promise.resolve({ status: 'pending' })
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

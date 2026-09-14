import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyChanges,
  formatHlc,
  syncLibrary,
  type Change,
  type ImportPreview,
} from '@selfmp3/shared'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { ImportRequestRepository } from '../repositories/importRequests.js'
import { ImportRepository } from '../repositories/imports.js'
import { PlaylistRepository } from '../repositories/playlists.js'
import { SongRepository } from '../repositories/songs.js'
import { StatsRepository } from '../repositories/stats.js'
import { SyncRepository } from '../repositories/sync.js'
import { TagRepository } from '../repositories/tags.js'
import { CloudImportService } from './cloudImports.js'
import { CloudIngest } from './cloudIngest.js'
import { SyncClock } from './localEdits.js'

/**
 * A link pasted on a phone, imported by the server (docs/SYNC.md). What matters:
 * the request is recorded once, the link's songs are queued with the tags and
 * playlist asked for, a request is called off cleanly, and how it went ends up
 * where every device reads it — settled for good once its songs are done.
 */

const BASE = Date.parse('2026-09-01T10:00:00Z')
const at = (seconds: number, device = 'iphone-0b7d44a1'): string =>
  formatHlc({ ms: BASE + seconds * 1000, counter: 0, device })
const REQUEST = 'e1'.repeat(16)

const single = (title: string, alreadyHave = false): ImportPreview => ({
  kind: 'single',
  playlistTitle: null,
  items: [
    {
      url: `https://youtube.com/watch?v=${title}`,
      title,
      artist: 'Aurora',
      album: '',
      duration: 200,
      thumbnail: null,
      alreadyHave,
    },
  ],
})

describe('links other devices ask to import', () => {
  let db: Database.Database
  let requests: ImportRequestRepository
  let imports: ImportRepository
  let songs: SongRepository
  let tags: TagRepository
  let playlists: PlaylistRepository
  let sync: SyncRepository
  let ingest: CloudIngest
  let resolve: (url: string) => Promise<ImportPreview>
  let kicked: number
  let changed: number
  let service: CloudImportService

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    const logger = createLogger('silent')
    migrate(db, logger)
    requests = new ImportRequestRepository(db)
    imports = new ImportRepository(db)
    songs = new SongRepository(db)
    tags = new TagRepository(db)
    playlists = new PlaylistRepository(db)
    sync = new SyncRepository(db)
    ingest = new CloudIngest({
      db,
      songs,
      tags,
      playlists,
      stats: new StatsRepository(db),
      sync,
      requests,
      clock: new SyncClock({ deviceId: () => 'mac-aaaa1111', latest: () => null, now: () => BASE }),
      logger,
    })
    resolve = () => Promise.resolve(single('Sunrise'))
    kicked = 0
    changed = 0
    service = new CloudImportService({
      requests,
      imports,
      sync,
      resolve: url => resolve(url),
      kickQueue: () => kicked++,
      changed: () => changed++,
      logger,
    })
  })

  afterEach(() => db.close())

  const ask = (overrides: Partial<Extract<Change, { type: 'importRequested' }>> = {}): Change => ({
    type: 'importRequested',
    hlc: at(1),
    uid: REQUEST,
    url: 'https://music.youtube.com/watch?v=abc',
    tagUids: [],
    playlistUid: null,
    ...overrides,
  })

  const jobsOf = (uid: string) =>
    db
      .prepare<
        [string],
        { id: string; status: string; tag_ids: string; playlist_id: number | null }
      >('SELECT id, status, tag_ids, playlist_id FROM import_jobs WHERE request_uid = ?')
      .all(uid)

  it('records a request once, saying who asked and when', () => {
    expect(ingest.apply([ask(), ask({ hlc: at(9) })]).requested).toBe(1)
    expect(requests.byUid(REQUEST)).toMatchObject({
      url: 'https://music.youtube.com/watch?v=abc',
      requestedBy: 'iphone-0b7d44a1',
      requestedAt: '2026-09-01 10:00:01',
      state: 'waiting',
    })
  })

  it('still looks after a first look found nothing to do', async () => {
    // As at startup: nothing waiting yet.
    await service.process()
    ingest.apply([ask()])
    await service.process()
    expect(requests.byUid(REQUEST)?.state).toBe('working')
  })

  it('looks again for a request that arrived during a run', async () => {
    let answer: (preview: ImportPreview) => void = () => undefined
    resolve = () => new Promise(resolvePreview => (answer = resolvePreview))
    ingest.apply([ask()])
    const first = service.process()
    const second = 'e2'.repeat(16)
    ingest.apply([ask({ uid: second, hlc: at(2) })])
    const joined = service.process()
    // In place before the first run is let go: the second follows it at once.
    resolve = () => Promise.resolve(single('Sunset'))
    answer(single('Sunrise'))
    await first
    await joined
    for (let tries = 0; tries < 50 && requests.byUid(second)?.state === 'waiting'; tries++) {
      await new Promise(done => setTimeout(done, 2))
    }
    expect(requests.byUid(second)?.state).toBe('working')
  })

  it('queues the link’s songs with the tags and playlist asked for', async () => {
    const chill = tags.create('chill')
    const mix = playlists.create({ name: 'Mix', description: '', kind: 'manual', rules: null })
    const tagUid = sync.uids('tags', [chill.id]).get(chill.id) ?? ''
    const playlistUid = sync.uids('playlists', [mix.id]).get(mix.id) ?? ''
    ingest.apply([ask({ tagUids: [tagUid], playlistUid })])

    await service.process()

    expect(requests.byUid(REQUEST)).toMatchObject({ state: 'working', title: 'Sunrise' })
    const [job] = jobsOf(REQUEST)
    expect(job).toMatchObject({ status: 'queued', playlist_id: mix.id })
    expect(JSON.parse(job?.tag_ids ?? '[]')).toEqual([chill.id])
    expect({ kicked, changed }).toEqual({ kicked: 1, changed: 1 })
  })

  it('says why when the link cannot be looked up', async () => {
    resolve = () => Promise.reject(new Error('yt-dlp is not installed'))
    ingest.apply([ask()])
    await service.process()
    expect(requests.byUid(REQUEST)).toMatchObject({
      state: 'failed',
      error: 'yt-dlp is not installed',
    })
    expect(jobsOf(REQUEST)).toEqual([])
  })

  it('is done at once when the library already has everything at the link', async () => {
    resolve = () => Promise.resolve(single('Sunrise', true))
    ingest.apply([ask()])
    await service.process()
    expect(requests.byUid(REQUEST)).toMatchObject({ state: 'done', songUids: [], error: null })
  })

  it('queues nothing for a request called off while its link was looked up', async () => {
    let answer: (preview: ImportPreview) => void = () => undefined
    resolve = () => new Promise(resolvePreview => (answer = resolvePreview))
    ingest.apply([ask()])
    const running = service.process()
    ingest.apply([{ type: 'importCancelled', hlc: at(2), uid: REQUEST }])
    answer(single('Sunrise'))
    await running
    expect(requests.byUid(REQUEST)?.state).toBe('cancelled')
    expect(jobsOf(REQUEST)).toEqual([])
  })

  it('settles once its songs are all done, keeping which songs they were', async () => {
    ingest.apply([ask()])
    await service.process()
    const [job] = jobsOf(REQUEST)
    const songId = songs.insert({
      path: 'Sunrise.m4a',
      title: 'Sunrise',
      artist: 'Aurora',
      album: '',
      albumArtist: '',
      trackNo: null,
      year: null,
      duration: 200,
      sizeBytes: 1,
      mime: 'audio/mp4',
      mtimeMs: 1,
      hasArt: false,
      artExt: null,
      lyricsKind: 'none',
      sourceUrl: null,
    })

    imports.update(job?.id ?? '', { status: 'running', step: 'downloading' })
    expect(requests.settle()).toBe(0)
    imports.update(job?.id ?? '', { status: 'done', step: 'finished', songId })
    expect(requests.settle()).toBe(1)
    const songUid = sync.uids('songs', [songId]).get(songId)
    expect(requests.byUid(REQUEST)).toMatchObject({ state: 'done', songUids: [songUid] })

    // Clearing the finished job from the queue does not lose it.
    imports.clearFinished()
    requests.settle()
    expect(requests.byUid(REQUEST)?.songUids).toEqual([songUid])
  })

  it('fails with the job’s own reason when none of its songs could be imported', async () => {
    ingest.apply([ask()])
    await service.process()
    const [job] = jobsOf(REQUEST)
    imports.update(job?.id ?? '', { status: 'error', step: 'finished', error: 'Video unavailable' })
    requests.settle()
    expect(requests.byUid(REQUEST)).toMatchObject({ state: 'failed', error: 'Video unavailable' })
  })

  it('calls off the songs still waiting when a request being worked on is cancelled', async () => {
    ingest.apply([ask()])
    await service.process()
    ingest.apply([{ type: 'importCancelled', hlc: at(3), uid: REQUEST }])
    expect(requests.byUid(REQUEST)?.state).toBe('cancelled')
    expect(jobsOf(REQUEST).map(job => job.status)).toEqual(['cancelled'])
  })

  it('says what a phone replaying the same changes would, until the server gets to it', () => {
    const changes: Change[] = [ask(), { type: 'importCancelled', hlc: at(4), uid: 'f2'.repeat(16) }]
    ingest.apply(changes)
    const phone = syncLibrary(null)
    applyChanges(phone, changes)
    const [mine] = requests.recent(100_000)
    expect(mine).toMatchObject({ ...phone.imports.get(REQUEST) })
  })
})

import path from 'node:path'
import Database from 'better-sqlite3'
import { API_ERROR } from '@selfmp3/shared'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Container } from '../container.js'
import { startLibrary, type TestLibrary } from '../fixtures/library.js'
import { newSong } from '../fixtures/songs.js'

/**
 * The server under a database that will not take a write — the disk full, a
 * lock held from outside — and under many reads of the whole library, through
 * the real app and a real database (bug bash round 3: R3-M9, R3-m7, R3-m6).
 */
describe('a database in trouble', () => {
  let library: TestLibrary
  let container: Container

  beforeAll(async () => {
    library = await startLibrary()
    container = library.container
  })

  afterAll(() => library.close())

  const send = (method: string, url: string, body?: unknown) => library.send(method, url, body)

  let files = 0
  const insert = (title: string) =>
    container.songs.insert(newSong({ title, path: `${title}-${++files}.m4a`, duration: 200 }))

  it('says a full disk as that, and goes on answering', async () => {
    // The database may grow no further: as a full disk leaves it.
    const pages = container.db.pragma('page_count', { simple: true }) as number
    container.db.pragma(`max_page_count = ${pages}`)
    try {
      let refused: Response | null = null
      for (let n = 0; n < 2000 && !refused; n++) {
        const response = await send('POST', '/api/tags', { name: `full ${n} ${'x'.repeat(20)}` })
        if (!response.ok) refused = response
      }
      expect(refused?.status).toBe(507)
      expect(await refused?.json()).toEqual({
        error: 'the server’s disk is full',
        code: API_ERROR.diskFull,
      })
      expect((await send('GET', '/api/health')).status).toBe(200)
      expect((await send('GET', '/api/library')).status).toBe(200)
    } finally {
      container.db.pragma('max_page_count = 4294967294')
    }
    expect((await send('POST', '/api/tags', { name: 'room again' })).status).toBe(200)
  })

  it('refuses a write a moment into a lock held elsewhere, as busy, not after seconds', async () => {
    const other = new Database(path.join(container.config.dataDir, 'selfmp3.db'))
    other.exec('BEGIN EXCLUSIVE')
    try {
      const started = Date.now()
      const response = await send('POST', '/api/tags', { name: 'while held' })
      expect(Date.now() - started).toBeLessThan(2_000)
      expect(response.status).toBe(503)
      expect(response.headers.get('retry-after')).toBe('2')
      expect(((await response.json()) as { code: string }).code).toBe(API_ERROR.databaseBusy)
      // Reads go on: the log lets them past the writer.
      expect((await send('GET', '/api/health')).status).toBe(200)
    } finally {
      other.exec('ROLLBACK')
      other.close()
    }
    expect((await send('POST', '/api/tags', { name: 'while held' })).status).toBe(200)
  })

  it('builds the library once while nothing changes, and again for any write, or a minute a live playlist counts', async () => {
    const id = insert('Kept')
    const reads = vi.spyOn(container.songs, 'all')
    let now = Date.parse('2026-10-25T12:00:10Z')
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const first = await (await send('GET', '/api/library')).text()
      const second = await (await send('GET', '/api/library')).text()
      expect(second).toBe(first)
      expect(reads).toHaveBeenCalledTimes(1)

      // A write that moves no version is still in the next answer.
      container.db.prepare('UPDATE songs SET title = ? WHERE id = ?').run('Changed', id)
      const after = JSON.parse(await (await send('GET', '/api/library')).text()) as {
        songs: Array<{ id: number; title: string }>
      }
      expect(after.songs.find(song => song.id === id)?.title).toBe('Changed')
      expect(reads).toHaveBeenCalledTimes(2)

      // A minute is nothing while no live playlist counts days.
      now += 60_000
      await send('GET', '/api/library')
      expect(reads).toHaveBeenCalledTimes(2)

      // One of what was played in the last week moves with the clock alone.
      container.playlists.create({
        name: 'This week',
        description: '',
        kind: 'live',
        rules: {
          match: 'all',
          rules: [{ field: 'lastPlayedAt', op: 'inLastDays', days: 7 }],
          orderBy: 'addedAt',
          order: 'desc',
          limit: null,
        },
      })
      await send('GET', '/api/library')
      expect(reads).toHaveBeenCalledTimes(3)
      await send('GET', '/api/library')
      expect(reads).toHaveBeenCalledTimes(3)
      now += 60_000
      await send('GET', '/api/library')
      expect(reads).toHaveBeenCalledTimes(4)
    } finally {
      reads.mockRestore()
      clock.mockRestore()
    }
  })

  it('keeps the library it built while a device only says it is still there', async () => {
    const id = insert('Heard')
    const reads = vi.spyOn(container.songs, 'all')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-25T12:00:10Z'))
    const heartbeat = {
      deviceId: 'phone-00001',
      name: 'Phone',
      kind: 'phone',
      state: {
        songId: null,
        position: 0,
        playing: false,
        queueIds: [],
        queueIndex: -1,
        shuffle: false,
        repeat: 'off',
        updatedAt: 0,
      },
    }
    try {
      const first = await (await send('GET', '/api/library')).text()
      expect((await send('POST', '/api/devices/heartbeat', heartbeat)).status).toBe(200)
      expect(await (await send('GET', '/api/library')).text()).toBe(first)
      expect(reads).toHaveBeenCalledTimes(1)

      // A write from outside the server, which no trigger of its own sees.
      const other = new Database(path.join(container.config.dataDir, 'selfmp3.db'))
      other.prepare('UPDATE songs SET title = ? WHERE id = ?').run('From a shell', id)
      other.close()
      const after = JSON.parse(await (await send('GET', '/api/library')).text()) as {
        songs: Array<{ id: number; title: string }>
      }
      expect(after.songs.find(song => song.id === id)?.title).toBe('From a shell')
      expect(reads).toHaveBeenCalledTimes(2)
    } finally {
      reads.mockRestore()
      clock.mockRestore()
    }
  })
})

import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { API_ERROR } from '@selfmp3/shared'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { createContainer, type Container } from '../container.js'

/**
 * The server under a database that will not take a write — the disk full, a
 * lock held from outside — and under many reads of the whole library, through
 * the real app and a real database (bug bash round 3: R3-M9, R3-m7, R3-m6).
 */
describe('a database in trouble', () => {
  const variables = [
    'SELFMP3_DATA_DIR',
    'SELFMP3_LIBRARY_DIR',
    'SELFMP3_LOG_LEVEL',
    'SELFMP3_CLOUD_DIR',
  ] as const
  const saved = new Map<string, string | undefined>()
  let root = ''
  let container: Container
  let server: http.Server
  let origin = ''

  beforeAll(async () => {
    for (const name of variables) saved.set(name, process.env[name])
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-trouble-'))
    process.env['SELFMP3_DATA_DIR'] = path.join(root, 'data')
    process.env['SELFMP3_LIBRARY_DIR'] = path.join(root, 'library')
    process.env['SELFMP3_LOG_LEVEL'] = 'silent'
    // The API answers nothing without a bucket; a folder stands in for one.
    process.env['SELFMP3_CLOUD_DIR'] = 'bucket'
    container = createContainer(loadConfig())
    server = http.createServer(createApp(container))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    container.close()
    fs.rmSync(root, { recursive: true, force: true })
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  const send = (method: string, url: string, body?: unknown) =>
    fetch(`${origin}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${container.config.authToken ?? ''}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  let files = 0
  const insert = (title: string) =>
    container.songs.insert({
      path: `${title}-${++files}.m4a`,
      title,
      artist: '',
      album: '',
      albumArtist: '',
      trackNo: null,
      year: null,
      duration: 200,
      sizeBytes: 1,
      mime: 'audio/mp4',
      mtimeMs: 0,
      hasArt: false,
      artExt: null,
      lyricsKind: 'none',
      sourceUrl: null,
    })

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

  it('builds the library once while nothing changes, and again for any write or minute', async () => {
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

      // A live playlist of the last week moves with the clock alone.
      now += 60_000
      await send('GET', '/api/library')
      expect(reads).toHaveBeenCalledTimes(3)
    } finally {
      reads.mockRestore()
      clock.mockRestore()
    }
  })
})

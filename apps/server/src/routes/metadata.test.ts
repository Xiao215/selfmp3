import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Library } from '@selfmp3/shared'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { createContainer, type Container } from '../container.js'

/**
 * A cover Tidy up filled in is taken off again by its Undo
 * (docs/features/ai.md, "Filling in what's missing"): through the real route
 * and a real database, the song is left with no cover, as it was before.
 */
describe('DELETE /api/songs/:id/cover', () => {
  const variables = [
    'SELFMP3_DATA_DIR',
    'SELFMP3_LIBRARY_DIR',
    'SELFMP3_LOG_LEVEL',
    'SELFMP3_CLOUD_DIR',
  ] as const
  const saved = new Map<string, string | undefined>()
  let root = ''
  let token = ''
  let container: Container
  let server: http.Server
  let origin = ''
  let songId = 0

  beforeAll(async () => {
    for (const name of variables) saved.set(name, process.env[name])
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-cover-'))
    process.env['SELFMP3_DATA_DIR'] = path.join(root, 'data')
    process.env['SELFMP3_LIBRARY_DIR'] = path.join(root, 'library')
    process.env['SELFMP3_LOG_LEVEL'] = 'silent'
    // The API answers nothing without a bucket; a folder stands in for one.
    process.env['SELFMP3_CLOUD_DIR'] = 'bucket'

    container = createContainer(loadConfig())
    token = container.config.authToken ?? ''
    songId = container.songs.insert({
      path: 'a.m4a',
      title: '夜に駆ける',
      artist: 'YOASOBI',
      album: '',
      albumArtist: '',
      trackNo: null,
      year: null,
      duration: 1,
      sizeBytes: 1,
      mime: 'audio/mp4',
      mtimeMs: 0,
      hasArt: false,
      artExt: null,
      lyricsKind: 'none',
      sourceUrl: null,
    })

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

  const ask = (method: string, at: string): Promise<Response> =>
    fetch(`${origin}${at}`, { method, headers: { Authorization: `Bearer ${token}` } })
  const song = async () => {
    const library = (await (await ask('GET', '/api/library')).json()) as Library
    return library.songs.find(each => each.id === songId)
  }

  it('leaves the song with no cover, as before it was filled in', async () => {
    // The cover a fill took in, as apply-metadata keeps it.
    await container.covers.save(songId, Buffer.alloc(2048, 7), '.jpg')
    expect((await song())?.hasArt).toBe(true)
    expect((await ask('GET', `/api/art/${songId}`)).status).toBe(200)
    const before = container.libraryVersion()

    const answer = await ask('DELETE', `/api/songs/${songId}/cover`)
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ ok: true })

    expect((await song())?.hasArt).toBe(false)
    expect(await container.covers.find(songId)).toBeNull()
    expect((await ask('GET', `/api/art/${songId}`)).status).toBe(404)
    // Devices asking whether anything changed are told it did.
    expect(container.libraryVersion()).not.toBe(before)
  })

  it('says so for a song that is not there', async () => {
    expect((await ask('DELETE', '/api/songs/9999/cover')).status).toBe(404)
  })
})

import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { createContainer, type Container } from '../container.js'

/** The playlist routes through the real app and a real database. */
describe('playlist routes', () => {
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
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-playlists-'))
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

  const send = (method: string, url: string, body?: unknown) =>
    fetch(`${origin}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${container.config.authToken ?? ''}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  it('answers every playlist’s songs in one request, live ones resolved', async () => {
    const one = insert('One')
    const two = insert('Two')
    container.songs.patch(two, { loved: true })
    const mix = container.playlists.create({
      name: 'Mix',
      description: '',
      kind: 'manual',
      rules: null,
    }).id
    container.playlists.add(mix, [two, one])
    const loved = container.playlists.create({
      name: 'Loved',
      description: '',
      kind: 'live',
      rules: {
        match: 'all',
        rules: [{ field: 'loved', op: 'is', value: true }],
        orderBy: 'title',
        order: 'asc',
        limit: null,
      },
    }).id

    const response = await send('GET', '/api/playlists/songs')

    expect(response.status).toBe(200)
    const { playlists } = (await response.json()) as {
      playlists: { playlistId: number; songIds: number[] }[]
    }
    expect(playlists).toEqual(
      expect.arrayContaining([
        { playlistId: mix, songIds: [two, one] },
        { playlistId: loved, songIds: [two] },
      ]),
    )
    expect(playlists).toHaveLength(2)
  })
})

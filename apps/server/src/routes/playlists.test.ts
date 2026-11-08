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

  // The rule lived only in the app, which deleted the playlist outright once
  // its removal was sent: an Undo in Ask then had nothing to put the songs
  // back in, and a song another device added meanwhile was lost (R7H-1).
  it('lets a kept playlist go with its last songs, and has it back when a song goes in', async () => {
    const one = insert('One')
    const two = insert('Two')
    const road = container.playlists.create({
      name: 'Road',
      description: 'for the car',
      kind: 'manual',
      rules: null,
    }).id
    container.playlists.add(road, [one, two])

    const first = await send('POST', `/api/playlists/${road}/songs/remove`, { songIds: [one] })
    expect(((await first.json()) as { playlist: unknown }).playlist).not.toBeNull()
    const last = await send('POST', `/api/playlists/${road}/songs/remove`, { songIds: [two] })
    expect(await last.json()).toEqual({ removed: 1, playlist: null })
    expect(container.playlists.byId(road)).toBeNull()

    // The Undo: the songs go back in, under the id it had, and in the order it had.
    const back = await send('POST', `/api/playlists/${road}/songs`, { songIds: [one, two] })
    expect(back.status).toBe(200)
    expect(await back.json()).toMatchObject({ id: road, name: 'Road', description: 'for the car' })
    expect(container.playlists.songIds({ id: road, kind: 'manual', rules: null })).toEqual([
      one,
      two,
    ])
    expect(container.playlists.allEmptied()).toEqual([])
  })

  // Undoing Ask's add to a playlist that had no songs deleted the playlist.
  it('keeps a playlist the Undo of an add leaves empty', async () => {
    const one = insert('One')
    const road = container.playlists.create({
      name: 'Road',
      description: '',
      kind: 'manual',
      rules: null,
    }).id
    await send('POST', `/api/playlists/${road}/songs`, { songIds: [one] })
    const undo = await send('POST', `/api/playlists/${road}/songs/remove`, {
      songIds: [one],
      keep: true,
    })
    expect(await undo.json()).toMatchObject({ removed: 1, playlist: { id: road, name: 'Road' } })
    expect(container.playlists.byId(road)).not.toBeNull()
    expect(container.playlists.allEmptied()).toEqual([])
  })
})

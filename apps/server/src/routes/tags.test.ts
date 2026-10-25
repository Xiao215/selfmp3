import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { createContainer, type Container } from '../container.js'

/** The tag routes through the real app and a real database. */
describe('tag routes', () => {
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
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-tags-'))
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

  it('tags the songs still there when one in the selection was removed meanwhile', async () => {
    const one = insert('One')
    const two = insert('Two')
    const gone = insert('Gone')
    container.songs.delete(gone)
    const tag = container.tags.create('bulk').id

    const response = await send('POST', '/api/tags/bulk', {
      tagId: tag,
      songIds: [gone, one, two],
      action: 'add',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ affected: 2 })
    expect(container.songs.byId(one)?.tagIds).toEqual([tag])
  })

  it('leaves a playlist that filled from a deleted tag with its songs', async () => {
    const song = insert('Followed')
    const tag = container.tags.create('followed').id
    container.tags.addToSong(song, tag)
    const playlist = container.playlists.create({
      name: 'Follows',
      description: '',
      kind: 'live',
      rules: {
        match: 'all',
        rules: [{ field: 'tag', op: 'has', tagId: tag }],
        orderBy: 'title',
        order: 'asc',
        limit: null,
      },
    }).id

    expect((await send('DELETE', `/api/tags/${tag}`)).status).toBe(200)

    const after = container.playlists.byId(playlist)!
    expect(after).toMatchObject({ kind: 'manual', songCount: 1 })
    expect(container.playlists.songIds(after)).toEqual([song])
  })
})

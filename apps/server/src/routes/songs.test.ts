import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SimilarSongs } from '@selfmp3/shared'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { createContainer, type Container } from '../container.js'

/**
 * The similar-songs answer keeps the library it read until the library changes,
 * through the real routes and a real database. A play is the change that does
 * not move the library version, and the answer carries play counts, so a play
 * must read it again all the same.
 */
describe('GET /api/songs/:id/similar', () => {
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

  beforeAll(async () => {
    for (const name of variables) saved.set(name, process.env[name])
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-similar-'))
    process.env['SELFMP3_DATA_DIR'] = path.join(root, 'data')
    process.env['SELFMP3_LIBRARY_DIR'] = path.join(root, 'library')
    process.env['SELFMP3_LOG_LEVEL'] = 'silent'
    // The API answers nothing without a bucket; a folder stands in for one.
    process.env['SELFMP3_CLOUD_DIR'] = 'bucket'

    container = createContainer(loadConfig())
    token = container.config.authToken ?? ''
    for (const name of ['a', 'b', 'c']) {
      container.songs.insert({
        path: `${name}.m4a`,
        title: name,
        artist: '',
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
    }

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

  const similar = async (id: number): Promise<SimilarSongs> => {
    const response = await fetch(`${origin}/api/songs/${id}/similar`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    return (await response.json()) as SimilarSongs
  }

  const play = async (id: number): Promise<void> => {
    const response = await fetch(`${origin}/api/songs/${id}/played`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msPlayed: 60_000, completed: true }),
    })
    expect(response.status).toBe(200)
  }

  const playsOf = (answer: SimilarSongs, id: number): number | undefined =>
    answer.songs.find(song => song.id === id)?.playCount

  it('reads the library once while nothing changes', async () => {
    const all = vi.spyOn(container.songs, 'all')
    try {
      const version = container.libraryVersion()
      await similar(1)
      await similar(1)
      await similar(3)
      expect(container.libraryVersion()).toBe(version)
      expect(all).toHaveBeenCalledTimes(1)
    } finally {
      all.mockRestore()
    }
  })

  it('answers with the new play count after a play, though the version stays put', async () => {
    expect(playsOf(await similar(1), 2)).toBe(0)
    const version = container.libraryVersion()

    await play(2)

    expect(container.libraryVersion()).toBe(version)
    expect(playsOf(await similar(1), 2)).toBe(1)
  })

  it('reads it again after an edit moves the version', async () => {
    await similar(1)
    const response = await fetch(`${origin}/api/songs/2/loved`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ loved: true }),
    })
    expect(response.status).toBe(200)
    expect((await similar(1)).songs.find(song => song.id === 2)?.loved).toBe(true)
  })
})

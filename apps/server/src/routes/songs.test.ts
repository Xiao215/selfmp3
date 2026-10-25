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
    // Timed by the stamp on the edit, so Liked can put it first.
    expect(((await response.json()) as { lovedAt: string | null }).lovedAt).toMatch(
      /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/,
    )
    expect((await similar(1)).songs.find(song => song.id === 2)?.loved).toBe(true)
  })
})

/**
 * A song held twice, folded into the copy kept when the server is asked
 * itself (a device talking to it directly): the copy's tags, love, playlist
 * places and plays are the kept song's after, and only the copy is gone.
 * cloudIngest.test.ts holds the same fold, arriving from another device's
 * log, to what a phone makes of it.
 */
describe('POST /api/songs/merge', () => {
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
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-merge-'))
    process.env['SELFMP3_DATA_DIR'] = path.join(root, 'data')
    process.env['SELFMP3_LIBRARY_DIR'] = path.join(root, 'library')
    process.env['SELFMP3_LOG_LEVEL'] = 'silent'
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
  const insert = (title: string, album = '') =>
    container.songs.insert({
      path: `${title}-${++files}.m4a`,
      title,
      artist: 'YOASOBI',
      album,
      albumArtist: '',
      trackNo: null,
      year: null,
      duration: 213,
      sizeBytes: 1,
      mime: 'audio/mp4',
      mtimeMs: 0,
      hasArt: false,
      artExt: null,
      lyricsKind: 'none',
      sourceUrl: null,
    })

  const post = (url: string, body: unknown, method = 'POST') =>
    fetch(`${origin}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${container.config.authToken ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

  it('moves the copy’s tags, love, playlist places and plays to the song kept', async () => {
    const kept = insert('アイドル')
    const extra = insert('アイドル', 'アイドル')
    container.songs.patch(extra, { loved: true })
    const rain = container.tags.create('rain', 20).id
    container.tags.setSongTags(extra, [rain])
    const mix = container.playlists.create({
      name: 'Mix',
      description: '',
      kind: 'manual',
      rules: null,
    }).id
    container.playlists.add(mix, [extra])
    for (const at of ['2026-08-03 10:00:00', '2026-08-20 10:00:00']) {
      container.stats.record(extra, 60_000, true, at, null)
      container.songs.recordPlay(extra, at)
    }

    const response = await post('/api/songs/merge', { keep: kept, songIds: [extra] })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ merged: 1 })

    expect(container.songs.byId(extra)).toBeNull()
    expect(container.songs.byId(kept)).toMatchObject({
      album: 'アイドル',
      loved: true,
      playCount: 2,
      tagIds: [rain],
      lastPlayedAt: '2026-08-20 10:00:00',
    })
    expect(container.playlists.songIds(container.playlists.byId(mix)!)).toEqual([kept])
    const plays = container.db.prepare('SELECT song_id AS id FROM play_events').all() as {
      id: number
    }[]
    expect(plays).toEqual([{ id: kept }, { id: kept }])
    // The tag stayed: the copy was not its last song.
    expect(container.tags.all().map(tag => tag.name)).toEqual(['rain'])
  })

  /*
   * Another device put alpha on while this one's picker was open, or while it
   * was offline: the tick sends beta alone, and alpha stays.
   */
  it('changes only the tags an edit names, keeping one another device put on', async () => {
    const song = insert('夜に駆ける')
    const alpha = container.tags.create('alpha', 10).id
    const beta = container.tags.create('beta', 30).id
    container.tags.setSongTags(song, [alpha])

    const on = await post(`/api/songs/${song}/tags`, { add: [beta], remove: [] }, 'PATCH')
    expect(on.status).toBe(200)
    expect(((await on.json()) as { tagIds: number[] }).tagIds.sort()).toEqual([alpha, beta].sort())

    const off = await post(`/api/songs/${song}/tags`, { add: [], remove: [beta] }, 'PATCH')
    expect(((await off.json()) as { tagIds: number[] }).tagIds).toEqual([alpha])
  })

  it('counts a song already gone as deleted, for a delete asked again', async () => {
    const song = insert('Gone')
    const first = await post('/api/songs/bulk/delete', { songIds: [song] })
    expect(await first.json()).toEqual({ removed: 1, failed: [] })
    const again = await post('/api/songs/bulk/delete', { songIds: [song] })
    expect(await again.json()).toEqual({ removed: 1, failed: [] })
  })

  const playsOf = (id: number): number =>
    (
      container.db.prepare('SELECT COUNT(*) AS n FROM play_events WHERE song_id = ?').get(id) as {
        n: number
      }
    ).n

  const played = (id: number, times: number) => {
    for (let i = 0; i < times; i++) {
      const at = `2026-08-0${i + 1} 10:00:00`
      container.stats.record(id, 60_000, true, at, null)
      container.songs.recordPlay(id, at)
    }
  }

  it('keeps one song with every play when two merges cross', async () => {
    const a = insert('Crossed')
    const b = insert('Crossed')
    played(a, 2)
    played(b, 3)

    const answers = await Promise.all([
      post('/api/songs/merge', { keep: a, songIds: [b] }),
      post('/api/songs/merge', { keep: b, songIds: [a] }),
    ])
    const merged = await Promise.all(
      answers.map(async r => ((await r.json()) as { merged: number }).merged),
    )
    expect(merged.sort()).toEqual([0, 1])

    const left = [a, b].map(id => container.songs.byId(id)).filter(song => song !== null)
    expect(left).toHaveLength(1)
    expect(left[0]!.playCount).toBe(5)
    expect(playsOf(left[0]!.id)).toBe(5)
  })

  it('folds a copy once when the same merge is sent twice at once', async () => {
    const kept = insert('Twice')
    const extra = insert('Twice')
    played(kept, 3)
    played(extra, 3)

    const answers = await Promise.all([
      post('/api/songs/merge', { keep: kept, songIds: [extra] }),
      post('/api/songs/merge', { keep: kept, songIds: [extra] }),
    ])
    const merged = await Promise.all(
      answers.map(async r => ((await r.json()) as { merged: number }).merged),
    )
    expect(merged.sort()).toEqual([0, 1])
    expect(container.songs.byId(extra)).toBeNull()
    expect(container.songs.byId(kept)!.playCount).toBe(6)
    expect(playsOf(kept)).toBe(6)
  })

  it('folds nothing into a song that is not there, and nothing into itself', async () => {
    const only = insert('Only')
    expect(await (await post('/api/songs/merge', { keep: 9999, songIds: [only] })).json()).toEqual({
      merged: 0,
    })
    expect((await post('/api/songs/merge', { keep: only, songIds: [only] })).status).toBe(400)
    expect(container.songs.byId(only)).not.toBeNull()
  })
})

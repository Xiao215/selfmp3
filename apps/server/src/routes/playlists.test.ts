import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Container } from '../container.js'
import { startLibrary, type TestLibrary } from '../fixtures/library.js'
import { newSong } from '../fixtures/songs.js'

/** The playlist routes through the real app and a real database. */
describe('playlist routes', () => {
  let library: TestLibrary
  let container: Container

  beforeAll(async () => {
    library = await startLibrary()
    container = library.container
  })

  afterAll(() => library.close())

  let files = 0
  const insert = (title: string) =>
    container.songs.insert(newSong({ title, path: `${title}-${++files}.m4a`, duration: 200 }))

  const send = (method: string, url: string, body?: unknown) => library.send(method, url, body)

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

  // Not one that went with its last songs once: it was kept aside before the
  // add, and goes back there, as it does on a device.
  it('puts a playlist the Undo of an add empties back aside if it went with its last songs', async () => {
    const one = insert('Uno')
    const road = container.playlists.create({
      name: 'Back road',
      description: '',
      kind: 'manual',
      rules: null,
    }).id
    container.playlists.add(road, [one])
    await send('POST', `/api/playlists/${road}/songs/remove`, { songIds: [one] })
    expect(container.playlists.byId(road)).toBeNull()
    await send('POST', `/api/playlists/${road}/songs`, { songIds: [one] })
    const undo = await send('POST', `/api/playlists/${road}/songs/remove`, {
      songIds: [one],
      keep: true,
    })
    expect(await undo.json()).toEqual({ removed: 1, playlist: null })
    expect(container.playlists.emptiedById(road)?.name).toBe('Back road')
  })
})

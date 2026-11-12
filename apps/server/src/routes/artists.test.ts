import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrarySchema } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { startLibrary, type TestLibrary } from '../fixtures/library.js'
import { newSong } from '../fixtures/songs.js'

/** An artist's other names and picture, by name, through the real app and a real database. */
describe('artist routes', () => {
  let library: TestLibrary
  let container: Container

  beforeAll(async () => {
    library = await startLibrary()
    container = library.container
    container.songs.insert(newSong({ title: 'アイドル', artist: 'YOASOBI' }))
  })

  afterAll(() => library.close())

  it('keeps an artist’s other names tidied, and says the library changed', async () => {
    const before = container.libraryVersion()

    const response = await library.send('PUT', '/api/artists/names', {
      // As a person may type the artist: the key is what matches.
      artist: 'yoasobi',
      names: ['  夜遊び ', 'YOASOBI', 'Yoasobi', 'ヨアソビ', '夜遊び'],
    })

    expect(response.status).toBe(200)
    const kept = ['夜遊び', 'ヨアソビ']
    expect(await response.json()).toEqual({ artist: 'yoasobi', names: kept })
    expect(container.libraryVersion()).not.toBe(before)
    const answer = LibrarySchema.parse(await (await library.send('GET', '/api/library')).json())
    expect(answer.artistNames['yoasobi']).toEqual(kept)
  })

  it('says so for an artist no song is by, and keeps nothing', async () => {
    const response = await library.send('PUT', '/api/artists/names', {
      artist: 'Nobody Here',
      names: ['Somebody'],
    })
    expect(response.status).toBe(404)
    expect(container.names.artistNamed('nobody here')).toBeNull()
  })

  it('serves no picture for an artist none was kept for', async () => {
    const response = await library.send('GET', '/api/artists/backdrop/image?name=YOASOBI')
    expect(response.status).toBe(404)
  })
})

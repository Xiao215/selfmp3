import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Library } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { startLibrary, type TestLibrary } from '../fixtures/library.js'
import { newSong } from '../fixtures/songs.js'

/**
 * A cover Tidy up filled in is taken off again by its Undo
 * (docs/features/ai.md, "Filling in what's missing"): through the real route
 * and a real database, the song is left with no cover, as it was before.
 */
describe('DELETE /api/songs/:id/cover', () => {
  let library: TestLibrary
  let container: Container
  let songId = 0

  beforeAll(async () => {
    library = await startLibrary()
    container = library.container
    songId = container.songs.insert(newSong({ title: '夜に駆ける', artist: 'YOASOBI' }))
  })

  afterAll(() => library.close())

  const ask = (method: string, at: string): Promise<Response> => library.send(method, at)
  const song = async () => {
    const answer = (await (await ask('GET', '/api/library')).json()) as Library
    return answer.songs.find(each => each.id === songId)
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

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Container } from '../container.js'
import { startLibrary, type TestLibrary } from '../fixtures/library.js'
import { newSong } from '../fixtures/songs.js'

/** The tag routes through the real app and a real database. */
describe('tag routes', () => {
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

  it('tags the songs still there when one in the selection was removed meanwhile', async () => {
    const one = insert('One')
    const two = insert('Two')
    const gone = insert('Gone')
    container.songs.delete(gone)
    const tag = container.tags.create('bulk').id

    const response = await library.send('POST', '/api/tags/bulk', {
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

    expect((await library.send('DELETE', `/api/tags/${tag}`)).status).toBe(200)

    const after = container.playlists.byId(playlist)!
    expect(after).toMatchObject({ kind: 'manual', songCount: 1 })
    expect(container.playlists.songIds(after)).toEqual([song])
  })
})

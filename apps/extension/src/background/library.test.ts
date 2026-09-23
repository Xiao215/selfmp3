import { describe, expect, it } from 'vitest'
import { fixtureLibrary, memoryStore, song } from '../../verify/fixtures.js'
import { LibraryCache, linkIndex } from './library.js'

describe('linkIndex', () => {
  it('keys each song by the video it came from, and skips what it cannot', () => {
    const links = linkIndex([
      song({
        id: 1,
        title: 'Hello',
        artist: 'Adele',
        sourceUrl: 'https://music.youtube.com/watch?v=YQHsXMglC9A',
      }),
      song({ id: 2, title: 'Dropped in', artist: 'Me' }),
      song({
        id: 4,
        title: 'Hello again',
        artist: 'Adele',
        sourceUrl: 'https://youtu.be/YQHsXMglC9A',
      }),
    ])
    expect(Object.keys(links)).toEqual(['YQHsXMglC9A'])
    expect(links['YQHsXMglC9A']).toEqual({
      id: 1,
      title: 'Hello',
      artist: 'Adele',
      addedAt: '2026-09-01 12:00:00',
      playCount: 0,
    })
  })
})

describe('LibraryCache', () => {
  it('reads the library again only when the server says it changed', async () => {
    const store = memoryStore()
    const library = fixtureLibrary()
    let version = 1
    let songCount = library.songs.length
    let fetched = 0
    const api = {
      libraryVersion: () => Promise.resolve({ version, songCount }),
      library: () => {
        fetched++
        return Promise.resolve(library)
      },
    }
    const server = { baseUrl: 'http://localhost:4600', token: null }

    const cache = new LibraryCache(store)
    await cache.get(server, api as never)
    await cache.get(server, api as never)
    expect(fetched).toBe(1)

    version = 2
    await cache.get(server, api as never)
    expect(fetched).toBe(2)

    // A restarted server counts from the start again; the song count tells.
    version = 2
    songCount += 1
    await cache.get(server, api as never)
    expect(fetched).toBe(3)

    // A worker started again reads what the last one kept.
    await new LibraryCache(store).get(server, api as never)
    expect(fetched).toBe(3)

    // Another server is another library.
    await new LibraryCache(store).get({ baseUrl: 'http://other:4600', token: null }, api as never)
    expect(fetched).toBe(4)
  })
})

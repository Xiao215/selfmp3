import { describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { parseSpotifyEmbed, SpotifyLists } from './spotify.js'

const page = (entity: unknown) =>
  `<html><head></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { state: { data: { entity } } } },
  })}</script></body></html>`

describe('parseSpotifyEmbed', () => {
  it('walks a playlist page to its songs, the first artist leading', () => {
    const result = parseSpotifyEmbed(
      page({
        type: 'playlist',
        name: 'Summer Mix',
        trackList: [
          { title: 'Get Lucky', subtitle: 'Daft Punk, Pharrell Williams', duration: 369626 },
          { title: 'Creep - Remastered', subtitle: 'Radiohead', duration: 238640 },
          { title: '', subtitle: '', duration: 0 },
        ],
      }),
    )
    expect(result).toEqual({
      title: 'Summer Mix',
      tracks: [
        { title: 'Get Lucky', artist: 'Daft Punk', album: '', duration: 370 },
        { title: 'Creep', artist: 'Radiohead', album: '', duration: 239 },
      ],
    })
  })

  it('names an album’s songs after it', () => {
    const result = parseSpotifyEmbed(
      page({
        type: 'album',
        name: 'Random Access Memories',
        trackList: [{ title: 'Give Life Back to Music', subtitle: 'Daft Punk', duration: 275386 }],
      }),
    )
    expect(result?.tracks[0]?.album).toBe('Random Access Memories')
  })

  it('reads a track’s own page as that one track', () => {
    const result = parseSpotifyEmbed(
      page({
        type: 'track',
        name: 'Get Lucky (Radio Edit) [feat. Pharrell Williams and Nile Rodgers]',
        artists: [{ name: 'Daft Punk' }, { name: 'Pharrell Williams' }],
        duration: 247632,
      }),
    )
    expect(result?.title).toBeNull()
    expect(result?.tracks).toEqual([
      { title: 'Get Lucky', artist: 'Daft Punk', album: '', duration: 248 },
    ])
  })

  it('returns null when the page has no data or the shape is unknown', () => {
    expect(parseSpotifyEmbed('<html></html>')).toBeNull()
    expect(parseSpotifyEmbed('<script id="__NEXT_DATA__">not json</script>')).toBeNull()
    expect(parseSpotifyEmbed(page({ nothing: true }))).toBeNull()
  })
})

describe('SpotifyLists', () => {
  it('asks the embed page for the kind of link it was given', async () => {
    const asked: string[] = []
    const lists = new SpotifyLists(createLogger('silent'), async url => {
      asked.push(url)
      return new Response(
        page({ type: 'album', name: 'A', trackList: [{ title: 'B', subtitle: 'C', duration: 1 }] }),
      )
    })
    await lists.list({ kind: 'album', id: '4m2880jivSbbyEGAKfITCa' })
    expect(asked).toEqual(['https://open.spotify.com/embed/album/4m2880jivSbbyEGAKfITCa'])
  })

  it('says what to do instead when the page cannot be read', async () => {
    const lists = new SpotifyLists(
      createLogger('silent'),
      async () => new Response('<html></html>'),
    )
    await expect(lists.list({ kind: 'playlist', id: 'x' })).rejects.toThrow(/exportify/)
    const offline = new SpotifyLists(createLogger('silent'), () =>
      Promise.reject(new Error('offline')),
    )
    await expect(offline.list({ kind: 'playlist', id: 'x' })).rejects.toThrow(/offline/)
  })
})

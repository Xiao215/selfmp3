import { describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { coverSized, songRow, YouTubeMusicSearch } from './youtubeMusicSearch.js'

/**
 * The search against a fake of YouTube Music's private API, with a row cut
 * down from a real answer (the songs filter, "yoasobi") to the parts read.
 */

const page = (browseId: string, pageType: string) => ({
  navigationEndpoint: {
    browseEndpoint: {
      browseId,
      browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } },
    },
  },
})

function row(videoId: string, title: string, second: object[]) {
  return {
    musicResponsiveListItemRenderer: {
      thumbnail: {
        musicThumbnailRenderer: {
          thumbnail: {
            thumbnails: [
              { url: `https://yt3.test/${videoId}=w60-h60-l90-rj`, width: 60 },
              { url: `https://yt3.test/${videoId}=w120-h120-l90-rj`, width: 120 },
            ],
          },
        },
      },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: second } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: '1.1B plays' }] } } },
      ],
      playlistItemData: { videoId },
    },
  }
}

const yoruNiKakeru = row('by4SYYWlhEs', '夜に駆ける', [
  { text: 'YOASOBI', ...page('UCI6B8', 'MUSIC_PAGE_TYPE_ARTIST') },
  { text: ' • ' },
  { text: '夜に駆ける', ...page('MPREb_LfJd6hctedK', 'MUSIC_PAGE_TYPE_ALBUM') },
  { text: ' • ' },
  { text: '4:22' },
])

describe('songRow', () => {
  it('reads title, artist, album, length and a cover worth keeping', () => {
    expect(songRow(yoruNiKakeru.musicResponsiveListItemRenderer)).toEqual({
      url: 'https://music.youtube.com/watch?v=by4SYYWlhEs',
      title: '夜に駆ける',
      artist: 'YOASOBI',
      album: '夜に駆ける',
      duration: 262,
      thumbnail: 'https://yt3.test/by4SYYWlhEs=w544-h544-l90-rj',
    })
  })

  it('names every artist of a song by two, and leaves a single without an album', () => {
    const duet = row('abc', 'Duet', [
      { text: 'Ayase', ...page('UC1', 'MUSIC_PAGE_TYPE_ARTIST') },
      { text: ' & ' },
      { text: 'ikura', ...page('UC2', 'MUSIC_PAGE_TYPE_ARTIST') },
      { text: ' • ' },
      { text: '1:02:03' },
    ])
    expect(songRow(duet.musicResponsiveListItemRenderer)).toMatchObject({
      artist: 'Ayase, ikura',
      album: '',
      duration: 3723,
    })
  })

  it('skips a row that is not a song', () => {
    expect(songRow({ flexColumns: [] })).toBeNull()
  })
})

describe('YouTubeMusicSearch', () => {
  it('asks for songs only and answers them as tracks', async () => {
    const asked: { url: string; body: unknown }[] = []
    const search = new YouTubeMusicSearch(createLogger('silent'), (url, init) => {
      asked.push({ url, body: JSON.parse(String(init?.body)) })
      const body = { contents: { tabbedSearchResultsRenderer: { tabs: [{ contents: [yoruNiKakeru] }] } } }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })
    const songs = await search.songs('yoasobi')
    expect(asked[0]?.url).toContain('youtubei/v1/search')
    expect(asked[0]?.body).toMatchObject({ query: 'yoasobi', params: expect.stringMatching(/^Eg/) })
    expect(songs?.map(song => song.title)).toEqual(['夜に駆ける'])
  })

  it('is null when YouTube Music does not answer', async () => {
    const search = new YouTubeMusicSearch(createLogger('silent'), () =>
      Promise.resolve(new Response('', { status: 503 })),
    )
    expect(await search.songs('yoasobi')).toBeNull()
  })
})

describe('coverSized', () => {
  it('asks the same address for a larger picture', () => {
    expect(coverSized('https://yt3.test/x=w120-h120-l90-rj')).toBe('https://yt3.test/x=w544-h544-l90-rj')
    expect(coverSized('https://i.ytimg.test/vi/x/hqdefault.jpg')).toBe('https://i.ytimg.test/vi/x/hqdefault.jpg')
  })
})

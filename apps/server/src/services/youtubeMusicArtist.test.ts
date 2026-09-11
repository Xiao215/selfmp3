import { describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { YouTubeMusicArtists } from './youtubeMusicArtist.js'

/**
 * The artist lookup against a fake of YouTube Music's private API, with pages
 * cut down from real ones (YOASOBI, and a tech channel YouTube also calls an
 * artist) to the parts that are read.
 */

const YOASOBI = 'UCvpredjG93ifbCP1Y77JyFA'
const SONGS_PLAYLIST = 'OLAK5uy_m9tuwAgM8iEzi0d2BqpMmc2Sr67omN0pc'

const text = (value: string) => ({ runs: [{ text: value }] })

function songRow(videoId: string, title: string) {
  return {
    musicResponsiveListItemRenderer: {
      thumbnail: {
        musicThumbnailRenderer: {
          thumbnail: {
            thumbnails: [
              { url: `https://i.ytimg.test/${videoId}/60`, width: 60 },
              { url: `https://i.ytimg.test/${videoId}/120`, width: 120 },
            ],
          },
        },
      },
      flexColumns: [title, 'YOASOBI', '1.1B plays', title].map(column => ({
        musicResponsiveListItemFlexColumnRenderer: { text: text(column) },
      })),
      playlistItemData: { videoId },
    },
  }
}

const browseTo = (browseId: string) => ({ browseEndpoint: { browseId } })

function artistPage(options: { seeAll: boolean }) {
  return {
    header: { musicImmersiveHeaderRenderer: { title: text('YOASOBI') } },
    contents: {
      singleColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      musicShelfRenderer: {
                        title: {
                          runs: [
                            {
                              text: 'Top songs',
                              ...(options.seeAll
                                ? { navigationEndpoint: browseTo(`VL${SONGS_PLAYLIST}`) }
                                : {}),
                            },
                          ],
                        },
                        contents: [
                          songRow('m9SMT5ipbxk', 'アイドル'),
                          songRow('x8VYWazR5mE', '夜に駆ける'),
                        ],
                      },
                    },
                    {
                      musicCarouselShelfRenderer: {
                        header: {
                          musicCarouselShelfBasicHeaderRenderer: {
                            title: {
                              runs: [
                                { text: 'Singles & EPs', navigationEndpoint: browseTo('MPADUC_x') },
                              ],
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  }
}

/** A channel with only a carousel of videos: an "artist" to YouTube, no songs to us. */
const videosOnlyPage = {
  header: { musicVisualHeaderRenderer: { title: text('Marques Brownlee') } },
  contents: {
    musicCarouselShelfRenderer: {
      header: { musicCarouselShelfBasicHeaderRenderer: { title: text('Videos') } },
    },
  },
}

function fakeYouTubeMusic(pages: Record<string, unknown>, handles: Record<string, string>) {
  const calls: { endpoint: string; body: Record<string, unknown> }[] = []
  const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
    const endpoint = new URL(url).pathname.replace('/youtubei/v1/', '')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({ endpoint, body })

    if (endpoint === 'navigation/resolve_url') {
      const channelId = handles[String(body['url'])]
      // An unknown handle comes back with no endpoint at all.
      return Promise.resolve(
        Response.json(channelId ? { endpoint: browseTo(channelId) } : { responseContext: {} }),
      )
    }
    const page = pages[String(body['browseId'])]
    return Promise.resolve(page ? Response.json(page) : new Response('', { status: 404 }))
  }
  return { artists: new YouTubeMusicArtists(createLogger('silent'), fetchImpl), calls }
}

describe('YouTubeMusicArtists.topSongs', () => {
  it('resolves a handle and finds the "Top songs" playlist', async () => {
    const { artists, calls } = fakeYouTubeMusic(
      { [YOASOBI]: artistPage({ seeAll: true }) },
      { 'https://music.youtube.com/@YOASOBI_Official': YOASOBI },
    )

    const songs = await artists.topSongs({ handle: '@YOASOBI_Official' })

    expect(songs).toMatchObject({
      artist: 'YOASOBI',
      playlistUrl: `https://music.youtube.com/playlist?list=${SONGS_PLAYLIST}`,
    })
    expect(calls.map(call => call.endpoint)).toEqual(['navigation/resolve_url', 'browse'])
  })

  it('goes straight to the page for a channel id', async () => {
    const { artists, calls } = fakeYouTubeMusic({ [YOASOBI]: artistPage({ seeAll: true }) }, {})

    const songs = await artists.topSongs({ channelId: YOASOBI })

    expect(songs?.playlistUrl).toContain(SONGS_PLAYLIST)
    expect(calls.map(call => call.endpoint)).toEqual(['browse'])
  })

  it('takes the rows themselves when the list is too short for a See all', async () => {
    const { artists } = fakeYouTubeMusic({ [YOASOBI]: artistPage({ seeAll: false }) }, {})

    const songs = await artists.topSongs({ channelId: YOASOBI })

    expect(songs?.playlistUrl).toBeNull()
    expect(songs?.tracks).toEqual([
      {
        url: 'https://music.youtube.com/watch?v=m9SMT5ipbxk',
        title: 'アイドル',
        artist: 'YOASOBI',
        album: '',
        duration: 0,
        thumbnail: 'https://i.ytimg.test/m9SMT5ipbxk/120',
      },
      expect.objectContaining({ title: '夜に駆ける', url: expect.stringContaining('x8VYWazR5mE') }),
    ])
  })

  it('is null for a channel with no songs list', async () => {
    const { artists } = fakeYouTubeMusic(
      { UCBJycsmduvYEL83R_U4JriQ: videosOnlyPage },
      { 'https://music.youtube.com/@mkbhd': 'UCBJycsmduvYEL83R_U4JriQ' },
    )
    expect(await artists.topSongs({ handle: '@mkbhd' })).toBeNull()
  })

  it('is null for a handle that does not resolve, and when YouTube Music fails', async () => {
    const { artists } = fakeYouTubeMusic({}, {})
    expect(await artists.topSongs({ handle: '@nobody' })).toBeNull()
    expect(await artists.topSongs({ channelId: YOASOBI })).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { parseLyrics } from '@selfmp3/shared'
import { createLogger } from '../logger.js'
import { YouTubeMusicLyrics } from './youtubeMusic.js'

/**
 * YouTube Music against a fake of its private API, with responses cut down
 * from real ones to the parts that are read. What matters is which track's
 * timings are believed: only a studio track as long as the file.
 */

interface FakeTrack {
  videoId: string
  title: string
  length: string
  type: 'MUSIC_VIDEO_TYPE_ATV' | 'MUSIC_VIDEO_TYPE_OMV'
  /** Timed lines, [ms, text]; omitted for a track with no timed lyrics. */
  lines?: [number, string][]
}

const musicVideoType = (type: string) => ({
  watchEndpoint: {
    watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: type } },
  },
})

function fakeYouTubeMusic(tracks: FakeTrack[], searchResults: FakeTrack[] = []) {
  const calls: string[] = []
  const reply = (body: unknown) => Promise.resolve(Response.json(body))

  const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
    const endpoint = new URL(url).pathname.split('/').at(-1) ?? ''
    const body = JSON.parse(String(init?.body)) as {
      videoId?: string
      browseId?: string
      context: { client: { clientName: string } }
    }
    calls.push(endpoint)

    if (endpoint === 'next') {
      const track = tracks.find(item => item.videoId === body.videoId)
      if (!track) return reply({})
      return reply({
        contents: {
          playlistPanelRenderer: {
            contents: [
              {
                playlistPanelVideoRenderer: {
                  videoId: track.videoId,
                  title: { runs: [{ text: track.title }] },
                  longBylineText: {
                    runs: [{ text: 'YOASOBI' }, { text: ' • ' }, { text: 'Album' }],
                  },
                  lengthText: { runs: [{ text: track.length }] },
                  navigationEndpoint: musicVideoType(track.type),
                },
              },
            ],
          },
          tabs: [
            {
              tabRenderer: { endpoint: { browseEndpoint: { browseId: `MPLYt_${track.videoId}` } } },
            },
          ],
        },
      })
    }

    if (endpoint === 'browse') {
      const track = tracks.find(item => `MPLYt_${item.videoId}` === body.browseId)
      // Only the Android client is ever given timings.
      if (!track?.lines || body.context.client.clientName !== 'ANDROID_MUSIC') return reply({})
      return reply({
        contents: {
          elementRenderer: {
            newElement: {
              type: {
                componentType: {
                  model: {
                    timedLyricsModel: {
                      lyricsData: {
                        timedLyricsData: track.lines.map(([ms, text], index) => ({
                          lyricLine: text,
                          cueRange: {
                            startTimeMilliseconds: String(ms),
                            endTimeMilliseconds: String(track.lines?.[index + 1]?.[0] ?? ms + 4000),
                          },
                        })),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })
    }

    // search
    return reply({
      contents: searchResults.map(track => ({
        musicResponsiveListItemRenderer: {
          playlistItemData: { videoId: track.videoId },
          overlay: musicVideoType(track.type),
          flexColumns: [
            {
              musicResponsiveListItemFlexColumnRenderer: {
                text: { runs: [{ text: track.title }] },
              },
            },
            {
              musicResponsiveListItemFlexColumnRenderer: {
                text: {
                  runs: [
                    { text: 'YOASOBI' },
                    { text: ' • ' },
                    { text: 'Album' },
                    { text: ' • ' },
                    { text: track.length },
                  ],
                },
              },
            },
          ],
        },
      })),
    })
  }

  return { youtubeMusic: new YouTubeMusicLyrics(createLogger('silent'), fetchImpl), calls }
}

const orion: FakeTrack = {
  videoId: 'fCh0qfxElm8',
  title: 'オリオン - Orion',
  length: '3:27',
  type: 'MUSIC_VIDEO_TYPE_ATV',
  lines: [
    [10710, '窓の外 静かな 朝'],
    [13220, '小さな 灯り ひとつ'],
  ],
}
const song = { artist: 'YOASOBI', title: 'オリオン', duration: 206.62 }

describe('YouTubeMusicLyrics', () => {
  it('finds timed lyrics for the video a song came from, as LRC', async () => {
    const { youtubeMusic, calls } = fakeYouTubeMusic([orion])
    const lrc = await youtubeMusic.find({ ...song, videoId: orion.videoId })

    expect(lrc).toContain('[00:10.71]窓の外 静かな 朝')
    expect(calls).toEqual(['next', 'browse'])
    const parsed = parseLyrics(lrc ?? '')
    expect(parsed.synced).toBe(true)
    // The last line ends where YouTube Music says it does.
    expect(parsed.lines.at(-1)).toEqual({ time: 17.22, text: '' })
  })

  it('reads a length shown rounded up as the same recording', async () => {
    const { youtubeMusic } = fakeYouTubeMusic([{ ...orion, length: '3:28' }])
    // 3:28 covers 207–208 s: 0.38 s from a 206.62 s file, within the second.
    expect(await youtubeMusic.find({ ...song, videoId: orion.videoId })).not.toBeNull()
    // 3:29 covers 208–209 s: 1.38 s away.
    const { youtubeMusic: farther } = fakeYouTubeMusic([{ ...orion, length: '3:29' }])
    expect(await farther.find({ ...song, videoId: orion.videoId })).toBeNull()
  })

  it('looks past a music video to the studio track of the same length', async () => {
    const video: FakeTrack = { ...orion, videoId: 'musicvideo1', type: 'MUSIC_VIDEO_TYPE_OMV' }
    const { youtubeMusic } = fakeYouTubeMusic([video, orion], [orion])
    const lrc = await youtubeMusic.find({ ...song, videoId: video.videoId })
    expect(lrc).toContain('窓の外')
  })

  it('does not use the studio track for a music video with an intro', async () => {
    const video: FakeTrack = {
      ...orion,
      videoId: 'musicvideo1',
      length: '3:41',
      type: 'MUSIC_VIDEO_TYPE_OMV',
    }
    const { youtubeMusic } = fakeYouTubeMusic([video, orion], [orion])
    expect(await youtubeMusic.find({ ...song, duration: 220.4, videoId: video.videoId })).toBeNull()
  })

  it('finds a song added by hand by searching, and skips another version', async () => {
    const english: FakeTrack = {
      ...orion,
      videoId: 'english0001',
      title: 'Orion (English Version)',
      lines: [[10710, 'something else']],
    }
    const { youtubeMusic } = fakeYouTubeMusic([english, orion], [english, orion])
    const lrc = await youtubeMusic.find({ ...song, videoId: null })
    expect(lrc).toContain('窓の外')
    expect(lrc).not.toContain('something else')
  })

  it('has nothing for a track without timings', async () => {
    const { youtubeMusic } = fakeYouTubeMusic([{ ...orion, lines: undefined }])
    expect(await youtubeMusic.find({ ...song, videoId: orion.videoId })).toBeNull()
  })

  it('stays quiet when YouTube Music cannot be reached', async () => {
    const youtubeMusic = new YouTubeMusicLyrics(createLogger('silent'), () =>
      Promise.reject(new Error('offline')),
    )
    expect(await youtubeMusic.find({ ...song, videoId: orion.videoId })).toBeNull()
  })
})

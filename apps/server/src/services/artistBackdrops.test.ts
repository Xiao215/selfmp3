import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song } from '@selfmp3/shared'
import { createLogger } from '../logger.js'
import type { Config } from '../config.js'
import type { ArtistNamesRow, NamesRepository } from '../repositories/names.js'
import type { SongRepository } from '../repositories/songs.js'
import { ArtistBackdropService } from './artistBackdrops.js'
import type { YouTubeMusicArtists } from './youtubeMusicArtist.js'

/**
 * An artist's picture against a fake of YouTube Music's search, cut down to
 * the parts read: what matters is which page the songs agree on, and that a
 * disagreement — the "Unknown Artist" of a hundred channels — is no picture.
 */

const YORUSHIKA = 'UCabLXblrQG4cO8F9qdd4Xsw'
const BANNER = Buffer.from('a wide picture of Yorushika, allegedly')
const PORTRAIT = Buffer.from('the same, cut square')

interface Hit {
  title: string
  artist: string
  channelId: string | null
  length: string
  video?: boolean
}

const text = (value: string) => ({ runs: [{ text: value }] })

function hit({ title, artist, channelId, length, video = false }: Hit) {
  const artistRun = {
    text: artist,
    ...(channelId ? { navigationEndpoint: { browseEndpoint: { browseId: channelId } } } : {}),
  }
  return {
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: `v-${title}` },
      overlay: {
        watchEndpoint: {
          watchEndpointMusicSupportedConfigs: {
            watchEndpointMusicConfig: {
              musicVideoType: video ? 'MUSIC_VIDEO_TYPE_OMV' : 'MUSIC_VIDEO_TYPE_ATV',
            },
          },
        },
      },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: text(title) } },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: {
              runs: [
                artistRun,
                { text: ' • ' },
                { text: 'Album' },
                { text: ' • ' },
                { text: length },
              ],
            },
          },
        },
      ],
    },
  }
}

const song = (id: number, title: string, artist: string, duration: number): Song =>
  ({ id, title, artist, duration }) as unknown as Song

function fakeYouTubeMusic(hitsByQuery: Record<string, Hit[]>) {
  const searches: string[] = []
  let pictures = 0
  const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
    if (!url.includes('/youtubei/')) {
      pictures += 1
      const bytes = url.endsWith('=w240-h240-p-l90-rj') ? PORTRAIT : BANNER
      return Promise.resolve(new Response(bytes, { headers: { 'Content-Type': 'image/jpeg' } }))
    }
    const body = JSON.parse(String(init?.body)) as { query?: string }
    searches.push(body.query ?? '')
    const hits = hitsByQuery[body.query ?? ''] ?? []
    return Promise.resolve(Response.json({ contents: hits }))
  }
  return { fetchImpl, searches, pictures: () => pictures }
}

describe('ArtistBackdropService', () => {
  let dataDir = ''
  /** The names each artist also goes by, by key, as the names repository has them. */
  let otherNames = new Map<string, ArtistNamesRow>()
  beforeEach(() => {
    otherNames = new Map()
  })
  afterEach(() => {
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
  })

  function service(
    songs: Song[],
    fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
    pause: (ms: number) => Promise<void> = () => Promise.resolve(),
  ) {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-artists-'))
    const picture = vi.fn(async (channelId: string) =>
      channelId === YORUSHIKA ? 'https://yt3.test/yorushika' : null,
    )
    const youtube = { picture } as unknown as YouTubeMusicArtists
    return {
      backdrops: new ArtistBackdropService(
        { dataDir } as Config,
        // A fresh array each time, as the repository's after a change.
        { all: () => [...songs] } as unknown as SongRepository,
        { artistNames: () => otherNames } as unknown as NamesRepository,
        youtube,
        createLogger('silent'),
        fetchImpl,
        pause,
      ),
      picture,
    }
  }

  it('keeps the picture of the page the songs agree on, wide and square', async () => {
    const yt = fakeYouTubeMusic({
      'Yorushika 靴の花火': [
        hit({ title: '靴の花火', artist: 'ヨルシカ', channelId: YORUSHIKA, length: '5:06' }),
      ],
      'Yorushika 晴る': [
        hit({ title: '晴る', artist: 'Yorushika', channelId: YORUSHIKA, length: '3:12' }),
      ],
    })
    const { backdrops, picture } = service(
      [song(1, '靴の花火', 'Yorushika', 306), song(2, '晴る', 'Yorushika', 192)],
      yt.fetchImpl,
    )

    const kept = await backdrops.find('Yorushika')
    expect(kept).not.toBeNull()
    expect(fs.readFileSync(kept!.path)).toEqual(BANNER)
    expect(picture).toHaveBeenCalledWith(YORUSHIKA)
    expect((await backdrops.kept('yorushika'))?.rev).toBe(kept!.rev)
    const portrait = await backdrops.kept('Yorushika', 'portrait')
    expect(fs.readFileSync(portrait!.path)).toEqual(PORTRAIT)
    expect(portrait!.rev).toBe(kept!.rev)

    // Kept: the next ask goes nowhere.
    await backdrops.find('Yorushika')
    expect(yt.searches).toHaveLength(2)
    expect(yt.pictures()).toBe(2)
  })

  it('looks for every artist of the library without a picture, one at a time, and only once', async () => {
    const yt = fakeYouTubeMusic({
      'Yorushika 靴の花火': [
        hit({ title: '靴の花火', artist: 'ヨルシカ', channelId: YORUSHIKA, length: '5:06' }),
      ],
      'Yorushika 晴る': [
        hit({ title: '晴る', artist: 'Yorushika', channelId: YORUSHIKA, length: '3:12' }),
      ],
    })
    const pause = vi.fn(() => Promise.resolve())
    const { backdrops } = service(
      [
        song(1, '靴の花火', 'Yorushika', 306),
        song(2, '晴る', 'Yorushika', 192),
        // No page agrees for this one: remembered as none, not asked again.
        song(3, 'Nowhere', 'Stranger', 200),
      ],
      yt.fetchImpl,
      pause,
    )

    expect(await backdrops.fill()).toBe(1)
    expect(await backdrops.keptPair('Yorushika')).toMatchObject({ rev: expect.any(String) })
    expect(await backdrops.keptPair('Stranger')).toBeNull()
    // A pause between two artists, none before the first.
    expect(pause).toHaveBeenCalledTimes(1)

    const searches = yt.searches.length
    expect(await backdrops.fill()).toBe(0)
    expect(yt.searches).toHaveLength(searches)
  })

  it('looks again for a banner kept without its portrait', async () => {
    const yt = fakeYouTubeMusic({
      'Yorushika 靴の花火': [
        hit({ title: '靴の花火', artist: 'ヨルシカ', channelId: YORUSHIKA, length: '5:06' }),
      ],
      'Yorushika 晴る': [
        hit({ title: '晴る', artist: 'Yorushika', channelId: YORUSHIKA, length: '3:12' }),
      ],
    })
    const { backdrops } = service(
      [song(1, '靴の花火', 'Yorushika', 306), song(2, '晴る', 'Yorushika', 192)],
      yt.fetchImpl,
    )
    const first = await backdrops.find('Yorushika')
    fs.rmSync((await backdrops.kept('Yorushika', 'portrait'))!.path)

    // Half a pair is no pair: neither shape is served, and the next ask finds both.
    expect(await backdrops.kept('Yorushika')).toBeNull()
    expect(await backdrops.kept('Yorushika', 'portrait')).toBeNull()
    const again = await backdrops.find('Yorushika')
    expect(again?.path).toBe(first!.path)
    expect(fs.readFileSync((await backdrops.kept('Yorushika', 'portrait'))!.path)).toEqual(PORTRAIT)
  })

  it('lights nothing for songs that name different pages', async () => {
    const yt = fakeYouTubeMusic({
      'Unknown Artist Track 1': [
        hit({ title: 'Track 1', artist: 'Unknown Artist', channelId: 'UCone', length: '3:00' }),
        hit({ title: 'Track 1', artist: 'Unknown Artist', channelId: 'UCtwo', length: '7:15' }),
      ],
    })
    const { backdrops, picture } = service([song(1, 'Track 1', 'Unknown Artist', 0)], yt.fetchImpl)

    expect(await backdrops.find('Unknown Artist')).toBeNull()
    expect(picture).not.toHaveBeenCalled()
    // Remembered: the page opening again does not ask again.
    expect(await backdrops.find('Unknown Artist')).toBeNull()
    expect(yt.searches).toHaveLength(1)
  })

  it('needs two songs to agree when there is more than one to ask', async () => {
    const yt = fakeYouTubeMusic({
      'Xiao Song A': [
        hit({ title: 'Song A', artist: 'Xiao', channelId: 'UCxiao', length: '3:00' }),
      ],
      'Xiao Song B': [],
    })
    const { backdrops } = service(
      [song(1, 'Song A', 'Xiao', 180), song(2, 'Song B', 'Xiao', 200)],
      yt.fetchImpl,
    )
    expect(await backdrops.find('Xiao')).toBeNull()
  })

  it('does not believe a hit that is a video or the wrong length', async () => {
    const yt = fakeYouTubeMusic({
      'Yorushika 靴の花火': [
        hit({
          title: '靴の花火',
          artist: 'Yorushika',
          channelId: YORUSHIKA,
          length: '5:06',
          video: true,
        }),
        hit({ title: '靴の花火', artist: 'Yorushika', channelId: YORUSHIKA, length: '4:00' }),
      ],
    })
    const { backdrops } = service([song(1, '靴の花火', 'Yorushika', 306)], yt.fetchImpl)
    expect(await backdrops.find('Yorushika')).toBeNull()
  })

  it('takes one measured song at its word though its hit writes the name in romaji', async () => {
    const yt = fakeYouTubeMusic({
      'ヨルシカ 晴る': [
        hit({ title: '晴る', artist: 'Yorushika', channelId: YORUSHIKA, length: '3:12' }),
      ],
    })
    const { backdrops } = service([song(1, '晴る', 'ヨルシカ', 192)], yt.fetchImpl)
    expect(await backdrops.find('ヨルシカ')).not.toBeNull()
  })

  it('remembers nothing when YouTube Music could not be asked', async () => {
    const fetchImpl = () => Promise.reject(new Error('offline'))
    const { backdrops } = service([song(1, '靴の花火', 'Yorushika', 306)], fetchImpl)
    expect(await backdrops.find('Yorushika')).toBeNull()
    expect(fs.readdirSync(dataDir + '/artists')).toEqual([])
  })

  it('takes one song at its word only when its hit names the artist', async () => {
    const yt = fakeYouTubeMusic({
      'suis 花に亡霊': [
        hit({ title: '花に亡霊', artist: 'ヨルシカ', channelId: YORUSHIKA, length: '4:00' }),
      ],
    })
    const { backdrops } = service([song(1, '花に亡霊', 'n-buna feat. suis', 240)], yt.fetchImpl)
    // One song alone has to be vouched for by its hit naming the artist, and
    // this hit names the band, not the singer.
    expect(await backdrops.find('suis')).toBeNull()
  })

  it.each([
    ['the new name goes by the old', 'ヨルシカ', ['Yorushika']],
    ['the old name goes by the new', 'yorushika', ['ヨルシカ']],
  ])(
    'gives a renamed artist the picture kept under their old name: %s',
    async (_, named, names) => {
      const yt = fakeYouTubeMusic({
        'Yorushika 靴の花火': [
          hit({ title: '靴の花火', artist: 'ヨルシカ', channelId: YORUSHIKA, length: '5:06' }),
        ],
        'Yorushika 晴る': [
          hit({ title: '晴る', artist: 'Yorushika', channelId: YORUSHIKA, length: '3:12' }),
        ],
      })
      const songs = [song(1, '靴の花火', 'Yorushika', 306), song(2, '晴る', 'Yorushika', 192)]
      const { backdrops } = service(songs, yt.fetchImpl)
      await backdrops.find('Yorushika')

      // Renamed before anyone said the two names are one artist: none found
      // for the new name, which the search does not know.
      songs.splice(0, 2, song(1, '靴の花火', 'ヨルシカ', 306), song(2, '晴る', 'ヨルシカ', 192))
      expect(await backdrops.find('ヨルシカ')).toBeNull()
      const searches = yt.searches.length

      // Then they are: the kept picture is theirs, "none" notwithstanding.
      otherNames.set(named, { names, hlc: '1' })
      expect(await backdrops.fill()).toBe(1)
      const kept = await backdrops.kept('ヨルシカ')
      expect(fs.readFileSync(kept!.path)).toEqual(BANNER)
      expect(fs.readFileSync((await backdrops.kept('ヨルシカ', 'portrait'))!.path)).toEqual(
        PORTRAIT,
      )
      expect(yt.searches).toHaveLength(searches)
      expect(yt.pictures()).toBe(2)
    },
  )

  it('asks again about an artist with none once the songs naming them change', async () => {
    const yt = fakeYouTubeMusic({})
    const songs = [song(1, 'Song A', 'Xiao', 180)]
    const { backdrops } = service(songs, yt.fetchImpl)

    expect(await backdrops.find('Xiao')).toBeNull()
    expect(await backdrops.find('Xiao')).toBeNull()
    expect(yt.searches).toEqual(['Xiao Song A'])

    // A song renamed to them is a new witness: the week is not waited out.
    songs.push(song(2, 'Song B', 'Xiao', 200))
    expect(await backdrops.find('Xiao')).toBeNull()
    expect(yt.searches).toHaveLength(3)
    expect(await backdrops.find('Xiao')).toBeNull()
    expect(yt.searches).toHaveLength(3)
  })
})

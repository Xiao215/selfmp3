import { describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { coverSized, songRow, YouTubeMusicLists } from './youtubeMusicLists.js'

/**
 * Searches, albums and playlists against a fake of YouTube Music's private
 * API, with rows and headers cut down from real answers (YOASOBI's THE BOOK,
 * a search for "yoasobi", a made playlist) to the parts that are read.
 */

const to = (browseId: string, pageType: string) => ({
  navigationEndpoint: {
    browseEndpoint: {
      browseId,
      browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } },
    },
  },
})
const artist = (name: string) => ({ text: name, ...to('UC1', 'MUSIC_PAGE_TYPE_ARTIST') })
const album = (name: string) => ({ text: name, ...to('MPREb_1', 'MUSIC_PAGE_TYPE_ALBUM') })
const text = (value: string) => ({ runs: [{ text: value }] })
const thumbnails = (name: string) => ({
  musicThumbnailRenderer: {
    thumbnail: {
      thumbnails: [
        { url: `https://yt3.test/${name}=w60-h60-l90-rj`, width: 60 },
        { url: `https://yt3.test/${name}=w120-h120-l90-rj`, width: 120 },
      ],
    },
  },
})

/** One row: flex columns of runs, a fixed column for the length, a cover when the row has one. */
function row(videoId: string, flex: object[][], length: string, cover?: string) {
  return {
    musicResponsiveListItemRenderer: {
      ...(cover ? { thumbnail: thumbnails(cover) } : {}),
      flexColumns: flex.map(runs => ({
        musicResponsiveListItemFlexColumnRenderer: { text: { runs } },
      })),
      fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: text(length) } }],
      playlistItemData: { videoId },
    },
  }
}

const header = (title: string, options: { artist?: string; count?: string; cover?: string }) => ({
  musicResponsiveHeaderRenderer: {
    title: text(title),
    ...(options.artist ? { straplineTextOne: { runs: [artist(options.artist)] } } : {}),
    ...(options.count ? { secondSubtitle: text(options.count) } : {}),
    ...(options.cover ? { thumbnail: thumbnails(options.cover) } : {}),
  },
})

const answer = (body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))

describe('songRow', () => {
  it('reads a search row: title, every artist, album, length, and a cover worth keeping', () => {
    const duet = row(
      'abc',
      [
        [{ text: 'Duet' }],
        [
          artist('Ayase'),
          { text: ' & ' },
          artist('ikura'),
          { text: ' • ' },
          album('Singles'),
          { text: ' • ' },
          { text: '4:22' },
        ],
      ],
      '',
      'abc',
    )
    expect(songRow(duet.musicResponsiveListItemRenderer)).toEqual({
      url: 'https://music.youtube.com/watch?v=abc',
      title: 'Duet',
      artist: 'Ayase, ikura',
      album: 'Singles',
      duration: 262,
      thumbnail: 'https://yt3.test/abc=w544-h544-l90-rj',
    })
  })

  it("takes what an album's row does not say from the page", () => {
    const epilogue = row('k_Z', [[{ text: 'Epilogue' }], [], [{ text: '5.1M plays' }]], '0:51')
    expect(
      songRow(epilogue.musicResponsiveListItemRenderer, {
        artist: 'YOASOBI',
        album: 'THE BOOK',
        thumbnail: 'https://yt3.test/book=w544-h544-l90-rj',
      }),
    ).toEqual({
      url: 'https://music.youtube.com/watch?v=k_Z',
      title: 'Epilogue',
      artist: 'YOASOBI',
      album: 'THE BOOK',
      duration: 51,
      thumbnail: 'https://yt3.test/book=w544-h544-l90-rj',
    })
  })

  it('skips a row that is not a song', () => {
    expect(songRow({ flexColumns: [] })).toBeNull()
  })
})

describe('YouTubeMusicLists', () => {
  const logger = createLogger('silent')

  it('asks a search for songs only', async () => {
    const asked: { url: string; body: unknown }[] = []
    const lists = new YouTubeMusicLists(logger, (url, init) => {
      asked.push({ url, body: JSON.parse(String(init?.body)) })
      return answer({
        contents: [row('by4', [[{ text: '夜に駆ける' }], [artist('YOASOBI')]], '4:22', 'by4')],
      })()
    })
    const songs = await lists.songs('yoasobi')
    expect(asked[0]?.url).toContain('youtubei/v1/search')
    expect(asked[0]?.body).toMatchObject({ query: 'yoasobi', params: expect.stringMatching(/^Eg/) })
    expect(songs?.map(song => [song.title, song.artist])).toEqual([['夜に駆ける', 'YOASOBI']])
  })

  it("reads an album: its title as every song's album, its artist and cover as theirs", async () => {
    const lists = new YouTubeMusicLists(
      logger,
      answer({
        header: header('THE BOOK', {
          artist: 'YOASOBI',
          count: '2 songs • 5 minutes',
          cover: 'book',
        }),
        contents: [
          row('k_Z', [[{ text: 'Epilogue' }], [], [{ text: '5.1M plays' }]], '0:51'),
          row('qFe', [[{ text: 'アンコール' }], [], [{ text: '90M plays' }]], '4:32'),
        ],
      }),
    )
    const result = await lists.album('MPREb_hqiB0KumHYT')
    expect(result?.title).toBe('THE BOOK')
    expect(result?.tracks.map(t => [t.title, t.artist, t.album, t.duration, t.thumbnail])).toEqual([
      ['Epilogue', 'YOASOBI', 'THE BOOK', 51, 'https://yt3.test/book=w544-h544-l90-rj'],
      ['アンコール', 'YOASOBI', 'THE BOOK', 272, 'https://yt3.test/book=w544-h544-l90-rj'],
    ])
  })

  it('reads a playlist, each row naming its own artist, album and cover', async () => {
    const asked: unknown[] = []
    const lists = new YouTubeMusicLists(logger, (_url, init) => {
      asked.push(JSON.parse(String(init?.body)))
      return answer({
        header: header('Never Ending Stories Tour', { count: '1 song • 3 minutes' }),
        contents: [
          row(
            'm9S',
            [[{ text: 'アイドル' }], [artist('YOASOBI')], [album('アイドル')]],
            '3:34',
            'idol',
          ),
        ],
      })()
    })
    const result = await lists.playlist('PLcKNQQ5neMz2J5RP49n')
    expect(asked[0]).toMatchObject({ browseId: 'VLPLcKNQQ5neMz2J5RP49n' })
    expect(result?.title).toBe('Never Ending Stories Tour')
    expect(result?.complete).toBe(true)
    expect(result?.tracks[0]).toMatchObject({
      title: 'アイドル',
      artist: 'YOASOBI',
      album: 'アイドル',
      duration: 214,
      thumbnail: 'https://yt3.test/idol=w544-h544-l90-rj',
    })
  })

  it("reads an album's own playlist, answered without a header, from the album's page", async () => {
    const asked: string[] = []
    const lists = new YouTubeMusicLists(logger, (_url, init) => {
      const { browseId } = JSON.parse(String(init?.body)) as { browseId: string }
      asked.push(browseId)
      if (browseId.startsWith('VL')) {
        // Rows only: no header names the list, but each row names its album.
        return answer({
          contents: [
            row('k_Z', [[{ text: 'Epilogue' }], [artist('YOASOBI')], [album('THE BOOK')]], '0:51'),
          ],
        })()
      }
      return answer({
        header: header('THE BOOK', { artist: 'YOASOBI', count: '1 song • 1 minute' }),
        contents: [row('k_Z', [[{ text: 'Epilogue' }], [], [{ text: '5.1M plays' }]], '0:51')],
      })()
    })
    const result = await lists.playlist('OLAK5uy_kMq7')
    expect(asked).toEqual(['VLOLAK5uy_kMq7', 'MPREb_1'])
    expect(result?.title).toBe('THE BOOK')
    expect(result?.complete).toBe(true)
    expect(result?.tracks.map(t => [t.title, t.artist, t.album])).toEqual([
      ['Epilogue', 'YOASOBI', 'THE BOOK'],
    ])
  })

  it('hands over a playlist it was answered only part of, and says so', async () => {
    const lists = new YouTubeMusicLists(
      logger,
      answer({
        header: header('Everything', { count: '250 songs • 14 hours' }),
        contents: [row('one', [[{ text: 'One' }]], '3:00')],
      }),
    )
    const result = await lists.playlist('PLlong')
    expect(result?.complete).toBe(false)
    expect(result?.tracks.map(track => track.title)).toEqual(['One'])
  })

  it('is null when YouTube Music does not answer, or answers no page', async () => {
    const down = new YouTubeMusicLists(logger, () =>
      Promise.resolve(new Response('', { status: 503 })),
    )
    expect(await down.songs('yoasobi')).toBeNull()
    expect(await down.album('MPREb_x')).toBeNull()
    const empty = new YouTubeMusicLists(logger, answer({ contents: [] }))
    expect(await empty.playlist('PLx')).toBeNull()
  })
})

describe('coverSized', () => {
  it('asks the same address for a larger picture, and leaves other addresses be', () => {
    expect(coverSized('https://yt3.test/x=w120-h120-l90-rj')).toBe(
      'https://yt3.test/x=w544-h544-l90-rj',
    )
    expect(coverSized('https://i.ytimg.test/vi/x/hqdefault.jpg')).toBe(
      'https://i.ytimg.test/vi/x/hqdefault.jpg',
    )
  })
})

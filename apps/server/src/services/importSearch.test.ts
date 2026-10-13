import { describe, expect, it } from 'vitest'
import { searchRows, searchSongs } from './importSearch.js'
import type { NeteaseTrack } from './netease.js'
import type { ProbedTrack } from './ytdlp.js'

const yt = (title: string, artist: string, duration: number, id: string): ProbedTrack => ({
  url: `https://music.youtube.com/watch?v=${id}`,
  title,
  artist,
  album: '',
  duration,
  thumbnail: `https://lh3.googleusercontent.com/${id}`,
})

const ne = (title: string, artist: string, duration: number, id: string, free: boolean) =>
  ({
    url: `https://music.163.com/#/song?id=${id}`,
    title,
    artist,
    album: title,
    duration,
    thumbnail: `https://p1.music.126.net/${id}.jpg`,
    free,
  }) satisfies NeteaseTrack

/** What the two places answered for "孤勇者" on 2026-10-12, in their order. */
const YOUTUBE = [
  yt(
    '孤勇者 (《英雄聯盟：雙城之戰》動畫劇集中文主題曲) - Warrior of the Darkness',
    'Eason Chan',
    256,
    'E-MBcgOPHJg',
  ),
  yt('孤勇者', 'холли ветролов', 198, 'gYCUK7Jpevc'),
  yt('盖世孤勇者 (DJ咚鼓版)', '韩冬东', 245, 'p-ilUT7PQio'),
  yt('孤勇者 (现场)', '安達組合', 300, 'WTguAM_usuU'),
]
const NETEASE = [
  ne('孤勇者', '陈奕迅', 256, '1901371647', false),
  ne('孤勇者 (Single Version)', '田一名', 255, '2', true),
  ne('孤勇者 (童声版)', '王静瑶', 256, '3', false),
  ne('孤勇者 (女声版)', '庄园', 253, '4', true),
]

describe('searchRows', () => {
  it('pairs a song 网易云 only previews with YouTube’s, named as 网易云 names it', () => {
    const rows = searchRows(YOUTUBE, NETEASE)
    const first = rows[0]
    expect(first).toMatchObject({
      title: '孤勇者',
      artist: '陈奕迅',
      source: 'youtube',
      url: 'https://music.youtube.com/watch?v=E-MBcgOPHJg',
      netease: { url: 'https://music.163.com/#/song?id=1901371647', free: false },
      youtube: { url: 'https://music.youtube.com/watch?v=E-MBcgOPHJg', match: 'sure' },
    })
    // Eason Chan's song is that row; it is not drawn a second time.
    expect(rows.filter(row => row.url.includes('E-MBcgOPHJg'))).toHaveLength(1)
  })

  it('never pairs a cover 网易云 gives out with another singer’s song of its name and length', () => {
    const rows = searchRows(YOUTUBE, NETEASE)
    const cover = rows.find(row => row.artist === '田一名')
    expect(cover).toMatchObject({ source: 'netease', youtube: null })
    expect(cover?.netease).toEqual({ url: 'https://music.163.com/#/song?id=2', free: true })
  })

  it('looks for a song 网易云 only previews on YouTube when no answer is surely it', () => {
    const rows = searchRows(YOUTUBE, NETEASE)
    expect(rows.find(row => row.artist === '王静瑶')).toMatchObject({
      url: '',
      source: 'youtube',
      netease: { url: 'https://music.163.com/#/song?id=3', free: false },
      youtube: { url: null, match: 'looking' },
    })
  })

  it('takes turns, YouTube Music first, every answer once', () => {
    const rows = searchRows(YOUTUBE, NETEASE)
    expect(rows.map(row => `${row.title} · ${row.artist}`)).toEqual([
      '孤勇者 · 陈奕迅',
      '孤勇者 · холли ветролов',
      '孤勇者 (Single Version) · 田一名',
      '盖世孤勇者 (DJ咚鼓版) · 韩冬东',
      '孤勇者 (童声版) · 王静瑶',
      '孤勇者 (现场) · 安達組合',
      '孤勇者 (女声版) · 庄园',
    ])
  })

  it('pairs a song 网易云 gives out with the same recording on YouTube, from 网易云', () => {
    const rows = searchRows(
      [yt('Get Lucky', 'Daft Punk', 248, 'lucky')],
      [ne('Get Lucky', 'Daft Punk', 249, '9', true)],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      source: 'netease',
      url: 'https://music.163.com/#/song?id=9',
      youtube: { url: 'https://music.youtube.com/watch?v=lucky', match: 'sure' },
    })
  })

  it('draws a pair where 网易云 placed it when 网易云 placed it first', () => {
    const rows = searchRows(
      [yt('Other', 'Someone', 200, 'other'), yt('Get Lucky', 'Daft Punk', 248, 'lucky')],
      [ne('Get Lucky', 'Daft Punk', 248, '9', true)],
    )
    expect(rows.map(row => row.title)).toEqual(['Other', 'Get Lucky'])
    const late = searchRows(
      [yt('Get Lucky', 'Daft Punk', 248, 'lucky')],
      [ne('Other', 'Someone', 200, '1', true), ne('Get Lucky', 'Daft Punk', 248, '9', true)],
    )
    expect(late.map(row => row.title)).toEqual(['Get Lucky', 'Other'])
  })
})

describe('searchSongs', () => {
  const deps = (
    youtube: ProbedTrack[] | null,
    netease: NeteaseTrack[],
    library: { id: number; url: string; title: string; artist: string; duration: number }[] = [],
  ) => ({
    songs: { all: () => library as never },
    cloudRepo: { states: () => new Map() },
    cloudSync: { connected: false },
    imports: { pendingUrls: () => ['https://music.youtube.com/watch?v=gYCUK7Jpevc'] },
    youtubeMusicLists: { songs: () => Promise.resolve(youtube) },
    netease: { search: () => Promise.resolve(netease) },
  })

  it('says which songs are yours already and which are on their way', async () => {
    const items = await searchSongs(
      deps(
        YOUTUBE,
        [],
        [
          {
            id: 1,
            url: 'https://www.youtube.com/watch?v=WTguAM_usuU',
            title: '孤勇者 (现场)',
            artist: '安達組合',
            duration: 300,
          },
        ],
      ),
      '孤勇者',
    )
    expect(items.find(item => item.artist === '安達組合')?.alreadyHave).toBe(true)
    expect(items.find(item => item.artist === 'холли ветролов')?.inQueue).toBe(true)
    expect(items.find(item => item.artist === '韩冬东')).toMatchObject({
      alreadyHave: false,
      inQueue: false,
    })
  })

  it('answers with what one place found when the other is silent', async () => {
    const items = await searchSongs(deps(null, NETEASE), '孤勇者')
    expect(items).toHaveLength(NETEASE.length)
  })

  it('says so when neither place answered', async () => {
    await expect(searchSongs(deps(null, []), '孤勇者')).rejects.toThrow(/Neither/)
  })

  it('answers nothing found with no rows', async () => {
    await expect(searchSongs(deps([], []), 'zzzz')).resolves.toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { NeteaseMusic, toTracks, withoutCredits } from './netease.js'

/** 网易云's API, answering from a table of paths; a POST is keyed by its path and form. */
function fakeApi(answers: Record<string, unknown>, redirects: Record<string, string> = {}) {
  const asked: string[] = []
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const target = redirects[url]
    if (target) return new Response(null, { status: 302, headers: { location: target } })
    const key = init?.method === 'POST' ? `${url} ${String(init.body)}` : url
    asked.push(key)
    const answer = answers[key]
    if (answer === undefined) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(answer), { status: 200 })
  }
  return { netease: new NeteaseMusic(createLogger('silent'), fetchImpl), asked }
}

const API = 'https://music.163.com/api/'
const detail = (ids: number[]) =>
  `${API}v3/song/detail ${new URLSearchParams({ c: JSON.stringify(ids.map(id => ({ id }))) }).toString()}`

const songs = [
  {
    id: 1973665667,
    name: '海屿你',
    dt: 295_940,
    ar: [{ name: '马也_Crabbit' }],
    al: { name: '海屿你', picUrl: 'http://p2.music.126.net/a.jpg' },
  },
  {
    id: 1901371647,
    name: '孤勇者',
    dt: 256_000,
    ar: [{ name: '陈奕迅' }],
    al: { name: '孤勇者', picUrl: 'http://p1.music.126.net/b.jpg' },
  },
  { id: 186016, name: '晴天', dt: 269_000, ar: [{ name: '周杰伦' }], al: { name: '叶惠美' } },
]
const privileges = [
  { id: 1973665667, pl: 320_000, st: 0 },
  { id: 1901371647, pl: 0, st: -100 },
  { id: 186016, pl: 0, st: -100 },
]

describe('toTracks', () => {
  it('says which songs 网易云 gives out whole, from what this server may play', () => {
    const tracks = toTracks(songs, privileges)
    expect(tracks.map(track => [track.title, track.free])).toEqual([
      ['海屿你', true],
      ['孤勇者', false],
      ['晴天', false],
    ])
    expect(tracks[0]).toEqual({
      url: 'https://music.163.com/song?id=1973665667',
      title: '海屿你',
      artist: '马也_Crabbit',
      album: '海屿你',
      duration: 296,
      thumbnail: 'https://p2.music.126.net/a.jpg?param=1000y1000',
      free: true,
    })
    expect(tracks[2]?.thumbnail).toBeNull()
  })

  it('takes a song with no privileges for one it may not play', () => {
    expect(toTracks([songs[0]!], [])[0]?.free).toBe(false)
  })

  it('names every artist, and drops a song with no name', () => {
    const [track, ...rest] = toTracks(
      [
        { id: 1, name: 'Duet', ar: [{ name: 'A' }, { name: 'B' }] },
        { id: 2, name: '  ' },
      ],
      [],
    )
    expect(track?.artist).toBe('A, B')
    expect(rest).toEqual([])
  })
})

describe('withoutCredits', () => {
  it('drops the credits at the start and the end, and keeps the words', () => {
    const lrc = [
      '[00:00.000] 作词 : 唐恬',
      '[00:00.463] 作曲 : 钱雷',
      '[00:01.852] 制作人：钱雷',
      '[00:12.10]都 是勇敢的',
      '[00:15.20]He said: go',
      '[00:18.00]',
      '[04:10.00] 母带 : 周天澈',
    ].join('\n')
    expect(withoutCredits(lrc)).toBe(
      ['[00:12.10]都 是勇敢的', '[00:15.20]He said: go', '[00:18.00]'].join('\n'),
    )
  })

  it('keeps a song with no credits as it is, and has nothing for credits alone', () => {
    expect(withoutCredits('[00:01.00]line one\n[00:02.00]line two')).toBe(
      '[00:01.00]line one\n[00:02.00]line two',
    )
    expect(withoutCredits('[00:00.00] 作词 : A\n[00:01.00] 作曲 : B')).toBe('')
  })
})

describe('NeteaseMusic', () => {
  it('reads a playlist: its name, then every song with what this server may play', async () => {
    const { netease } = fakeApi({
      [`${API}v6/playlist/detail?id=3778678&n=100000`]: {
        code: 200,
        playlist: { name: '热歌榜', trackIds: [{ id: 1973665667 }, { id: 1901371647 }] },
      },
      [detail([1973665667, 1901371647])]: {
        code: 200,
        songs: songs.slice(0, 2),
        privileges: privileges.slice(0, 2),
      },
    })
    const list = await netease.list({ kind: 'playlist', id: '3778678' })
    expect(list.title).toBe('热歌榜')
    expect(list.tracks.map(track => [track.title, track.free])).toEqual([
      ['海屿你', true],
      ['孤勇者', false],
    ])
  })

  it('reads an album and one song the same way', async () => {
    const { netease } = fakeApi({
      [`${API}v1/album/18905`]: { code: 200, album: { name: '叶惠美' }, songs: [{ id: 186016 }] },
      [detail([186016])]: { code: 200, songs: [songs[2]], privileges: [privileges[2]] },
    })
    expect((await netease.list({ kind: 'album', id: '18905' })).title).toBe('叶惠美')
    const one = await netease.list({ kind: 'song', id: '186016' })
    expect(one.title).toBeNull()
    expect(one.tracks.map(track => track.title)).toEqual(['晴天'])
  })

  it('says so when 网易云 does not answer, or answers with its own refusal', async () => {
    const { netease } = fakeApi({
      [`${API}v6/playlist/detail?id=1&n=100000`]: { code: -447 },
    })
    await expect(netease.list({ kind: 'playlist', id: '1' })).rejects.toThrow(/did not answer/)
    await expect(netease.list({ kind: 'playlist', id: '2' })).rejects.toThrow(/did not answer/)
  })

  it('follows a short link to the page it stands for', async () => {
    const { netease } = fakeApi(
      {},
      {
        'https://163cn.tv/abc': 'https://y.music.163.com/m/playlist?id=42&userid=7',
        'https://163cn.tv/gone': 'https://music.163.com/#404',
      },
    )
    expect(await netease.link('https://163cn.tv/abc')).toEqual({ kind: 'playlist', id: '42' })
    expect(await netease.link('https://163cn.tv/gone')).toBeNull()
    expect(await netease.link('https://music.163.com/#/song?id=5')).toEqual({
      kind: 'song',
      id: '5',
    })
  })

  it('fetches a song’s words without the credits, and knows a song without any', async () => {
    const { netease } = fakeApi({
      [`${API}song/lyric?id=1&lv=1`]: {
        code: 200,
        lrc: { lyric: '[00:00.00] 作词 : A\n[00:10.00]第一句' },
      },
      [`${API}song/lyric?id=2&lv=1`]: { code: 200, pureMusic: true },
      [`${API}song/lyric?id=3&lv=1`]: { code: 200, lrc: { lyric: '' } },
    })
    expect(await netease.lyrics('1')).toEqual({ text: '[00:10.00]第一句' })
    expect(await netease.lyrics('2')).toBe('instrumental')
    expect(await netease.lyrics('3')).toBeNull()
    expect(await netease.lyrics('4')).toBeNull()
  })
})

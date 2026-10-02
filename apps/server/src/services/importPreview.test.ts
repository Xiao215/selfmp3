import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { EMPTY_SMART_RULES } from '@selfmp3/shared'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { PlaylistRepository } from '../repositories/playlists.js'
import {
  buildImportPreview,
  findLooking,
  previewFound,
  resolveImportPlaylist,
  withMusicDetails,
} from './importPreview.js'
import type { NeteaseList } from './netease.js'
import type { SpotifyList } from './spotify.js'
import type { ProbedTrack } from './ytdlp.js'
import type { ArtistSongs } from './youtubeMusicArtist.js'
import type { SongList } from './youtubeMusicLists.js'

/** The real schema on an in-memory database, the same way smartPlaylist.test does. */
function makePlaylists(): PlaylistRepository {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db, createLogger('silent'))
  return new PlaylistRepository(db)
}

describe('resolveImportPlaylist', () => {
  it('returns null when nothing was asked for', () => {
    const playlists = makePlaylists()
    expect(resolveImportPlaylist(playlists, { playlistId: null, createPlaylistName: null })).toBe(
      null,
    )
    expect(playlists.all()).toHaveLength(0)
  })

  it('creates a manual playlist by name, and reuses it next time', () => {
    const playlists = makePlaylists()
    const first = resolveImportPlaylist(playlists, {
      playlistId: null,
      createPlaylistName: 'Liked Music',
    })
    expect(first?.name).toBe('Liked Music')
    expect(first?.kind).toBe('manual')

    const second = resolveImportPlaylist(playlists, {
      playlistId: null,
      createPlaylistName: 'liked music',
    })
    expect(second?.id).toBe(first?.id)
    expect(playlists.all()).toHaveLength(1)
  })

  it('prefers an explicit id over a name', () => {
    const playlists = makePlaylists()
    const existing = playlists.create({
      name: 'Road trip',
      description: '',
      kind: 'manual',
      rules: null,
    })
    const resolved = resolveImportPlaylist(playlists, {
      playlistId: existing.id,
      createPlaylistName: 'Something else',
    })
    expect(resolved?.id).toBe(existing.id)
    expect(playlists.all()).toHaveLength(1)
  })

  it('rejects a missing or live playlist', () => {
    const playlists = makePlaylists()
    expect(() =>
      resolveImportPlaylist(playlists, { playlistId: 999, createPlaylistName: null }),
    ).toThrow(/no such playlist/)

    const live = playlists.create({
      name: 'Recent',
      description: '',
      kind: 'live',
      rules: EMPTY_SMART_RULES,
    })
    expect(() =>
      resolveImportPlaylist(playlists, { playlistId: live.id, createPlaylistName: null }),
    ).toThrow(/live playlist/)
  })
})

function track(url: string, title: string, duration = 200): ProbedTrack {
  return { url, title, artist: 'YOASOBI', album: '', duration, thumbnail: null }
}

/** yt-dlp, the library and YouTube Music, each answering from a table. */
function previewDeps(options: {
  playlists?: Record<string, ProbedTrack[]>
  artist?: ArtistSongs | null
  /** What YouTube Music's search answers for any query, or null for no answer. */
  search?: ProbedTrack[] | null
  /** What YouTube Music answers for any album or playlist page, or null for no answer. */
  list?: SongList | null
  have?: { id?: number; artist: string; title: string }[]
  /** The ids of `have` that are in the bucket; given, a bucket is connected. */
  inBucket?: number[]
  /** Links with a job already queued or downloading. */
  pending?: string[]
  /** What 网易云 lists for any link it reads. */
  netease?: NeteaseList
  /** What Spotify lists for any link it reads. */
  spotify?: SpotifyList
}) {
  const probed: string[] = []
  const deps = {
    ytdlp: {
      status: () => Promise.resolve({ ytdlp: true, ffmpeg: true, ytdlpVersion: 'test' }),
      probe: (url: string) => {
        probed.push(url)
        const tracks = options.playlists?.[url]
        if (!tracks) return Promise.reject(new Error(`yt-dlp cannot read ${url}`))
        return Promise.resolve({ kind: 'playlist' as const, playlistTitle: 'Top songs', tracks })
      },
    },
    songs: { all: () => (options.have ?? []).map((song, index) => ({ id: index + 1, ...song })) },
    cloudRepo: { states: () => new Map((options.inBucket ?? []).map(id => [id, {}])) },
    cloudSync: { connected: options.inBucket !== undefined },
    imports: { pendingUrls: () => options.pending ?? [] },
    youtubeMusicArtists: { topSongs: () => Promise.resolve(options.artist ?? null) },
    youtubeMusicLists: {
      songs: () => Promise.resolve(options.search ?? null),
      album: () => Promise.resolve(options.list ?? null),
      playlist: () => Promise.resolve(options.list ?? null),
    },
    netease: {
      link: (url: string) =>
        Promise.resolve(url.includes('163cn.tv') ? null : { kind: 'playlist', id: '1' }),
      list: () =>
        options.netease
          ? Promise.resolve(options.netease)
          : Promise.reject(new Error('网易云音乐 did not answer')),
    },
    spotify: {
      list: () =>
        options.spotify
          ? Promise.resolve(options.spotify)
          : Promise.reject(new Error('Could not read that from Spotify')),
    },
  }
  return { deps: deps as unknown as Parameters<typeof buildImportPreview>[0], probed }
}

describe('buildImportPreview with an album or playlist link', () => {
  const albumPage = 'https://music.youtube.com/browse/MPREb_hqiB0KumHYT'
  const playlistPage = 'https://music.youtube.com/playlist?list=PLcKNQQ5neMz2J5RP49n'

  it('takes an album from YouTube Music, named after it, with the album on every song', async () => {
    const { deps, probed } = previewDeps({
      list: {
        title: 'THE BOOK',
        tracks: [{ ...track('https://y.test/1', 'Epilogue', 51), album: 'THE BOOK' }],
        complete: true,
      },
    })
    const preview = await buildImportPreview(deps, albumPage)
    expect(probed).toEqual([])
    expect(preview.playlistTitle).toBe('THE BOOK')
    expect(preview.items[0]).toMatchObject({ title: 'Epilogue', album: 'THE BOOK', duration: 51 })
  })

  it('falls back to yt-dlp when YouTube Music does not answer a playlist', async () => {
    const { deps, probed } = previewDeps({
      list: null,
      playlists: { [playlistPage]: [track('https://y.test/1', 'アイドル')] },
    })
    const preview = await buildImportPreview(deps, playlistPage)
    expect(probed).toEqual([playlistPage])
    expect(preview.items.map(item => item.title)).toEqual(['アイドル'])
  })

  it("has yt-dlp read a playlist YouTube Music answered part of, keeping YouTube Music's word where it gave one", async () => {
    const { deps, probed } = previewDeps({
      list: {
        title: 'Everything',
        tracks: [
          {
            ...track('https://music.youtube.com/watch?v=aaaaaaaaaaa', 'アイドル', 214),
            artist: 'YOASOBI',
            album: 'THE BOOK 3',
            thumbnail: 'https://yt3.test/idol=w544-h544-l90-rj',
          },
        ],
        complete: false,
      },
      playlists: {
        [playlistPage]: [
          {
            ...track('https://www.youtube.com/watch?v=aaaaaaaaaaa', 'YOASOBI「アイドル」'),
            artist: 'Ayase / YOASOBI',
          },
          {
            ...track('https://www.youtube.com/watch?v=bbbbbbbbbbb', '怪物'),
            artist: 'Ayase / YOASOBI',
            thumbnail: 'https://i.ytimg.test/b.jpg',
          },
        ],
      },
    })
    const preview = await buildImportPreview(deps, playlistPage)
    expect(probed).toEqual([playlistPage])
    expect(preview.playlistTitle).toBe('Everything')
    expect(
      preview.items.map(item => [item.title, item.artist, item.album, item.thumbnail]),
    ).toEqual([
      ['アイドル', 'YOASOBI', 'THE BOOK 3', 'https://yt3.test/idol=w544-h544-l90-rj'],
      ['怪物', 'Ayase / YOASOBI', '', 'https://i.ytimg.test/b.jpg'],
    ])
  })
})

describe('withMusicDetails', () => {
  const named = [
    {
      ...track('https://music.youtube.com/watch?v=aaaaaaaaaaa', 'Bubble', 0),
      artist: 'Yorushika',
      album: '幻燈',
      thumbnail: 'https://yt3.test/a',
    },
  ]
  const listing = [
    {
      ...track('https://www.youtube.com/watch?v=aaaaaaaaaaa', 'Bubble', 235),
      artist: 'ヨルシカ / n-buna Official',
    },
    {
      ...track('https://www.youtube.com/watch?v=ccccccccccc', 'Sunny', 273),
      artist: 'ヨルシカ / n-buna Official',
    },
  ]

  it("keeps the listing's order and length, YouTube Music's details, and yt-dlp's length where YouTube Music gave none", () => {
    expect(withMusicDetails(listing, named, null)).toEqual([
      { ...named[0], duration: 235 },
      listing[1],
    ])
  })

  it("credits a song YouTube Music left out to the artist whose list it is, when it is one artist's", () => {
    expect(withMusicDetails(listing, named, 'Yorushika')[1]).toMatchObject({
      title: 'Sunny',
      artist: 'Yorushika',
    })
  })
})

describe('buildImportPreview with a search link', () => {
  const search = 'https://music.youtube.com/search?q=yoasobi'

  it("takes the search's songs from YouTube Music, named after it, and never asks yt-dlp", async () => {
    const { deps, probed } = previewDeps({
      search: [
        {
          ...track('https://y.test/1', '夜に駆ける'),
          album: '夜に駆ける',
          thumbnail: 'https://yt3.test/a',
        },
        track('https://y.test/2', '怪物'),
      ],
      have: [{ artist: 'YOASOBI', title: '怪物' }],
    })
    const preview = await buildImportPreview(deps, search)
    expect(probed).toEqual([])
    expect(preview.kind).toBe('playlist')
    expect(preview.playlistTitle).toBe('yoasobi')
    expect(preview.items.map(item => [item.title, item.album, item.alreadyHave])).toEqual([
      ['夜に駆ける', '夜に駆ける', false],
      ['怪物', '', true],
    ])
  })

  it('says a song this server holds but the bucket does not is yours, and waiting to upload', async () => {
    const { deps } = previewDeps({
      search: [track('https://y.test/1', '夜に駆ける'), track('https://y.test/2', '怪物')],
      have: [
        { artist: 'YOASOBI', title: '夜に駆ける' },
        { artist: 'YOASOBI', title: '怪物' },
      ],
      // The first is in the bucket; the second's upload has not gone through.
      inBucket: [1],
    })
    const preview = await buildImportPreview(deps, search)
    expect(preview.items.map(item => [item.alreadyHave, item.waitingToUpload])).toEqual([
      [true, false],
      [true, true],
    ])
  })

  it('says a song a job is already queued for is in the queue, whichever link queued it', async () => {
    const { deps } = previewDeps({
      search: [
        track('https://music.youtube.com/watch?v=by4SYYWlhEs', '夜に駆ける'),
        track('https://music.youtube.com/watch?v=xxxxxxxxxxx', '怪物'),
      ],
      pending: ['https://youtu.be/by4SYYWlhEs'],
    })
    const preview = await buildImportPreview(deps, search)
    expect(preview.items.map(item => [item.alreadyHave, item.inQueue])).toEqual([
      [false, true],
      [false, false],
    ])
  })

  it("counts nothing as waiting without a bucket: this server's library is the library", async () => {
    const { deps } = previewDeps({
      search: [track('https://y.test/1', '夜に駆ける')],
      have: [{ artist: 'YOASOBI', title: '夜に駆ける' }],
    })
    const preview = await buildImportPreview(deps, search)
    expect(preview.items[0]).toMatchObject({ alreadyHave: true, waitingToUpload: false })
  })

  it('says so when YouTube Music does not answer', async () => {
    const { deps } = previewDeps({ search: null })
    await expect(buildImportPreview(deps, search)).rejects.toThrow(/did not answer/)
  })
})

describe('buildImportPreview with an artist link', () => {
  const songsList = 'https://music.youtube.com/playlist?list=OLAK5uy_songs'

  it("imports the artist's top songs as a playlist named after them", async () => {
    const { deps, probed } = previewDeps({
      artist: { artist: 'YOASOBI', playlistUrl: songsList, tracks: [] },
      playlists: {
        [songsList]: [
          track('https://y.test/1', 'アイドル'),
          track('https://y.test/2', '夜に駆ける'),
        ],
      },
      have: [{ artist: 'YOASOBI', title: '夜に駆ける' }],
    })

    const preview = await buildImportPreview(deps, 'https://music.youtube.com/@YOASOBI_Official')

    // The channel link itself never reaches yt-dlp, which would read it as tabs.
    expect(probed).toEqual([songsList])
    expect(preview.kind).toBe('playlist')
    expect(preview.playlistTitle).toBe('YOASOBI')
    expect(preview.items.map(item => [item.title, item.artist, item.alreadyHave])).toEqual([
      ['アイドル', 'YOASOBI', false],
      ['夜に駆ける', 'YOASOBI', true],
    ])
  })

  it("takes the artist's list from YouTube Music when it answers whole, and never asks yt-dlp", async () => {
    const { deps, probed } = previewDeps({
      artist: { artist: 'YOASOBI', playlistUrl: songsList, tracks: [] },
      list: {
        title: 'Top songs',
        tracks: [{ ...track('https://y.test/1', 'アイドル'), album: 'THE BOOK 3' }],
        complete: true,
      },
    })

    const preview = await buildImportPreview(deps, 'https://music.youtube.com/@YOASOBI_Official')

    expect(probed).toEqual([])
    expect(preview.playlistTitle).toBe('YOASOBI')
    expect(preview.items[0]).toMatchObject({ title: 'アイドル', album: 'THE BOOK 3' })
  })

  it('uses the rows from the page when there is no See all', async () => {
    const { deps, probed } = previewDeps({
      artist: {
        artist: 'YOASOBI',
        playlistUrl: null,
        tracks: [track('https://y.test/1', 'アイドル', 0)],
      },
    })

    const preview = await buildImportPreview(deps, 'https://www.youtube.com/@YOASOBI_Official')

    expect(probed).toEqual([])
    expect(preview.items).toHaveLength(1)
    expect(preview.playlistTitle).toBe('YOASOBI')
  })

  it('explains a channel with no songs instead of listing its tabs', async () => {
    const { deps } = previewDeps({ artist: null })
    await expect(buildImportPreview(deps, 'https://www.youtube.com/@mkbhd')).rejects.toThrow(
      /no songs on YouTube Music/,
    )
  })

  it('still hands a channel tab to yt-dlp as it is', async () => {
    const videos = 'https://www.youtube.com/@YOASOBI_Official/videos'
    const { deps, probed } = previewDeps({
      playlists: { [videos]: [track('https://y.test/v', 'MV')] },
    })

    await buildImportPreview(deps, videos)

    expect(probed).toEqual([videos])
  })
})

describe('buildImportPreview with a 网易云 link', () => {
  const chart = 'https://music.163.com/#/playlist?id=3778678'
  const netease: NeteaseList = {
    title: '热歌榜',
    tracks: [
      {
        url: 'https://music.163.com/song?id=1',
        title: '海屿你',
        artist: '马也_Crabbit',
        album: '海屿你',
        duration: 296,
        thumbnail: 'https://p2.music.126.net/a.jpg?param=1000y1000',
        free: true,
      },
      {
        url: 'https://music.163.com/song?id=2',
        title: '孤勇者',
        artist: '陈奕迅',
        album: '孤勇者',
        duration: 256,
        thumbnail: 'https://p1.music.126.net/b.jpg?param=1000y1000',
        free: false,
      },
    ],
  }

  it('downloads what 网易云 gives out whole, and looks for the rest on YouTube', async () => {
    const { deps, probed } = previewDeps({ netease })
    const preview = await buildImportPreview(deps, `分享歌单《热歌榜》: ${chart} (来自@网易云音乐)`)
    expect(probed).toEqual([])
    expect(preview).toMatchObject({ kind: 'playlist', playlistTitle: '热歌榜', from: 'netease' })
    expect(preview.items[0]).toMatchObject({
      url: 'https://music.163.com/song?id=1',
      source: 'netease',
      netease: { url: 'https://music.163.com/song?id=1', free: true },
      youtube: null,
    })
    // Its 网易云 cover stays; only the audio comes from YouTube.
    expect(preview.items[1]).toMatchObject({
      url: '',
      source: 'youtube',
      thumbnail: 'https://p1.music.126.net/b.jpg?param=1000y1000',
      netease: { url: 'https://music.163.com/song?id=2', free: false },
      youtube: { url: null, match: 'looking' },
    })
  })

  it('knows a 网易云 song already in the library by its name', async () => {
    const { deps } = previewDeps({ netease, have: [{ artist: '陈奕迅', title: '孤勇者' }] })
    const preview = await buildImportPreview(deps, chart)
    expect(preview.items.map(item => item.alreadyHave)).toEqual([false, true])
  })

  it('says why when the link opens nothing it can read', async () => {
    const { deps } = previewDeps({ netease })
    await expect(buildImportPreview(deps, 'https://163cn.tv/gone')).rejects.toThrow(/Share button/)
    const { deps: silent } = previewDeps({})
    await expect(buildImportPreview(silent, chart)).rejects.toThrow(/did not answer/)
  })
})

describe('buildImportPreview with a Spotify link or a list of songs', () => {
  it('lists Spotify’s songs to be found on YouTube', async () => {
    const { deps } = previewDeps({
      spotify: {
        title: 'Summer Mix',
        tracks: [{ title: 'Get Lucky', artist: 'Daft Punk', album: '', duration: 248 }],
      },
    })
    const preview = await buildImportPreview(
      deps,
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    )
    expect(preview).toMatchObject({
      kind: 'playlist',
      playlistTitle: 'Summer Mix',
      from: 'spotify',
    })
    expect(preview.items[0]).toMatchObject({
      url: '',
      title: 'Get Lucky',
      source: 'youtube',
      netease: null,
      youtube: { url: null, match: 'looking' },
    })
  })

  it('reads words with no link in them as songs to find', async () => {
    const { deps } = previewDeps({})
    const preview = await buildImportPreview(deps, 'Daft Punk - Get Lucky\nRadiohead - Creep')
    expect(preview.from).toBe('list')
    expect(preview.items.map(item => `${item.artist}|${item.title}`)).toEqual([
      'Daft Punk|Get Lucky',
      'Radiohead|Creep',
    ])
  })

  it('refuses words that are not songs', async () => {
    const { deps } = previewDeps({})
    await expect(buildImportPreview(deps, '   \n  ')).rejects.toThrow(/one song per line/)
  })
})

describe('findLooking and previewFound', () => {
  const looking = {
    url: '',
    title: 'Get Lucky',
    artist: 'Daft Punk',
    album: '',
    duration: 248,
    thumbnail: null,
    alreadyHave: false,
    waitingToUpload: false,
    inQueue: false,
    source: 'youtube' as const,
    netease: null,
    youtube: { url: null, match: 'looking' as const },
  }
  const found = {
    url: 'https://www.youtube.com/watch?v=5NV6Rdv1a3I',
    title: 'Get Lucky',
    artist: 'Daft Punk',
    album: 'Random Access Memories',
    duration: 248,
    thumbnail: 'https://lh3.googleusercontent.com/x=w544-h544',
    sure: true,
  }

  it('fills in what was found and marks what was not', async () => {
    const items = await findLooking(
      { find: async tracks => tracks.map((_, i) => (i === 0 ? found : null)) },
      [looking, { ...looking, title: 'Nothing' }],
    )
    expect(items[0]).toMatchObject({
      url: found.url,
      album: 'Random Access Memories',
      thumbnail: found.thumbnail,
      youtube: { url: found.url, match: 'sure' },
    })
    expect(items[1]).toMatchObject({ url: '', youtube: { url: null, match: 'none' } })
  })

  it('leaves out a song nothing was found for, where nobody reviews it', async () => {
    const { deps } = previewDeps({})
    const preview = await previewFound(
      {
        ...deps,
        youtubeMatcher: { find: async tracks => tracks.map((_, i) => (i === 0 ? found : null)) },
      },
      'Daft Punk - Get Lucky\nNobody - Nothing',
    )
    expect(preview.items.map(item => item.url)).toEqual([found.url])
  })
})

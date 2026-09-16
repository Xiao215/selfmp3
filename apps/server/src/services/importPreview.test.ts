import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { EMPTY_SMART_RULES } from '@selfmp3/shared'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { PlaylistRepository } from '../repositories/playlists.js'
import { buildImportPreview, resolveImportPlaylist } from './importPreview.js'
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
  have?: { artist: string; title: string }[]
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
    songs: { all: () => options.have ?? [] },
    youtubeMusicArtists: { topSongs: () => Promise.resolve(options.artist ?? null) },
    youtubeMusicLists: {
      songs: () => Promise.resolve(options.search ?? null),
      album: () => Promise.resolve(options.list ?? null),
      playlist: () => Promise.resolve(options.list ?? null),
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
      },
    })
    const preview = await buildImportPreview(deps, albumPage)
    expect(probed).toEqual([])
    expect(preview.playlistTitle).toBe('THE BOOK')
    expect(preview.items[0]).toMatchObject({ title: 'Epilogue', album: 'THE BOOK', duration: 51 })
  })

  it('falls back to yt-dlp when YouTube Music does not answer a playlist whole', async () => {
    const { deps, probed } = previewDeps({
      list: null,
      playlists: { [playlistPage]: [track('https://y.test/1', 'アイドル')] },
    })
    const preview = await buildImportPreview(deps, playlistPage)
    expect(probed).toEqual([playlistPage])
    expect(preview.items.map(item => item.title)).toEqual(['アイドル'])
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
    expect(preview.items.map(item => [item.title, item.alreadyHave])).toEqual([
      ['アイドル', false],
      ['夜に駆ける', true],
    ])
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

import { describe, expect, it } from 'vitest'
import type { Playlist, Song } from '@selfmp3/shared'
import {
  buildBrowseTree,
  nodeById,
  resolveMediaId,
  ROOT_ID,
  searchBrowseTree,
  type BrowseInput,
} from './browseTree'

const song = (id: number, patch: Partial<Song> = {}): Song => ({
  id,
  path: `music/${id}.mp3`,
  title: `Song ${id}`,
  artist: 'Artist',
  album: 'Album',
  albumArtist: '',
  trackNo: null,
  year: null,
  duration: 180,
  sizeBytes: 1000,
  mime: 'audio/mpeg',
  hasArt: false,
  lyricsKind: 'none',
  playCount: 0,
  skipCount: 0,
  loved: false,
  sourceUrl: null,
  lastPlayedAt: null,
  addedAt: '2025-01-01T00:00:00.000Z',
  missing: false,
  tagIds: [],
  features: null,
  ...patch,
})

const playlist = (id: number, patch: Partial<Playlist> = {}): Playlist => ({
  id,
  name: `Playlist ${id}`,
  description: '',
  kind: 'manual',
  rules: null,
  songCount: 0,
  totalDuration: 0,
  pinned: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  ...patch,
})

const input = (patch: Partial<BrowseInput> = {}): BrowseInput => ({
  songs: [],
  playlists: [],
  playlistSongIds: {},
  ...patch,
})

describe('buildBrowseTree', () => {
  it('always has the four root sections, even with an empty library', () => {
    const tree = buildBrowseTree(input())
    expect(nodeById(tree, ROOT_ID)?.items.map(item => item.id)).toEqual([
      'playlists',
      'albums',
      'artists',
      'recent',
    ])
  })

  it('groups songs into albums, ordered by track number', () => {
    const tree = buildBrowseTree(
      input({
        songs: [
          song(1, { album: 'Blue', trackNo: 3 }),
          song(2, { album: 'Blue', trackNo: 1 }),
          song(3, { album: 'Amber', trackNo: 1 }),
        ],
      }),
    )

    expect(nodeById(tree, 'albums')?.items.map(item => item.title)).toEqual(['Amber', 'Blue'])
    expect(nodeById(tree, 'album.Blue')?.songIds).toEqual([2, 1])
  })

  it('sorts a track with no number last rather than first', () => {
    const tree = buildBrowseTree(
      input({
        songs: [song(1, { trackNo: null }), song(2, { trackNo: 9 })],
      }),
    )
    expect(nodeById(tree, 'album.Album')?.songIds).toEqual([2, 1])
  })

  it('prefers the album artist when grouping artists', () => {
    const tree = buildBrowseTree(
      input({
        songs: [
          song(1, { artist: 'Guest', albumArtist: 'Main' }),
          song(2, { artist: 'Main', albumArtist: '' }),
        ],
      }),
    )
    expect(nodeById(tree, 'artists')?.items.map(item => item.title)).toEqual(['Main'])
    expect(nodeById(tree, 'artist.Main')?.songIds).toEqual([1, 2])
  })

  it('skips blank album and artist names instead of showing an empty row', () => {
    const tree = buildBrowseTree(input({ songs: [song(1, { album: '   ', artist: '' })] }))
    expect(nodeById(tree, 'albums')?.items).toEqual([])
    expect(nodeById(tree, 'artists')?.items).toEqual([])
  })

  it('leaves missing songs out — there is nothing a driver can do about them', () => {
    const tree = buildBrowseTree(input({ songs: [song(1), song(2, { missing: true })] }) )
    expect(nodeById(tree, 'recent')?.songIds).toEqual([1])
  })

  it('orders recently added newest first and honours the limit', () => {
    const tree = buildBrowseTree(
      input({
        songs: [
          song(1, { addedAt: '2025-01-01T00:00:00.000Z' }),
          song(2, { addedAt: '2025-06-01T00:00:00.000Z' }),
          song(3, { addedAt: '2025-03-01T00:00:00.000Z' }),
        ],
      }),
      { recentLimit: 2 },
    )
    expect(nodeById(tree, 'recent')?.songIds).toEqual([2, 3])
  })

  it('puts pinned playlists first and resolves their contents in order', () => {
    const tree = buildBrowseTree(
      input({
        songs: [song(1), song(2), song(3)],
        playlists: [playlist(1, { name: 'Zeta' }), playlist(2, { name: 'Alpha', pinned: true })],
        playlistSongIds: { 1: [3, 1], 2: [2] },
      }),
    )
    expect(nodeById(tree, 'playlists')?.items.map(item => item.title)).toEqual(['Alpha', 'Zeta'])
    expect(nodeById(tree, 'playlist.1')?.songIds).toEqual([3, 1])
  })

  it('drops playlist entries whose song is gone', () => {
    const tree = buildBrowseTree(
      input({
        songs: [song(1)],
        playlists: [playlist(1)],
        playlistSongIds: { 1: [1, 99] },
      }),
    )
    expect(nodeById(tree, 'playlist.1')?.songIds).toEqual([1])
  })

  it('caps a node at the head unit list limit', () => {
    const songs = Array.from({ length: 10 }, (_, i) => song(i + 1))
    const tree = buildBrowseTree(input({ songs }), { maxItemsPerNode: 4 })
    expect(nodeById(tree, 'album.Album')?.items).toHaveLength(4)
  })

  it('encodes names that would otherwise collide with the id format', () => {
    const tree = buildBrowseTree(input({ songs: [song(1, { album: 'a|b.c' })] }))
    const item = nodeById(tree, 'albums')?.items[0]
    expect(item?.id).toBe('album.a%7Cb.c')
    expect(nodeById(tree, item?.id ?? '')?.songIds).toEqual([1])
  })
})

describe('resolveMediaId', () => {
  const tree = buildBrowseTree(
    input({
      songs: [
        song(1, { album: 'Blue', trackNo: 1 }),
        song(2, { album: 'Blue', trackNo: 2 }),
        song(3, { album: 'Blue', trackNo: 3 }),
      ],
    }),
  )

  it('resolves a browsable id to its node', () => {
    const selection = resolveMediaId(tree, 'albums')
    expect(selection).toEqual({ kind: 'browse', node: nodeById(tree, 'albums') })
  })

  it('plays the rest of the list after the chosen track', () => {
    const selection = resolveMediaId(tree, 'album.Blue|2')
    expect(selection).toEqual({ kind: 'play', songIds: [1, 2, 3], startIndex: 1 })
  })

  it('returns null for an unknown node or song', () => {
    expect(resolveMediaId(tree, 'album.Nope')).toBeNull()
    expect(resolveMediaId(tree, 'album.Blue|99')).toBeNull()
    expect(resolveMediaId(tree, '')).toBeNull()
  })
})

describe('searchBrowseTree', () => {
  const tree = buildBrowseTree(
    input({
      songs: [
        song(1, { album: 'Kind of Blue', title: 'So What' }),
        song(2, { album: 'Kind of Blue', title: 'Blue in Green' }),
        song(3, { album: 'Giant Steps', title: 'Naima' }),
      ],
    }),
  )

  it('prefers a whole album over a song', () => {
    expect(searchBrowseTree(tree, 'kind of blue')).toMatchObject({ kind: 'play', startIndex: 0 })
  })

  it('falls back to a song title', () => {
    const selection = searchBrowseTree(tree, 'naima')
    expect(selection).toMatchObject({ kind: 'play' })
    expect(selection?.kind === 'play' && selection.songIds[selection.startIndex]).toBe(3)
  })

  it('returns null for an empty query or no match', () => {
    expect(searchBrowseTree(tree, '   ')).toBeNull()
    expect(searchBrowseTree(tree, 'nothing here')).toBeNull()
  })
})

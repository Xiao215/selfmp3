import { describe, expect, it } from 'vitest'
import type { Library, Playlist, Song, Tag } from '@selfmp3/shared'
import { hasLivePlaylists, withPlaylist, withSong, withTag } from './patchLibrary.js'

const song = (id: number, overrides: Partial<Song> = {}): Song => ({
  id,
  path: `song-${id}.m4a`,
  title: `Song ${id}`,
  artist: 'Aurora Lane',
  album: '',
  albumArtist: '',
  trackNo: null,
  year: null,
  duration: 200,
  sizeBytes: 1000,
  mime: 'audio/mp4',
  hasArt: false,
  coverTone: null,
  rev: '1',
  lyricsKind: 'none',
  instrumental: false,
  playCount: 0,
  skipCount: 0,
  loved: false,
  sourceUrl: null,
  lastPlayedAt: null,
  addedAt: '2026-09-01 10:00:00',
  missing: false,
  tagIds: [],
  audioFeatures: null,
  ...overrides,
})

const tag = (id: number, overrides: Partial<Tag> = {}): Tag => ({
  id,
  name: `tag ${id}`,
  hue: 100,
  songCount: 0,
  ...overrides,
})

const playlist = (id: number, overrides: Partial<Playlist> = {}): Playlist => ({
  id,
  name: `list ${id}`,
  description: null,
  kind: 'manual',
  rules: null,
  songCount: 0,
  totalDuration: 0,
  pinned: false,
  createdAt: '2026-09-01 10:00:00',
  updatedAt: '2026-09-01 10:00:00',
  lastPlayedAt: null,
  ...overrides,
})

const library = (overrides: Partial<Library> = {}): Library => ({
  songs: [song(1, { tagIds: [10] }), song(2)],
  tags: [tag(10, { songCount: 1 }), tag(11)],
  playlists: [playlist(20)],
  version: 3,
  generatedAt: '2026-09-14T10:00:00.000Z',
  ...overrides,
})

describe('withSong', () => {
  it('replaces the song and leaves the rest alone', () => {
    const before = library()
    const after = withSong(before, song(2, { loved: true }))

    expect(after?.songs.map(each => each.loved)).toEqual([false, true])
    expect(after?.tags).toBe(before.tags)
    expect(before.songs[1]?.loved).toBe(false)
  })

  it('moves the counts of the tags a song gained and lost', () => {
    const after = withSong(library(), song(1, { tagIds: [11] }))
    expect(after?.tags.map(each => each.songCount)).toEqual([0, 1])
  })

  it('answers null for a song it does not have', () => {
    expect(withSong(library(), song(99))).toBeNull()
  })
})

describe('withTag', () => {
  it('recolours a tag in place', () => {
    expect(withTag(library(), tag(11, { hue: 300 }))?.tags[1]?.hue).toBe(300)
  })

  it('leaves a renamed tag to a refetch, since tags are sorted by name', () => {
    expect(withTag(library(), tag(11, { name: 'aaa' }))).toBeNull()
  })
})

describe('withPlaylist', () => {
  it('replaces a playlist, and names this as a new answer', () => {
    const after = withPlaylist(library(), playlist(20, { songCount: 4 }), 'now')
    expect(after?.playlists[0]?.songCount).toBe(4)
    expect(after?.generatedAt).toBe('now')
  })

  it('leaves a renamed or pinned playlist to a refetch', () => {
    expect(withPlaylist(library(), playlist(20, { name: 'zzz' }), 'now')).toBeNull()
    expect(withPlaylist(library(), playlist(20, { pinned: true }), 'now')).toBeNull()
  })
})

describe('hasLivePlaylists', () => {
  it('says when a song edit could change a playlist too', () => {
    expect(hasLivePlaylists(library())).toBe(false)
    expect(hasLivePlaylists(library({ playlists: [playlist(1, { kind: 'live' })] }))).toBe(true)
  })
})

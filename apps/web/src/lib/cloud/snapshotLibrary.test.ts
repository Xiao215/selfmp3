import { describe, expect, it } from 'vitest'
import { LibrarySchema, type CloudSnapshot, type CloudSong } from '@selfmp3/shared'
import { NO_IDS, snapshotToLibrary } from './snapshotLibrary.js'

/**
 * The bucket's snapshot as the library the app shows. What matters: a song
 * keeps its id on this device from one snapshot to the next, an id is never
 * handed to anything else, and the result is a library the app's own schema
 * accepts.
 */

const hash = (c: string) => c.repeat(64)
const uid = (c: string) => c.repeat(32)

const song = (u: string, overrides: Partial<CloudSong> = {}): CloudSong => ({
  uid: uid(u),
  title: `Song ${u}`,
  artist: 'Aurora Lane',
  album: '',
  albumArtist: '',
  trackNo: null,
  year: null,
  duration: 200,
  audio: { key: `audio/${hash(u)}.m4a`, size: 4_000_000, mime: 'audio/mp4' },
  cover: null,
  lyrics: null,
  instrumental: false,
  loved: false,
  playCount: 0,
  skipCount: 0,
  lastPlayedAt: null,
  addedAt: '2026-09-01 10:00:00',
  sourceUrl: null,
  tagUids: [],
  features: null,
  ...overrides,
})

const snapshot = (overrides: Partial<CloudSnapshot> = {}): CloudSnapshot => ({
  format: 1,
  writtenAt: '2026-09-11T10:00:00.000Z',
  writtenBy: 'mac-3f9a1c2e',
  upTo: {},
  songs: [],
  tags: [],
  playlists: [],
  ...overrides,
})

describe('snapshotToLibrary', () => {
  it('gives the app a library its own schema accepts', () => {
    const { library } = snapshotToLibrary(
      snapshot({
        songs: [
          song('a', {
            cover: { key: `covers/${hash('c')}.jpg`, size: 100 },
            lyrics: { key: `lyrics/${hash('d')}.lrc`, size: 50, kind: 'synced' },
            tagUids: [uid('t')],
          }),
        ],
        tags: [{ uid: uid('t'), name: 'chill', hue: 200 }],
      }),
      NO_IDS,
      7,
    )
    expect(() => LibrarySchema.parse(library)).not.toThrow()
    expect(library.version).toBe(7)
    expect(library.songs[0]).toMatchObject({
      title: 'Song a',
      hasArt: true,
      lyricsKind: 'synced',
      sizeBytes: 4_000_000,
      missing: false,
    })
    expect(library.tags[0]).toMatchObject({ name: 'chill', songCount: 1 })
    expect(library.songs[0]?.tagIds).toEqual([library.tags[0]?.id])
  })

  it('keeps each song’s id from one snapshot to the next', () => {
    const first = snapshotToLibrary(snapshot({ songs: [song('a'), song('b')] }), NO_IDS, 1)
    const second = snapshotToLibrary(snapshot({ songs: [song('b'), song('a')] }), first.ids, 2)
    const idOf = (l: typeof first, u: string) =>
      l.library.songs.find(s => s.title === `Song ${u}`)?.id
    expect(idOf(second, 'a')).toBe(idOf(first, 'a'))
    expect(idOf(second, 'b')).toBe(idOf(first, 'b'))
  })

  it('never gives a new song the id of one that went', () => {
    const first = snapshotToLibrary(snapshot({ songs: [song('a')] }), NO_IDS, 1)
    const second = snapshotToLibrary(snapshot({ songs: [song('b')] }), first.ids, 2)
    expect(second.library.songs[0]?.id).not.toBe(first.library.songs[0]?.id)
  })

  it('changes a song’s rev when its cover changes, so no old cover is served', () => {
    const before = snapshotToLibrary(snapshot({ songs: [song('a')] }), NO_IDS, 1)
    const after = snapshotToLibrary(
      snapshot({ songs: [song('a', { cover: { key: `covers/${hash('e')}.png`, size: 9 } })] }),
      before.ids,
      2,
    )
    expect(after.library.songs[0]?.rev).not.toBe(before.library.songs[0]?.rev)
  })

  it('knows where each song’s files are', () => {
    const { library, files } = snapshotToLibrary(
      snapshot({
        songs: [song('a', { lyrics: { key: `lyrics/${hash('d')}.txt`, size: 5, kind: 'plain' } })],
      }),
      NO_IDS,
      1,
    )
    const id = library.songs[0]?.id ?? 0
    expect(files[id]).toEqual({
      audio: `audio/${hash('a')}.m4a`,
      cover: null,
      lyrics: `lyrics/${hash('d')}.txt`,
      lyricsKind: 'plain',
    })
  })

  it('keeps playlists in order, and names smart rules’ tags by this device’s ids', () => {
    const view = snapshotToLibrary(
      snapshot({
        songs: [song('a', { duration: 100 }), song('b', { duration: 50 })],
        tags: [{ uid: uid('t'), name: 'chill', hue: 1 }],
        playlists: [
          {
            uid: uid('p'),
            name: 'Mix',
            description: '',
            kind: 'smart',
            rules: {
              match: 'all',
              rules: [
                { field: 'tag', op: 'has', tagUid: uid('t') },
                { field: 'tag', op: 'notHas', tagUid: uid('z') },
              ],
              orderBy: 'addedAt',
              order: 'desc',
              limit: null,
            },
            pinned: true,
            songUids: [uid('b'), uid('a'), uid('x')],
            createdAt: '2026-09-01',
            updatedAt: '2026-09-02',
          },
        ],
      }),
      NO_IDS,
      1,
    )
    const playlist = view.library.playlists[0]
    const idOf = (u: string) => view.library.songs.find(s => s.title === `Song ${u}`)?.id
    expect(view.playlistSongs[playlist?.id ?? 0]).toEqual([idOf('b'), idOf('a')])
    expect(playlist).toMatchObject({ songCount: 2, totalDuration: 150, pinned: true })
    expect(playlist?.rules?.rules[0]).toEqual({
      field: 'tag',
      op: 'has',
      tagId: view.library.tags[0]?.id,
    })
    // A tag this library does not have matches nothing, as it did.
    expect(playlist?.rules?.rules[1]).toMatchObject({ field: 'tag', op: 'notHas' })
  })
})

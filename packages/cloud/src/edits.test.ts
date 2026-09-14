import { describe, expect, it } from 'vitest'
import {
  ChangeSchema,
  HlcClock,
  applyChanges,
  logFile,
  type Change,
  type CloudSnapshot,
  type CloudSong,
} from '@selfmp3/shared'
import * as edits from './edits.js'
import type { EditContext } from './edits.js'
import { CloudRouteError } from './errors.js'
import { foldedOwnLogs, latestStamp, replay, replayedSnapshot } from './replay.js'
import { NO_IDS, snapshotToLibrary, type CloudLibrary } from './snapshotLibrary.js'

/**
 * Editing on a device with no Mac behind it: an edit the app makes by id
 * becomes changes by uid, which land in the library here straight away and
 * are what every other device replays. What matters: the change says exactly
 * what the edit did, it is refused where the Mac would refuse it, and the
 * library shows it at once — live playlists included.
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

const BASE: CloudSnapshot = {
  format: 1,
  writtenAt: '2026-09-11T10:00:00.000Z',
  writtenBy: 'mac-3f9a1c2e',
  upTo: {},
  songs: [song('a', { tagUids: [uid('1')] }), song('b'), song('c')],
  tags: [
    { uid: uid('1'), name: 'chill', hue: 200 },
    { uid: uid('2'), name: 'rain', hue: 20 },
  ],
  playlists: [
    {
      uid: uid('7'),
      name: 'Mix',
      description: '',
      kind: 'manual',
      rules: null,
      pinned: false,
      songUids: [uid('a'), uid('b')],
      createdAt: '2026-09-01 10:00:00',
      updatedAt: '2026-09-01 10:00:00',
    },
    {
      uid: uid('8'),
      name: 'Loved',
      description: '',
      kind: 'live',
      rules: {
        match: 'all',
        rules: [{ field: 'loved', op: 'is', value: true }],
        orderBy: 'title',
        order: 'asc',
        limit: null,
      },
      pinned: false,
      songUids: [],
      createdAt: '2026-09-01 10:00:00',
      updatedAt: '2026-09-01 10:00:00',
    },
  ],
}

/** A device's view of BASE plus changes, and a context to edit it with. */
function device(changes: readonly Change[] = []) {
  const clock = new HlcClock('iphone-0b7d44a1', { now: () => Date.parse('2026-09-11T12:00:00Z') })
  const library = replay(BASE, [], changes)
  let view: CloudLibrary = snapshotToLibrary(replayedSnapshot(library, BASE), NO_IDS, 1)
  let made = 0
  const ctx = (): EditContext => ({
    view,
    stamp: () => clock.tick(),
    newUid: () => uid(String.fromCharCode(0x64 + made++)),
    now: () => new Date('2026-09-11T12:00:00Z'),
  })
  /** Apply what an edit made, as the replica does, and look again. */
  const apply = (made: readonly Change[]): CloudLibrary => {
    for (const change of made) expect(ChangeSchema.parse(change)).toEqual(change)
    applyChanges(library, made)
    view = snapshotToLibrary(replayedSnapshot(library, BASE), view.ids, 2)
    return view
  }
  const idOf = (table: 'songs' | 'tags' | 'playlists', c: string): number => {
    const found = view.ids[table][uid(c)]
    if (found === undefined) throw new Error(`no ${table} ${c}`)
    return found
  }
  return { ctx, apply, idOf, view: () => view }
}

describe('editing songs', () => {
  it('loves a song, and a playlist of loved songs has it straight away', () => {
    const d = device()
    const changes = edits.editSong(d.ctx(), d.idOf('songs', 'b'), { loved: true })
    expect(changes).toEqual([
      { type: 'songEdited', hlc: expect.any(String), uid: uid('b'), fields: { loved: true } },
    ])
    const view = d.apply(changes)
    expect(view.playlistSongs[d.idOf('playlists', '8')]).toEqual([d.idOf('songs', 'b')])
  })

  it('sets a song’s tags as the ones that go on and the ones that come off', () => {
    const d = device()
    const changes = edits.setSongTags(d.ctx(), d.idOf('songs', 'a'), [d.idOf('tags', '2'), 9999])
    expect(
      changes.map(change => change.type === 'songTagged' && [change.tagUid, change.on]),
    ).toEqual([
      [uid('2'), true],
      [uid('1'), false],
    ])
    const view = d.apply(changes)
    expect(view.library.songs.find(s => s.id === d.idOf('songs', 'a'))?.tagIds).toEqual([
      d.idOf('tags', '2'),
    ])
  })

  it('takes a song out of the library and its playlists', () => {
    const d = device()
    const view = d.apply(edits.removeSongs(d.ctx(), [d.idOf('songs', 'a'), 424242]))
    expect(view.library.songs.map(s => s.title)).toEqual(['Song b', 'Song c'])
    expect(view.playlistSongs[d.idOf('playlists', '7')]).toEqual([d.idOf('songs', 'b')])
  })

  it('counts a play under the play outbox’s own id, so a resend counts once', () => {
    const d = device()
    const play = { msPlayed: 1000, completed: true, clientId: 'outbox-123456' }
    const first = edits.playSong(d.ctx(), d.idOf('songs', 'c'), play)
    const again = edits.playSong(d.ctx(), d.idOf('songs', 'c'), play)
    expect(first[0]).toMatchObject({
      playId: 'outbox-123456',
      playedAt: '2026-09-11T12:00:00.000Z',
    })
    const view = d.apply([...first, ...again])
    expect(view.library.songs.find(s => s.title === 'Song c')?.playCount).toBe(1)
  })

  it('refuses a song this device does not have', () => {
    const d = device()
    expect(() => edits.editSong(d.ctx(), 424242, { loved: true })).toThrow(CloudRouteError)
  })
})

describe('editing tags', () => {
  it('makes a tag once, whatever the case, as the Mac does', () => {
    const d = device()
    expect(edits.createTag(d.ctx(), 'CHILL', undefined)).toEqual({ changes: [], uid: uid('1') })
    const made = edits.createTag(d.ctx(), 'night drive', undefined)
    expect(made.changes).toEqual([
      {
        type: 'tagCreated',
        hlc: expect.any(String),
        uid: made.uid,
        name: 'night drive',
        hue: expect.any(Number),
      },
    ])
    const view = d.apply(made.changes)
    expect(view.library.tags.map(tag => tag.name)).toEqual(['chill', 'rain', 'night drive'])
  })

  it('refuses a name another tag has', () => {
    const d = device()
    expect(() => edits.editTag(d.ctx(), d.idOf('tags', '2'), { name: 'Chill' })).toThrow(
      expect.objectContaining({ status: 409 }),
    )
    expect(edits.editTag(d.ctx(), d.idOf('tags', '2'), { name: 'Rain', hue: 10 })).toEqual([
      {
        type: 'tagEdited',
        hlc: expect.any(String),
        uid: uid('2'),
        fields: { name: 'Rain', hue: 10 },
      },
    ])
  })
})

describe('editing playlists', () => {
  it('makes a playlist with rules naming tags by uid', () => {
    const d = device()
    const made = edits.createPlaylist(d.ctx(), {
      name: 'Chill',
      description: '',
      kind: 'live',
      rules: {
        match: 'all',
        rules: [{ field: 'tag', op: 'has', tagId: d.idOf('tags', '1') }],
        orderBy: 'addedAt',
        order: 'desc',
        limit: null,
      },
    })
    expect(made.changes[0]).toMatchObject({
      type: 'playlistCreated',
      rules: { rules: [{ field: 'tag', op: 'has', tagUid: uid('1') }] },
    })
    const view = d.apply(made.changes)
    const id = view.ids.playlists[made.uid] ?? 0
    expect(view.playlistSongs[id]).toEqual([d.idOf('songs', 'a')])
  })

  it('puts songs in at a position, as a new order', () => {
    const d = device()
    const mix = d.idOf('playlists', '7')
    const changes = edits.addToPlaylist(d.ctx(), mix, [d.idOf('songs', 'c')], 1)
    expect(changes.map(change => change.type)).toEqual(['playlistSong', 'playlistOrdered'])
    const view = d.apply(changes)
    expect(view.playlistSongs[mix]).toEqual(['a', 'c', 'b'].map(c => d.idOf('songs', c)))
  })

  it('refuses to put songs into a live playlist, or none that exist', () => {
    const d = device()
    expect(() => edits.addToPlaylist(d.ctx(), d.idOf('playlists', '8'), [1], undefined)).toThrow(
      /live playlist/,
    )
    expect(() =>
      edits.addToPlaylist(d.ctx(), d.idOf('playlists', '7'), [424242], undefined),
    ).toThrow(/none of those songs/)
  })

  it('refuses rules on a manual playlist', () => {
    const d = device()
    expect(() =>
      edits.editPlaylist(d.ctx(), d.idOf('playlists', '7'), {
        rules: { match: 'all', rules: [], orderBy: 'addedAt', order: 'desc', limit: null },
      }),
    ).toThrow(/cannot have rules/)
  })
})

describe('importing', () => {
  it('asks the Mac for a link, with its tags and playlist, and shows it waiting', () => {
    const d = device()
    const made = edits.requestImport(d.ctx(), {
      url: 'https://music.youtube.com/watch?v=abc',
      tagIds: [d.idOf('tags', '2')],
      playlistId: d.idOf('playlists', '7'),
    })
    expect(made.changes).toEqual([
      {
        type: 'importRequested',
        hlc: expect.any(String),
        uid: made.uid,
        url: 'https://music.youtube.com/watch?v=abc',
        tagUids: [uid('2')],
        playlistUid: uid('7'),
      },
    ])
    const view = d.apply(made.changes)
    expect(view.imports).toEqual([
      expect.objectContaining({ uid: made.uid, state: 'waiting', requestedBy: 'iphone-0b7d44a1' }),
    ])
  })

  it('calls a link off, but not one that has finished', () => {
    const d = device()
    const made = edits.requestImport(d.ctx(), {
      url: 'https://youtu.be/x',
      tagIds: [],
      playlistId: null,
    })
    d.apply(made.changes)
    const view = d.apply(edits.cancelImport(d.ctx(), made.uid))
    expect(view.imports[0]?.state).toBe('cancelled')
    expect(() => edits.cancelImport(d.ctx(), made.uid)).toThrow(/finished already/)
    expect(() => edits.cancelImport(d.ctx(), 'f'.repeat(32))).toThrow(CloudRouteError)
  })

  it('will not put imports into a smart playlist', () => {
    const d = device()
    expect(() =>
      edits.requestImport(d.ctx(), {
        url: 'https://youtu.be/x',
        tagIds: [],
        playlistId: d.idOf('playlists', '8'),
      }),
    ).toThrow(/manual playlist/)
  })
})

describe('replaying', () => {
  it('puts this device’s changes on top of other devices’, in stamp order', () => {
    const early = new HlcClock('web-3f9a2c1d', { now: () => 1_000 }).tick()
    const late = new HlcClock('iphone-0b7d44a1', { now: () => 2_000 }).tick()
    const theirs = logFile(
      'web-3f9a2c1d',
      1,
      [{ type: 'songEdited', hlc: late, uid: uid('a'), fields: { title: 'Theirs, later' } }],
      new Date(),
    )
    const library = replay(
      BASE,
      [theirs],
      [{ type: 'songEdited', hlc: early, uid: uid('a'), fields: { title: 'Mine, earlier' } }],
    )
    expect(library.songs.get(uid('a'))?.title).toBe('Theirs, later')
  })

  it('keeps a shuffled smart playlist in the same order from one look to the next', () => {
    const shuffled: CloudSnapshot = {
      ...BASE,
      playlists: [
        {
          ...BASE.playlists[1]!,
          rules: { match: 'all', rules: [], orderBy: 'random', order: 'asc', limit: null },
        },
      ],
    }
    const first = replayedSnapshot(replay(shuffled, [], []), shuffled).playlists[0]?.songUids
    const second = replayedSnapshot(replay(shuffled, [], []), shuffled).playlists[0]?.songUids
    expect(first).toHaveLength(3)
    expect(second).toEqual(first)
  })

  it('knows the latest stamp a snapshot carries', () => {
    const stamped: CloudSnapshot = {
      ...BASE,
      songs: [song('a', { stamps: { title: '0000000a1.0000.mac-3f9a1c2e' } })],
      tags: [{ uid: uid('1'), name: 'x', hue: 1, stamps: { name: '0000000b2.0000.mac-3f9a1c2e' } }],
    }
    expect(latestStamp(stamped)).toBe('0000000b2.0000.mac-3f9a1c2e')
    expect(latestStamp(null)).toBeNull()
  })

  it('tidies away only this device’s own files a snapshot has folded in', () => {
    const keys = [
      'log/iphone-0b7d44a1/000000000001.json',
      'log/iphone-0b7d44a1/000000000002.json',
      'log/iphone-0b7d44a1/000000000003.json',
      'log/web-3f9a2c1d/000000000001.json',
    ]
    expect(
      foldedOwnLogs(keys, 'iphone-0b7d44a1', { 'iphone-0b7d44a1': 2, 'web-3f9a2c1d': 9 }),
    ).toEqual(keys.slice(0, 2))
  })
})

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
import { latestStamp, replay, replayedSnapshot } from './replay.js'
import { NO_IDS, snapshotToLibrary, type CloudLibrary } from './snapshotLibrary.js'

/**
 * Editing on a device with no server behind it: an edit the app makes by id
 * becomes changes by uid, which land in the library here straight away and
 * are what every other device replays. What matters: the change says exactly
 * what the edit did, it is refused where the server would refuse it, and the
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
  coverTone: null,
  lyrics: null,
  motion: null,
  instrumental: false,
  loved: false,
  playCount: 0,
  lastPlayedAt: null,
  addedAt: '2026-09-01 10:00:00',
  sourceUrl: null,
  tagUids: [],
  audioFeatures: null,
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
  artists: [],
  artistNames: [],
  spellings: {},
  sound: null,
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

  it('changes a song’s tags as the ones that go on and the ones that come off', () => {
    const d = device()
    const changes = edits.changeSongTags(
      d.ctx(),
      d.idOf('songs', 'a'),
      [d.idOf('tags', '2'), 9999],
      [d.idOf('tags', '1')],
    )
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

  it('takes the tags only those songs had with them, as the server does, and no others', () => {
    // "chill" was on song a alone; "rain" was on nothing, and stays to be filled.
    const d = device()
    const changes = edits.removeSongs(d.ctx(), [d.idOf('songs', 'a')])
    expect(changes.map(change => [change.type, change.uid])).toEqual([
      ['songRemoved', uid('a')],
      ['tagEmptied', uid('1')],
    ])
    expect(d.apply(changes).library.tags.map(tag => tag.name)).toEqual(['rain'])
    expect(edits.removeSongs(d.ctx(), [d.idOf('songs', 'b')]).map(c => c.type)).toEqual([
      'songRemoved',
    ])
  })

  // R3-M7: the tag went everywhere, and the song tagged with it lost it.
  it('leaves a tag another device has just put on a song this one had not heard of', () => {
    const here = device()
    const removing = edits.removeSongs(here.ctx(), [here.idOf('songs', 'a')])
    const there = device()
    const tagging = edits
      .changeSongTags(there.ctx(), there.idOf('songs', 'b'), [there.idOf('tags', '1')], [])
      .map(change => ({ ...change, hlc: change.hlc.replace('iphone-0b7d44a1', 'web-5c6d7e8f') }))
    const both = replayedSnapshot(replay(BASE, [], [...removing, ...tagging]), BASE)
    expect(both.tags.map(tag => tag.name)).toEqual(['chill', 'rain'])
    expect(both.songs.find(s => s.uid === uid('b'))?.tagUids).toEqual([uid('1')])
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

  it('merges nothing into a kept song that is gone, as the server does', () => {
    const d = device()
    expect(edits.mergeSongs(d.ctx(), 424242, [d.idOf('songs', 'a')])).toEqual([])
    expect(
      edits.mergeSongs(d.ctx(), d.idOf('songs', 'a'), [d.idOf('songs', 'b'), 424242]),
    ).toMatchObject([{ type: 'songMerged', uid: uid('b'), into: uid('a') }])
  })

  it('refuses a song this device does not have', () => {
    const d = device()
    expect(() => edits.editSong(d.ctx(), 424242, { loved: true })).toThrow(CloudRouteError)
  })
})

describe('naming an artist', () => {
  it('keeps the names an artist also goes by, tidied, under the artist as the songs write them', () => {
    const d = device()
    const { changes, named } = edits.nameArtist(d.ctx(), 'AURORA LANE', [
      ' Aurora ',
      'aurora',
      'Aurora Lane',
      'オーロラ',
    ])
    expect(named).toEqual({ artist: 'aurora lane', names: ['Aurora', 'オーロラ'] })
    expect(changes).toEqual([{ type: 'artistNamed', hlc: expect.any(String), ...named }])
    expect(d.apply(changes).library.artistNames).toEqual({ 'aurora lane': ['Aurora', 'オーロラ'] })
  })

  it('refuses an artist no song names', () => {
    const d = device()
    expect(() => edits.nameArtist(d.ctx(), 'Nobody', ['x'])).toThrow(
      expect.objectContaining({ status: 404 }),
    )
  })
})

describe('editing tags', () => {
  it('makes a tag once, whatever the case, as the server does', () => {
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

describe('deleting a tag playlists follow', () => {
  /** A live playlist on chill — and, for "Chill and loved", on being loved too. */
  const follow = (d: ReturnType<typeof device>, name: string) => {
    const made = edits.createPlaylist(d.ctx(), {
      name,
      description: '',
      kind: 'live',
      rules: {
        match: 'all',
        rules: [
          { field: 'tag', op: 'has', tagId: d.idOf('tags', '1') },
          ...(name === 'Chill and loved'
            ? [{ field: 'loved' as const, op: 'is' as const, value: true }]
            : []),
        ],
        orderBy: 'addedAt',
        order: 'desc',
        limit: null,
      },
    })
    return d.apply(made.changes).ids.playlists[made.uid] ?? 0
  }

  it('keeps the songs of a playlist that followed only it, and stops it following', () => {
    const d = device()
    const chill = follow(d, 'Chill')
    const changes = edits.removeTag(d.ctx(), d.idOf('tags', '1'))
    expect(changes.map(change => change.type)).toEqual(['playlistUnfollowed', 'tagRemoved'])
    const view = d.apply(changes)
    expect(view.library.playlists.find(p => p.id === chill)).toMatchObject({
      kind: 'manual',
      rules: null,
    })
    expect(view.playlistSongs[chill]).toEqual([d.idOf('songs', 'a')])
  })

  // Dropping only the tag's rule widened an "all" playlist and narrowed an "any" one.
  it('keeps the songs of a playlist that follows other things too', () => {
    const d = device()
    const both = follow(d, 'Chill and loved')
    const changes = edits.removeTag(d.ctx(), d.idOf('tags', '1'))
    expect(changes.map(change => change.type)).toEqual(['playlistUnfollowed', 'tagRemoved'])
    const view = d.apply(changes)
    expect(view.library.playlists.find(p => p.id === both)).toMatchObject({
      kind: 'manual',
      rules: null,
    })
  })

  it('leaves the removed songs out of a playlist their emptied tag stops', () => {
    const d = device()
    const chill = follow(d, 'Chill')
    const changes = edits.removeSongs(d.ctx(), [d.idOf('songs', 'a')])
    expect(changes.map(change => change.type)).toEqual([
      'songRemoved',
      'playlistUnfollowed',
      'tagEmptied',
    ])
    const view = d.apply(changes)
    expect(view.library.playlists.find(p => p.id === chill)?.kind).toBe('manual')
    expect(view.playlistSongs[chill]).toEqual([])
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

  it('makes a playlist with its first songs in the same changes', () => {
    const d = device()
    const made = edits.createPlaylist(d.ctx(), {
      name: 'Picked',
      description: '',
      kind: 'manual',
      rules: null,
      // One the library does not have is left out, as an add leaves it out.
      songIds: [d.idOf('songs', 'b'), 999_999, d.idOf('songs', 'a')],
    })
    expect(made.changes.map(change => change.type)).toEqual([
      'playlistCreated',
      'playlistSong',
      'playlistSong',
    ])
    const view = d.apply(made.changes)
    const id = view.ids.playlists[made.uid] ?? 0
    expect(view.playlistSongs[id]).toEqual(['b', 'a'].map(c => d.idOf('songs', c)))
  })

  it('puts songs in at a position, as a new order', () => {
    const d = device()
    const mix = d.idOf('playlists', '7')
    const changes = edits.addToPlaylist(d.ctx(), mix, [d.idOf('songs', 'c')], 1)
    expect(changes.map(change => change.type)).toEqual(['playlistSong', 'playlistOrdered'])
    const view = d.apply(changes)
    expect(view.playlistSongs[mix]).toEqual(['a', 'c', 'b'].map(c => d.idOf('songs', c)))
  })

  it('lets a playlist that follows tags be put in an order by hand', () => {
    const d = device()
    const live = d.idOf('playlists', '8')
    const songs = d.apply([]).playlistSongs[live] ?? []
    // The rule still says which songs; this says the order of the ones it names.
    const changes = edits.reorderPlaylist(d.ctx(), live, [...songs].reverse())
    expect(changes.map(change => change.type)).toEqual(['playlistOrdered'])
  })

  it('shows a playlist that follows tags in the order it was put in, straight away', () => {
    const d = device()
    const live = d.idOf('playlists', '8')
    const [a, b, c] = ['a', 'b', 'c'].map(u => d.idOf('songs', u)) as [number, number, number]
    // Loved here, after the snapshot: the rule matches them, title first.
    expect(d.apply(edits.loveSongs(d.ctx(), [a, b, c], true)).playlistSongs[live]).toEqual([
      a,
      b,
      c,
    ])
    const view = d.apply(edits.reorderPlaylist(d.ctx(), live, [c, a]))
    // The order names two; the third keeps its place after them.
    expect(view.playlistSongs[live]).toEqual([c, a, b])
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

  it('stops a playlist following its tags, keeping the songs it shows', () => {
    const d = device()
    const live = d.idOf('playlists', '8')
    d.apply(edits.editSong(d.ctx(), d.idOf('songs', 'b'), { loved: true }))
    const changes = edits.stopFollowing(d.ctx(), live)
    expect(changes).toEqual([
      { type: 'playlistUnfollowed', hlc: expect.any(String), uid: uid('8'), songUids: [uid('b')] },
    ])
    let view = d.apply(changes)
    expect(view.byId.playlists.get(live)).toMatchObject({ kind: 'manual', rules: null })
    // Loving another song no longer reaches it: that is the point.
    view = d.apply(edits.editSong(d.ctx(), d.idOf('songs', 'c'), { loved: true }))
    expect(view.playlistSongs[live]).toEqual([d.idOf('songs', 'b')])
    // And a playlist that follows nothing is left as it is.
    expect(edits.stopFollowing(d.ctx(), live)).toEqual([])
  })

  it('refuses to take a live playlist’s rules away, as the server does', () => {
    // Recorded, it emptied the playlist on the server: a live row with no
    // rules reads there as a manual playlist with nothing in it.
    const d = device()
    expect(() => edits.editPlaylist(d.ctx(), d.idOf('playlists', '8'), { rules: null })).toThrow(
      /stop following it instead/,
    )
  })
})

describe('importing', () => {
  it('asks the server for a link, with its tags and playlist, and shows it waiting', () => {
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
    ).toThrow(/live playlist builds itself/)
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
})

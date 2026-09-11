import { describe, expect, it } from 'vitest'
import { MISSING_TAG_UID } from './cloud.js'
import { formatHlc } from './hlc.js'
import type { CloudPlaylist, CloudSnapshot, CloudSong, CloudTag } from './schemas/cloud.js'
import { CloudSnapshotSchema } from './schemas/cloud.js'
import type { Change } from './schemas/sync.js'
import {
  applyChange,
  applyChanges,
  copySyncLibrary,
  logFile,
  readLogFile,
  reordered,
  snapshotOf,
  syncLibrary,
  toSqliteTime,
  type SyncLibrary,
} from './sync.js'

const uid = (n: number): string => n.toString(16).padStart(32, '0')
const SONG_A = uid(0xa1)
const SONG_B = uid(0xb2)
const SONG_C = uid(0xc3)
const TAG_CHILL = uid(0x71)
const TAG_RAIN = uid(0x72)
const LIST = uid(0x91)
const SMART = uid(0x92)

/** A stamp at `seconds` past a fixed moment, from `device`. */
const at = (seconds: number, device = 'mac-aaaa'): string =>
  formatHlc({ ms: 1_789_000_000_000 + seconds * 1000, counter: 0, device })

function song(id: string, overrides: Partial<CloudSong> = {}): CloudSong {
  return {
    uid: id,
    title: 'Title',
    artist: 'Artist',
    album: '',
    albumArtist: '',
    trackNo: null,
    year: null,
    duration: 200,
    audio: { key: `audio/${'ab'.repeat(32)}.m4a`, size: 1000, mime: 'audio/mp4' },
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
  }
}

function tag(id: string, name: string, overrides: Partial<CloudTag> = {}): CloudTag {
  return { uid: id, name, hue: 200, ...overrides }
}

function playlist(id: string, overrides: Partial<CloudPlaylist> = {}): CloudPlaylist {
  return {
    uid: id,
    name: 'Mix',
    description: '',
    kind: 'manual',
    rules: null,
    pinned: false,
    songUids: [],
    createdAt: '2026-09-01 10:00:00',
    updatedAt: '2026-09-01 10:00:00',
    ...overrides,
  }
}

function snapshot(overrides: Partial<CloudSnapshot> = {}): CloudSnapshot {
  return {
    format: 1,
    writtenAt: '2026-09-11T10:00:00.000Z',
    writtenBy: 'mac-aaaa',
    upTo: {},
    songs: [song(SONG_A), song(SONG_B), song(SONG_C)],
    tags: [tag(TAG_CHILL, 'chill'), tag(TAG_RAIN, 'rain')],
    playlists: [
      playlist(LIST, { songUids: [SONG_A, SONG_B] }),
      playlist(SMART, {
        kind: 'smart',
        rules: { match: 'all', rules: [], orderBy: 'addedAt', order: 'desc', limit: null },
      }),
    ],
    ...overrides,
  }
}

function replay(changes: readonly Change[], from: CloudSnapshot = snapshot()): SyncLibrary {
  const library = syncLibrary(from)
  applyChanges(library, changes)
  return library
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [
      item,
      ...rest,
    ]),
  )
}

describe('editing a song', () => {
  it('keeps the value from the latest change, whatever order they arrive in', () => {
    const changes: Change[] = [
      { type: 'songEdited', hlc: at(1, 'web-bbbb'), uid: SONG_A, fields: { title: 'First' } },
      { type: 'songEdited', hlc: at(3, 'mac-aaaa'), uid: SONG_A, fields: { title: 'Last' } },
      { type: 'songEdited', hlc: at(2, 'web-cccc'), uid: SONG_A, fields: { title: 'Middle' } },
    ]
    for (const order of permutations(changes)) {
      const library = syncLibrary(snapshot())
      // One at a time, as a device that hears of them one by one would.
      for (const change of order) applyChange(library, change)
      expect(library.songs.get(SONG_A)?.title).toBe('Last')
      expect(library.songs.get(SONG_A)?.stamps).toEqual({ title: at(3, 'mac-aaaa') })
    }
  })

  it('keeps both of two edits to different fields', () => {
    const library = replay([
      {
        type: 'songEdited',
        hlc: at(1, 'web-bbbb'),
        uid: SONG_A,
        fields: { title: 'On the phone' },
      },
      { type: 'songEdited', hlc: at(2, 'mac-aaaa'), uid: SONG_A, fields: { artist: 'On the Mac' } },
    ])
    expect(library.songs.get(SONG_A)).toMatchObject({ title: 'On the phone', artist: 'On the Mac' })
  })

  it('lets a late change lose to a newer one the snapshot already has', () => {
    const newer = snapshot({
      songs: [song(SONG_A, { loved: true, stamps: { loved: at(10) } })],
    })
    const library = replay(
      [{ type: 'songEdited', hlc: at(5, 'web-bbbb'), uid: SONG_A, fields: { loved: false } }],
      newer,
    )
    expect(library.songs.get(SONG_A)?.loved).toBe(true)
  })

  it('lets any change replace a value nothing has stamped', () => {
    const library = replay([
      { type: 'songEdited', hlc: at(-999_999), uid: SONG_A, fields: { year: 1999, trackNo: 4 } },
    ])
    expect(library.songs.get(SONG_A)).toMatchObject({ year: 1999, trackNo: 4 })
  })

  it('ignores a change to a song that is not there', () => {
    const library = syncLibrary(snapshot())
    const changed = applyChange(library, {
      type: 'songEdited',
      hlc: at(1),
      uid: uid(0xdead),
      fields: { title: 'Ghost' },
    })
    expect(changed).toBe(false)
    expect(library.songs.has(uid(0xdead))).toBe(false)
  })
})

describe('tags on songs', () => {
  it('stay off when taken off after they were put on, in either order of arrival', () => {
    const changes: Change[] = [
      { type: 'songTagged', hlc: at(1), uid: SONG_A, tagUid: TAG_CHILL, on: true },
      { type: 'songTagged', hlc: at(2, 'web-bbbb'), uid: SONG_A, tagUid: TAG_CHILL, on: false },
    ]
    for (const order of permutations(changes)) {
      const library = syncLibrary(snapshot())
      for (const change of order) applyChange(library, change)
      expect(library.songs.get(SONG_A)?.tagUids).toEqual([])
      expect(library.songs.get(SONG_A)?.tagStamps).toEqual({ [TAG_CHILL]: at(2, 'web-bbbb') })
    }
  })

  it('never names a tag twice on one song', () => {
    const library = replay([
      { type: 'songTagged', hlc: at(1), uid: SONG_A, tagUid: TAG_CHILL, on: true },
      { type: 'songTagged', hlc: at(2), uid: SONG_A, tagUid: TAG_CHILL, on: true },
      { type: 'songTagged', hlc: at(3), uid: SONG_A, tagUid: TAG_RAIN, on: true },
    ])
    expect(library.songs.get(SONG_A)?.tagUids).toEqual([TAG_CHILL, TAG_RAIN])
  })

  it('ignore a tag that is not in the library', () => {
    const library = replay([
      { type: 'songTagged', hlc: at(1), uid: SONG_A, tagUid: uid(0xdead), on: true },
    ])
    expect(library.songs.get(SONG_A)?.tagUids).toEqual([])
  })
})

describe('tags', () => {
  it('made on a device can be put on songs straight away', () => {
    const fresh = uid(0x73)
    const library = replay([
      { type: 'tagCreated', hlc: at(1, 'web-bbbb'), uid: fresh, name: 'night', hue: 30 },
      { type: 'songTagged', hlc: at(2, 'web-bbbb'), uid: SONG_B, tagUid: fresh, on: true },
    ])
    expect(library.tags.get(fresh)).toEqual({ uid: fresh, name: 'night', hue: 30 })
    expect(library.songs.get(SONG_B)?.tagUids).toEqual([fresh])
  })

  it('made twice under one name become one tag, and the second uid still finds it', () => {
    const twin = uid(0x74)
    const library = replay([
      { type: 'tagCreated', hlc: at(1, 'web-bbbb'), uid: twin, name: 'CHILL', hue: 10 },
      { type: 'songTagged', hlc: at(2, 'web-bbbb'), uid: SONG_C, tagUid: twin, on: true },
      {
        type: 'playlistCreated',
        hlc: at(3, 'web-bbbb'),
        uid: uid(0x93),
        kind: 'smart',
        name: 'Chill',
        description: '',
        pinned: false,
        rules: {
          match: 'all',
          rules: [{ field: 'tag', op: 'has', tagUid: twin }],
          orderBy: 'addedAt',
          order: 'desc',
          limit: null,
        },
      },
    ])
    expect(library.tags.has(twin)).toBe(false)
    expect(library.aliases.get(twin)).toBe(TAG_CHILL)
    expect(library.songs.get(SONG_C)?.tagUids).toEqual([TAG_CHILL])
    expect(library.playlists.get(uid(0x93))?.rules?.rules).toEqual([
      { field: 'tag', op: 'has', tagUid: TAG_CHILL },
    ])
  })

  it('keep their name when renamed to one another tag has, but take the colour', () => {
    const library = replay([
      { type: 'tagEdited', hlc: at(1), uid: TAG_RAIN, fields: { name: 'Chill', hue: 99 } },
    ])
    expect(library.tags.get(TAG_RAIN)).toMatchObject({ name: 'rain', hue: 99 })
    expect(library.tags.get(TAG_RAIN)?.stamps).toEqual({ hue: at(1) })
  })

  it('can be renamed to their own name in another case', () => {
    const library = replay([
      { type: 'tagEdited', hlc: at(1), uid: TAG_CHILL, fields: { name: 'Chill' } },
    ])
    expect(library.tags.get(TAG_CHILL)?.name).toBe('Chill')
  })

  it('removed are gone from every song, and a late edit does not bring them back', () => {
    const tagged = snapshot({
      songs: [song(SONG_A, { tagUids: [TAG_CHILL, TAG_RAIN], tagStamps: { [TAG_CHILL]: at(1) } })],
      aliases: { [uid(0x74)]: TAG_CHILL },
    })
    const library = replay(
      [
        { type: 'tagRemoved', hlc: at(5), uid: TAG_CHILL },
        { type: 'tagEdited', hlc: at(4, 'web-bbbb'), uid: TAG_CHILL, fields: { name: 'mellow' } },
        { type: 'tagEdited', hlc: at(6, 'web-bbbb'), uid: TAG_CHILL, fields: { name: 'mellow' } },
        { type: 'songTagged', hlc: at(7, 'web-bbbb'), uid: SONG_A, tagUid: TAG_CHILL, on: true },
      ],
      tagged,
    )
    expect(library.tags.has(TAG_CHILL)).toBe(false)
    expect(library.aliases.size).toBe(0)
    expect(library.songs.get(SONG_A)?.tagUids).toEqual([TAG_RAIN])
    expect(library.songs.get(SONG_A)?.tagStamps).toBeUndefined()
  })
})

describe('smart rules about tags', () => {
  const tagged = (tagUid: string) => ({
    match: 'all' as const,
    rules: [{ field: 'tag' as const, op: 'has' as const, tagUid }],
    orderBy: 'addedAt' as const,
    order: 'desc' as const,
    limit: null,
  })

  it('keep meaning what they did when the tag is removed', () => {
    const library = replay([
      { type: 'playlistEdited', hlc: at(1), uid: SMART, fields: { rules: tagged(TAG_RAIN) } },
      { type: 'tagRemoved', hlc: at(2), uid: TAG_RAIN },
    ])
    expect(library.playlists.get(SMART)?.rules).toEqual(tagged(MISSING_TAG_UID))
  })

  it('name a tag the library does not have as missing, as the Mac would', () => {
    const library = replay([
      { type: 'playlistEdited', hlc: at(1), uid: SMART, fields: { rules: tagged(uid(0xdead)) } },
    ])
    expect(library.playlists.get(SMART)?.rules).toEqual(tagged(MISSING_TAG_UID))
  })
})

describe('removing a song', () => {
  it('takes it out of every playlist, for good', () => {
    const library = replay([
      { type: 'songRemoved', hlc: at(2), uid: SONG_A },
      { type: 'songEdited', hlc: at(3), uid: SONG_A, fields: { loved: true } },
      { type: 'playlistSong', hlc: at(4), uid: LIST, songUid: SONG_A, on: true },
    ])
    expect(library.songs.has(SONG_A)).toBe(false)
    expect(library.playlists.get(LIST)?.songUids).toEqual([SONG_B])
  })
})

describe('plays and skips', () => {
  it('add up, and the same play twice counts once', () => {
    const played: Change = {
      type: 'songPlayed',
      hlc: at(1, 'web-bbbb'),
      uid: SONG_A,
      playId: 'play-0001',
      playedAt: '2026-09-11T08:30:00.000Z',
      msPlayed: 180_000,
      completed: true,
    }
    const library = replay([
      played,
      { ...played, hlc: at(9, 'web-bbbb') },
      { ...played, playId: 'play-0002', playedAt: '2026-09-11T07:00:00.000Z' },
      {
        type: 'songSkipped',
        hlc: at(2),
        uid: SONG_A,
        skipId: 'skip-0001',
        skippedAt: '2026-09-11T08:00:00.000Z',
        atSeconds: 12,
      },
    ])
    expect(library.songs.get(SONG_A)).toMatchObject({
      playCount: 2,
      skipCount: 1,
      // Only moves forward: the play from earlier that morning arrived last.
      lastPlayedAt: '2026-09-11 08:30:00',
    })
  })
})

describe('playlists', () => {
  it('made on a device start empty, dated by their stamp', () => {
    const fresh = uid(0x94)
    const library = replay([
      {
        type: 'playlistCreated',
        hlc: at(0, 'web-bbbb'),
        uid: fresh,
        kind: 'manual',
        name: 'Road trip',
        description: '',
        pinned: false,
        rules: null,
      },
      { type: 'playlistSong', hlc: at(1, 'web-bbbb'), uid: fresh, songUid: SONG_C, on: true },
    ])
    expect(library.playlists.get(fresh)).toMatchObject({
      name: 'Road trip',
      songUids: [SONG_C],
      createdAt: toSqliteTime(1_789_000_000_000),
      updatedAt: toSqliteTime(1_789_000_001_000),
    })
  })

  it('gain songs at the end and lose them by the latest change for each', () => {
    const library = replay([
      { type: 'playlistSong', hlc: at(2, 'web-bbbb'), uid: LIST, songUid: SONG_A, on: false },
      { type: 'playlistSong', hlc: at(1, 'mac-aaaa'), uid: LIST, songUid: SONG_A, on: true },
      { type: 'playlistSong', hlc: at(3, 'mac-aaaa'), uid: LIST, songUid: SONG_C, on: true },
    ])
    expect(library.playlists.get(LIST)?.songUids).toEqual([SONG_B, SONG_C])
  })

  it('reorder without losing a song another device added meanwhile', () => {
    const library = replay([
      { type: 'playlistSong', hlc: at(1, 'mac-aaaa'), uid: LIST, songUid: SONG_C, on: true },
      // The phone had not heard of SONG_C when it reordered.
      { type: 'playlistOrdered', hlc: at(2, 'web-bbbb'), uid: LIST, songUids: [SONG_B, SONG_A] },
    ])
    expect(library.playlists.get(LIST)?.songUids).toEqual([SONG_B, SONG_A, SONG_C])
  })

  it('keep the latest order, whatever order the reorders arrive in', () => {
    const changes: Change[] = [
      { type: 'playlistOrdered', hlc: at(1), uid: LIST, songUids: [SONG_B, SONG_A] },
      { type: 'playlistOrdered', hlc: at(2, 'web-bbbb'), uid: LIST, songUids: [SONG_A, SONG_B] },
    ]
    for (const order of permutations(changes)) {
      const library = syncLibrary(snapshot())
      for (const change of order) applyChange(library, change)
      expect(library.playlists.get(LIST)?.songUids).toEqual([SONG_A, SONG_B])
    }
  })

  it('that are smart take their songs from their rules, not from changes', () => {
    const library = replay([
      { type: 'playlistSong', hlc: at(1), uid: SMART, songUid: SONG_A, on: true },
      { type: 'playlistOrdered', hlc: at(2), uid: SMART, songUids: [SONG_A] },
    ])
    expect(library.playlists.get(SMART)?.songUids).toEqual([])
  })

  it('removed stay removed', () => {
    const library = replay([
      { type: 'playlistRemoved', hlc: at(1), uid: LIST },
      { type: 'playlistEdited', hlc: at(2), uid: LIST, fields: { name: 'Back' } },
    ])
    expect(library.playlists.has(LIST)).toBe(false)
  })

  it('keep the latest of each field, and move their updated time forward', () => {
    const library = replay([
      { type: 'playlistEdited', hlc: at(2), uid: LIST, fields: { name: 'Later', pinned: true } },
      { type: 'playlistEdited', hlc: at(1, 'web-bbbb'), uid: LIST, fields: { name: 'Earlier' } },
    ])
    expect(library.playlists.get(LIST)).toMatchObject({
      name: 'Later',
      pinned: true,
      updatedAt: toSqliteTime(1_789_000_002_000),
    })
  })
})

describe('asking for a link to be imported', () => {
  const REQUEST = uid(0xe1)
  const asked: Change = {
    type: 'importRequested',
    hlc: at(1, 'iphone-0b7d44a1'),
    uid: REQUEST,
    url: 'https://music.youtube.com/watch?v=abc',
    tagUids: [],
    playlistUid: null,
  }

  it('waits for a device that can fetch it, saying who asked and when', () => {
    const library = replay([asked, { ...asked, hlc: at(5, 'iphone-0b7d44a1') }])
    expect([...library.imports.values()]).toEqual([
      {
        uid: REQUEST,
        url: 'https://music.youtube.com/watch?v=abc',
        requestedBy: 'iphone-0b7d44a1',
        requestedAt: toSqliteTime(1_789_000_001_000),
        state: 'waiting',
        title: null,
        songUids: [],
        error: null,
        updatedAt: toSqliteTime(1_789_000_001_000),
      },
    ])
  })

  it('can be called off until it is done', () => {
    const cancelled = replay([asked, { type: 'importCancelled', hlc: at(2), uid: REQUEST }])
    expect(cancelled.imports.get(REQUEST)?.state).toBe('cancelled')

    // Once the Mac has said it is done, calling it off changes nothing.
    const done = replay([asked], {
      ...snapshot(),
      imports: [
        {
          ...replay([asked]).imports.get(REQUEST)!,
          state: 'done',
          songUids: [SONG_A],
          title: 'A song',
        },
      ],
    })
    expect(applyChange(done, { type: 'importCancelled', hlc: at(3), uid: REQUEST })).toBe(false)
    expect(done.imports.get(REQUEST)?.state).toBe('done')
  })
})

describe('reordering', () => {
  it('puts named songs first and keeps the rest in their order, ignoring strangers', () => {
    expect(reordered(['a', 'b', 'c', 'd'], ['c', 'x', 'a', 'c'])).toEqual(['c', 'a', 'b', 'd'])
  })
})

describe('a replayed library', () => {
  it('is the same from the same changes, however they were batched', () => {
    const changes: Change[] = [
      { type: 'tagCreated', hlc: at(1, 'web-bbbb'), uid: uid(0x75), name: 'drive', hue: 5 },
      { type: 'songTagged', hlc: at(2, 'web-bbbb'), uid: SONG_A, tagUid: uid(0x75), on: true },
      { type: 'songEdited', hlc: at(3, 'mac-aaaa'), uid: SONG_A, fields: { title: 'Mac' } },
      { type: 'playlistSong', hlc: at(4, 'web-cccc'), uid: LIST, songUid: SONG_C, on: true },
      { type: 'songEdited', hlc: at(5, 'web-cccc'), uid: SONG_A, fields: { title: 'Phone' } },
      { type: 'songRemoved', hlc: at(6, 'mac-aaaa'), uid: SONG_B },
    ]
    const whole = replay(changes)
    // As the Mac would: two passes, each batch in stamp order.
    const inTwo = syncLibrary(snapshot())
    applyChanges(inTwo, changes.slice(0, 3))
    applyChanges(inTwo, changes.slice(3))
    const meta = { writtenAt: 'now', writtenBy: 'mac-aaaa', upTo: {} }
    expect(snapshotOf(inTwo, meta)).toEqual(snapshotOf(whole, meta))
    expect(whole.songs.get(SONG_A)?.title).toBe('Phone')
  })

  it('makes a snapshot other devices accept', () => {
    const library = replay([
      { type: 'songEdited', hlc: at(1), uid: SONG_A, fields: { loved: true } },
      { type: 'tagCreated', hlc: at(2), uid: uid(0x76), name: 'Rain', hue: 1 },
    ])
    const written = snapshotOf(library, {
      writtenAt: '2026-09-11T10:00:00.000Z',
      writtenBy: 'mac-aaaa',
      upTo: { 'web-bbbb': 4 },
    })
    expect(CloudSnapshotSchema.parse(written)).toEqual(written)
    expect(written.aliases).toEqual({ [uid(0x76)]: TAG_RAIN })
  })

  it('can be copied and replayed into without touching the original', () => {
    const original = syncLibrary(snapshot())
    const copy = copySyncLibrary(original)
    applyChange(copy, { type: 'songRemoved', hlc: at(1), uid: SONG_A })
    expect(original.songs.has(SONG_A)).toBe(true)
    expect(original.playlists.get(LIST)?.songUids).toEqual([SONG_A, SONG_B])
  })
})

describe('log files', () => {
  const change: Change = { type: 'songEdited', hlc: at(1), uid: SONG_A, fields: { loved: true } }

  it('read back what was written', () => {
    const file = logFile('web-bbbb', 7, [change], new Date('2026-09-11T10:00:00.000Z'))
    const read = readLogFile(JSON.parse(JSON.stringify(file)))
    expect(read).toEqual({ ok: true, file, skipped: 0 })
  })

  it('set aside a change from a newer build, keeping the rest', () => {
    const file = {
      ...logFile('web-bbbb', 7, [change], new Date()),
      changes: [change, { type: 'songRated', hlc: at(2), uid: SONG_A, stars: 5 }],
    }
    const read = readLogFile(file)
    expect(read.ok && read.file.changes).toEqual([change])
    expect(read.ok && read.skipped).toBe(1)
  })

  it('refuse a file in a newer format, or one that is not a log file at all', () => {
    expect(readLogFile({ ...logFile('web-bbbb', 7, [change], new Date()), format: 99 })).toEqual({
      ok: false,
      reason: 'newer',
    })
    expect(readLogFile({ hello: 'world' })).toEqual({ ok: false, reason: 'unreadable' })
  })
})

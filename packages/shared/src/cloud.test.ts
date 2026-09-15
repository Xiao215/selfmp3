import { describe, expect, it } from 'vitest'
import {
  MISSING_TAG_UID,
  UNKNOWN_TAG_ID,
  audioKey,
  cleanExtension,
  coverKey,
  fromCloudRules,
  isCloudFileKey,
  isCloudListPrefix,
  isDeletableCloudKey,
  logKey,
  lyricsKey,
  newCloudDeviceId,
  newUid,
  newestSnapshotKey,
  parseEndpoint,
  parseLogKey,
  parseSnapshotKey,
  snapshotKey,
  snapshotsToPrune,
  toCloudRules,
  unfoldedLogKeys,
} from './cloud.js'
import { CloudSnapshotSchema, CloudSongSchema, UidSchema } from './schemas/cloud.js'
import {
  DoormanClaimRequestSchema,
  SignInCodeSchema,
  formatSignInCode,
  normalizeSignInCode,
} from './schemas/doorman.js'
import type { SmartRules } from './schemas/smart.js'

const SHA = 'ab'.repeat(32)
const OTHER_SHA = 'cd'.repeat(32)

describe('uids', () => {
  it('are 32 hex characters, like the ones the migration gives existing rows', () => {
    const uid = newUid()
    expect(uid).toMatch(/^[0-9a-f]{32}$/)
    expect(UidSchema.safeParse(uid).success).toBe(true)
  })

  it('do not repeat', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => newUid()))
    expect(seen.size).toBe(1000)
  })

  it('come from whatever random source is given', () => {
    expect(newUid(bytes => bytes.fill(0))).toBe('0'.repeat(32))
  })

  it('name a device by its kind', () => {
    expect(newCloudDeviceId('mac')).toMatch(/^mac-[0-9a-f]{8}$/)
    expect(newCloudDeviceId('My iPhone!')).toMatch(/^my-iphone-[0-9a-f]{8}$/)
    expect(newCloudDeviceId('???')).toMatch(/^device-[0-9a-f]{8}$/)
  })
})

describe('file names', () => {
  it('name a file by its hash, with a clean extension', () => {
    expect(audioKey(SHA, '.M4A')).toBe(`audio/${SHA}.m4a`)
    expect(coverKey(SHA, 'jpg')).toBe(`covers/${SHA}.jpg`)
    expect(lyricsKey(SHA, true)).toBe(`lyrics/${SHA}.lrc`)
    expect(lyricsKey(SHA, false)).toBe(`lyrics/${SHA}.txt`)
  })

  it('never lets an odd extension become part of a path', () => {
    expect(cleanExtension('../../etc')).toBe('bin')
    expect(cleanExtension('')).toBe('bin')
    expect(cleanExtension('.flac')).toBe('flac')
  })
})

describe('snapshots', () => {
  const at = (iso: string) => new Date(iso)

  it('are named by a fixed-width UTC time, so text order is time order', () => {
    const key = snapshotKey(at('2026-09-11T14:22:05.123Z'), 'mac-3f9a1c2e')
    expect(key).toBe('snapshots/20260911T142205123Z-mac-3f9a1c2e.json')
    expect(parseSnapshotKey(key)).toEqual({
      stamp: '20260911T142205123Z',
      deviceId: 'mac-3f9a1c2e',
    })
  })

  it('ignore anything that is not a snapshot', () => {
    expect(parseSnapshotKey('snapshots/notes.txt')).toBeNull()
    expect(parseSnapshotKey(`audio/${SHA}.m4a`)).toBeNull()
  })

  it('pick the newest by anyone', () => {
    const keys = [
      snapshotKey(at('2026-09-10T10:00:00Z'), 'mac-aaaaaaaa'),
      snapshotKey(at('2026-09-11T09:00:00Z'), 'iphone-bbbbbbbb'),
      snapshotKey(at('2026-09-11T08:00:00Z'), 'mac-aaaaaaaa'),
      'snapshots/garbage.json',
    ]
    expect(newestSnapshotKey(keys)).toBe(keys[1])
    expect(newestSnapshotKey([])).toBeNull()
  })

  it("prune only the device's own, oldest first, keeping the newest few", () => {
    const mine = [1, 2, 3, 4, 5].map(day =>
      snapshotKey(at(`2026-09-0${day}T00:00:00Z`), 'mac-aaaaaaaa'),
    )
    const theirs = snapshotKey(at('2026-09-01T00:00:00Z'), 'iphone-bbbbbbbb')
    const shuffled = [mine[3], theirs, mine[0], mine[4], mine[1], mine[2]] as string[]
    expect(snapshotsToPrune(shuffled, 'mac-aaaaaaaa', 3)).toEqual([mine[0], mine[1]])
    expect(snapshotsToPrune(shuffled, 'mac-aaaaaaaa', 10)).toEqual([])
  })
})

describe('log files', () => {
  it('are numbered in fixed width, so a listing gives them in order', () => {
    expect(logKey('iphone-0b7d44a1', 42)).toBe('log/iphone-0b7d44a1/000000000042.json')
    expect(isCloudFileKey(logKey('iphone-0b7d44a1', 42))).toBe(true)
    expect(isDeletableCloudKey(logKey('iphone-0b7d44a1', 42))).toBe(true)
    expect(parseLogKey('log/iphone-0b7d44a1/000000000042.json')).toEqual({
      deviceId: 'iphone-0b7d44a1',
      seq: 42,
    })
  })

  it('are told apart from anything else in the log folder', () => {
    expect(parseLogKey('log/iphone-0b7d44a1/42.json')).toBeNull()
    expect(parseLogKey('log/iphone-0b7d44a1/000000000000.json')).toBeNull()
    expect(parseLogKey('log/iphone-0b7d44a1/000000000042.json.tmp')).toBeNull()
    expect(parseLogKey('snapshots/000000000042.json')).toBeNull()
  })

  it('still to be folded in are the ones after where a snapshot got to, in order', () => {
    const keys = [
      logKey('web-bbbb', 3),
      logKey('mac-aaaa', 1),
      logKey('web-bbbb', 1),
      logKey('web-bbbb', 2),
      logKey('web-cccc', 1),
      'log/web-bbbb/notes.txt',
    ]
    expect(unfoldedLogKeys(keys, { 'web-bbbb': 1, 'web-cccc': 1 })).toEqual([
      logKey('mac-aaaa', 1),
      logKey('web-bbbb', 2),
      logKey('web-bbbb', 3),
    ])
  })
})

describe('sign-in codes', () => {
  it('read back however they are typed', () => {
    for (const typed of ['4F7K2QXM', '4f7k-2qxm', ' 4F7K 2QXM ']) {
      expect(SignInCodeSchema.parse(typed)).toBe('4F7K2QXM')
    }
    // I and L are 1, O is 0: the letters Crockford's alphabet leaves out.
    expect(normalizeSignInCode('ilo0-abcd')).toBe('1100ABCD')
    expect(formatSignInCode('4f7k2qxm')).toBe('4F7K-2QXM')
  })

  it('are refused when they cannot be one', () => {
    for (const typed of ['', '4F7K2QX', '4F7K2QXMM', '4F7K2QXU', '4F7K#QXM']) {
      expect(SignInCodeSchema.safeParse(typed).success).toBe(false)
    }
  })

  it('go with a claim only when there is one', () => {
    expect(DoormanClaimRequestSchema.parse({ attempt: 'a'.repeat(32) })).toEqual({
      attempt: 'a'.repeat(32),
    })
    expect(DoormanClaimRequestSchema.parse({ attempt: 'a'.repeat(32), code: '4f7k-2qxm' })).toEqual(
      { attempt: 'a'.repeat(32), code: '4F7K2QXM' },
    )
  })
})

describe('what may pass through the doorman', () => {
  const snapshot = snapshotKey(new Date('2026-09-11T14:22:05.123Z'), 'mac-3f9a1c2e')

  it('lets through the library’s own files', () => {
    for (const key of [
      'format.json',
      snapshot,
      `audio/${SHA}.m4a`,
      `covers/${SHA}.jpg`,
      `lyrics/${SHA}.lrc`,
      'log/iphone-0b7d44a1/000123.jsonl',
    ]) {
      expect(isCloudFileKey(key)).toBe(true)
    }
  })

  it('refuses anything else, however it is dressed up', () => {
    for (const key of [
      '',
      'format.json.bak',
      '../format.json',
      `audio/../covers/${SHA}.jpg`,
      `audio/${SHA.toUpperCase()}.m4a`,
      `audio/${SHA}`,
      `music/${SHA}.m4a`,
      'snapshots/latest.json',
      'log/../../etc/passwd',
      'log/iphone-0b7d44a1/../x',
      'log/iphone-0b7d44a1/..',
      'log/iphone-0b7d44a1/.',
      'log/iphone-0b7d44a1/.hidden',
      'log/Phone/1.jsonl',
    ]) {
      expect(isCloudFileKey(key), key).toBe(false)
    }
  })

  it('lets snapshots and logs be deleted, never files named by their hash', () => {
    expect(isDeletableCloudKey(snapshot)).toBe(true)
    expect(isDeletableCloudKey('log/iphone-0b7d44a1/000123.jsonl')).toBe(true)
    expect(isDeletableCloudKey(`audio/${SHA}.m4a`)).toBe(false)
    expect(isDeletableCloudKey('format.json')).toBe(false)
  })

  it('lists only the library’s own folders', () => {
    for (const prefix of [
      '',
      'snapshots/',
      'log/',
      'log/mac-3f9a1c2e/',
      'audio/',
      'covers/',
      'lyrics/',
    ]) {
      expect(isCloudListPrefix(prefix), prefix).toBe(true)
    }
    for (const prefix of ['a', 'audio', 'snapshots/2026', '../', 'log/../']) {
      expect(isCloudListPrefix(prefix), prefix).toBe(false)
    }
  })
})

describe('parseEndpoint', () => {
  it('works out the region from a B2 address, pasted however it comes', () => {
    expect(parseEndpoint('s3.us-west-004.backblazeb2.com')).toEqual({
      url: 'https://s3.us-west-004.backblazeb2.com',
      region: 'us-west-004',
    })
    expect(parseEndpoint('  https://s3.eu-central-003.backblazeb2.com/ ')).toEqual({
      url: 'https://s3.eu-central-003.backblazeb2.com',
      region: 'eu-central-003',
    })
  })

  it('leaves the region to be given for anyone else', () => {
    expect(parseEndpoint('https://abc123.r2.cloudflarestorage.com')).toEqual({
      url: 'https://abc123.r2.cloudflarestorage.com',
      region: null,
    })
    expect(parseEndpoint('http://127.0.0.1:9000')).toEqual({
      url: 'http://127.0.0.1:9000',
      region: null,
    })
  })

  it('refuses what is not an address', () => {
    expect(parseEndpoint('')).toBeNull()
    expect(parseEndpoint('https://s3.us-west-004.backblazeb2.com/my-bucket')).toBeNull()
    expect(parseEndpoint('not a url at all')).toBeNull()
  })
})

describe('toCloudRules', () => {
  const rules: SmartRules = {
    match: 'all',
    rules: [
      { field: 'tag', op: 'has', tagId: 3 },
      { field: 'tag', op: 'notHas', tagId: 99 },
      { field: 'playCount', op: 'gt', value: 5 },
    ],
    orderBy: 'playCount',
    order: 'desc',
    limit: 50,
  }

  it('names tags by uid and leaves every other rule as it is', () => {
    const uid = 'f'.repeat(32)
    const cloud = toCloudRules(rules, id => (id === 3 ? uid : null))
    expect(cloud.rules[0]).toEqual({ field: 'tag', op: 'has', tagUid: uid })
    expect(cloud.rules[2]).toEqual({ field: 'playCount', op: 'gt', value: 5 })
    expect(cloud).toMatchObject({ match: 'all', orderBy: 'playCount', order: 'desc', limit: 50 })
  })

  it('keeps a rule about a deleted tag meaning what it meant', () => {
    const cloud = toCloudRules(rules, () => null)
    expect(cloud.rules[1]).toEqual({ field: 'tag', op: 'notHas', tagUid: MISSING_TAG_UID })
  })
})

describe('fromCloudRules', () => {
  it("names tags by this device's ids again, and a tag it does not have by none", () => {
    const known = 'f'.repeat(32)
    const local = fromCloudRules(
      {
        match: 'any',
        rules: [
          { field: 'tag', op: 'has', tagUid: known },
          { field: 'tag', op: 'has', tagUid: MISSING_TAG_UID },
          { field: 'loved', op: 'is', value: true },
        ],
        orderBy: 'title',
        order: 'asc',
        limit: null,
      },
      uid => (uid === known ? 7 : null),
    )
    expect(local.rules).toEqual([
      { field: 'tag', op: 'has', tagId: 7 },
      { field: 'tag', op: 'has', tagId: UNKNOWN_TAG_ID },
      { field: 'loved', op: 'is', value: true },
    ])
    expect(local).toMatchObject({ match: 'any', orderBy: 'title', order: 'asc', limit: null })
  })
})

describe('snapshot schema', () => {
  const song = {
    uid: 'a'.repeat(32),
    title: 'Gunjou',
    artist: 'YOASOBI',
    album: '',
    albumArtist: '',
    trackNo: null,
    year: null,
    duration: 250,
    audio: { key: `audio/${SHA}.m4a`, size: 4_000_000, mime: 'audio/mp4' },
    cover: { key: `covers/${OTHER_SHA}.jpg`, size: 80_000 },
    lyrics: null,
    instrumental: false,
    loved: true,
    playCount: 3,
    skipCount: 0,
    lastPlayedAt: null,
    addedAt: '2026-09-01 10:00:00',
    sourceUrl: null,
    tagUids: [],
    audioFeatures: null,
  }

  it('accepts a well-formed song', () => {
    expect(CloudSongSchema.safeParse(song).success).toBe(true)
  })

  it('refuses a song that points anywhere but a hash in its own folder', () => {
    for (const key of [
      `covers/${SHA}.m4a`,
      `audio/${SHA}`,
      `audio/../${SHA}.m4a`,
      `audio/${SHA.slice(2)}.m4a`,
      `/audio/${SHA}.m4a`,
    ]) {
      expect(CloudSongSchema.safeParse({ ...song, audio: { ...song.audio, key } }).success).toBe(
        false,
      )
    }
  })

  it('fills in what the change log will add later', () => {
    const parsed = CloudSnapshotSchema.parse({
      format: 1,
      writtenAt: '2026-09-11T14:22:05.123Z',
      writtenBy: 'mac-3f9a1c2e',
      songs: [song],
      tags: [],
      playlists: [],
    })
    expect(parsed.upTo).toEqual({})
  })
})

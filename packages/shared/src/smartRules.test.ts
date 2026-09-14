import { describe, expect, it } from 'vitest'
import { MISSING_TAG_UID } from './cloud.js'
import type { CloudSmartRule, CloudSmartRules, CloudSong } from './schemas/cloud.js'
import { livePlaylistSongs } from './smartRules.js'

const uid = (n: number): string => n.toString(16).padStart(32, '0')
const CHILL = uid(0x71)
const NOW = Date.parse('2026-09-11T12:00:00.000Z')

function song(n: number, overrides: Partial<CloudSong> = {}): CloudSong {
  return {
    uid: uid(n),
    title: `Song ${n}`,
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

function rules(list: CloudSmartRule[], overrides: Partial<CloudSmartRules> = {}): CloudSmartRules {
  return { match: 'all', rules: list, orderBy: 'addedAt', order: 'desc', limit: null, ...overrides }
}

const features = (bpm: number | null, camelot: string | null) => ({
  bpm,
  energy: 0.5,
  loudnessLufs: -9,
  key: null,
  camelot,
  danceability: 0.5,
  analyzedAt: '2026-09-01 10:00:00',
  version: 1,
})

// Newest first, as a snapshot lists them.
const LIBRARY: CloudSong[] = [
  song(5, { title: 'Rain Song', loved: true, addedAt: '2026-09-10 09:00:00', tagUids: [CHILL] }),
  song(4, {
    title: 'rainy day',
    playCount: 12,
    lastPlayedAt: '2026-09-10 20:00:00',
    addedAt: '2026-09-05 09:00:00',
    features: features(128, '8A'),
  }),
  song(3, { title: 'Sunny', year: 1999, playCount: 3, addedAt: '2026-08-01 09:00:00' }),
  song(2, {
    title: 'Ämne',
    playCount: 12,
    addedAt: '2026-08-01 09:00:00',
    features: features(90, '9A'),
    lyrics: { key: `lyrics/${'cd'.repeat(32)}.lrc`, size: 10, kind: 'synced', romanized: null },
  }),
  song(1, { title: 'Old', addedAt: '2025-01-01 09:00:00', lastPlayedAt: '2025-06-01 09:00:00' }),
]

const run = (r: CloudSmartRules): string[] => livePlaylistSongs(r, LIBRARY, { now: NOW })
const ids = (...ns: number[]): string[] => ns.map(uid)

describe('smart playlists on a device', () => {
  it('match text ignoring the case of A–Z only, as SQLite does', () => {
    expect(run(rules([{ field: 'title', op: 'contains', value: 'RAIN' }]))).toEqual(ids(5, 4))
    expect(run(rules([{ field: 'title', op: 'equals', value: 'sunny' }]))).toEqual(ids(3))
    expect(run(rules([{ field: 'title', op: 'startsWith', value: 'rain' }]))).toEqual(ids(5, 4))
    expect(run(rules([{ field: 'title', op: 'notContains', value: 'n' }]))).toEqual(ids(1))
    // SQLite folds no case outside A–Z, so "ä" does not match "Ä".
    expect(run(rules([{ field: 'title', op: 'contains', value: 'ämne' }]))).toEqual([])
  })

  it('match tags, a deleted one included', () => {
    expect(run(rules([{ field: 'tag', op: 'has', tagUid: CHILL }]))).toEqual(ids(5))
    expect(run(rules([{ field: 'tag', op: 'has', tagUid: MISSING_TAG_UID }]))).toEqual([])
    expect(run(rules([{ field: 'tag', op: 'notHas', tagUid: MISSING_TAG_UID }]))).toHaveLength(5)
  })

  it('never match a missing year with a number', () => {
    expect(run(rules([{ field: 'year', op: 'lt', value: 3000 }]))).toEqual(ids(3))
  })

  it('count days back from now, and treat never played as not played lately', () => {
    expect(run(rules([{ field: 'addedAt', op: 'inLastDays', days: 7 }]))).toEqual(ids(5, 4))
    expect(run(rules([{ field: 'lastPlayedAt', op: 'notInLastDays', days: 30 }]))).toEqual(
      ids(5, 3, 2, 1),
    )
    expect(run(rules([{ field: 'lastPlayedAt', op: 'never' }]))).toEqual(ids(5, 3, 2))
  })

  it('match loved, lyrics, features and keys, leaving songs not analysed out', () => {
    expect(run(rules([{ field: 'loved', op: 'is', value: true }]))).toEqual(ids(5))
    expect(run(rules([{ field: 'hasLyrics', op: 'is', value: true }]))).toEqual(ids(2))
    expect(run(rules([{ field: 'bpm', op: 'gte', value: 100 }]))).toEqual(ids(4))
    expect(run(rules([{ field: 'bpm', op: 'lt', value: 100 }]))).toEqual(ids(2))
    expect(run(rules([{ field: 'key', op: 'compatible', value: '8a' }]))).toEqual(ids(4, 2))
  })

  it('combine rules with all or any', () => {
    const both: CloudSmartRule[] = [
      { field: 'title', op: 'contains', value: 'rain' },
      { field: 'loved', op: 'is', value: true },
    ]
    expect(run(rules(both))).toEqual(ids(5))
    expect(run(rules(both, { match: 'any' }))).toEqual(ids(5, 4))
  })

  it('sort with ties broken the way the server breaks them, nulls last, then limit', () => {
    // 4 and 2 tie on plays; the server's newer row comes first going down.
    expect(run(rules([], { orderBy: 'playCount', order: 'desc' }))).toEqual(ids(4, 2, 3, 5, 1))
    expect(run(rules([], { orderBy: 'playCount', order: 'asc' }))).toEqual(ids(1, 5, 3, 2, 4))
    expect(run(rules([], { orderBy: 'lastPlayedAt', order: 'asc' }))).toEqual(ids(1, 4, 2, 3, 5))
    expect(run(rules([], { orderBy: 'title', order: 'asc', limit: 2 }))).toEqual(ids(1, 5))
  })

  it('shuffle when asked to, using the random source given', () => {
    const shuffled = livePlaylistSongs(rules([], { orderBy: 'random' }), LIBRARY, {
      now: NOW,
      random: (() => {
        let n = 0
        return () => [0.9, 0.1, 0.5, 0.3, 0.7][n++ % 5] ?? 0
      })(),
    })
    expect(shuffled).toEqual(ids(4, 2, 3, 1, 5))
  })
})

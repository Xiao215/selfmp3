import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MISSING_TAG_UID,
  applyChanges,
  formatHlc,
  livePlaylistSongs,
  syncLibrary,
  type Change,
  type CloudSmartRules,
  type CloudSnapshot,
  type SmartRules,
} from '@selfmp3/shared'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { CloudRepository } from '../repositories/cloud.js'
import { PlaylistRepository } from '../repositories/playlists.js'
import { SongRepository } from '../repositories/songs.js'
import { StatsRepository } from '../repositories/stats.js'
import { SyncRepository } from '../repositories/sync.js'
import { TagRepository } from '../repositories/tags.js'
import { CloudIngest } from './cloudIngest.js'
import { buildSnapshot } from './cloudSnapshot.js'
import { LocalEdits, SyncClock } from './localEdits.js'

/**
 * The Mac applies other devices' changes to its database; every other device
 * replays them over a snapshot in memory (packages/shared/src/sync.ts). If the
 * two ever disagreed, devices would drift apart for good. So each test here
 * runs the same changes through both and expects the same library — and the
 * live playlists the Mac builds in SQL to match the ones a phone builds in
 * JavaScript.
 */

const BASE = Date.parse('2026-09-01T10:00:00Z')
/** A stamp `seconds` after BASE, from `device`. */
const at = (seconds: number, device = 'web-bbbb1111'): string =>
  formatHlc({ ms: BASE + seconds * 1000, counter: 0, device })
const sha = (n: number): string => n.toString(16).padStart(64, '0')

describe('CloudIngest', () => {
  let db: Database.Database
  let songs: SongRepository
  let tags: TagRepository
  let playlists: PlaylistRepository
  let stats: StatsRepository
  let sync: SyncRepository
  let cloud: CloudRepository
  let edits: LocalEdits
  let ingest: CloudIngest
  let now: number

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    const logger = createLogger('silent')
    migrate(db, logger)
    songs = new SongRepository(db)
    tags = new TagRepository(db)
    playlists = new PlaylistRepository(db)
    stats = new StatsRepository(db)
    sync = new SyncRepository(db)
    cloud = new CloudRepository(db)
    now = BASE
    const clock = new SyncClock({
      deviceId: () => 'mac-aaaa1111',
      latest: () => sync.latestStamp(),
      now: () => now,
    })
    edits = new LocalEdits({ db, sync, clock })
    ingest = new CloudIngest({ db, songs, tags, playlists, stats, sync, clock, logger })
  })

  afterEach(() => db.close())

  let next = 1
  /** A song in the library, uploaded as far as the bookkeeping knows. */
  function addSong(
    title: string,
    fields: { artist?: string; year?: number; lyrics?: boolean; art?: boolean } = {},
  ): number {
    const n = next++
    const id = songs.insert({
      path: `${title}.m4a`,
      title,
      artist: fields.artist ?? 'Artist',
      album: '',
      albumArtist: '',
      trackNo: null,
      year: fields.year ?? null,
      duration: 100 + n,
      sizeBytes: 1000,
      mime: 'audio/mp4',
      mtimeMs: 1,
      hasArt: fields.art ?? false,
      artExt: fields.art ? '.jpg' : null,
      lyricsKind: fields.lyrics ? 'synced' : 'none',
      sourceUrl: null,
    })
    // Distinct times, oldest first, the way a library fills up.
    db.prepare("UPDATE songs SET added_at = datetime('2026-08-01', ?) WHERE id = ?").run(
      `+${n} hours`,
      id,
    )
    cloud.saveState({
      songId: id,
      audioKey: `audio/${sha(n)}.m4a`,
      audioSize: 1000,
      audioSig: 'sig',
      coverKey: fields.art ? `covers/${sha(n)}.jpg` : null,
      coverSize: fields.art ? 10 : null,
      coverSig: 'sig',
      lyricsKey: fields.lyrics ? `lyrics/${sha(n)}.lrc` : null,
      lyricsSize: fields.lyrics ? 10 : null,
      lyricsKind: fields.lyrics ? 'synced' : null,
      romanizedKey: null,
      lyricsSig: 'sig',
    })
    return id
  }

  /** The snapshot this Mac would publish now, exactly as the sync builds it. */
  function macSnapshot(): CloudSnapshot {
    return buildSnapshot({
      songs: songs.all(),
      songUids: new Map(cloud.songFiles().map(file => [file.id, file.uid])),
      states: cloud.states(),
      tags: tags.all(),
      tagUids: cloud.tagUids(),
      playlists: playlists.all(),
      playlistUids: cloud.playlistUids(),
      playlistSongIds: playlist => playlists.songIds(playlist),
      deviceId: 'mac-aaaa1111',
      writtenAt: new Date(BASE),
      stamps: sync.allStamps(),
      aliases: sync.aliases(),
      upTo: sync.cursors(),
    })
  }

  /** What a phone makes of the same changes over the snapshot it had. */
  function replayed(from: CloudSnapshot, changes: readonly Change[]): CloudSnapshot {
    const library = syncLibrary(from)
    applyChanges(library, changes)
    const list = [...library.songs.values()]
    return {
      ...from,
      songs: list,
      tags: [...library.tags.values()],
      playlists: [...library.playlists.values()].map(playlist =>
        playlist.kind === 'live' && playlist.rules
          ? { ...playlist, songUids: livePlaylistSongs(playlist.rules, list) }
          : playlist,
      ),
      aliases: library.aliases.size > 0 ? Object.fromEntries(library.aliases) : undefined,
    }
  }

  /** Two libraries side by side, with nothing but order to tell them apart. */
  function comparable(snapshot: CloudSnapshot) {
    const byUid = <T extends { uid: string }>(items: readonly T[]) =>
      [...items].sort((a, b) => a.uid.localeCompare(b.uid))
    return {
      songs: byUid(snapshot.songs).map(song => ({ ...song, tagUids: [...song.tagUids].sort() })),
      tags: byUid(snapshot.tags),
      playlists: byUid(snapshot.playlists),
      aliases: snapshot.aliases ?? {},
    }
  }

  const uidOf = (table: 'songs' | 'tags' | 'playlists', id: number): string => {
    const uid = sync.uids(table, [id]).get(id)
    if (!uid) throw new Error(`no ${table} row ${id}`)
    return uid
  }

  it('ends up with the same library as a phone replaying the same changes', () => {
    const a = addSong('Alpha', { year: 2001 })
    const b = addSong('Bravo', { lyrics: true })
    const c = addSong('Charlie', { art: true })
    const chill = tags.create('chill', 10).id
    const rain = tags.create('rain', 20).id
    tags.setSongTags(a, [chill])
    const mix = playlists.create({ name: 'Mix', description: '', kind: 'manual', rules: null }).id
    playlists.add(mix, [a, b])
    const lovedRules: SmartRules = {
      match: 'all',
      rules: [{ field: 'loved', op: 'is', value: true }],
      orderBy: 'title',
      order: 'asc',
      limit: null,
    }
    const loved = playlists.create({
      name: 'Loved',
      description: '',
      kind: 'live',
      rules: lovedRules,
    }).id
    const rainy = playlists.create({
      name: 'Rainy',
      description: '',
      kind: 'live',
      rules: { ...lovedRules, rules: [{ field: 'tag', op: 'has', tagId: rain }] },
    }).id

    // Edited here, later than the phone's edit of the same field below.
    now = BASE + 50_000
    songs.patch(a, { title: 'Alpha (Mac)' })
    edits.songs([a], ['title'])

    const before = macSnapshot()
    const [A, B, C] = [a, b, c].map(id => uidOf('songs', id)) as [string, string, string]
    const [CHILL, RAIN] = [chill, rain].map(id => uidOf('tags', id)) as [string, string]
    const MIX = uidOf('playlists', mix)
    const LOVED = uidOf('playlists', loved)
    const RAINY = uidOf('playlists', rainy)
    const road = 'f'.repeat(31) + '1'
    const twin = 'f'.repeat(31) + '2'
    const night = 'f'.repeat(31) + '3'

    const changes: Change[] = [
      // Loses to the Mac's later edit; the artist, which the Mac did not touch, wins.
      {
        type: 'songEdited',
        hlc: at(10),
        uid: A,
        fields: { title: 'Alpha (phone)', artist: 'Phone' },
      },
      { type: 'songEdited', hlc: at(11), uid: B, fields: { loved: true, year: 1999 } },
      { type: 'songEdited', hlc: at(12, 'web-cccc2222'), uid: C, fields: { loved: true } },
      // "Chill" made on the phone while the Mac had "chill": one tag.
      { type: 'tagCreated', hlc: at(13), uid: twin, name: 'Chill', hue: 5 },
      { type: 'songTagged', hlc: at(14), uid: B, tagUid: twin, on: true },
      { type: 'songTagged', hlc: at(15), uid: A, tagUid: CHILL, on: false },
      { type: 'tagCreated', hlc: at(16), uid: night, name: 'night', hue: 200 },
      { type: 'songTagged', hlc: at(17), uid: C, tagUid: night, on: true },
      // A name another tag has is refused; the colour still changes.
      { type: 'tagEdited', hlc: at(18), uid: night, fields: { name: 'CHILL', hue: 300 } },
      { type: 'tagRemoved', hlc: at(19, 'web-cccc2222'), uid: RAIN },
      {
        type: 'playlistCreated',
        hlc: at(20),
        uid: road,
        kind: 'manual',
        name: 'Road trip',
        description: 'for the drive',
        pinned: true,
        rules: null,
      },
      { type: 'playlistSong', hlc: at(21), uid: road, songUid: C, on: true },
      { type: 'playlistSong', hlc: at(22), uid: road, songUid: B, on: true },
      { type: 'playlistOrdered', hlc: at(23), uid: road, songUids: [B, C] },
      { type: 'playlistSong', hlc: at(24), uid: MIX, songUid: C, on: true },
      { type: 'playlistOrdered', hlc: at(25, 'web-cccc2222'), uid: MIX, songUids: [B, A] },
      {
        type: 'playlistEdited',
        hlc: at(26),
        uid: LOVED,
        fields: { name: 'Favourites', pinned: true },
      },
      {
        type: 'songPlayed',
        hlc: at(27),
        uid: B,
        playId: 'play-00000001',
        playedAt: '2026-09-01T09:00:00.000Z',
        msPlayed: 90_000,
        completed: true,
      },
      {
        type: 'songPlayed',
        hlc: at(28),
        uid: B,
        playId: 'play-00000001',
        playedAt: '2026-09-01T09:00:00.000Z',
        msPlayed: 90_000,
        completed: true,
      },
      {
        type: 'songSkipped',
        hlc: at(29),
        uid: C,
        skipId: 'skip-00000001',
        skippedAt: '2026-09-01T09:05:00.000Z',
        atSeconds: 3,
      },
      // For something that is not here, nothing happens.
      { type: 'songEdited', hlc: at(30), uid: '9'.repeat(32), fields: { title: 'Ghost' } },
    ]

    const result = ingest.apply(changes)
    const after = macSnapshot()
    const phone = replayed(before, changes)

    expect(comparable(after)).toEqual(comparable(phone))
    expect(result.applied).toBe(19)
    // And it is the library it should be, not just the same wrong one twice.
    const song = (uid: string) => after.songs.find(s => s.uid === uid)
    expect(song(A)).toMatchObject({ title: 'Alpha (Mac)', artist: 'Phone', tagUids: [] })
    expect(song(B)).toMatchObject({ loved: true, year: 1999, playCount: 1, tagUids: [CHILL] })
    expect(song(C)?.skipCount).toBe(1)
    expect(after.aliases).toEqual({ [twin]: CHILL })
    expect(after.tags.find(tag => tag.uid === night)).toMatchObject({ name: 'night', hue: 300 })
    expect(after.tags.some(tag => tag.uid === RAIN)).toBe(false)
    const playlist = (uid: string) => after.playlists.find(p => p.uid === uid)
    expect(playlist(road)).toMatchObject({ name: 'Road trip', pinned: true, songUids: [B, C] })
    expect(playlist(MIX)?.songUids).toEqual([B, A, C])
    expect(playlist(LOVED)).toMatchObject({ name: 'Favourites', songUids: [B, C] })
    expect(playlist(RAINY)?.rules?.rules).toEqual([
      { field: 'tag', op: 'has', tagUid: MISSING_TAG_UID },
    ])
  })

  it('removes a song everywhere, and says whose files are to go', () => {
    const a = addSong('Alpha')
    const b = addSong('Bravo')
    const mix = playlists.create({ name: 'Mix', description: '', kind: 'manual', rules: null }).id
    playlists.add(mix, [a, b])
    const before = macSnapshot()
    const A = uidOf('songs', a)
    const changes: Change[] = [
      { type: 'songEdited', hlc: at(1), uid: A, fields: { loved: true } },
      { type: 'songRemoved', hlc: at(2), uid: A },
      { type: 'songEdited', hlc: at(3), uid: A, fields: { title: 'Back?' } },
    ]
    const result = ingest.apply(changes)
    expect(result.removed).toEqual([{ id: a, path: 'Alpha.m4a' }])
    expect(songs.byId(a)).toBeNull()
    expect(sync.allStamps().filter(stamp => stamp.uid === A)).toEqual([])
    expect(comparable(macSnapshot())).toEqual(comparable(replayed(before, changes)))
  })

  it('applies a change arriving late only where nothing later has been', () => {
    const a = addSong('Alpha')
    const A = uidOf('songs', a)
    ingest.apply([{ type: 'songEdited', hlc: at(20), uid: A, fields: { title: 'Later' } }])
    ingest.apply([
      {
        type: 'songEdited',
        hlc: at(10, 'web-cccc2222'),
        uid: A,
        fields: { title: 'Earlier', year: 1990 },
      },
    ])
    expect(songs.byId(a)).toMatchObject({ title: 'Later', year: 1990 })
  })

  it('stamps what the Mac does after anything it has taken in', () => {
    const a = addSong('Alpha')
    const A = uidOf('songs', a)
    // Another device's clock is a minute ahead of this Mac's.
    ingest.apply([{ type: 'songEdited', hlc: at(60), uid: A, fields: { title: 'Phone' } }])
    songs.patch(a, { title: 'Mac' })
    edits.songs([a], ['title'])
    expect(sync.stamp('song', A, 'title')! > at(60)).toBe(true)
    // So the phone's edit, arriving again, does not undo the Mac's.
    ingest.apply([{ type: 'songEdited', hlc: at(60), uid: A, fields: { title: 'Phone' } }])
    expect(songs.byId(a)?.title).toBe('Mac')
  })

  it('moves the cursors with the changes, and skips one that fails without losing the rest', () => {
    const a = addSong('Alpha')
    const A = uidOf('songs', a)
    const originalPatch = songs.patch.bind(songs)
    songs.patch = (id, patch) => {
      if (patch.title === 'Boom') throw new Error('the disk is on fire')
      originalPatch(id, patch)
    }
    const result = ingest.apply(
      [
        { type: 'songEdited', hlc: at(1), uid: A, fields: { title: 'Boom' } },
        { type: 'songEdited', hlc: at(2), uid: A, fields: { year: 2020 } },
      ],
      () => sync.setCursor('web-bbbb1111', 7),
    )
    expect(result.applied).toBe(1)
    expect(songs.byId(a)).toMatchObject({ title: 'Alpha', year: 2020 })
    // The failed change left no stamp behind to block a later fix.
    expect(sync.stamp('song', A, 'title')).toBeNull()
    expect(sync.cursors()).toEqual({ 'web-bbbb1111': 7 })
  })

  it('never moves a cursor back', () => {
    sync.setCursor('web-bbbb1111', 7)
    sync.setCursor('web-bbbb1111', 3)
    expect(sync.cursors()).toEqual({ 'web-bbbb1111': 7 })
  })

  describe('live playlists on a phone and on the Mac', () => {
    const rulesets: CloudSmartRules[] = []
    const base = {
      match: 'all' as const,
      orderBy: 'addedAt' as const,
      order: 'desc' as const,
      limit: null,
    }

    beforeEach(() => {
      const ids = [
        addSong('Rain Song', { artist: 'Aurora', year: 2019, lyrics: true, art: true }),
        addSong('rainy day', { artist: 'aurora', year: 2003 }),
        addSong('Sunny', { artist: 'Björk', lyrics: true }),
        addSong('Ämne', { artist: 'Zed', year: 1999, art: true }),
        addSong('50% Off', { artist: 'Sale_Band' }),
        addSong('Old', { artist: 'Aurora' }),
      ]
      const [one, two, three, four, five, six] = ids as [
        number,
        number,
        number,
        number,
        number,
        number,
      ]
      songs.patch(one, { loved: true })
      songs.patch(four, { loved: true })
      for (const [id, plays] of [
        [one, 5],
        [two, 5],
        [three, 2],
        [five, 9],
      ] as const) {
        for (let i = 0; i < plays; i++) songs.recordPlay(id, `2026-08-2${i} 10:00:00`)
      }
      songs.recordSkip(six)
      const chill = tags.create('chill').id
      tags.setSongTags(one, [chill])
      tags.setSongTags(three, [chill])
      for (const [id, bpm, energy, camelot] of [
        [one, 128, 0.8, '8A'],
        [two, 90, 0.3, '9A'],
        [four, 128, 0.5, '3B'],
      ] as const) {
        db.prepare(
          'INSERT INTO song_features (song_id, bpm, energy, loudness_lufs, key, camelot, danceability) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(id, bpm, energy, -8 - bpm / 100, null, camelot, 0.5)
      }
      const chillUid = uidOf('tags', chill)

      rulesets.length = 0
      rulesets.push(
        { ...base, rules: [{ field: 'title', op: 'contains', value: 'RAIN' }] },
        { ...base, rules: [{ field: 'title', op: 'contains', value: '%' }] },
        { ...base, rules: [{ field: 'artist', op: 'contains', value: 'sale_' }] },
        { ...base, rules: [{ field: 'artist', op: 'equals', value: 'AURORA' }] },
        { ...base, rules: [{ field: 'artist', op: 'startsWith', value: 'bj' }] },
        { ...base, rules: [{ field: 'title', op: 'notContains', value: 'a' }] },
        { ...base, rules: [{ field: 'tag', op: 'has', tagUid: chillUid }] },
        { ...base, rules: [{ field: 'tag', op: 'notHas', tagUid: chillUid }] },
        { ...base, rules: [{ field: 'tag', op: 'has', tagUid: MISSING_TAG_UID }] },
        { ...base, rules: [{ field: 'year', op: 'lt', value: 2010 }] },
        { ...base, rules: [{ field: 'playCount', op: 'gte', value: 5 }] },
        { ...base, rules: [{ field: 'skipCount', op: 'eq', value: 1 }] },
        { ...base, rules: [{ field: 'duration', op: 'gt', value: 103 }] },
        { ...base, rules: [{ field: 'loved', op: 'is', value: true }] },
        { ...base, rules: [{ field: 'hasLyrics', op: 'is', value: false }] },
        { ...base, rules: [{ field: 'hasArt', op: 'is', value: true }] },
        { ...base, rules: [{ field: 'bpm', op: 'eq', value: 128 }] },
        { ...base, rules: [{ field: 'energy', op: 'lt', value: 0.6 }] },
        { ...base, rules: [{ field: 'loudness', op: 'lte', value: -9 }] },
        { ...base, rules: [{ field: 'key', op: 'compatible', value: '8A' }] },
        { ...base, rules: [{ field: 'key', op: 'is', value: '3B' }] },
        { ...base, rules: [{ field: 'addedAt', op: 'inLastDays', days: 3650 }] },
        { ...base, rules: [{ field: 'lastPlayedAt', op: 'never' }] },
        { ...base, rules: [{ field: 'lastPlayedAt', op: 'notInLastDays', days: 1 }] },
        {
          ...base,
          match: 'any',
          rules: [
            { field: 'loved', op: 'is', value: true },
            { field: 'artist', op: 'equals', value: 'aurora' },
          ],
        },
        { ...base, rules: [], orderBy: 'playCount', order: 'desc' },
        { ...base, rules: [], orderBy: 'playCount', order: 'asc', limit: 4 },
        { ...base, rules: [], orderBy: 'title', order: 'asc' },
        { ...base, rules: [], orderBy: 'artist', order: 'desc' },
        { ...base, rules: [], orderBy: 'album', order: 'asc' },
        { ...base, rules: [], orderBy: 'duration', order: 'desc' },
        { ...base, rules: [], orderBy: 'lastPlayedAt', order: 'desc' },
        { ...base, rules: [], orderBy: 'lastPlayedAt', order: 'asc' },
        { ...base, rules: [], orderBy: 'addedAt', order: 'asc', limit: 2 },
      )
    })

    it('agree on every kind of rule, sort and limit', () => {
      const snapshot = macSnapshot()
      const uidOfSong = new Map(cloud.songFiles().map(file => [file.id, file.uid]))
      const tagIdOf = new Map([...cloud.tagUids()].map(([id, uid]) => [uid, id]))
      for (const cloudRules of rulesets) {
        const local: SmartRules = {
          ...cloudRules,
          rules: cloudRules.rules.map(rule =>
            rule.field === 'tag'
              ? { field: 'tag', op: rule.op, tagId: tagIdOf.get(rule.tagUid) ?? 999_999 }
              : rule,
          ),
        }
        const mac = playlists
          .songIds({
            id: 0,
            name: 'check',
            description: '',
            kind: 'live',
            rules: local,
            songCount: 0,
            totalDuration: 0,
            pinned: false,
            createdAt: '',
            updatedAt: '',
          })
          .map(id => uidOfSong.get(id))
        const phone = livePlaylistSongs(cloudRules, snapshot.songs)
        expect({ rules: cloudRules, songs: phone }).toEqual({ rules: cloudRules, songs: mac })
      }
    })
  })
})

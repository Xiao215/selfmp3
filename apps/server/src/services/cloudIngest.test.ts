import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MISSING_TAG_UID,
  applyChanges,
  formatHlc,
  inKeptOrder,
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
import { NamesRepository } from '../repositories/names.js'
import { TagRepository } from '../repositories/tags.js'
import { CloudIngest } from './cloudIngest.js'
import { SongMerge } from './songMerge.js'
import { buildSnapshot } from './cloudSnapshot.js'
import { LocalEdits, SyncClock } from './localEdits.js'

/**
 * The server applies other devices' changes to its database; every other device
 * replays them over a snapshot in memory (packages/shared/src/sync.ts). If the
 * two ever disagreed, devices would drift apart for good. So each test here
 * runs the same changes through both and expects the same library — and the
 * live playlists the server builds in SQL to match the ones a phone builds in
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
  let names: NamesRepository
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
    names = new NamesRepository(db)
    now = BASE
    const clock = new SyncClock({
      deviceId: () => 'mac-aaaa1111',
      latest: () => sync.latestStamp(),
      now: () => now,
    })
    edits = new LocalEdits({ db, sync, clock })
    ingest = new CloudIngest({
      db,
      songs,
      tags,
      playlists,
      stats,
      sync,
      cloud: new CloudRepository(db),
      names,
      clock,
      logger,
      merge: new SongMerge({ db, sync }),
    })
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
    // Distinct times, newest first: the order a server that adopted a bucket
    // gave its ids out in, since a snapshot lists the newest song first. So a
    // sort that fell back on row ids would disagree with a device's.
    db.prepare("UPDATE songs SET added_at = datetime('2026-08-01', ?) WHERE id = ?").run(
      `-${n} hours`,
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
      lyricsSig: 'sig',
      motionKey: null,
      motionSig: 'none',
    })
    return id
  }

  /** The snapshot this server would publish now, exactly as the sync builds it. */
  function serverSnapshot(): CloudSnapshot {
    return buildSnapshot({
      songs: songs.all(),
      songUids: new Map(cloud.songFiles().map(file => [file.id, file.uid])),
      states: cloud.states(),
      artists: [],
      artistNames: names.artistNames(),
      tags: tags.all(),
      tagUids: cloud.tagUids(),
      playlists: playlists.all(),
      playlistUids: cloud.playlistUids(),
      playlistSongIds: playlist => playlists.songIds(playlist),
      deviceId: 'mac-aaaa1111',
      writtenAt: new Date(BASE),
      stamps: sync.allStamps(),
      aliases: sync.aliases(),
      merged: sync.merges(),
      upTo: sync.cursors(),
    })
  }

  /**
   * What a phone makes of the same changes over the snapshot it had: each
   * playlist that follows tags its rule's songs, in the order kept by hand
   * (packages/replica/src/replay.ts).
   */
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
          ? {
              ...playlist,
              songUids: inKeptOrder(playlist.songUids, livePlaylistSongs(playlist.rules, list)),
            }
          : playlist,
      ),
      artistNames: [...library.artistNames.values()],
      aliases: library.aliases.size > 0 ? Object.fromEntries(library.aliases) : undefined,
      merged: library.merged.size > 0 ? Object.fromEntries(library.merged) : undefined,
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
      artistNames: [...snapshot.artistNames].sort((a, b) => a.artist.localeCompare(b.artist)),
      aliases: snapshot.aliases ?? {},
      merged: snapshot.merged ?? {},
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
    songs.patch(a, { title: 'Alpha (Server)' })
    edits.songs([a], ['title'])
    // Named here later than the phone names them below.
    names.takeArtistNames('server', ['The Server'], at(40, 'mac-aaaa1111'))

    const before = serverSnapshot()
    const [A, B, C] = [a, b, c].map(id => uidOf('songs', id)) as [string, string, string]
    const [CHILL, RAIN] = [chill, rain].map(id => uidOf('tags', id)) as [string, string]
    const MIX = uidOf('playlists', mix)
    const LOVED = uidOf('playlists', loved)
    const RAINY = uidOf('playlists', rainy)
    const road = 'f'.repeat(31) + '1'
    const twin = 'f'.repeat(31) + '2'
    const night = 'f'.repeat(31) + '3'

    const changes: Change[] = [
      // Loses to the server's later edit; the artist, which the server did not touch, wins.
      {
        type: 'songEdited',
        hlc: at(10),
        uid: A,
        fields: { title: 'Alpha (phone)', artist: 'Phone' },
      },
      { type: 'songEdited', hlc: at(11), uid: B, fields: { loved: true, year: 1999 } },
      { type: 'songEdited', hlc: at(12, 'web-cccc2222'), uid: C, fields: { loved: true } },
      // "Chill" made on the phone while the server had "chill": one tag.
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
      // A playlist that follows tags takes a hand order too.
      { type: 'playlistOrdered', hlc: at(29), uid: LOVED, songUids: [C, B] },
      // For something that is not here, nothing happens.
      { type: 'songEdited', hlc: at(30), uid: '9'.repeat(32), fields: { title: 'Ghost' } },
      // An artist is named by how the songs write them, whatever the case.
      { type: 'artistNamed', hlc: at(31), artist: 'Phone', names: ['Fone', '电话'] },
      { type: 'artistNamed', hlc: at(32), artist: 'Server', names: ['Too early'] },
      // Cleared later on another device: cleared, and kept that way.
      { type: 'artistNamed', hlc: at(33, 'web-cccc2222'), artist: 'phone', names: [] },
    ]

    const result = ingest.apply(changes)
    const after = serverSnapshot()
    const phone = replayed(before, changes)

    expect(comparable(after)).toEqual(comparable(phone))
    expect(result.applied).toBe(21)
    // And it is the library it should be, not just the same wrong one twice.
    const song = (uid: string) => after.songs.find(s => s.uid === uid)
    expect(song(A)).toMatchObject({ title: 'Alpha (Server)', artist: 'Phone', tagUids: [] })
    expect(song(B)).toMatchObject({ loved: true, year: 1999, playCount: 1, tagUids: [CHILL] })
    expect(after.aliases).toEqual({ [twin]: CHILL })
    expect(after.tags.find(tag => tag.uid === night)).toMatchObject({ name: 'night', hue: 300 })
    expect(after.tags.some(tag => tag.uid === RAIN)).toBe(false)
    const playlist = (uid: string) => after.playlists.find(p => p.uid === uid)
    expect(playlist(road)).toMatchObject({ name: 'Road trip', pinned: true, songUids: [B, C] })
    expect(playlist(MIX)?.songUids).toEqual([B, A, C])
    expect(playlist(LOVED)).toMatchObject({ name: 'Favourites', songUids: [C, B] })
    expect(playlist(RAINY)?.rules?.rules).toEqual([
      { field: 'tag', op: 'has', tagUid: MISSING_TAG_UID },
    ])
    expect(Object.fromEntries(after.artistNames.map(entry => [entry.artist, entry.names]))).toEqual(
      { phone: [], server: ['The Server'] },
    )
  })

  it('removes a song everywhere, and says whose files are to go', () => {
    const a = addSong('Alpha')
    const b = addSong('Bravo')
    const mix = playlists.create({ name: 'Mix', description: '', kind: 'manual', rules: null }).id
    playlists.add(mix, [a, b])
    const before = serverSnapshot()
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
    expect(comparable(serverSnapshot())).toEqual(comparable(replayed(before, changes)))
  })

  it('folds a copy into the song kept as a phone does, losing none of it', () => {
    const kept = addSong('Alpha')
    const extra = addSong('Alpha (copy)', { year: 2020, lyrics: true, art: true })
    songs.patch(extra, { album: 'THE BOOK', loved: true })
    const chill = tags.create('chill', 10).id
    const rain = tags.create('rain', 20).id
    tags.setSongTags(kept, [chill])
    tags.setSongTags(extra, [chill, rain])
    const mix = playlists.create({ name: 'Mix', description: '', kind: 'manual', rules: null }).id
    const road = playlists.create({ name: 'Road', description: '', kind: 'manual', rules: null }).id
    const other = addSong('Other')
    playlists.add(mix, [other, extra])
    playlists.add(road, [kept, extra])
    // Plays of both, in the history Stats and the bucket's plays files are made from.
    for (const [id, at] of [
      [kept, '2026-08-02 10:00:00'],
      [extra, '2026-08-03 10:00:00'],
      [extra, '2026-08-20 10:00:00'],
    ] as const) {
      stats.record(id, 60_000, true, at, null)
      songs.recordPlay(id, at)
    }
    const months = stats.months()
    // The album was cleared on the kept song after the fold was made: it stays clear.
    now = BASE + 50_000
    songs.patch(kept, { album: '' })
    edits.songs([kept], ['album'])

    const before = serverSnapshot()
    const copied = cloud.states().get(extra)
    const [KEPT, EXTRA] = [kept, extra].map(id => uidOf('songs', id)) as [string, string]
    const RAIN = uidOf('tags', rain)
    const changes: Change[] = [
      { type: 'songMerged', hlc: at(10), uid: EXTRA, into: KEPT },
      // Late, from a phone that still had the copy: its play and its tag land on the song kept.
      {
        type: 'songPlayed',
        hlc: at(11),
        uid: EXTRA,
        playId: 'play-late-0001',
        playedAt: '2026-09-01T09:00:00.000Z',
        msPlayed: 70_000,
        completed: false,
      },
      { type: 'songTagged', hlc: at(12), uid: EXTRA, tagUid: RAIN, on: false },
      // A removal of the copy, or an edit of it, is about the copy, which is gone.
      { type: 'songRemoved', hlc: at(13), uid: EXTRA },
      { type: 'songEdited', hlc: at(14), uid: EXTRA, fields: { title: 'Back?' } },
    ]
    const result = ingest.apply(changes)
    const after = serverSnapshot()

    expect(comparable(after)).toEqual(comparable(replayed(before, changes)))
    expect(result.removed).toEqual([{ id: extra, path: 'Alpha (copy).m4a' }])
    const song = after.songs.find(each => each.uid === KEPT)
    expect(song).toMatchObject({
      title: 'Alpha',
      album: '',
      year: 2020,
      loved: true,
      playCount: 4,
      lastPlayedAt: '2026-09-01 09:00:00',
      cover: { key: copied?.coverKey },
      lyrics: { key: copied?.lyricsKey, kind: 'synced' },
    })
    // The late "off" for rain is newer than the fold's "on".
    expect(song?.tagUids).toEqual([uidOf('tags', chill)])
    expect(after.songs.some(each => each.uid === EXTRA)).toBe(false)
    expect(after.merged).toEqual({ [EXTRA]: KEPT })
    const playlist = (id: number) =>
      after.playlists.find(each => each.uid === uidOf('playlists', id))
    expect(playlist(mix)?.songUids).toEqual([uidOf('songs', other), KEPT])
    expect(playlist(road)?.songUids).toEqual([KEPT])
    // Every play is the kept song's now, and the months they are in go up again.
    const history = db
      .prepare('SELECT song_id AS id, COUNT(*) AS n FROM play_events GROUP BY song_id')
      .all()
    expect(history).toEqual([{ id: kept, n: 4 }])
    expect(stats.months().find(month => month.month === '2026-08')?.sig).not.toBe(
      months.find(month => month.month === '2026-08')?.sig,
    )
  })

  it('folds nothing when the song to keep is gone', () => {
    const extra = addSong('Copy')
    const before = serverSnapshot()
    const changes: Change[] = [
      { type: 'songMerged', hlc: at(1), uid: uidOf('songs', extra), into: '9'.repeat(32) },
    ]
    expect(ingest.apply(changes).applied).toBe(0)
    expect(songs.byId(extra)).not.toBeNull()
    expect(comparable(serverSnapshot())).toEqual(comparable(replayed(before, changes)))
  })

  it('keeps a live playlist’s rules when a change would take them away', () => {
    const a = addSong('Alpha')
    songs.patch(a, { loved: true })
    const loved = playlists.create({
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
    }).id
    const before = serverSnapshot()
    const changes: Change[] = [
      {
        type: 'playlistEdited',
        hlc: at(1),
        uid: uidOf('playlists', loved),
        fields: { rules: null },
      },
    ]
    expect(ingest.apply(changes).applied).toBe(0)
    // Stored, the null read here as a manual playlist with nothing in it.
    expect(playlists.byId(loved)).toMatchObject({ kind: 'live', songCount: 1 })
    expect(comparable(serverSnapshot())).toEqual(comparable(replayed(before, changes)))
  })

  it('takes the tags a removal emptied, and leaves one another device has just made', () => {
    const a = addSong('Alpha')
    const b = addSong('Bravo')
    const chill = tags.create('chill').id
    tags.setSongTags(a, [chill])
    const before = serverSnapshot()
    const made = 'f'.repeat(31) + '4'
    const changes: Change[] = [
      // Made on one phone, to be filled in a moment…
      { type: 'tagCreated', hlc: at(1, 'web-cccc2222'), uid: made, name: 'later', hue: 90 },
      // …while another removed a song, and the tag it was the last song of.
      { type: 'songRemoved', hlc: at(2), uid: uidOf('songs', a) },
      { type: 'tagRemoved', hlc: at(3), uid: uidOf('tags', chill) },
    ]
    ingest.apply(changes)
    expect(tags.all().map(tag => tag.name)).toEqual(['later'])
    expect(songs.byId(b)).not.toBeNull()
    expect(comparable(serverSnapshot())).toEqual(comparable(replayed(before, changes)))
  })

  it('stops a playlist following its tags with the songs the phone kept', () => {
    const a = addSong('Alpha')
    const b = addSong('Bravo')
    songs.patch(a, { loved: true })
    const rules: SmartRules = {
      match: 'all',
      rules: [{ field: 'loved', op: 'is', value: true }],
      orderBy: 'title',
      order: 'asc',
      limit: null,
    }
    const loved = playlists.create({ name: 'Loved', description: '', kind: 'live', rules }).id
    const LOVED = uidOf('playlists', loved)
    const before = serverSnapshot()
    const changes: Change[] = [
      // Loved on the phone, which then stopped the playlist with both in it,
      // in the order it showed them: the server keeps that, not its own answer.
      { type: 'songEdited', hlc: at(1), uid: uidOf('songs', b), fields: { loved: true } },
      {
        type: 'playlistUnfollowed',
        hlc: at(2),
        uid: LOVED,
        songUids: [uidOf('songs', b), uidOf('songs', a)],
      },
    ]
    ingest.apply(changes)
    expect(playlists.byId(loved)).toMatchObject({ kind: 'manual', rules: null })
    expect(playlists.songIds(playlists.byId(loved)!)).toEqual([b, a])
    expect(comparable(serverSnapshot())).toEqual(comparable(replayed(before, changes)))
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

  // One phone's log carried ten thousand plays of one song, all ending at the
  // same instant, and every one of them counted; and plays nobody could have made.
  it('takes in only plays somebody could have made', () => {
    const a = addSong('Alpha')
    const A = uidOf('songs', a)
    const played = (n: number, over: Partial<Change & { type: 'songPlayed' }> = {}): Change => ({
      type: 'songPlayed',
      hlc: at(30 + n),
      uid: A,
      playId: `play-${String(n).padStart(8, '0')}`,
      playedAt: '2026-09-01T09:00:00.000Z',
      msPlayed: 90_000,
      completed: true,
      ...over,
    })
    const result = ingest.apply([
      ...Array.from({ length: 200 }, (_, n) => played(n)),
      played(300, { msPlayed: 0 }),
      played(301, { msPlayed: 2000, playedAt: '2026-09-02T09:00:00.000Z' }),
      played(302, { playedAt: '2999-01-01T00:00:00.000Z' }),
      // The next time round is a play of its own.
      played(303, { playedAt: '2026-09-01T09:01:41.000Z' }),
    ])
    expect(result.applied).toBe(2)
    expect(songs.byId(a)?.playCount).toBe(2)
  })

  it('stamps what the server does after anything it has taken in', () => {
    const a = addSong('Alpha')
    const A = uidOf('songs', a)
    // Another device's clock is a minute ahead of this server's.
    ingest.apply([{ type: 'songEdited', hlc: at(60), uid: A, fields: { title: 'Phone' } }])
    songs.patch(a, { title: 'Server' })
    edits.songs([a], ['title'])
    expect(sync.stamp('song', A, 'title')! > at(60)).toBe(true)
    // So the phone's edit, arriving again, does not undo the server's.
    ingest.apply([{ type: 'songEdited', hlc: at(60), uid: A, fields: { title: 'Phone' } }])
    expect(songs.byId(a)?.title).toBe('Server')
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

  describe('live playlists on a phone and on the server', () => {
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
      // Words and a cover this server has read and not put up yet: no phone
      // can see them, so no rule here may count them either.
      songs.setLyricsKind(six, 'synced')
      db.prepare('UPDATE songs SET has_art = 1 WHERE id = ?').run(six)
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
      const chill = tags.create('chill').id
      tags.setSongTags(one, [chill])
      tags.setSongTags(three, [chill])
      for (const [id, bpm, energy, camelot] of [
        [one, 128, 0.8, '8A'],
        [two, 90, 0.3, '9A'],
        [four, 128, 0.5, '3B'],
      ] as const) {
        db.prepare(
          'INSERT INTO song_audio_features (song_id, bpm, energy, loudness_lufs, key, camelot, danceability) VALUES (?, ?, ?, ?, ?, ?, ?)',
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
        { ...base, rules: [{ field: 'duration', op: 'gt', value: 103 }] },
        { ...base, rules: [{ field: 'loved', op: 'is', value: true }] },
        { ...base, rules: [{ field: 'hasLyrics', op: 'is', value: false }] },
        { ...base, rules: [{ field: 'hasLyrics', op: 'is', value: true }] },
        { ...base, rules: [{ field: 'hasArt', op: 'is', value: true }] },
        { ...base, rules: [{ field: 'hasArt', op: 'is', value: false }] },
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
      const snapshot = serverSnapshot()
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
        const server = playlists
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
        expect({ rules: cloudRules, songs: phone }).toEqual({ rules: cloudRules, songs: server })
      }
    })
  })
})

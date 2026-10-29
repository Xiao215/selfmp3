import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SmartRule } from '@selfmp3/shared'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { PlaylistRepository } from '../repositories/playlists.js'
import { SongRepository } from '../repositories/songs.js'
import { SyncRepository } from '../repositories/sync.js'
import { TagRepository } from '../repositories/tags.js'
import { LocalEdits, SyncClock } from './localEdits.js'
import { TagRemoval } from './tagRemoval.js'

/**
 * Deleting a tag that live playlists follow. Left alone, the rule named a tag
 * nobody could see or remove: a "has" playlist emptied and dropped off the
 * Playlists page, and a "does not have" one became the whole library.
 */
describe('TagRemoval', () => {
  let db: Database.Database
  let songs: SongRepository
  let tags: TagRepository
  let playlists: PlaylistRepository
  let sync: SyncRepository
  let removal: TagRemoval

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    songs = new SongRepository(db)
    tags = new TagRepository(db)
    playlists = new PlaylistRepository(db)
    sync = new SyncRepository(db)
    const clock = new SyncClock({ deviceId: () => 'mac-aaaa1111', latest: () => null })
    removal = new TagRemoval({ db, tags, playlists, edits: new LocalEdits({ db, sync, clock }) })
  })

  const song = (title: string): number =>
    songs.insert({
      path: `${title}.m4a`,
      title,
      artist: '',
      album: '',
      albumArtist: '',
      trackNo: null,
      year: null,
      duration: 200,
      sizeBytes: 1,
      mime: 'audio/mp4',
      mtimeMs: 0,
      hasArt: false,
      artExt: null,
      lyricsKind: 'none',
      sourceUrl: null,
    })

  const live = (name: string, rules: SmartRule[]) =>
    playlists.create({
      name,
      description: '',
      kind: 'live',
      rules: { match: 'all', rules, orderBy: 'title', order: 'asc', limit: null },
    })

  const stamped = (id: number): string[] => {
    const uid = sync.uids('playlists', [id]).get(id) ?? ''
    return (
      db
        .prepare("SELECT field FROM sync_stamps WHERE kind = 'playlist' AND uid = ? ORDER BY field")
        .all(uid) as { field: string }[]
    ).map(row => row.field)
  }

  it('keeps the songs of a playlist that followed only it, and stops it following', () => {
    const [a, b] = [song('a'), song('b'), song('c')]
    const chill = tags.create('chill').id
    tags.bulk([a!, b!], chill, 'add')
    const has = live('has chill', [{ field: 'tag', op: 'has', tagId: chill }])
    const hasNot = live('not chill', [{ field: 'tag', op: 'notHas', tagId: chill }])

    expect(removal.remove(chill)).toEqual(['has chill', 'not chill'])

    expect(tags.byId(chill)).toBeNull()
    const kept = playlists.byId(has.id)!
    expect(kept).toMatchObject({ kind: 'manual', rules: null, songCount: 2 })
    expect(playlists.songIds(kept)).toEqual([a, b])
    expect(playlists.byId(hasNot.id)).toMatchObject({ kind: 'manual', songCount: 1 })
    expect(stamped(has.id)).toEqual(['order', 'rules'])
  })

  /*
   * Only the rule about the tag used to go, and the rest stayed live: under
   * "all" that widened the playlist — "has chill and not loved", four songs,
   * became every song not loved — and under "any" it narrowed it.
   */
  it('keeps the songs of a playlist that follows something else too', () => {
    const [a, b, c] = [song('a'), song('b'), song('c')]
    const chill = tags.create('chill').id
    const rain = tags.create('rain').id
    tags.bulk([a!, b!], chill, 'add')
    tags.bulk([b!, c!], rain, 'add')
    songs.patch(b!, { loved: true })
    const notLoved = live('chill, not loved', [
      { field: 'tag', op: 'has', tagId: chill },
      { field: 'loved', op: 'is', value: false },
    ])
    const either = playlists.create({
      name: 'chill or rain',
      description: '',
      kind: 'live',
      rules: {
        match: 'any',
        rules: [
          { field: 'tag', op: 'has', tagId: chill },
          { field: 'tag', op: 'has', tagId: rain },
        ],
        orderBy: 'title',
        order: 'asc',
        limit: null,
      },
    })
    const other = live('rain only', [{ field: 'tag', op: 'has', tagId: rain }])

    expect(removal.remove(chill).sort()).toEqual(['chill or rain', 'chill, not loved'])

    const kept = playlists.byId(notLoved.id)!
    expect(kept).toMatchObject({ kind: 'manual', rules: null })
    expect(playlists.songIds(kept)).toEqual([a])
    expect(playlists.songIds(playlists.byId(either.id)!)).toEqual([a, b, c])
    expect(stamped(notLoved.id)).toEqual(['order', 'rules'])
    expect(playlists.byId(other.id)).toMatchObject({ kind: 'live' })
    expect(stamped(other.id)).toEqual([])
  })
})

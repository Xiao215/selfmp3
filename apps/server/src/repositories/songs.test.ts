import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { SongRepository } from './songs.js'

/**
 * The instrumental flag, against a database built from the real schema, so
 * the column, the row mapping and the patch allow-list are checked together.
 */

describe('SongRepository instrumental flag', () => {
  let db: Database.Database
  let songs: SongRepository

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    db.prepare(
      "INSERT INTO songs (id, path, title, artist, album, duration) VALUES (1, 'a.mp3', 'Interlude', 'Aurora Lane', 'Night', 90)",
    ).run()
    songs = new SongRepository(db)
  })

  it('starts false for every song', () => {
    expect(songs.byId(1)?.instrumental).toBe(false)
    expect(songs.all()[0]?.instrumental).toBe(false)
  })

  it('is set and cleared by setInstrumental', () => {
    songs.setInstrumental(1, true)
    expect(songs.byId(1)?.instrumental).toBe(true)
    songs.setInstrumental(1, false)
    expect(songs.byId(1)?.instrumental).toBe(false)
  })

  it('can be set by hand through patch, without touching lyricsKind', () => {
    songs.patch(1, { instrumental: true })
    expect(songs.byId(1)).toMatchObject({ instrumental: true, lyricsKind: 'none' })
    songs.patch(1, { instrumental: false })
    expect(songs.byId(1)?.instrumental).toBe(false)
  })
})

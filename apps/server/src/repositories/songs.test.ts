import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { SongRepository } from './songs.js'

/**
 * The instrumental flag, against a database built from the real migrations,
 * so the column, the row mapping and the patch allow-list are checked together.
 */

describe('backfilling where imported songs came from', () => {
  it('takes each song’s link from its import job, and leaves the rest', () => {
    const db = new Database(':memory:')
    const logger = createLogger('silent')
    migrate(db, logger)
    // Step back one migration, as a database from before it would be.
    const latest = db.pragma('user_version', { simple: true }) as number
    db.pragma(`user_version = ${latest - 1}`)
    db.exec(`
      INSERT INTO songs (id, path, title) VALUES (1, 'a.m4a', 'A'), (2, 'b.m4a', 'B'), (3, 'c.m4a', 'C');
      UPDATE songs SET source_url = 'https://kept.example' WHERE id = 3;
      INSERT INTO import_jobs (id, url, status, song_id) VALUES
        ('j1', 'https://www.youtube.com/watch?v=fCh0qfxElm8', 'done', 1),
        ('j3', 'https://www.youtube.com/watch?v=dGZqpVCJP3k', 'done', 3);
    `)

    migrate(db, logger)

    const songs = new SongRepository(db)
    expect(songs.byId(1)?.sourceUrl).toBe('https://www.youtube.com/watch?v=fCh0qfxElm8')
    expect(songs.byId(2)?.sourceUrl).toBeNull()
    expect(songs.byId(3)?.sourceUrl).toBe('https://kept.example')
  })
})

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

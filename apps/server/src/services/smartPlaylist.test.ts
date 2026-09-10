import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { SmartRulesSchema, type SmartRules } from '@selfmp3/shared'
import { compileSmartRules, describeSmartRules } from './smartPlaylist.js'

/**
 * These tests run the compiled SQL against a real in-memory SQLite database.
 *
 * Asserting on the generated SQL string would be brittle and would not prove
 * the query is even valid; executing it proves both that it parses and that it
 * selects the rows it claims to.
 */

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE songs (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      album_artist TEXT NOT NULL DEFAULT '',
      duration REAL NOT NULL DEFAULT 0,
      year INTEGER,
      play_count INTEGER NOT NULL DEFAULT 0,
      skip_count INTEGER NOT NULL DEFAULT 0,
      loved INTEGER NOT NULL DEFAULT 0,
      has_art INTEGER NOT NULL DEFAULT 0,
      lyrics_kind TEXT NOT NULL DEFAULT 'none',
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_played_at TEXT,
      missing INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE song_tags (song_id INTEGER, tag_id INTEGER, PRIMARY KEY (song_id, tag_id));
    CREATE TABLE song_features (
      song_id INTEGER PRIMARY KEY,
      bpm REAL, energy REAL, loudness_lufs REAL, key TEXT, camelot TEXT, danceability REAL,
      analyzed_at TEXT NOT NULL DEFAULT (datetime('now')),
      version INTEGER NOT NULL DEFAULT 1
    );
  `)

  const insert = db.prepare(`
    INSERT INTO songs (id, title, artist, album, duration, year, play_count, loved, has_art, lyrics_kind, added_at, last_played_at, missing)
    VALUES (@id, @title, @artist, @album, @duration, @year, @play_count, @loved, @has_art, @lyrics_kind, @added_at, @last_played_at, @missing)
  `)

  const rows = [
    { id: 1, title: 'Midnight Drive', artist: 'Aurora Lane', album: 'Night', duration: 254, year: 2021, play_count: 12, loved: 1, has_art: 1, lyrics_kind: 'synced', added_at: "datetime('now','-2 days')", last_played_at: "datetime('now','-1 days')", missing: 0 },
    { id: 2, title: 'Sunrise', artist: 'Aurora Lane', album: 'Night', duration: 190, year: 2021, play_count: 0, loved: 0, has_art: 1, lyrics_kind: 'none', added_at: "datetime('now','-40 days')", last_played_at: null, missing: 0 },
    { id: 3, title: 'Nocturne Study', artist: 'Klara Feld', album: 'Etudes', duration: 420, year: 2019, play_count: 30, loved: 0, has_art: 0, lyrics_kind: 'plain', added_at: "datetime('now','-100 days')", last_played_at: "datetime('now','-90 days')", missing: 0 },
    { id: 4, title: 'Gone Missing', artist: 'Ghost', album: '', duration: 100, year: null, play_count: 99, loved: 1, has_art: 0, lyrics_kind: 'none', added_at: "datetime('now')", last_played_at: null, missing: 1 },
  ]

  for (const row of rows) {
    insert.run({
      ...row,
      added_at: '2020-01-01 00:00:00',
      last_played_at: null,
    })
  }

  // Set the relative dates properly now that the rows exist.
  db.prepare("UPDATE songs SET added_at = datetime('now','-2 days'),  last_played_at = datetime('now','-1 days')  WHERE id = 1").run()
  db.prepare("UPDATE songs SET added_at = datetime('now','-40 days'), last_played_at = NULL                        WHERE id = 2").run()
  db.prepare("UPDATE songs SET added_at = datetime('now','-100 days'),last_played_at = datetime('now','-90 days')  WHERE id = 3").run()
  db.prepare("UPDATE songs SET added_at = datetime('now'),            last_played_at = NULL                        WHERE id = 4").run()

  db.prepare('INSERT INTO tags (id, name) VALUES (1, ?), (2, ?)').run('chill', 'classical')
  db.prepare('INSERT INTO song_tags VALUES (1, 1), (2, 1), (3, 2)').run()

  // Song 2 has not been analysed; song 3 was analysed but has no beat.
  db.prepare(`
    INSERT INTO song_features (song_id, bpm, energy, loudness_lufs, key, camelot) VALUES
      (1, 124, 0.8, -9.5, 'A minor', '8A'),
      (3, NULL, 0.2, -22, 'E major', '12B'),
      (4, 128, 0.9, -8, 'A minor', '8A')
  `).run()

  return db
}

function run(db: Database.Database, rules: Partial<SmartRules>): number[] {
  const parsed = SmartRulesSchema.parse({ orderBy: 'title', order: 'asc', ...rules })
  const { sql, params } = compileSmartRules(parsed)
  return db
    .prepare<unknown[], { id: number }>(sql)
    .all(...params)
    .map(row => row.id)
}

describe('compileSmartRules', () => {
  const db = makeDb()

  it('excludes missing files from every result', () => {
    // Song 4 is missing; a playlist must never hand the player a dead track.
    expect(run(db, { rules: [] })).toEqual([1, 3, 2])
  })

  it('matches text with contains', () => {
    expect(run(db, { rules: [{ field: 'artist', op: 'contains', value: 'aurora' }] })).toEqual([1, 2])
  })

  it('matches text with equals, case-insensitively', () => {
    expect(run(db, { rules: [{ field: 'title', op: 'equals', value: 'sunrise' }] })).toEqual([2])
  })

  it('matches with startsWith', () => {
    expect(run(db, { rules: [{ field: 'title', op: 'startsWith', value: 'Mid' }] })).toEqual([1])
  })

  it('negates with notContains', () => {
    expect(run(db, { rules: [{ field: 'artist', op: 'notContains', value: 'Aurora' }] })).toEqual([3])
  })

  it('treats LIKE wildcards in user input as literal characters', () => {
    // Without escaping, '%' would match every row — a subtle and nasty bug.
    expect(run(db, { rules: [{ field: 'title', op: 'contains', value: '%' }] })).toEqual([])
    expect(run(db, { rules: [{ field: 'title', op: 'contains', value: '_' }] })).toEqual([])
  })

  it('filters by tag', () => {
    expect(run(db, { rules: [{ field: 'tag', op: 'has', tagId: 1 }] })).toEqual([1, 2])
    expect(run(db, { rules: [{ field: 'tag', op: 'notHas', tagId: 1 }] })).toEqual([3])
  })

  it('compares numbers', () => {
    expect(run(db, { rules: [{ field: 'playCount', op: 'gt', value: 10 }] })).toEqual([1, 3])
    expect(run(db, { rules: [{ field: 'duration', op: 'lt', value: 200 }] })).toEqual([2])
    expect(run(db, { rules: [{ field: 'playCount', op: 'eq', value: 0 }] })).toEqual([2])
  })

  it('does not let a null year satisfy a numeric comparison', () => {
    expect(run(db, { rules: [{ field: 'year', op: 'lt', value: 3000 }] })).toEqual([1, 3, 2])
  })

  it('filters by relative dates', () => {
    expect(run(db, { rules: [{ field: 'addedAt', op: 'inLastDays', days: 7 }] })).toEqual([1])
    expect(run(db, { rules: [{ field: 'lastPlayedAt', op: 'never' }] })).toEqual([2])
  })

  it('includes never-played songs in "not played in N days"', () => {
    // "Forgotten songs" has to mean never-played too, or the list is useless.
    const ids = run(db, { rules: [{ field: 'lastPlayedAt', op: 'notInLastDays', days: 7 }] })
    expect(ids).toContain(2)
    expect(ids).toContain(3)
    expect(ids).not.toContain(1)
  })

  it('filters booleans', () => {
    expect(run(db, { rules: [{ field: 'loved', op: 'is', value: true }] })).toEqual([1])
    expect(run(db, { rules: [{ field: 'hasArt', op: 'is', value: false }] })).toEqual([3])
    expect(run(db, { rules: [{ field: 'hasLyrics', op: 'is', value: true }] })).toEqual([1, 3])
  })

  it('compares analysed features, ignoring songs that were not analysed', () => {
    expect(run(db, { rules: [{ field: 'bpm', op: 'gt', value: 100 }] })).toEqual([1])
    expect(run(db, { rules: [{ field: 'energy', op: 'lt', value: 0.5 }] })).toEqual([3])
    expect(run(db, { rules: [{ field: 'loudness', op: 'gte', value: -10 }] })).toEqual([1])
    // Song 2 has no row at all; song 3 has a null BPM. Neither is "less than 200".
    expect(run(db, { rules: [{ field: 'bpm', op: 'lt', value: 200 }] })).toEqual([1])
  })

  it('matches keys exactly and by Camelot compatibility', () => {
    expect(run(db, { rules: [{ field: 'key', op: 'is', value: '8A' }] })).toEqual([1])
    expect(run(db, { rules: [{ field: 'key', op: 'is', value: '12B' }] })).toEqual([3])
    // 8A mixes with 7A, 9A and 8B — not 12B.
    expect(run(db, { rules: [{ field: 'key', op: 'compatible', value: '9A' }] })).toEqual([1])
    expect(run(db, { rules: [{ field: 'key', op: 'compatible', value: '8B' }] })).toEqual([1])
    expect(run(db, { rules: [{ field: 'key', op: 'compatible', value: '1B' }] })).toEqual([3])
    expect(run(db, { rules: [{ field: 'key', op: 'compatible', value: '4A' }] })).toEqual([])
  })

  it('rejects a key that is not a Camelot code at the schema', () => {
    expect(() => run(db, { rules: [{ field: 'key', op: 'is', value: 'A minor' } as never] })).toThrow()
  })

  it('combines rules with AND', () => {
    expect(
      run(db, {
        match: 'all',
        rules: [
          { field: 'artist', op: 'contains', value: 'Aurora' },
          { field: 'playCount', op: 'gt', value: 5 },
        ],
      }),
    ).toEqual([1])
  })

  it('combines rules with OR', () => {
    expect(
      run(db, {
        match: 'any',
        rules: [
          { field: 'title', op: 'equals', value: 'Sunrise' },
          { field: 'playCount', op: 'gt', value: 20 },
        ],
      }),
    ).toEqual([3, 2])
  })

  it('honours ordering and limits', () => {
    expect(run(db, { orderBy: 'playCount', order: 'desc', limit: 2 })).toEqual([3, 1])
    expect(run(db, { orderBy: 'duration', order: 'asc' })).toEqual([2, 1, 3])
  })

  it('produces valid SQL for a random ordering', () => {
    const ids = run(db, { orderBy: 'random' })
    expect(ids.sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('survives an injection attempt in a text value', () => {
    const ids = run(db, {
      rules: [{ field: 'title', op: 'contains', value: "'; DROP TABLE songs; --" }],
    })
    expect(ids).toEqual([])
    // The table had better still be there.
    expect(db.prepare('SELECT COUNT(*) AS n FROM songs').get()).toEqual({ n: 4 })
  })
})

describe('describeSmartRules', () => {
  const tagNames = new Map([[1, 'chill']])

  it('describes an empty rule set', () => {
    expect(describeSmartRules(SmartRulesSchema.parse({}), tagNames)).toBe('Every song')
  })

  it('describes a limited empty rule set', () => {
    expect(describeSmartRules(SmartRulesSchema.parse({ limit: 50 }), tagNames)).toBe('50 songs')
  })

  it('reads like English', () => {
    const rules = SmartRulesSchema.parse({
      match: 'all',
      rules: [
        { field: 'tag', op: 'has', tagId: 1 },
        { field: 'playCount', op: 'gt', value: 5 },
      ],
    })
    expect(describeSmartRules(rules, tagNames)).toBe('tagged chill and playCount > 5')
  })

  it('describes feature rules', () => {
    const rules = SmartRulesSchema.parse({
      match: 'any',
      rules: [
        { field: 'bpm', op: 'gte', value: 120 },
        { field: 'loudness', op: 'lt', value: -12 },
        { field: 'key', op: 'compatible', value: '8a' },
      ],
    })
    expect(describeSmartRules(rules, tagNames)).toBe(
      'bpm >= 120 or loudness < -12 LUFS or key mixes with 8A',
    )
  })

  it('falls back gracefully for a deleted tag', () => {
    const rules = SmartRulesSchema.parse({ rules: [{ field: 'tag', op: 'has', tagId: 99 }] })
    expect(describeSmartRules(rules, tagNames)).toBe('tagged #99')
  })
})

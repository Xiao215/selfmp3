import type { Database } from 'better-sqlite3'
import type { Logger } from '../logger.js'

/**
 * Schema migrations.
 *
 * SQLite's `user_version` pragma tracks which migrations have run. Each
 * migration is applied inside a transaction, so a failure leaves the database
 * exactly as it was rather than half-upgraded.
 *
 * Rules for adding one: append to the end, never edit an existing entry, and
 * never renumber. The array index *is* the version.
 */

interface Migration {
  readonly name: string
  readonly sql: string
}

const MIGRATIONS: readonly Migration[] = [
  {
    name: 'initial schema',
    sql: `
      CREATE TABLE songs (
        id            INTEGER PRIMARY KEY,
        path          TEXT    NOT NULL UNIQUE,
        title         TEXT    NOT NULL,
        artist        TEXT    NOT NULL DEFAULT '',
        album         TEXT    NOT NULL DEFAULT '',
        album_artist  TEXT    NOT NULL DEFAULT '',
        track_no      INTEGER,
        year          INTEGER,
        duration      REAL    NOT NULL DEFAULT 0,
        size_bytes    INTEGER NOT NULL DEFAULT 0,
        mime          TEXT    NOT NULL DEFAULT 'audio/mp4',
        mtime_ms      INTEGER NOT NULL DEFAULT 0,
        has_art       INTEGER NOT NULL DEFAULT 0,
        art_ext       TEXT,
        lyrics_kind   TEXT    NOT NULL DEFAULT 'none',
        play_count    INTEGER NOT NULL DEFAULT 0,
        skip_count    INTEGER NOT NULL DEFAULT 0,
        loved         INTEGER NOT NULL DEFAULT 0,
        source_url    TEXT,
        last_played_at TEXT,
        added_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        missing       INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX idx_songs_added   ON songs(added_at DESC);
      CREATE INDEX idx_songs_artist  ON songs(artist COLLATE NOCASE);
      CREATE INDEX idx_songs_album   ON songs(album COLLATE NOCASE);
      CREATE INDEX idx_songs_plays   ON songs(play_count DESC);
      CREATE INDEX idx_songs_missing ON songs(missing) WHERE missing = 1;

      CREATE TABLE tags (
        id         INTEGER PRIMARY KEY,
        name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        hue        INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE song_tags (
        song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
        PRIMARY KEY (song_id, tag_id)
      );

      CREATE INDEX idx_song_tags_tag ON song_tags(tag_id);

      CREATE TABLE playlists (
        id          INTEGER PRIMARY KEY,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        kind        TEXT    NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','smart')),
        rules       TEXT,
        pinned      INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE playlist_items (
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        song_id     INTEGER NOT NULL REFERENCES songs(id)     ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        added_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (playlist_id, song_id)
      );

      CREATE INDEX idx_playlist_items_order ON playlist_items(playlist_id, position);

      -- Every play is kept as an event rather than only a counter, so stats can
      -- be recomputed or asked new questions of later.
      CREATE TABLE play_events (
        id        INTEGER PRIMARY KEY,
        song_id   INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        played_at TEXT    NOT NULL DEFAULT (datetime('now')),
        ms_played INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX idx_play_events_time ON play_events(played_at DESC);
      CREATE INDEX idx_play_events_song ON play_events(song_id);

      -- The import queue lives in the database so it survives a restart.
      CREATE TABLE import_jobs (
        id           TEXT    PRIMARY KEY,
        url          TEXT    NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'queued',
        step         TEXT    NOT NULL DEFAULT 'waiting',
        progress     REAL,
        title        TEXT    NOT NULL DEFAULT '',
        artist       TEXT    NOT NULL DEFAULT '',
        album        TEXT    NOT NULL DEFAULT '',
        thumbnail    TEXT,
        duration     REAL    NOT NULL DEFAULT 0,
        error        TEXT,
        song_id      INTEGER REFERENCES songs(id) ON DELETE SET NULL,
        attempts     INTEGER NOT NULL DEFAULT 0,
        tag_ids      TEXT    NOT NULL DEFAULT '[]',
        playlist_id  INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
        position     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_import_jobs_status ON import_jobs(status, position);

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Full-text search over the fields people actually search by. An external
      -- content table means the text is stored once, in the songs table.
      CREATE VIRTUAL TABLE songs_fts USING fts5(
        title, artist, album,
        content = 'songs',
        content_rowid = 'id',
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER songs_fts_insert AFTER INSERT ON songs BEGIN
        INSERT INTO songs_fts(rowid, title, artist, album)
        VALUES (new.id, new.title, new.artist, new.album);
      END;

      CREATE TRIGGER songs_fts_delete AFTER DELETE ON songs BEGIN
        INSERT INTO songs_fts(songs_fts, rowid, title, artist, album)
        VALUES ('delete', old.id, old.title, old.artist, old.album);
      END;

      CREATE TRIGGER songs_fts_update AFTER UPDATE ON songs BEGIN
        INSERT INTO songs_fts(songs_fts, rowid, title, artist, album)
        VALUES ('delete', old.id, old.title, old.artist, old.album);
        INSERT INTO songs_fts(rowid, title, artist, album)
        VALUES (new.id, new.title, new.artist, new.album);
      END;
    `,
  },
  {
    name: 'lyrics+: lyric search index and provider secrets',
    sql: `
      -- One row per lyric line. \`tokens\` is the line with every CJK character
      -- space-separated so unicode61 can match inside a run of Han/kana; the
      -- original \`line\` is kept unindexed for display.
      CREATE VIRTUAL TABLE lyrics_fts USING fts5(
        song_id UNINDEXED,
        line_no UNINDEXED,
        line UNINDEXED,
        tokens,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      -- Which text each song's index rows were built from, so a re-index is
      -- skipped when nothing changed and the boot backfill knows what is missing.
      CREATE TABLE lyrics_index (
        song_id    INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
        hash       TEXT    NOT NULL,
        indexed_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      -- A virtual table cannot cascade, so mirror the delete by trigger.
      CREATE TRIGGER lyrics_fts_song_delete AFTER DELETE ON songs BEGIN
        DELETE FROM lyrics_fts WHERE song_id = old.id;
      END;

      -- API keys live apart from settings so they can never be returned by
      -- accident from GET /api/settings.
      CREATE TABLE secrets (
        name  TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
]

export function migrate(db: Database, logger: Logger): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number

  if (currentVersion > MIGRATIONS.length) {
    throw new Error(
      `Database schema is version ${currentVersion} but this build only knows about ` +
        `${MIGRATIONS.length}. You are running an older server against a newer database.`,
    )
  }

  if (currentVersion === MIGRATIONS.length) {
    logger.debug('schema up to date', { version: currentVersion })
    return
  }

  for (let version = currentVersion; version < MIGRATIONS.length; version++) {
    const migration = MIGRATIONS[version]
    if (!migration) continue
    const nextVersion = version + 1
    logger.info(`applying migration ${nextVersion}: ${migration.name}`)

    // better-sqlite3 cannot run DDL inside its transaction() wrapper reliably
    // when the statements include CREATE VIRTUAL TABLE, so drive it manually.
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.pragma(`user_version = ${nextVersion}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw new Error(
        `Migration ${nextVersion} (${migration.name}) failed: ` +
          (error instanceof Error ? error.message : String(error)),
      )
    }
  }

  logger.info('schema migrated', { to: MIGRATIONS.length })
}

export const SCHEMA_VERSION = MIGRATIONS.length

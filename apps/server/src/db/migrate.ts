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
  {
    name: 'audio features',
    sql: `
      -- One row per analysed song. Nullable columns mean "looked, found
      -- nothing" (a silent file has no tempo); a missing row means "not yet".
      CREATE TABLE song_features (
        song_id       INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
        bpm           REAL,
        energy        REAL,
        loudness_lufs REAL,
        key           TEXT,
        camelot       TEXT,
        danceability  REAL,
        analyzed_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        version       INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX idx_song_features_camelot ON song_features(camelot);
    `,
  },
  {
    name: 'devices: presence and last playback state',
    sql: `
      -- One row per client that has ever heartbeated. \`state\` is the last
      -- PlaybackState as JSON, kept so "continue where you left off" works
      -- across a restart and from a device that is now asleep.
      CREATE TABLE devices (
        id           TEXT    PRIMARY KEY,
        name         TEXT    NOT NULL,
        kind         TEXT    NOT NULL DEFAULT 'other' CHECK (kind IN ('phone','desktop','other')),
        state        TEXT    NOT NULL,
        last_seen_at INTEGER NOT NULL,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_devices_seen ON devices(last_seen_at DESC);
    `,
  },
  {
    name: 'songs: art revision for cache-busting cover URLs',
    sql: `
      -- Bumped whenever a song's cover is written. Cover URLs carry it, so a
      -- replaced cover is fetched fresh instead of served from a cache that
      -- treats /api/art/<id> as forever.
      ALTER TABLE songs ADD COLUMN art_rev INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    name: 'play events: client ids for plays reported late',
    sql: `
      -- A play made with the server out of reach is sent later, and sent again
      -- if the first response goes missing. The id the client gave it is how
      -- the second copy is recognised and ignored. Live plays have none.
      ALTER TABLE play_events ADD COLUMN client_id TEXT;
      CREATE UNIQUE INDEX idx_play_events_client
        ON play_events(client_id) WHERE client_id IS NOT NULL;
    `,
  },
  {
    name: 'songs: remember that a song is instrumental',
    sql: `
      -- Set when lrclib says a track has no words, or when you mark it so.
      -- It is not a lyrics_kind value because the scanner rewrites that column
      -- from the files on every rescan, and smart playlists read
      -- lyrics_kind != 'none' as "has lyrics".
      ALTER TABLE songs ADD COLUMN instrumental INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    name: 'songs: remember where imported songs came from',
    sql: `
      -- The column was there from the start but the importer never filled it.
      -- A song's YouTube link is how its own timed lyrics are found, so take
      -- it from the import job for every song whose job is still on record.
      UPDATE songs
         SET source_url = (
           SELECT url FROM import_jobs
            WHERE import_jobs.song_id = songs.id
            ORDER BY updated_at DESC
            LIMIT 1
         )
       WHERE source_url IS NULL
         AND EXISTS (SELECT 1 FROM import_jobs WHERE import_jobs.song_id = songs.id);
    `,
  },
  {
    name: 'cloud: stable ids, and what has been uploaded',
    sql: `
      -- A uid is how a song, tag or playlist is known outside this database
      -- (docs/SYNC.md). Integer ids stay as local handles: SQLite reuses them
      -- after a delete, and another device would hand out the same numbers.
      -- ALTER TABLE cannot give a column a random default, so every existing
      -- row is filled here and every new one by trigger — unless it arrives
      -- with a uid of its own, as a song made on another device will.
      --
      -- The search index's update trigger first becomes one for the columns
      -- it indexes. As it was, any update to a song rewrote its search entry —
      -- every play did — and the uid trigger below would fire it for a song
      -- whose entry the insert trigger had not written yet, and FTS5 corrupts
      -- itself deleting an entry it does not have.
      DROP TRIGGER songs_fts_update;
      CREATE TRIGGER songs_fts_update AFTER UPDATE OF title, artist, album ON songs BEGIN
        INSERT INTO songs_fts(songs_fts, rowid, title, artist, album)
        VALUES ('delete', old.id, old.title, old.artist, old.album);
        INSERT INTO songs_fts(rowid, title, artist, album)
        VALUES (new.id, new.title, new.artist, new.album);
      END;

      ALTER TABLE songs ADD COLUMN uid TEXT;
      UPDATE songs SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL;
      CREATE UNIQUE INDEX idx_songs_uid ON songs(uid);
      CREATE TRIGGER songs_uid AFTER INSERT ON songs WHEN new.uid IS NULL BEGIN
        UPDATE songs SET uid = lower(hex(randomblob(16))) WHERE id = new.id;
      END;

      ALTER TABLE tags ADD COLUMN uid TEXT;
      UPDATE tags SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL;
      CREATE UNIQUE INDEX idx_tags_uid ON tags(uid);
      CREATE TRIGGER tags_uid AFTER INSERT ON tags WHEN new.uid IS NULL BEGIN
        UPDATE tags SET uid = lower(hex(randomblob(16))) WHERE id = new.id;
      END;

      ALTER TABLE playlists ADD COLUMN uid TEXT;
      UPDATE playlists SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL;
      CREATE UNIQUE INDEX idx_playlists_uid ON playlists(uid);
      CREATE TRIGGER playlists_uid AFTER INSERT ON playlists WHEN new.uid IS NULL BEGIN
        UPDATE playlists SET uid = lower(hex(randomblob(16))) WHERE id = new.id;
      END;

      -- What was uploaded for each song, and from which state of it: the audio
      -- file's size and mtime, the cover's revision, the lyric sidecar's size
      -- and mtime. A song whose signatures still match is not read again, so a
      -- rescan or a restart does not re-hash the whole library.
      CREATE TABLE cloud_songs (
        song_id     INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
        audio_key   TEXT    NOT NULL,
        audio_size  INTEGER NOT NULL,
        audio_sig   TEXT    NOT NULL,
        cover_key   TEXT,
        cover_size  INTEGER,
        cover_sig   TEXT    NOT NULL,
        lyrics_key  TEXT,
        lyrics_size INTEGER,
        lyrics_kind TEXT,
        lyrics_sig  TEXT    NOT NULL,
        uploaded_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      -- Every file known to be in the bucket. Files are named by their hash
      -- and never change, so "is it there?" is asked of the bucket once.
      CREATE TABLE cloud_files (
        key         TEXT    PRIMARY KEY,
        size        INTEGER NOT NULL,
        uploaded_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    name: 'sync: edits from every device',
    sql: `
      -- For each field an edit has set, when it was set (docs/SYNC.md): the
      -- stamp of the change, from a hybrid logical clock. An edit from another
      -- device that is older than the stamp arrived late, and loses. \`field\`
      -- is a column's name, or for a tag on a song the tag's uid, and for a
      -- song in a playlist the song's. A field with no stamp was never edited
      -- anywhere, and any edit replaces it.
      CREATE TABLE sync_stamps (
        kind  TEXT NOT NULL CHECK (kind IN ('song','songTag','tag','playlist','playlistSong')),
        uid   TEXT NOT NULL,
        field TEXT NOT NULL,
        hlc   TEXT NOT NULL,
        PRIMARY KEY (kind, uid, field)
      ) WITHOUT ROWID;
      CREATE INDEX idx_sync_stamps_field ON sync_stamps(kind, field);

      -- A stamp goes with the thing it is about, however that thing is deleted.
      CREATE TRIGGER sync_stamps_song_delete AFTER DELETE ON songs BEGIN
        DELETE FROM sync_stamps WHERE kind IN ('song','songTag') AND uid = old.uid;
        DELETE FROM sync_stamps WHERE kind = 'playlistSong' AND field = old.uid;
      END;
      CREATE TRIGGER sync_stamps_tag_delete AFTER DELETE ON tags BEGIN
        DELETE FROM sync_stamps WHERE kind = 'tag' AND uid = old.uid;
        DELETE FROM sync_stamps WHERE kind = 'songTag' AND field = old.uid;
      END;
      CREATE TRIGGER sync_stamps_playlist_delete AFTER DELETE ON playlists BEGIN
        DELETE FROM sync_stamps WHERE kind IN ('playlist','playlistSong') AND uid = old.uid;
      END;

      -- A tag made on two devices under one name, before either had heard of
      -- the other, is one tag here. The second uid is kept, so a change that
      -- names it still finds the tag.
      CREATE TABLE tag_aliases (
        uid    TEXT    PRIMARY KEY,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE
      );

      -- How far into each other device's log this Mac has read.
      CREATE TABLE cloud_log_cursors (
        device TEXT    PRIMARY KEY,
        seq    INTEGER NOT NULL
      );

      -- Skips from other devices already counted. Plays have play_events'
      -- client ids for the same job.
      CREATE TABLE counted_skips (
        id TEXT PRIMARY KEY
      ) WITHOUT ROWID;
    `,
  },
  {
    name: 'sync: links other devices ask to import',
    sql: `
      -- A link a device that cannot fetch asked this Mac to import, and how
      -- it went: every device reads that in the snapshot (docs/SYNC.md). Its
      -- import jobs point back at it, and once they are all finished the
      -- outcome is kept here, so clearing the jobs does not lose it.
      CREATE TABLE import_requests (
        uid          TEXT PRIMARY KEY,
        url          TEXT NOT NULL,
        tag_uids     TEXT NOT NULL DEFAULT '[]',
        playlist_uid TEXT,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        state        TEXT NOT NULL DEFAULT 'waiting'
                     CHECK (state IN ('waiting','working','done','failed','cancelled')),
        title        TEXT,
        song_uids    TEXT NOT NULL DEFAULT '[]',
        error        TEXT,
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_import_requests_time ON import_requests(requested_at);

      ALTER TABLE import_jobs ADD COLUMN request_uid TEXT;
      CREATE INDEX idx_import_jobs_request ON import_jobs(request_uid) WHERE request_uid IS NOT NULL;
    `,
  },
  {
    name: 'songs: the colour of each cover',
    sql: `
      -- The cover's most vivid colour, picked here from a 24×24 drawing of it
      -- so no device has to decode the image to draw the playing song in it.
      -- cover_tone_rev is the art_rev it was picked from: a new cover makes it
      -- stale. A cover with no colour in it keeps a null hue with the revision
      -- set, so it is not read again.
      ALTER TABLE songs ADD COLUMN cover_hue REAL;
      ALTER TABLE songs ADD COLUMN cover_chroma REAL;
      ALTER TABLE songs ADD COLUMN cover_tone_rev INTEGER;
    `,
  },
]

/**
 * Bring the schema up to `target` — the latest, unless a test wants a
 * database as it was before some migration, to watch that migration run.
 */
export function migrate(db: Database, logger: Logger, target = MIGRATIONS.length): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number

  if (currentVersion > MIGRATIONS.length) {
    throw new Error(
      `Database schema is version ${currentVersion} but this build only knows about ` +
        `${MIGRATIONS.length}. You are running an older server against a newer database.`,
    )
  }

  const goal = Math.min(target, MIGRATIONS.length)
  if (currentVersion >= goal) {
    logger.debug('schema up to date', { version: currentVersion })
    return
  }

  for (let version = currentVersion; version < goal; version++) {
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

  logger.info('schema migrated', { to: goal })
}

/** The version a migration brings the schema to, found by its name. */
export function migrationVersion(name: string): number {
  const index = MIGRATIONS.findIndex(migration => migration.name === name)
  if (index === -1) throw new Error(`no migration called ${JSON.stringify(name)}`)
  return index + 1
}

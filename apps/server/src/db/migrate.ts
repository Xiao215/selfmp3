import type { Database } from 'better-sqlite3'
import type { Logger } from '../logger.js'

/**
 * The database schema, and how a database comes to have it.
 *
 * `SCHEMA` is the whole schema at version `SCHEMA_VERSION`, and a new database
 * is made from it in one step. A later change is appended to `MIGRATIONS` —
 * never edited once it has run anywhere, never reordered — and each one brings
 * a database to the version after the last. SQLite's `user_version` pragma
 * records where a database is, and every step runs in a transaction, so a
 * failure leaves the database exactly as it was.
 */

interface Migration {
  readonly name: string
  readonly sql: string
}

/** Where the migrations `SCHEMA` replaced left off, so no database has to be made again. */
const SCHEMA_VERSION = 19

const SCHEMA = `
  CREATE TABLE songs (
    id             INTEGER PRIMARY KEY,
    path           TEXT    NOT NULL UNIQUE,
    title          TEXT    NOT NULL,
    artist         TEXT    NOT NULL DEFAULT '',
    album          TEXT    NOT NULL DEFAULT '',
    album_artist   TEXT    NOT NULL DEFAULT '',
    track_no       INTEGER,
    year           INTEGER,
    duration       REAL    NOT NULL DEFAULT 0,
    size_bytes     INTEGER NOT NULL DEFAULT 0,
    mime           TEXT    NOT NULL DEFAULT 'audio/mp4',
    mtime_ms       INTEGER NOT NULL DEFAULT 0,
    has_art        INTEGER NOT NULL DEFAULT 0,
    art_ext        TEXT,
    lyrics_kind    TEXT    NOT NULL DEFAULT 'none',
    play_count     INTEGER NOT NULL DEFAULT 0,
    skip_count     INTEGER NOT NULL DEFAULT 0,
    loved          INTEGER NOT NULL DEFAULT 0,
    -- The link an import came from: how its own timed lyrics are found.
    source_url     TEXT,
    last_played_at TEXT,
    added_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    missing        INTEGER NOT NULL DEFAULT 0,
    -- Bumped whenever a song's cover is written. Cover URLs carry it, so a
    -- replaced cover is fetched fresh instead of served from a cache that
    -- treats /api/art/<id> as forever.
    art_rev        INTEGER NOT NULL DEFAULT 0,
    -- Set when lrclib says a track has no words, or when you mark it so. Not a
    -- lyrics_kind value, because the scanner rewrites that column from the
    -- files on every rescan, and smart playlists read lyrics_kind != 'none' as
    -- "has lyrics".
    instrumental   INTEGER NOT NULL DEFAULT 0,
    -- How the song is known outside this database (docs/SYNC.md). The integer
    -- id stays a local handle: SQLite reuses ids after a delete, and another
    -- device would hand out the same numbers.
    uid            TEXT,
    -- The cover's most vivid colour, picked from a 24×24 drawing of it so no
    -- device has to decode the image to draw the playing song in it, and the
    -- handful of colours it is made of (JSON, most of the cover first), which
    -- the no-lyrics visuals draw in. cover_tone_rev is the art_rev they were
    -- picked from: a new cover makes them stale. A cover with no colour in it
    -- keeps a null hue with the revision set, so it is not read again.
    cover_hue      REAL,
    cover_chroma   REAL,
    cover_tone_rev INTEGER,
    cover_palette  TEXT
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
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    uid        TEXT
  );

  CREATE TABLE song_tags (
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (song_id, tag_id)
  );

  CREATE INDEX idx_song_tags_tag ON song_tags(tag_id);

  -- A 'live' playlist follows its rules and updates itself; a 'manual' one
  -- holds the songs put in it.
  CREATE TABLE playlists (
    id             INTEGER PRIMARY KEY,
    name           TEXT    NOT NULL,
    description    TEXT    NOT NULL DEFAULT '',
    kind           TEXT    NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','live')),
    rules          TEXT,
    pinned         INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    uid            TEXT,
    -- Set when a playlist is started as one (Play, Shuffle, a row in it), so
    -- the playlists page can put the ones in use first. Not synced: it moves
    -- on every play, and an edit stamp for it would put a playlist in every
    -- device's log each time music started.
    last_played_at TEXT
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
    completed INTEGER NOT NULL DEFAULT 0,
    -- A play made with the server out of reach is sent later, and sent again
    -- if the first response goes missing. The id the client gave it is how
    -- the second copy is recognised and ignored. Live plays have none.
    client_id TEXT
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
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    -- The import request (below) the job was made for, if another device asked.
    request_uid  TEXT
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

  CREATE UNIQUE INDEX idx_play_events_client
    ON play_events(client_id) WHERE client_id IS NOT NULL;

  -- Only for the columns it indexes: any other update — every play is one —
  -- would rewrite the entry, and the uid trigger below would fire it for a
  -- song whose entry the insert trigger had not written yet, which FTS5
  -- corrupts itself deleting.
  CREATE TRIGGER songs_fts_update AFTER UPDATE OF title, artist, album ON songs BEGIN
    INSERT INTO songs_fts(songs_fts, rowid, title, artist, album)
    VALUES ('delete', old.id, old.title, old.artist, old.album);
    INSERT INTO songs_fts(rowid, title, artist, album)
    VALUES (new.id, new.title, new.artist, new.album);
  END;

  -- ALTER TABLE cannot give a column a random default, so a row that arrives
  -- without a uid gets one by trigger. One made on another device arrives
  -- with its own.
  CREATE UNIQUE INDEX idx_songs_uid ON songs(uid);
  CREATE TRIGGER songs_uid AFTER INSERT ON songs WHEN new.uid IS NULL BEGIN
    UPDATE songs SET uid = lower(hex(randomblob(16))) WHERE id = new.id;
  END;

  CREATE UNIQUE INDEX idx_tags_uid ON tags(uid);
  CREATE TRIGGER tags_uid AFTER INSERT ON tags WHEN new.uid IS NULL BEGIN
    UPDATE tags SET uid = lower(hex(randomblob(16))) WHERE id = new.id;
  END;

  CREATE UNIQUE INDEX idx_playlists_uid ON playlists(uid);
  CREATE TRIGGER playlists_uid AFTER INSERT ON playlists WHEN new.uid IS NULL BEGIN
    UPDATE playlists SET uid = lower(hex(randomblob(16))) WHERE id = new.id;
  END;

  -- What was uploaded for each song, and from which state of it: the audio
  -- file's size and mtime, the cover's revision, the lyric sidecar's size and
  -- mtime, the romanized lines and the motion curve beside the lyrics. A song
  -- whose signatures still match is not read again, so a rescan or a restart
  -- does not re-hash the whole library.
  CREATE TABLE cloud_songs (
    song_id       INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
    audio_key     TEXT    NOT NULL,
    audio_size    INTEGER NOT NULL,
    audio_sig     TEXT    NOT NULL,
    cover_key     TEXT,
    cover_size    INTEGER,
    cover_sig     TEXT    NOT NULL,
    lyrics_key    TEXT,
    lyrics_size   INTEGER,
    lyrics_kind   TEXT,
    lyrics_sig    TEXT    NOT NULL,
    uploaded_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    romanized_key TEXT,
    motion_key    TEXT,
    motion_sig    TEXT NOT NULL DEFAULT ''
  );

  -- Every file known to be in the bucket. Files are named by their hash and
  -- never change, so "is it there?" is asked of the bucket once.
  CREATE TABLE cloud_files (
    key         TEXT    PRIMARY KEY,
    size        INTEGER NOT NULL,
    uploaded_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- For each field an edit has set, when it was set (docs/SYNC.md): the stamp
  -- of the change, from a hybrid logical clock. An edit from another device
  -- that is older than the stamp arrived late, and loses. \`field\` is a
  -- column's name, or for a tag on a song the tag's uid, and for a song in a
  -- playlist the song's. A field with no stamp was never edited anywhere, and
  -- any edit replaces it.
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

  -- A tag made on two devices under one name, before either had heard of the
  -- other, is one tag here. The second uid is kept, so a change that names it
  -- still finds the tag.
  CREATE TABLE tag_aliases (
    uid    TEXT    PRIMARY KEY,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE
  );

  -- How far into each other device's log this server has read.
  CREATE TABLE cloud_log_cursors (
    device TEXT    PRIMARY KEY,
    seq    INTEGER NOT NULL
  );

  -- Skips from other devices already counted. Plays have play_events' client
  -- ids for the same job.
  CREATE TABLE counted_skips (
    id TEXT PRIMARY KEY
  ) WITHOUT ROWID;

  -- A link a device that cannot fetch asked this server to import, and how it
  -- went: every device reads that in the snapshot (docs/SYNC.md). Its import
  -- jobs point back at it, and once they are all finished the outcome is kept
  -- here, so clearing the jobs does not lose it.
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

  CREATE INDEX idx_import_jobs_request ON import_jobs(request_uid) WHERE request_uid IS NOT NULL;
`

/** Changes to the schema after `SCHEMA_VERSION`, oldest first. */
const MIGRATIONS: readonly Migration[] = [
  {
    // 20. The table says what kind of features it holds, as audioFeatures does
    // everywhere else. SQLite has no RENAME INDEX, so the index is made again.
    name: 'song_features is song_audio_features',
    sql: `
      ALTER TABLE song_features RENAME TO song_audio_features;
      DROP INDEX idx_song_features_camelot;
      CREATE INDEX idx_song_audio_features_camelot ON song_audio_features(camelot);
    `,
  },
]

/** Bring the schema to the latest version. */
export function migrate(db: Database, logger: Logger): void {
  const current = db.pragma('user_version', { simple: true }) as number
  const latest = SCHEMA_VERSION + MIGRATIONS.length

  if (current > latest) {
    throw new Error(
      `Database schema is version ${current} but this build only knows about ` +
        `${latest}. You are running an older server against a newer database.`,
    )
  }
  if (current > 0 && current < SCHEMA_VERSION) {
    throw new Error(
      `Database schema is version ${current}, older than the ${SCHEMA_VERSION} this build ` +
        'starts from. Point the server at a new data directory.',
    )
  }
  if (current === latest) {
    logger.debug('schema up to date', { version: current })
    return
  }

  if (current === 0) apply(db, logger, SCHEMA_VERSION, { name: 'schema', sql: SCHEMA })
  for (let version = Math.max(current, SCHEMA_VERSION) + 1; version <= latest; version++) {
    const migration = MIGRATIONS[version - SCHEMA_VERSION - 1]
    if (migration) apply(db, logger, version, migration)
  }

  logger.info('schema migrated', { to: latest })
}

function apply(db: Database, logger: Logger, version: number, migration: Migration): void {
  logger.info(`applying migration ${version}: ${migration.name}`)

  // better-sqlite3 cannot run DDL inside its transaction() wrapper reliably
  // when the statements include CREATE VIRTUAL TABLE, so drive it manually.
  db.exec('BEGIN')
  try {
    db.exec(migration.sql)
    db.pragma(`user_version = ${version}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw new Error(
      `Migration ${version} (${migration.name}) failed: ` +
        (error instanceof Error ? error.message : String(error)),
    )
  }
}

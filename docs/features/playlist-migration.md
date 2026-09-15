# Playlist migration

Bring a playlist over from Spotify, Apple Music, or anywhere that can give you a list of
songs. Each song is matched to a YouTube upload, you check the matches, and the ones you
keep go through the normal import queue.

Open it from **Import → Migrate a playlist from another app**, or go to `/import/migrate`.

## What you can paste

- **Plain text**, one song per line. Any of these work, and can be mixed:
  `Artist - Title`, `Title - Artist`, `Title by Artist`, `Artist — Title`, or just `Title`.
  Numbering (`1.`, `2)`) and trailing durations (`3:45`) are ignored; `(Official Video)`,
  `[Remastered 2011]`, `feat. …` and similar noise is stripped from titles. Whether lines
  are `Artist - Title` or `Title - Artist` is guessed from the whole list (the side that
  repeats is the artist), defaulting to artist first.
- **A CSV/TSV export**: [Exportify](https://exportify.net) (log in with Spotify, pick the
  playlist, Export), TuneMyMusic, or Apple Music's *File → Library → Export Playlist*.
  Recognised columns: Track Name / Name / Title, Artist Name(s) / Artist, Album,
  Duration (ms) / Time, Playlist name.
- **A public Spotify playlist link**. This is best-effort: the server fetches Spotify's
  embed page and reads the track list out of it. When Spotify does not cooperate you get a
  clear error and the CSV hint above.

## How matching works

For every song the server runs `yt-dlp "ytsearch5:<artist> <title>"` (three searches at a
time) and scores each result 0–1:

- title similarity and artist similarity (against the video title and the channel name),
  multiplied so a wrong title cannot be rescued by the right artist;
- duration closeness when the source knew the length;
- a bonus for `<Artist> - Topic` and VEVO channels and "Official Audio/Video" titles;
- penalties for live, cover, remix, reaction, 8D, sped up / slowed, nightcore, karaoke,
  instrumental, hour-long loops — unless the source title itself asks for that version.
  Lyric videos are barely marked down.

Songs already in the library (fuzzy title + artist) are flagged **already have** and left
unticked. Rows with a red confidence (below 0.5) or no results are unticked too; green is
0.8 and up, amber in between. The dropdown on each row switches to another of the top three
candidates.

## Importing

Pick tags, optionally a playlist name (prefilled from the export when it carried one — an
existing manual playlist with the same name is reused), then **Import N songs**. The songs
are enqueued through the ordinary import queue with the same download, lyrics and cover-art
pipeline; a link takes you to the Import page to watch progress.

## API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/migrate/parse` | `{ text }` → `{ kind, playlistName, tracks, skipped }`. Pure except for Spotify links. |
| `POST` | `/api/migrate/match` | `{ tracks }` → a match job. |
| `GET` | `/api/migrate/match/:id` | Progress and results so far; poll while `status` is `running`. |
| `POST` | `/api/migrate/match/:id/cancel` | Stop searching. |
| `POST` | `/api/migrate/enqueue` | `{ items, tagIds, playlistName }` → import jobs plus the playlist id. |

Match jobs live in memory only and expire an hour after finishing. Unlike the download
queue there is nothing worth persisting: the results are suggestions the user has not
committed to, and redoing a search costs seconds rather than a download.

## Code

- `packages/shared/src/schemas/migrate.ts` — the contract.
- `apps/server/src/services/migrateParse.ts` — text, CSV and Spotify-embed parsing (pure, tested).
- `apps/server/src/services/migrateScore.ts` — candidate scoring and library de-duplication (pure, tested).
- `apps/server/src/services/migrate.ts` — the job runner and the yt-dlp searcher.
- `apps/server/src/routes/migrate.ts` — the routes.
- `apps/app/src/features/migrate/MigrateScreen.tsx`, `migrate.model.ts` — the page
  (route `apps/app/app/import/migrate.tsx`).

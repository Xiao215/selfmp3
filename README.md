# self.mp3

A private music library you actually own. Import from a link, tag it your way, sync it to
your phone, listen offline.

No account, no subscription, no telemetry. Your music is a folder of files on your Mac and
your metadata is one SQLite file next to it. Copy those two things anywhere and you have a
complete backup.

```
your Mac                         your phone
┌──────────────────────┐        ┌──────────────────────┐
│  library/  *.m4a     │        │  self.mp3 (PWA)      │
│  data/selfmp3.db     │◄──────►│  cached audio        │
│  self.mp3 server     │  Tail  │  cached metadata     │
└──────────────────────┘  scale └──────────────────────┘
                                 plays with the Mac asleep
```

---

## Quick start

```bash
npm install
brew install yt-dlp ffmpeg     # needed for importing
npm run build
npm start
```

Open <http://localhost:4600>.

For development with hot reload:

```bash
npm run dev                    # api on :4600, web on :4601
```

To reach it from your phone anywhere in the world, see **[docs/SETUP.md](docs/SETUP.md)** —
it walks through Tailscale, HTTPS, and running the server in the background.

---

## What it does

**Library.** Drop audio files into `library/` and hit rescan, or import them from a link.
Everything is filtered, sorted and searched client-side, so it stays instant and works with
no connection.

**Tags instead of folders.** One flat vocabulary you define. Combine them with AND —
`chinese` + `chill` — to slice the library any way you want.

**Playlists, manual and smart.** Manual ones you drag into order. Smart ones build
themselves from rules ("tagged chill, played more than 5 times, added in the last 90 days")
and stay correct as the library grows. The rule builder shows the live match count as you
type.

**Importing.** Paste one link or twenty, or a whole playlist. Metadata is fetched first so
you can correct it and untick duplicates before anything downloads. A persistent queue
handles the rest, with progress, retries, and cancel — and it survives a server restart.

**Offline on your phone.** Install it to your home screen and download your whole library.
Cached songs play with the Mac asleep, in the background, with lock-screen controls and
artwork.

**Playback.** Gapless and crossfade via a dual-element engine, a reorderable up-next queue,
playback speed, and a sleep timer that fades out rather than cutting off.

**Lyrics.** Synced `.lrc` lyrics with karaoke-style highlighting, click a line to jump
there. Resolved from a sidecar file, the audio file's own tags, or lrclib.net — and cached
to disk so they work offline afterwards.

**Stats.** Plays over time, when you listen, top artists and tags, listening streaks, and
how many songs you have never played once. All derived from stored play events, so the
questions can change later.

**⌘K.** One box that searches songs, playlists and tags and runs commands.

---

## How it is put together

```
packages/shared     zod schemas — the single source of truth for the API contract,
                    imported by both the server and the web app
apps/server         Express 5 + better-sqlite3, layered: routes → services → repositories
apps/web            React 19 + Vite + TanStack Query, plus a hand-written service worker
```

A few decisions worth knowing about:

**The contract is shared code, not documentation.** Every request the server validates and
every response the client parses go through the same zod schema. A mismatch is a compile
error, not a runtime surprise on a phone somewhere.

**Storage is behind an interface.** `StorageDriver` has a local-disk implementation and an
S3-compatible one. Moving your library to Cloudflare R2 later is a config change and one
driver file, not a refactor.

**Missing files are marked, never deleted.** Unplug an external drive and your tags, play
counts and playlist membership survive. Forgetting them permanently is a separate, explicit
button.

**Play events are stored, not just counted.** Every play is a row, so stats can be
recomputed or asked new questions of later.

**The import queue lives in SQLite.** Forty queued downloads survive a restart, and your
phone can open the import screen cold and see exactly what is happening.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API and web with hot reload |
| `npm run build` | Type-check and build everything |
| `npm start` | Run the built server |
| `npm run check` | Typecheck + lint + tests |
| `npm test` | Unit tests |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

---

## Configuration

Everything is optional; the defaults work.

| Variable | Default | Meaning |
|---|---|---|
| `SELFMP3_PORT` | `4600` | Port to listen on |
| `SELFMP3_HOST` | `0.0.0.0` | Bind address. `127.0.0.1` restricts to this machine |
| `SELFMP3_LIBRARY_DIR` | `./library` | Where your audio lives |
| `SELFMP3_DATA_DIR` | `./data` | Database and cover art cache |
| `SELFMP3_AUTH_TOKEN` | none | Optional bearer token, on top of Tailscale |
| `SELFMP3_STORAGE_DRIVER` | `local` | `local` or `s3` |
| `SELFMP3_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `SELFMP3_SCAN_ON_BOOT` | `true` | Scan the library folder at startup |

For S3-compatible storage, also set `SELFMP3_S3_BUCKET`, `SELFMP3_S3_REGION`,
`SELFMP3_S3_ENDPOINT`, `SELFMP3_S3_ACCESS_KEY_ID` and `SELFMP3_S3_SECRET_ACCESS_KEY`, and
install the SDK:

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `⌘K` | Search everything |
| `Space` | Play / pause |
| `←` `→` | Skip 5 seconds |
| `⇧←` `⇧→` | Previous / next track |
| `S` | Shuffle |
| `R` | Repeat |
| `L` | Lyrics |
| `Q` | Queue |

---

## Backing up

```bash
cp -r library/ data/ /Volumes/Backup/selfmp3/
```

That is the whole thing. `library/` is your audio and lyric sidecars; `data/selfmp3.db`
holds tags, playlists, play history and metadata edits. Cover art in `data/covers/` is a
disposable cache and rebuilds itself on the next scan.

---

## A note on importing

`yt-dlp` is a general-purpose downloader; self.mp3 just drives it. Downloading from a
service is governed by that service's terms and by copyright law where you live, and a
Premium subscription generally covers offline playback *inside that app* rather than
extraction to your own files. What you download and what you do with it is on you — this
tool assumes you are working with music you have the right to keep.

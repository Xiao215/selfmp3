# self.mp3

A private music library you actually own. Import from a link, tag it your way, sync it to
your phone, listen offline.

No account, no subscription, no telemetry. Your music is a folder of files on your Mac and
your metadata is one SQLite file next to it. Copy those two things anywhere and you have a
complete backup.

```
your Mac                         your phone                    your car
┌──────────────────────┐        ┌──────────────────────┐      ┌──────────────┐
│  library/  *.m4a     │        │  self.mp3 (PWA or    │      │  CarPlay /   │
│  data/selfmp3.db     │◄──────►│  native app)         │◄────►│  Android     │
│  self.mp3 server     │  Tail  │  downloaded audio    │      │  Auto        │
└──────────────────────┘  scale └──────────────────────┘      └──────────────┘
                                 plays with the Mac asleep
```

---

## Quick start

```bash
./scripts/setup-mac.sh         # checks Node, installs yt-dlp and ffmpeg, builds, offers
                               # to start self.mp3 at login
```

Or by hand:

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
**[docs/INSTALL.md](docs/INSTALL.md)** covers Docker, backups, updating, and migrating from
the old `hum` app. Every feature has a page under
**[docs/features/](docs/features)**.

---

## What it does

**Library.** Drop audio files into `library/` and they appear — the folder is watched, so a
drag into Finder is enough. Or import them from a link: each import gets a folder of its own,
`library/Artist - Title/`, with its lyrics beside it. Everything is filtered, sorted and
searched client-side, so it stays instant and works with no connection.

**Tags instead of folders.** One flat vocabulary you define. Combine them with AND —
`chinese` + `chill` — or leave one out: `chill`, but not `instrumental`. Rename and recolour
them in place, tag the song that is playing with `T`, and work through everything untagged
one song at a time with the number keys. See
[docs/features/tagging.md](docs/features/tagging.md).

**Playlists, manual and smart.** Manual ones you drag into order. Smart ones build
themselves from rules ("tagged chill, played more than 5 times, added in the last 90 days",
or "between 120 and 130 BPM in a key that mixes with 8A") and stay correct as the library
grows. The rule builder shows the live match count as you type.

**Importing.** Paste one link or twenty, or a whole playlist. Metadata is fetched first so
you can correct it and untick duplicates before anything downloads. A persistent queue
handles the rest, with progress, retries, and cancel — and it survives a server restart.

**Share straight from your phone.** Share a track from the YouTube Music app and it queues
on the Mac. On Android that is a share target the app registers; on iOS it is a one-step
Shortcut, described in [docs/features/share-to-import.md](docs/features/share-to-import.md).

**Bring your existing library.** Point yt-dlp at your browser's YouTube cookies and your
Liked Music and private playlists import like any other link. Playlists from Spotify and
Apple Music come in through a paste box — a link, a CSV export, or just a list of song
names — and each track is matched to a YouTube upload, scored, and shown to you with
alternatives before anything downloads.

**Metadata that fixes itself.** Look a song up on iTunes or MusicBrainz, see the candidates
side by side with your current values, and apply only the fields you want. Missing cover art
can be filled in across the whole library in one pass.

**Offline on your phone.** Install it to your home screen and it downloads your library on
its own — on Wi-Fi, whenever the Mac is reachable, until the phone is nearly full — with a mark
on every song that says whether it is there. Cached songs play with the Mac asleep, in the
background, with lock-screen controls and artwork, and the plays you make offline are sent to
the Mac when it wakes, dated when they happened. See
[docs/features/offline-sync.md](docs/features/offline-sync.md). There is also a native iOS and
Android app — see
[docs/MOBILE.md](docs/MOBILE.md) — which adds CarPlay and Android Auto.

**Playback.** Gapless and crossfade via a dual-element engine, a reorderable up-next queue,
playback speed, and a sleep timer that fades out rather than cutting off.

**Every device knows about the others.** The Mac and the phone see what each other is
playing. Hand a song over mid-track in either direction, use the phone as a remote for the
Mac, or pick up where you left off on the other device when you open the app.

**A page for the song that is playing.** Click the artwork in the player bar and the song
opens into its own page: the artwork and what the app knows about it beside its synced
lyrics. Press `F` and the page turns into Focus — the words alone, big, each line filling
in as it is sung, and the controls fading away while you just listen. A song with no words
gets a visual drawn from its own tempo, energy and cover colours instead, picked to suit
it: a slow aurora for a nocturne, a live spectrum for a big-band chase. See
[docs/features/now-playing.md](docs/features/now-playing.md).

**Lyrics.** Synced `.lrc` lyrics, click a line to jump there, right-click it to loop it.
Resolved from a sidecar file, the audio file's own tags, or lrclib.net — and cached to disk
so they work offline afterwards. Chinese lyrics can show pinyin and Japanese romaji
underneath, offline. Songs with no timings can be synced by tapping along, instrumentals
are remembered as instrumentals, and you can find any song by a line you remember.

**Audio it has actually listened to.** Every song is analysed locally for tempo, musical
key, energy and loudness. That feeds smart playlists, a "similar songs" pick, and an
auto-mix mode that orders the queue into a smooth path and sets each crossfade to suit the
transition.

**Practice.** An A–B loop for the bar you keep missing, speed changes that hold pitch, and
a transpose readout.

**Stats, and Wrapped whenever you want it.** Plays over time, when you listen, top artists
and tags, listening streaks, and how many songs you have never played once. A Wrapped view
for any range — week, month, year, all time — that you can export as a square image.
Forgotten gems resurfaces things you loved and stopped playing.

**⌘K.** One box that searches songs, playlists, tags and lyrics, and runs commands.

---

## How it is put together

```
packages/shared     zod schemas — the single source of truth for the API contract —
                    plus the pure helpers every client needs: queue mechanics, LRC
                    parsing, fuzzy search, feature distances
apps/server         Express 5 + better-sqlite3, layered: routes → services → repositories
apps/web            React 19 + Vite + TanStack Query, plus a hand-written service worker
apps/mobile         Expo / React Native — iOS and Android, CarPlay and Android Auto
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

**Analysis is local and cached.** Tempo, key and loudness are computed from the audio with
ffmpeg and plain TypeScript maths — no service, no upload, no key. Results live in their own
table with a version number, so improving the algorithm later means re-running it, not
losing anything.

**Devices talk over one SSE stream.** Presence, remote commands and library-changed pings
share `GET /api/events`. Polling stays as the fallback, so a dropped stream degrades to what
the app did before rather than breaking.

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
| `npm run check:mobile` | Typecheck + lint the native app |
| `npm run cli -- <command>` | The `selfmp3` CLI (`scan`, `import`, `backup`, `doctor`) |

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

Most day-to-day behaviour — crossfade, watched folder, YouTube cookies, romanization,
translation provider — lives in Settings in the app rather than in environment variables, so
the Mac and the phone agree on it.

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
| `L` | Lyrics, full size (again to close) |
| `F` | Switch the song's page between Stage and Focus |
| `Esc` | Step back: Focus → Stage → closed |
| `Q` | Queue |
| `P` | Practice panel |
| `T` | Tag the song that is playing |

---

## Backing up

```bash
npm run cli -- backup /Volumes/Backup/selfmp3     # or just: cp -r library/ data/ …
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

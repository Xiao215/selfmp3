# self.mp3

[![Check](https://github.com/Xiao215/selfmp3/actions/workflows/check.yml/badge.svg)](https://github.com/Xiao215/selfmp3/actions/workflows/check.yml)

A private music library you run yourself. Import songs from a link or drop in files you
already have, tag them your way, and play them on your computer and your phone, with no
signal if need be.

It is for one person, or a household, who wants their music as files they own rather than
a catalogue they rent. There is no account to make with anyone, no subscription and no
telemetry. The music is a folder of audio files and the metadata is one SQLite database
beside it. Copy those two folders and you have a complete backup.

```
your server                     a storage bucket you own          your devices
┌──────────────────────┐        ┌──────────────────────┐        ┌──────────────────────┐
│ ~/Music/selfmp3      │        │ Backblaze B2         │        │ browser tab          │
│ selfmp3.db           │───────►│ audio, covers,       │◄──────►│ iPhone / Android app │
│ yt-dlp, ffmpeg       │ publish│ lyrics, change log   │  sync  │ Mac desktop app      │
└──────────────────────┘        └──────────────────────┘        └──────────────────────┘
          ▲                                                               │
          └───────── Tailscale: imports, and the server's own page ───────┘
```

The server imports and analyses. The bucket holds a copy of the library that every device
reads and writes, so your phone keeps working, and keeps its edits, while the server is
asleep.

## Contents

- [Where it runs](#where-it-runs)
- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Development](#development)
- [How it is put together](#how-it-is-put-together)
- [Documentation](#documentation)
- [Backing up](#backing-up)
- [A note on importing](#a-note-on-importing)
- [Licence](#licence)

---

## Where it runs

One server, and one app (`apps/app`, Expo) that runs in a browser, on a phone and inside
the desktop app. The screens are the same everywhere; the layout follows the width of the
window, not the platform.

**Every device gets in the same way — sign in with Google, and the library is your
bucket's.** There is no server address to type anywhere. The server's own page, on
`:4600`, is not where you listen: it is where you set the server up and see what it is
doing.

| | Server | Browser tab | iPhone and Android app | Mac desktop app |
|---|---|---|---|---|
| **What it is** | Node, Express and SQLite on a Mac, a Linux box or in Docker | The GitHub Pages build at `xiao215.github.io/selfmp3`, signed in to your bucket | The Expo app, built yourself from this repo | An Electron window around the same web build, a `.dmg` on the releases page |
| **Holds the library** | Yes: the folder and the database | No | A copy of the bucket's library | A copy of the bucket's library |
| **Music with no signal** | — | Streams, keeps nothing | Downloads, and plays from the files | Downloads, and plays from the files |
| **Import from a link** | Runs yt-dlp itself | Reaches the server directly when it can, otherwise leaves the request in the bucket | The same | The same |
| **Stats, Untagged, metadata lookup** | Serves them over `/api` | Hidden — see below | Hidden | Hidden |
| **Controls outside the app** | — | The browser's media controls | Lock screen, Control Center, Android Auto (partly) | Media keys, Now Playing in Control Center, the menu bar |
| **Keyboard** | — | Space for play and pause | — | The application menu's shortcuts, and `⌘K` for Search |

On a phone the tabs are **Library · Playlists · Import · You**; You holds Stats & report,
Untagged, Tags and Settings. On a computer those live in the sidebar.

**Stats, the Untagged inbox and looking metadata up are the server's own.** They need its
database and the calls only it makes, so the app hides them whenever the library it is
showing is the bucket's. Every surface now signs in to the bucket, so today none of them
draws those screens, and the server's page does not draw them either — it serves them over
`/api` and nothing asks. That is a gap rather than a decision, and it is the next thing to
close.

---

## What it does

### Your library

**The bucket is the library.** Every song, cover and lyric lives in a storage bucket of your
own, and every device reads it from there. The server's folder, `~/Music/selfmp3`, is an
inbox: an import lands there, a file you drop there is imported too, and once a song is in
the bucket the copy is deleted. Filtering, sorting and search run on the device, so they are
instant and work offline. See [watched-library-folder.md](docs/features/watched-library-folder.md)
and [SYNC.md](docs/SYNC.md).

**Tags instead of folders.** One flat vocabulary you define. Combine tags — `chinese` and
`chill` — or leave one out: `chill`, but not `live`. Rename and recolour them in place, tag
the song that is playing from the player bar, and work through everything untagged one song
at a time with the number keys. See [tagging.md](docs/features/tagging.md).

**Playlists, three kinds.** A **Playlist** is songs you pick and drag into order. **Smart**
builds an ordinary playlist in one go from a template — Most played, Forgotten gems, Short
ones, Long songs, Recently added, Loved, By tag — and then leaves it to you. A **Live**
playlist keeps
its rules ("tagged chill, played more than 5 times, between 120 and 130 BPM") and updates
itself as the library changes. Pin a playlist and it sits in the sidebar's Playlists section.

**Metadata that fixes itself.** Look a song up on iTunes or MusicBrainz, compare the
candidates with what you have, and apply only the fields you want. Missing cover art can be
filled in across the whole library in one pass. See [metadata-polish.md](docs/features/metadata-polish.md).

**Select several, act once.** Tick songs and a bar floats over the list — at the top on a
computer, at the bottom on a phone — to play, queue, tag, add to a playlist, download or
remove them together. See [multi-select.md](docs/features/multi-select.md).

### Bringing music in

**From a link.** Paste one link or twenty, or a whole playlist. Metadata is fetched first,
so you can correct it, listen to a track and untick duplicates before anything downloads.
The queue lives in the database, so it survives a restart.

**And from anywhere.** Only your server can fetch a link, but you do not have to be near it
to add one. Out of its reach, the link goes into the bucket with the tags and the playlist
you chose, and your server takes it the next time it is awake; it arrives on your devices
with the sync after that. What you lose while away is the looking — what a link holds, and
playing a song before it is added — not the adding.

**Titles arrive as song titles.** Where YouTube has no music metadata of its own, the
video's title is read as the song's: "YOASOBI「アイドル」 Official Music Video" comes in as
アイドル by YOASOBI. It drops what the video says about itself — "Official Music Video",
【MV】, a trailing "| Official Video", and the artist written in front when that is the
channel — and keeps what belongs to the song, so "(Live)", a "(From …)" note and a
"feat." credit all survive. It happens in the server's probe
(`tidyVideoTitle` in `packages/shared/src/titles.ts`), so the Import page, a share from
your phone and the iOS Shortcut all get the same titles.

**From your phone's share sheet.** Share a track from the YouTube Music app and it queues on
the server: a share target on Android, a one-step Shortcut on iOS. See
[share-to-import.md](docs/features/share-to-import.md).

**From your existing library.** Point yt-dlp at your browser's YouTube cookies and your Liked
Music, private playlists and artist pages import like any other link
([youtube-music-library.md](docs/features/youtube-music-library.md)). Playlists from Spotify
or Apple Music come in as a link, a CSV export or a plain list of songs; each track is
matched to a YouTube upload and shown to you with alternatives first
([playlist-migration.md](docs/features/playlist-migration.md)).

**From the browser.** A Chrome extension that imports the song you are looking at without
leaving the page: a **self.mp3** button in the YouTube page itself, a popup with the title,
your tags and a playlist to put it in, a whole playlist ticked through, and a right-click
item for any link anywhere. The toolbar counts what it is importing and says what landed.
Sign in with Google and it finds your server by itself — and when the server is asleep it
leaves the link in your bucket for the server to fetch when it wakes. It is
loaded unpacked from `apps/extension` rather than installed from a store. See
[browser-extension.md](docs/features/browser-extension.md).

### Listening

**Playback.** Gapless and crossfade in a browser and the desktop app, a reorderable up-next
queue, playback speed, and a sleep timer that fades out rather than cutting off. Nothing is
drawn at the foot of the window until something plays.

**A page for the song that is playing.** Click the artwork in the player bar and the song
opens into Stage: its artwork, what the app knows about it, and its synced lyrics, up next
or details beside it. Focus turns the page into the words alone, big, each line filling in
as it is sung. A song with no lyrics gets an animated visual instead — Aurora, Pulse,
Spectrum or Drift — that follows the actual sound and takes its colours from the cover. See
[now-playing.md](docs/features/now-playing.md).

**The song's own colour.** The playing row, the player bar and the phone's mini player take
their colour from the cover rather than the app's accent. See
[now-playing-colour.md](docs/features/now-playing-colour.md).

**Lyrics.** Synced `.lrc` lyrics: click a line to jump there, right-click it to loop it.
Found in a sidecar file, the audio file's tags, YouTube Music's timed lyrics or lrclib.net,
then kept. Chinese lyrics can show pinyin and Japanese romaji underneath, and you can find a
song by a line you remember. See [lyrics-plus.md](docs/features/lyrics-plus.md).

**Audio it has actually listened to.** Every song is analysed on the server for tempo, key,
energy and loudness, with ffmpeg and plain TypeScript. That feeds live playlist rules, a
"similar songs" pick, and an auto-mix mode that orders the queue into a smooth path and sets
each crossfade to suit the transition. See [audio-intelligence.md](docs/features/audio-intelligence.md).

**Practice.** An A–B loop for the bar you keep missing, speed changes that hold pitch, and a
transpose readout. See [practice-tools.md](docs/features/practice-tools.md).

### Across your devices

**Offline, on the devices that keep songs.** The phone app and the desktop app download on
Wi-Fi by themselves, ask first on mobile data or past 500 MB, and mark every song that is on
the device. Plays made with no connection are sent later, dated when they happened. A browser
tab streams. See [offline-sync.md](docs/features/offline-sync.md).

**A library in a bucket.** Sign in with Google and every device reads and writes the same
library in a Backblaze B2 bucket you own, through a small Cloudflare Worker (the doorman)
that keeps the bucket's key off your devices. Edits made anywhere combine by fixed rules. See
[docs/SYNC.md](docs/SYNC.md).

**Handoff and remote control.** Devices that answer from the server see what each other is
playing. Move a song to another device mid-track, drive one from another, or continue where
you left off. The switchboard is `/api/devices` and a bucket cannot be one, so this is not
reachable while every surface reads the bucket — the honest version is in
[devices-and-handoff.md](docs/features/devices-and-handoff.md).

**A desktop app, not a tab.** A Dock icon, the media keys, the menu bar, `⌘K` search, songs
kept as files in `~/Library/Application Support/self.mp3`, and the keychain for its token.
See [desktop-app.md](docs/features/desktop-app.md).

### Looking back

**Stats, and Wrapped whenever you want it.** Plays over time, when you listen, top artists
and tags, streaks, and how much you have never played. A report for any range — week, month,
year, all time — that you can save as an image. Forgotten gems brings back songs you loved
and stopped playing. All of it is the server's own, so it is hidden from a bucket library
and — see [Where it runs](#where-it-runs) — not reachable from any surface today. See
[wrapped-and-gems.md](docs/features/wrapped-and-gems.md).

---

## Quick start

You need Node 22 or newer. On a Mac:

```bash
./scripts/setup-mac.sh
```

It installs `yt-dlp` and `ffmpeg` with Homebrew if they are missing, installs the npm
packages, builds, creates the library and data folders, and offers to start the server at
login. It is safe to run again after every `git pull`. Then open <http://localhost:4600>:
that is the server's own page — the library count, the Cloud section where you sign in
with Google and name your bucket, and a **Publish now** button. Once it has published, you
listen in the [GitHub Pages tab](https://xiao215.github.io/selfmp3), the Mac desktop app or
the phone app, each signed in with the same Google account.

By hand:

```bash
brew install yt-dlp ffmpeg     # yt-dlp downloads; ffmpeg analyses and embeds artwork
npm install
npm run build
npm start
```

Then, depending on where you want it:

| You want | Read |
|---|---|
| The server on an always-on box — a NAS, a Pi, a VPS | [INSTALL.md, With Docker](docs/INSTALL.md#with-docker) |
| To reach the server from your phone, anywhere | [SETUP.md](docs/SETUP.md): Tailscale and HTTPS |
| The Mac desktop app | [INSTALL.md, The desktop app](docs/INSTALL.md#the-desktop-app) |
| The iPhone or Android app | [MOBILE.md](docs/MOBILE.md) |
| Your library on every device while the server sleeps | [SYNC.md, Setting up](docs/SYNC.md#setting-up) |

`./scripts/doctor.sh` checks Node, yt-dlp, ffmpeg, the build, the service, the port and the
folders, and tells you the command that fixes whatever is wrong.

---

## Configuration

Everything is optional; the defaults work. Set these in the environment, or in a `.env` at
the top of the checkout (copy `.env.example`; git ignores `.env`).

| Variable | Default | Meaning |
|---|---|---|
| `SELFMP3_PORT` | `4600` | Port to listen on |
| `SELFMP3_HOST` | `0.0.0.0` | Bind address. `127.0.0.1` keeps it to this machine |
| `SELFMP3_PUBLIC_URL` | none | One more address to publish, for a device that cannot reach a local one: the HTTPS address of a tunnel in front of this server ([INSTALL.md](docs/INSTALL.md#letting-someone-else-in)) |
| `SELFMP3_LIBRARY_DIR` | `~/Music/selfmp3` | The inbox: where an import lands until it is in the bucket |
| `SELFMP3_DATA_DIR` | `~/Library/Application Support/selfmp3` (`~/.local/share/selfmp3` off macOS) | The database and cover art |
| `SELFMP3_PROFILE` | none | A separate installation: `dev` uses `~/Music/selfmp3-dev` and a `selfmp3-dev` data folder. `npm run dev` sets it |
| `SELFMP3_AUTH_TOKEN` | one the server makes for itself | A bearer token of your own, 8 characters or more |
| `SELFMP3_DOORMAN_URL` | the one in `packages/shared/src/cloud.ts` | The doorman this server signs in to the cloud through. Empty for none |
| `SELFMP3_CORS_ORIGINS` | none | Comma-separated origins allowed to call the API; none means same-origin only |
| `SELFMP3_STORAGE_DRIVER` | `local` | `local` or `s3` |
| `SELFMP3_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `SELFMP3_SCAN_ON_BOOT` | `true` | Sweep the inbox folder at startup, so a file dropped in while the server was off is imported |
| `SELFMP3_CLOUD_DIR` | unset | A folder to use as the bucket instead of an account — the dev profile and the verify lanes run with one. Relative to the data directory unless absolute |

For the `s3` driver, also set `SELFMP3_S3_BUCKET`, `SELFMP3_S3_REGION`,
`SELFMP3_S3_ENDPOINT`, `SELFMP3_S3_ACCESS_KEY_ID` and `SELFMP3_S3_SECRET_ACCESS_KEY`
(and optionally `SELFMP3_S3_SIGNED_URL_TTL`, in seconds). That is the server's own storage;
the bucket every device syncs with is set up separately, in [SYNC.md](docs/SYNC.md).

Day-to-day behaviour — crossfade, the watched folder, romanization — lives in the app's
Settings rather than in the environment, so every device agrees on it.

Five of the server's settings have no screen yet, so they sit at their defaults unless the
database is edited by hand: the YouTube cookie source and cookie file, the tags added to
every import, the automatic rescan interval, and the fraction of a song that counts as a
play. The server reads all five; nothing writes them.

**About that token.** The server listens on every interface, because the addresses those
interfaces give it are how your phone finds it to import (docs/SYNC.md). So it needs a key,
and one you have to remember to set is one that is usually not set — so it makes its own on
the first boot that finds none and keeps it in its database. You never type it: it goes into
the bucket beside those addresses, and every device signed in to your Google account is
handed it with the sync. Requests from the computer running the server are not asked for it
at all — its own page at `http://localhost:4600`, the `selfmp3` command and an extension
pointed at localhost all keep working untouched — because anyone at that keyboard could read
the database the token is in. Set `SELFMP3_AUTH_TOKEN` to choose your own instead; the
server prints the one it made in its startup log, for the rare case of opening its page from
another computer.

---

## Development

```bash
npm install
npm run dev        # the server on :4600 with the dev profile, the app's web dev server on :4601
```

The dev profile keeps its own library and database, so working on the code never touches
your real collection. Every root script:

| Command | What it does |
|---|---|
| `npm run dev` | `dev:api` and `dev:web` together |
| `npm run dev:api` | The server with reload, on the `dev` profile |
| `npm run dev:web` | Builds the packages, then the app's web dev server on `:4601` |
| `npm run dev:desktop` | The desktop app against a dev build |
| `npm run build:packages` | The four shared packages, in dependency order — every other build starts here |
| `npm run build` | The packages and the server — what `npm start` runs |
| `npm run build:desktop` | The same web export, packaged as a `.dmg` in `apps/desktop/release/` |
| `npm run build:extension` | The packages and the browser extension, into `apps/extension/dist/` |
| `npm run zip:extension` | That build, zipped into `apps/extension/release/` |
| `npm start` | Run the built server |
| `npm run cli -- <command>` | The `selfmp3` CLI: `start`, `scan`, `import`, `backup`, `doctor` |
| `npm run typecheck` | TypeScript across the root project |
| `npm run typecheck:clean` | The same, from scratch — for when a stale `tsconfig.tsbuildinfo` makes it lie |
| `npm run typecheck:verify` | The three Playwright suites, which no other project checks |
| `npm run typecheck:app` | Builds the packages, then type-checks the app and its service worker |
| `npm run lint` / `npm run lint:fix` | ESLint, or ESLint with fixes |
| `npm run lint:app` | ESLint for the app |
| `npm run check:exports` | Exports nothing imports, twin-aware (`scripts/unused-exports.mjs`) |
| `npm test` / `npm run test:watch` | The Vitest suite, once or watching |
| `npm run test:app` | The app's component tests (Jest) |
| `npm run check:app` | `typecheck:app`, `lint:app` and `test:app` |
| `npm run check` | Typecheck, lint and tests, the app included — what CI runs |
| `npm run format` / `npm run format:check` | Prettier, writing or checking |
| `npm run verify:flows` | Playwright flows at computer and phone width, against `npm run dev` ([verify/README.md](verify/README.md)) |
| `npm run verify:desktop` | Playwright against the built desktop app |
| `npm run verify:extension` | Playwright against the built browser extension |
| `npm run clean` | Remove every build output |

Inside `apps/app`, `npx expo run:ios` or `npx expo run:android` builds the phone app; see
[MOBILE.md](docs/MOBILE.md). Phone flows run with Maestro ([apps/app/.maestro/README.md](apps/app/.maestro/README.md)).

A few habits keep this repository in order:

- Run `npm run check` before you commit. [`check.yml`](.github/workflows/check.yml) runs the
  same thing on every push and pull request, and the Pages build will not publish without it.
- A schema change is a new migration appended to `apps/server/src/db/migrate.ts`. Never edit
  or renumber an existing one.
- A change to the API starts in `packages/shared`'s zod schemas; the compile errors then lead
  you to every place that needs updating.

---

## How it is put together

```
packages/shared          zod schemas (the API contract) and pure helpers: queue rules,
                         LRC parsing, fuzzy search, sync rules, audio feature distances
packages/client          what every client shares: API client, React Query hooks, the
                         download queue, practice and auto-mix rules, theme tokens
packages/replica         a device's own copy of the bucket's library, and its outbox
packages/desktop-bridge  the contract between the desktop shell and the page
apps/server              Express 5 and better-sqlite3: routes → services → repositories,
                         plus public/ — the hand-written page it serves on :4600
apps/app                 Expo / React Native: one app for iOS, Android and the web
apps/desktop             the Electron shell around apps/app's web export
apps/doorman             Cloudflare Worker: Google sign-in and bucket access
```

The decisions that shape it — shared schemas instead of documented ones, storage behind an
interface, missing files marked rather than deleted, every play kept as a row, platform
differences behind ports — are explained in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

Four GitHub workflows: [`check.yml`](.github/workflows/check.yml) on every push,
[`pages.yml`](.github/workflows/pages.yml) publishes the web app from `main`,
[`docker.yml`](.github/workflows/docker.yml) publishes `ghcr.io/xiao215/selfmp3`, and
[`desktop.yml`](.github/workflows/desktop.yml) builds the desktop app on a `desktop-v*` tag.
The doorman is deployed by hand with `npx wrangler deploy`
([apps/doorman/README.md](apps/doorman/README.md)).

---

## Documentation

| Document | What it covers |
|---|---|
| [docs/INSTALL.md](docs/INSTALL.md) | A Mac, Docker, a Raspberry Pi, the desktop app, the CLI, backups and updating |
| [docs/SETUP.md](docs/SETUP.md) | Reaching the server from your phone: Tailscale, HTTPS, running in the background |
| [docs/SYNC.md](docs/SYNC.md) | The library in a bucket: the layout, signing in, how edits combine, setting it up |
| [docs/MOBILE.md](docs/MOBILE.md) | Building and running the iPhone and Android app, and Android Auto |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the code is laid out, and why |
| [docs/FEATURE_TODO.md](docs/FEATURE_TODO.md) | What was planned or researched and is not built yet: the iPad, the desktop, the extension |
| [docs/UI-MIGRATION.md](docs/UI-MIGRATION.md) | The plan for moving the app to the redesigned interface. The mock it builds to is [docs/ui-mock/](docs/ui-mock/README.md) |
| [apps/doorman/README.md](apps/doorman/README.md) | Deploying the doorman, and what each setting means |
| [verify/README.md](verify/README.md) | The Playwright flows and what they need |
| [docs/PREPROD.md](docs/PREPROD.md) | Checking a build against the real thing before calling it good: what to test on each platform, and how not to damage the library doing it |
| [apps/app/.maestro/README.md](apps/app/.maestro/README.md) | The phone flows, run with Maestro on a simulator |

Feature pages, each with what it does, how it works and where the code is:

| Feature | |
|---|---|
| [audio-intelligence.md](docs/features/audio-intelligence.md) | Tempo, key, energy and loudness; similar songs; auto-mix |
| [design-system.md](docs/features/design-system.md) | Dropdowns, popovers, hover captions, tokens and focus |
| [desktop-app.md](docs/features/desktop-app.md) | The Mac app: why it exists and how the shell is built |
| [browser-extension.md](docs/features/browser-extension.md) | The Chrome extension: the pill, the popup, and what it asks Chrome for |
| [devices-and-handoff.md](docs/features/devices-and-handoff.md) | Presence, handoff, remote control, continue where you left off |
| [install-and-ops.md](docs/features/install-and-ops.md) | The setup script, `doctor`, the CLI and the Docker image |
| [lyrics-plus.md](docs/features/lyrics-plus.md) | Romanization, search by lyric, songs with no words |
| [metadata-polish.md](docs/features/metadata-polish.md) | iTunes and MusicBrainz lookups, finding missing covers |
| [multi-select.md](docs/features/multi-select.md) | Selecting songs and acting on them together |
| [native-app.md](docs/features/native-app.md) | The app on a phone, in brief |
| [now-playing.md](docs/features/now-playing.md) | Stage, Focus, lyrics and the visuals for songs with no lyrics |
| [now-playing-colour.md](docs/features/now-playing-colour.md) | The playing song marked in its cover's colour |
| [offline-sync.md](docs/features/offline-sync.md) | Automatic downloads and plays made offline |
| [playlist-migration.md](docs/features/playlist-migration.md) | Bringing playlists from Spotify and Apple Music |
| [practice-tools.md](docs/features/practice-tools.md) | A–B loop, speed with pitch lock, transpose |
| [share-to-import.md](docs/features/share-to-import.md) | Importing from the share sheet on Android and iOS |
| [tagging.md](docs/features/tagging.md) | Hiding and editing tags, tagging what plays, Untagged |
| [watched-library-folder.md](docs/features/watched-library-folder.md) | Rescanning when the library folder changes |
| [wrapped-and-gems.md](docs/features/wrapped-and-gems.md) | The listening report and forgotten gems |
| [youtube-music-library.md](docs/features/youtube-music-library.md) | Liked Music, private playlists and artist pages |

---

## Backing up

```bash
npm run cli -- backup /Volumes/Backup/selfmp3     # or copy the two folders yourself
```

That is the whole thing. The music is in your bucket; `selfmp3.db` in the data folder
(`~/Library/Application Support/selfmp3`) holds the play history, which is the one thing only
the server has (see [FEATURE_TODO.md](docs/FEATURE_TODO.md), "The cloud"). The backup copies
only what changed, and copies the database through SQLite's backup API, so the server can
keep running. `covers/` in the data folder is a cache. More in
[INSTALL.md](docs/INSTALL.md#backing-up).

---

## A note on importing

`yt-dlp` is a general-purpose downloader; self.mp3 drives it. Downloading from a service is
governed by that service's terms and by copyright law where you live, and a subscription
generally covers offline playback *inside that service's app* rather than extraction to your
own files. What you download and what you do with it is up to you; this tool assumes you are
keeping music you have the right to keep.

---

## Licence

MIT — see [LICENSE](LICENSE).

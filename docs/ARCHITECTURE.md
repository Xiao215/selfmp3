# Architecture

Notes on how this is put together and, more usefully, *why*. Written for whoever
touches this next — most likely you, six months from now.

---

## Where each piece runs

| Piece | Runs on | Holds |
|---|---|---|
| The server (`apps/server`) | An always-on computer, in Docker (`ghcr.io/xiao215/selfmp3`, arm64 and amd64). Xiao's is a Raspberry Pi 4 | A working copy of each library it works for, and `hub.json` |
| The bucket | Backblaze B2, one per Google account | The library: audio, covers, lyrics, the snapshot, the change log, the plays |
| The doorman (`apps/doorman`) | A Cloudflare Worker, with KV and Durable Objects | Sign-in sessions, grants, who may sign in, rooms, shared playlists, share links |
| The AI helper | Any OpenAI-compatible endpoint. Xiao's is [cli-bridge](https://github.com/Xiao215/cli-bridge), beside the server on `127.0.0.1:8787` | Nothing of the library |
| The app (`apps/app`) | GitHub Pages, the phone, the desktop app (`apps/desktop`) | Its own copy of the bucket's library, and the songs it downloaded |

A development machine (a Mac, in Xiao's case) runs none of these for real: `npm run dev`
starts a server of its own with a folder for a bucket, and the desktop app on it is one more
client. The server can also run outside Docker, on a Mac or a Linux machine
(`scripts/setup-mac.sh`, `scripts/install-service.sh`); Docker is the main path.

## The shape

```
packages/shared          the API contract (zod schemas + pure helpers)
  └── imported by the server, the app and every client package

packages/replica         a device's copy of the library in the bucket: session,
                         replica, outbox, the routes that answer from it, and
                         joining the shared server

packages/client          what the app shares across platforms: API client, React
                         Query hooks, download queue, auto-mix rules, theme
                         tokens, and the ports each platform implements

apps/server
  main.ts                boot, shutdown, signals
  config.ts              env → validated, frozen config object
  hub/                   a library (workspace) per account that joined; routing by token
  shared.ts              what every library on the machine shares: the model, YouTube's pace
  container.ts           composition root for one library: constructs everything, once
  start.ts               one library's background work
  app.ts                 express wiring, middleware order
  http/                  route helper, error handling, range requests, the admin page
  db/                    connection, migrations, row types
  storage/               StorageDriver interface + the local inbox folder
  bucket/                CloudStore: Backblaze through the doorman, S3 with a key, a folder
  repositories/          all SQL lives here, nowhere else
  services/              behaviour: scanning, metadata, lyrics, imports, publishing
  ai/                    the smart features, against an OpenAI-compatible endpoint
  sound/                 the listening model (CLaMP 3 on onnxruntime)
  routes/                thin — validate, call a service, return
  cli.ts, cli/           the `selfmp3` command: start, scan, import, backup, doctor
  public/                the page it serves on :4600: hand-written HTML, CSS and
                         JS, an admin page for the server and nothing else

apps/app                 one Expo app for iOS, Android and the web (Foundations and Stack, below)
  app/                   expo-router file routes, one per screen
  src/features/          a folder per screen or tool; each model file is pure and tested
  src/ports/             what differs by platform: engine, offline store, prefs,
                         secrets, cloud platform, device; `name.ts` on a phone,
                         `name.web.ts` in a browser
  src/connection/        which library answers, and reaching the server directly
  src/replica/           the device's copy of the bucket, wired to packages/replica
  src/player/            queue (from packages/shared), engine port, provider (React glue)
  src/offline/           downloads, the saved library, the listen outbox
  src/shell/             the width-decided frame: tab bar or sidebar, mini player or bar
  src/ui/                components, icons, the Unistyles theme
  sw/sw.ts               service worker, bundled to public/sw.js by esbuild
  public/                manifest, icons: copied into the web export as they are
  targets/widget/        the iOS home-screen widgets, in SwiftUI

apps/doorman             Cloudflare Worker: Google sign-in, bucket access, grants,
                         who may sign in, listening rooms, shared playlists, share links

apps/extension           the Chrome extension, which hands a link to the server

packages/desktop-bridge  the contract between the desktop app's shell and the page:
                         channel names, a zod schema for every argument and every
                         reply, and the application menu as data

apps/desktop             the Electron shell around apps/app's web export
  src/main/              the shell: window and bounds, `app://` with byte ranges,
                         files on disk, keychain, menu, Dock, deep links, updates
  src/preload/           the only door — `contextBridge`, and nothing of Node
                         reaches the page
  scripts/               esbuild bundling, the icon, and the signing tiers
  verify/                Playwright against the built app
```

The desktop app is a *shell*, not a fourth client. The page inside it is
`apps/app`'s web export byte for byte — the same one Pages serves — and
everything a window can do that a tab cannot goes through a port in
`src/ports/`, the same mechanism that separates a phone from a browser. See
[features/desktop-app.md](features/desktop-app.md).

---

## Decisions worth explaining

### The contract is shared code, not documentation

`packages/shared` holds zod schemas. The server validates incoming requests with them; the
client parses responses with the same ones. There is no hand-written type on either side
that can drift.

The concrete payoff: rename a field in `SongSchema` and the build breaks in both apps
immediately, with the exact lines. The alternative — types on one side, validation on the
other — fails silently on a phone, weeks later.

### Layers, strictly

`routes → services → repositories → database`

A route validates input and returns a value. A service holds behaviour. A repository holds
SQL. **No SQL exists outside `repositories/`**, so a schema change has one blast radius.
Routes never touch the database directly, so any route can be tested by handing it a
container built on an in-memory SQLite.

### The composition root

`container.ts` constructs every dependency once and passes them explicitly. Nothing reaches
for a global or a singleton. This is slightly more typing and it buys two things: the
construction order is visible in one place, and swapping any piece for a fake in a test is
a one-line change.

### Storage is an interface

`StorageDriver` — `exists`, `stat`, `read`, `write`, `delete`, `list`, `rangeSource`,
`localPath` — is the inbox folder; `CloudStore` — `head`, `get`, `put`, `list`, `delete`,
`range`, and the change counter — is the bucket. Local disk implements the first; the
doorman's store (`bucket/doorman.ts`, what a workspace uses, through its grant),
`S3CloudStore` (a bucket reached with its own key) and a folder (`bucket/local.ts`, for the
dev profile and the verify lanes) implement the second, and the sync cannot tell them apart.
`localPath` always has an answer, so tools that need a real filesystem path (ffmpeg, the tag
reader) take the file where it is.

### Range requests get their own module and the most tests

`packages/shared/src/range.ts` is small and disproportionately important. Seeking in a track
is a `Range:` header; get the 206 response wrong and iOS Safari refuses to play at all — not
"plays badly", *refuses*. The failure mode is remote, silent and miserable to debug, so the
rule is isolated, pure, and covered thoroughly.

It is shared because three places answer the header: the server (`http/range.ts`, the
Express glue), the desktop shell's `app://` protocol, whose `net.fetch` of a file ignores
`Range:`, and the service worker, because the Cache API returns whole responses and
something has to slice them when the player asks for bytes 500–999 of a cached file. One
parser, tested once.

### The server keeps no permanent copy of the library

The bucket is the library (docs/SYNC.md), and the folder the server works in is an inbox:
an import lands there, a file dropped there is an import, and once a song is wholly in the
bucket and analysed the cloud pass deletes the copy. There is no `missing` state, because
"the audio is not on this disk" is the ordinary state of every song, and there is no "keep
the file" when removing one, because a copy left in the folder is a new song to the next
sweep — which is how forty-three removed songs came back one evening. A song's audio comes
from the bucket when the server wants it: analysis fetches it to a temp file, and the stream
route forwards ranges to the bucket.

The row is what survives. Tags, play counts and playlist places belong to the song, not to
any file, and a song leaves the library only when someone removes it. The rows themselves
are the snapshot's: the server's database is a working copy of the bucket, and a workspace
whose folder is lost takes its library back from the bucket at its next start.

### Play events, not just counters

`play_events` stores a row per play. `songs.play_count` is also maintained, because smart
playlists and sorting want a cheap number.

Keeping the events means stats can answer questions nobody has asked yet — hourly
distribution, streaks, "what did I listen to in March" — without the underlying data having
already been thrown away. A counter is lossy the moment you write it.

The events go to the bucket too, so the server is not the only place they are kept: one
gzipped file a month, `lyrics/<sha256>.plays`, named in the snapshot, this month's at most
once an hour (`services/playsArchive.ts`, `#uploadPlays` in `services/cloudSync.ts`). A
workspace taking on a library reads them back before it publishes anything. Stats are still
worked out on the server, from its `play_events`, which is why a device asks the server for
them directly.

### The import queue is a table

Jobs live in `import_jobs`, not a `Map`. Forty queued downloads survive a server restart,
another device can watch progress, and a job orphaned by a crash is requeued at boot rather
than lost.

The worker is pull-based: after each job finishes it asks the database for the next one. No
coordination is needed between the HTTP layer and the worker, and a job added by your phone
gets picked up by the same loop.

### Live playlist rules have one evaluator

`packages/shared/src/smartRules.ts` (`livePlaylistSongs`) decides which songs a live
playlist holds and in what order, on every side: a device runs it over its snapshot, and the
server (`repositories/playlists.ts`) over its own songs, read once per change to the
database. No query string is ever built from a rule. The server once compiled rules to SQL,
and the two copies disagreed — about what a song with words is, until its words were up —
so now only the facts each side feeds in can differ, and they are the snapshot's: a song
"has lyrics" or "has art" when the bucket has them. `cloudIngest.test.ts` runs every
kind of rule, sort and limit on the server and over the snapshot it publishes and expects
the same songs.

The rule types are a discriminated union and every switch over them ends in
`assertNever`, so adding a variant to the shared schema stops the evaluator compiling
until the new case is handled.

### The player is three pieces, deliberately

- `apps/app/src/ports/engine.web.ts` — imperative, framework-free, owns two `<audio>`
  elements. On a phone, `engine.ts` beside it wraps react-native-track-player instead.
- `packages/shared/src/queue.ts` — pure functions, no side effects, fully tested, and the
  same rules on every platform.
- `apps/app/src/player/PlayerProvider.tsx` — the React glue, plus reporting plays and
  telling the operating system what is playing.

Two elements rather than one is what makes gapless and crossfade possible at all: by the
time `ended` fires on a single element, the gap has already happened. The next track is
loaded and buffered in the second element ahead of time, and the handover is either instant
or an equal-power volume ramp.

Keeping the queue rules pure means every awkward ordering question — shuffle that preserves
the current track, restoring the original order, "play next" versus "add to queue" — is
testable without mounting a component or touching audio.

### The whole library in one response

`GET /api/library` returns every song, tag and playlist. No pagination. On a device it is
answered from the device's copy of the bucket's snapshot (`packages/replica/src/routes.ts`),
which is itself the whole library in one file.

For a personal library — a few thousand songs at most — this is both simpler and faster
than paginating: the client filters, sorts and searches locally with zero round trips, and
the device keeps the entire payload for offline use. Pagination would add complexity to buy
nothing at this scale. If a library ever got to six figures this would be the first thing to
revisit.

### Only an installed app keeps songs

A browser tab streams and keeps nothing it shows as kept; the phone app and the desktop app
download, and what they hold is always visible and countable in Settings
(`ports/install.web.ts` decides which this is, from the presence of the desktop bridge). The
one thing a tab's service worker does hold is the last ten songs it played, whole, so that a
seek or a replay is not another request to the bucket (docs/SYNC.md, "Caps"): the worker's
own, let go oldest first and at sign-out, and never counted as a download.

A tab that quietly copied a library it was only streaming would fill a disk nobody asked it
to fill, and its storage is the browser's to evict anyway, so nothing there is worth
promising. In an app that does keep songs, the rule is still that it happened on purpose —
an automatic pass, or a song asked for by hand — never "whatever you happened to play".
Metadata goes to IndexedDB; audio goes to the Cache API on the web, because a cached
`Response` can be handed straight to an `<audio>` element by the service worker without ever
passing through JavaScript memory.

### The server is a worker, and its page says so

The bucket is the library. That makes the server one of the things that writes
to it — it imports, sweeps its inbox, analyses and publishes — rather than the
place every device points at. It serves no app: the app is on GitHub Pages, on
the phone and in the desktop app, and a device signs in with Google and reads
the library wherever the page came from. An app served from the server would
answer from the server's database rather than the bucket, a surface with no
sign-in. The page on `:4600` is an admin page instead (`http/admin.ts`,
`apps/server/public/`): hand-written HTML, CSS and JS, no build step, the
library count, the cloud connection and **Publish now** for the library a
request reaches. With no bucket connected, a library's API refuses everything
but connecting one: there is no library to serve.

What only the server can do, a device asks it for directly: Import (yt-dlp runs
there), Stats and the Report (worked out from `play_events`), metadata lookup
(the server asks iTunes and MusicBrainz), Ask and the other smart features, and
presence for handoff. The device finds the server by the addresses in its
bucket's snapshot — its LAN addresses and its public `https://` one
(`SELFMP3_PUBLIC_URL`, a Tailscale Funnel on Xiao's Pi) are raced, and the first
to answer as the server the snapshot names wins (`connection/useServerDirect.ts`;
docs/SYNC.md, "An answer has to be from the right server"). When none answers, the screen
is still drawn and says why (`connection/ServerAway.tsx`); an import is left in
the bucket for the server to take later. The bucket answers everything else, so
playing, browsing and editing never wait for the server.

### One server for everyone: the hub

A server works for every Google account that asks it to, not for one library
(`apps/server/src/hub/`, [features/shared-server.md](features/shared-server.md)).
Each account that joins gets a **workspace**: a whole container — its own
database, inbox, sync and import queue — under `<data>/accounts/<id>/` and
`<library>/<id>/`, publishing to that account's bucket through a **grant**, a
revocable doorman session the account gave the server. A request finds its
workspace by the token it carries, which is the workspace's own and reached the
device in its bucket's snapshot, so a device talks to its library exactly as it
would to a server of its own.

What the workspaces share is what is heavy or belongs to the machine
(`shared.ts`): the listening model, one analysis at a time, YouTube's pace,
MusicBrainz's pace. Every workspace's folders are a cache of its bucket, plays
included, so the only state the server keeps of its own is `<data>/hub.json`:
who joined, their tokens and their grants. Delete a workspace's folder and it is
rebuilt from the bucket; delete `hub.json` and each account joins again.

Joining needs no button. A signed-in device whose bucket names no server joins
the shared one, whose address the app knows as it knows the doorman's
(`DEFAULT_SERVER_URL` in `packages/shared/src/cloud.ts`;
`packages/replica/src/sharedServer.ts`). Who may sign in at all is the doorman's
to decide: its owners, and a list the owner keeps in Settings.

With a folder for a bucket (`SELFMP3_CLOUD_DIR`: the dev profile, the verify
lanes) there are no accounts, and the hub holds one library in the data folder
itself.

### The service worker is hand-written

Workbox would generate most of this, but not the part that matters: slicing a cached
response into a 206 for range requests. Since that is the whole reason offline playback
works on iOS, the file is written by hand and the three caching strategies are explicit —
cache-first for the shell, cache-first-with-range for audio, network-first for the API.

---

## Foundations

The rules that keep `apps/app` cheap to extend. They were written when the
separate web and phone apps were folded into one Expo app (September 2026), and
code comments cite them by number. Where a rule can be enforced by a tool, it is.

**1. No platform in packages.** `packages/replica`, `packages/client` and
`packages/desktop-bridge` compile without the DOM library, so a reach for
`window` fails at build time. `packages/shared` has the DOM library for one
name, `URL`, and touches nothing else of a browser. If a package needs the
platform, it declares an interface and the app supplies it — the pattern
`packages/replica/src/platform.ts` uses for `CloudFetch` and `DeviceStore`.
*Enforced by:* `"lib": ["ES2023"]` in each package's tsconfig.

**2. Every platform difference is a named port.** A port is a pair of files in
`apps/app/src/ports/` — `name.ts` for a phone, `name.web.ts` for a browser and
the desktop app, resolved by Metro's platform extensions — often implementing
an interface declared in a package. Screens never read `Platform.OS` for behaviour; they read
the port's declared capabilities. Adding a platform later (a desktop shell, a
TV) means implementing the ports, not touching screens. *Enforced by:* an
ESLint rule forbidding `Platform.OS` outside `src/ports/` and `src/shell/`.

**3. One folder per feature; the model file imports no UI.** A feature lives
in `apps/app/src/features/<name>/`: its screen, its components, and a
`<name>.model.ts` hook that holds every piece of state and behaviour. The
model file imports from `packages/*` and React only — never from
`react-native`, `expo-*`, a port or a component — so vitest runs it with no
simulator, and the screen is a thin renderer of it. Adding a feature is one
folder. *Enforced by:* `no-restricted-imports` on `**/*.model.ts`; vitest runs
the app's `.test.ts` files and jest-expo its `.test.tsx` ones.

**4. One design token source.** Colours are OKLCH lightness/chroma/hue triples
in one file (`packages/client/src/theme/tokens.ts`), resolved to hex by the
converter beside it. Spacing, radii, type scale, motion durations and the 820-point
breakpoint live beside them. Unistyles builds the light and dark themes from
that file; the accent hue is a runtime theme change. The one copy
in CSS, `tokens.reference.css`, is held to it. *Enforced by:* the token-parity
test in `packages/client/src/theme/tokens.test.ts`.

**5. Layout responds to width.** A component is written once with breakpoint
variants, not as a phone version and a desktop version. Where the two really
are different objects (a popover versus a sheet), the component decides at the
breakpoint and the caller does not know.

**6. Interaction follows the input, not the device.** Hover reveals, right-click
menus and keyboard shortcuts exist wherever there is a pointer or a keyboard;
long-press and swipe exist wherever there is a finger. `ports/pointer.ts` and
`ports/keyboard.ts` report which are present, and `useLayout()` passes the
pointer's answer on as `finePointer`. An iPad with a keyboard gets both.

**7. Features declare their platforms.** Each note in `docs/features/` should
have a "Where" line: which platforms carry the feature and, when one does not, why
(no widget on Android; no crossfade on a phone).

**8. Tests at the layer that can run them.** Pure logic and model files:
vitest, as now. Components and screens: `jest-expo` with React Native Testing
Library, which renders them without a device. Smoke flows: Maestro on the
phone, Playwright on the web. Nothing UI-shaped is left with zero coverage.

---

## Stack

| Concern | Choice | Why, and what was rejected |
|---|---|---|
| Framework | Expo SDK 57, React Native 0.86, New Architecture | Already what the phone runs on. Web target is Metro with `react-native-web` 0.21, which Expo bundles for this SDK and which is the mainstream universal path in 2026. |
| Routing | expo-router | File routes work on all three platforms and give the web real URLs. One `Stack` in `app/_layout.tsx`; the phone's floating tab bar and the computer's sidebar are the shell's own (`src/shell/Shell.tsx`, from `shell/nav.model.ts`), so both widths draw from one list of places. Web output stays `single`: `static` would need every `playlist/[id]` pre-rendered, and playlist ids are runtime data. |
| Styling | Unistyles 3 | Closest to what exists: tokens plus `StyleSheet`. On web it emits real CSS classes with media queries and `:hover` / `:focus` / `:active`, and themes switch without re-rendering. Needs the New Architecture, which is on. *Tamagui* rejected: it brings its own component kit and compiler, and the app has its own design system. *NativeWind / Uniwind* rejected: Tailwind's vocabulary would replace the OKLCH tokens rather than express them; if Tailwind is ever wanted, Uniwind (same authors) is the one to evaluate. |
| Lists | `FlatList` behind a `SongList` component | One component, so the choice of list can change in one file and no screen knows. FlashList v2 was tried and drew well, but on the phone its recycled cells stopped exposing accessible content after a data change, which broke VoiceOver and the smoke flow; `SongList.tsx` says what to re-test before trying it again. |
| Data | `@tanstack/react-query` | No other state library: player and offline state live in their providers. |
| Audio, web | a two-`<audio>` engine | Behind the engine port. Gapless, crossfade, analyser. |
| Audio, native | react-native-track-player 5 | Already in place. Gapless, lock screen, Android Auto. It is an alpha. **Fallback:** `expo-audio`, which in SDK 57 does background playback and lock-screen controls on both platforms; it lacks a native queue (so gapless) and Android Auto, and it is a second `engine.native.ts`, not a rewrite. |
| Listening before importing, native | `expo-audio`, a player of its own | A preview on the review is not a song in track-player's one queue, and the web plays it in an audio element apart from the player (`ports/listen.web.ts`); the phone does the same through `expo-audio` (`ports/listen.ts`), told to leave the audio session, which is track-player's, alone, and given each stream through `preload` so opening it never holds the JavaScript thread. The playing row's colour comes from the server (`GET /api/import/cover-tone`, services/previewCoverTone.ts), which reads the cover as it reads the library's. Not a second engine: no queue, no lock screen. |
| Offline, web | Cache API + service worker | Behind the offline port; the desktop app keeps files instead, through its bridge. |
| Service worker build | esbuild | The worker is one file with no imports, bundled to `public/sw.js` before `expo export`, which copies `public/` as it is. Metro cannot emit a separate worker entry. |
| Offline, native | files + JSON index | Behind the same port. |
| Icons | `react-native-svg` | One file for all three platforms. |
| Canvas work | A port twin per platform, sharing its model | The song visual is a canvas in a browser (`SongVisual.web.tsx`) and views moved by Reanimated on a phone (`SongVisual.tsx`), and both step the same `visualMotion.model.ts`. Expo DOM components (`'use dom'`) were the plan; a webview turned out to cost more than a second drawing, and nothing in the app uses one. |
| Tests | vitest for packages and model files, jest-expo + RNTL for the app, Maestro and Playwright for flows | See foundation 8. Vitest cannot yet run React Native components; Jest stays for those. |
| Repo tooling | npm workspaces, as now | pnpm + Turborepo is the 2026 default, and it is deliberately not adopted here: `docs/MOBILE.md` records how fragile the lockfile already is around React singletons, and a solo project gains nothing from a cached task graph. Revisit only when CI time hurts. |
| Desktop shell | **Electron 44.3.0** (Chromium 152, Node 24; macOS 13 or newer) | The installed desktop app wraps `apps/app`'s web export rather than drawing a second UI. One rendering engine on every OS, TypeScript end to end, and the four things the shell needs are all first-party: `protocol.handle` for `app://` with `Range`, `safeStorage` for the keychain, `navigator.mediaSession` for macOS Now Playing, `setAsDefaultProtocolClient` for the `selfmp3://` sign-in return. Tauri 2, react-native-macos and Mac Catalyst rejected; the reasoning is in [features/desktop-app.md](features/desktop-app.md). Pinned exactly: Electron ships a major every eight weeks and an upgrade is a commit of its own. |
| Desktop packaging | **electron-builder 26.15.3** | `dmg` and `zip` for macOS (arm64, x64), with `nsis` and `AppImage` listed and unbuilt. Electron Forge rejected as more than this needs. The shell has no runtime `dependencies` — esbuild bundles everything but `electron` — which is what sidesteps electron-builder's known trouble collecting workspace-hoisted packages (electron-builder #2205, #9654). |
| Desktop updates | **electron-updater 6.8.9**, from GitHub Releases | The only updater that needs no server. Squirrel on macOS refuses to apply an update to an ad-hoc signature (electron #36640), so unsigned builds only check the latest release's tag and open its page. Which tier a build is gets baked in by `apps/desktop/scripts/build.mjs`, because there is no API that asks a running app whether its own signature is one macOS would validate — and `canInstall` on the status is how the page knows never to draw a button that would fail. |
| The desktop contract | **`packages/desktop-bridge`**: zod schemas plus the `DesktopBridge` interface | The repository's rule that a contract is shared code, not documentation. `apps/desktop` implements it and `apps/app` consumes it, so a channel renamed on one side is a compile error on the other. No new dependency of its own: zod is already here. Compiled without the DOM library, like every other package. |
| Media session | **`navigator.mediaSession`**, behind a `MediaSessionPort` | Chromium bridges it to `MPNowPlayingInfoCenter` and the media keys on macOS, SMTC on Windows and MPRIS on Linux, so one web file serves the desktop app and a phone's browser alike. The native file is a no-op: track-player owns the lock screen. `globalShortcut` is not used for media keys — on macOS it registers and never fires while Electron's `HardwareMediaKeyHandling` is on (electron #20788), and turning that off would lose the Now Playing panel. |
| Electron tests | **Playwright `_electron`** (1.63, already here) | The smoke flow launches the *built* app, so the product is what is tested. `app.evaluate` reads the main process directly, which is how a 206 from `protocol.handle` is observed rather than inferred. The main process's pure modules — the range answer, the download index, the menu model, the update rule — run in the root vitest. |
| Desktop icon | **sharp**, the version `apps/server` already pins | One PNG at 1024 rendered from `apps/app/public/icons/icon.svg` by `apps/desktop/scripts/icon.mjs`; electron-builder makes the `.icns` and the `.ico` from it. Not a new dependency — the server has used sharp for cover art since before this — and rendering rather than keeping a second copy is what stops the app's mark drifting from the favicon's. Generating the container formats here would have meant macOS's `iconutil`, which CI's Linux runners do not have. |

Version notes: Unistyles 3 requires `react-native-nitro-modules` and a dev
client rebuild, which the project already does for track-player.
`react-native-web` 0.21 supports React 19.2. Both are pinned by Expo's
`bundledNativeModules.json`; run `npx expo-doctor` after adding them.

## The ports

Each is a `name.ts` / `name.web.ts` pair in `apps/app/src/ports/`. The main ones, and the
interface each implements where a package declares one:

| Port | What it hides | Web and desktop | Phone |
|---|---|---|---|
| `engine` (`PlaybackEngine`, packages/client) | load, play, pause, seek, volume, queue-ahead, events | two `<audio>` elements, Web Audio analyser, crossfade | track-player: native queue, lock screen, remote events |
| `downloadStorage` (`DownloadStorage`, packages/client) | is it here, fetch it, remove it, usage, progress | Cache API and the service worker in a tab; files through the bridge in the desktop app | `expo-file-system` + JSON index |
| `cloudPlatform` (`CloudPlatform` and `DeviceStore`, packages/replica) | the device's copy of the library, its session, small persistent values | IndexedDB | files |
| `events` (`ServerEventStream`, packages/client) | the server's event stream | `EventSource` | the same stream over `XMLHttpRequest` |
| `mediaSession` | what the operating system shows for the song | `navigator.mediaSession` (Now Playing and the media keys in the desktop app) | a no-op: track-player fills the lock screen |
| `shareLink` | handing a link to someone | `navigator.share`, else the clipboard | React Native's `Share` |
| `install` | whether this is an installed app, which keeps songs | true only in the desktop app | true |
| `pointer`, `keyboard` | which inputs are present | from media queries | a finger |
| `widget` | the iOS home-screen widget's snapshot | nothing | `widget.ios.ts`; nothing on Android |

The engine port declares capabilities — `crossfade`, `analyser` — and the visual and the
settings page read them. A control for something the platform cannot do is not rendered.

## What does not port one-to-one

What React Native does differently from the DOM, and what the app does about
each.

- **Container queries and `min()`-sized artwork.** The now-playing pages size
  the cover from the room left over. React Native has `onLayout`; the shell
  works the page column out from the window and what stands beside it, and
  passes it down.
- **Tooltips.** Hover-only; web-only. An element carries its caption as
  `data-tip` (`ui/tip.ts`), and the shell's `TooltipHost.web.tsx` draws it;
  `TooltipHost.tsx` on a phone draws nothing.
- **Popovers anchored to a button.** React Native has no `position: fixed`. A
  `Popover` primitive measures its anchor with `measureInWindow` and the
  shell's overlay host draws it there. A right-click's point stands in for the
  button (`ui/rightClick.ts`). Below the breakpoint, or with nothing to anchor
  to, it is a `Sheet`.
- **Range inputs.** The scrubber is one `SeekBar` everywhere, stepping by a
  fixed number of seconds from the keyboard or a screen reader.
- **The service worker.** A separate esbuild step to `public/sw.js`,
  registered through `ports/serviceWorker.web.ts` from `app/_layout.tsx`. Expo's
  web export copies `public/` as it is.
- **Static HTML per route.** Not used: `playlist/[id]` cannot be pre-rendered
  for ids that only exist at runtime. The export stays a single-page app, and
  the Pages workflow keeps its 404 redirect.
- **Crossfade and the analyser.** Web only, declared as engine capabilities.
  The native engine reports `crossfade: false`, and the phone's visual follows
  a motion curve the server worked out and left in the bucket instead.
- **Reveal in Finder.** Only the desktop app, for its downloads folder.
- **Canvas drawings.** The song visual is drawn twice — a canvas in a browser,
  Reanimated views on a phone — from one shared model of the motion. Written as
  a `'use dom'` webview first, it was cheaper to draw than to embed. The
  Report's cards and the energy wave are plain views and SVG at every width.
- **Hover reveals in rows.** `Pressable` on web reports hover; rows show their
  controls on hover where there is a pointer and always where there is not.

---

## Testing

Tests sit next to the code they cover. Where each kind runs:

| Kind | Runs in | What |
|---|---|---|
| Pure logic, the server, the packages, the app's model files | Vitest (`npm test`) | Every `*.test.ts` under `packages/` and `apps/*/src/` |
| The app's components and screens | jest-expo with React Native Testing Library (`npm run test:app`) | Every `*.test.tsx` in `apps/app` |
| Flows in a browser, at computer and phone width | Playwright (`npm run verify:flows`) | `verify/flows/`, against `npm run dev` |
| The desktop app and the extension | Playwright (`verify:desktop`, `verify:extension`; `e2e.yml` in CI) | `apps/desktop/verify/`, `apps/extension/verify/` |
| Flows on a phone | Maestro, on a simulator | `apps/app/.maestro/` |

A few areas get more than their share, and why:

| Area | Why it is tested the way it is |
|---|---|
| `range.ts` (`packages/shared`) | Highest bug density, worst failure mode, purely functional |
| `queue.ts` | All the awkward ordering rules, no mocking required |
| `smartRules.ts` | One evaluator for every side; `cloudIngest.test.ts` holds the server to it over its real database |
| `cloudSync.test.ts` | Publishing, taking a library on, plays in the bucket: what would lose data if wrong |
| `hub/hub.test.ts` | Joining, routing by token and letting go, against the real doorman over HTTP |
| `lrc.ts` | The format is loose in the wild; fixtures are synthetic placeholder text |
| `format.ts` | Cheap, and formatting bugs are visible to the user everywhere |
| `services/metadata.ts` | Filename parsing has a long tail of real-world shapes |

Run `npm run check` for every typecheck, lint and test, as CI does.

---

## Things deliberately not done

- **No account, no password, no session on the server.** Google, through the doorman, is
  the only sign-in. What guards each library's API is a bearer token of its own
  (`apps/server/src/hub/registry.ts`), published into that account's bucket, so every device
  signed in to the account is given it and nobody types anything. Joining is the one moment
  the server sees a doorman session, and it trades it for a grant at once. A request from
  the server's own machine with no token goes to the only library when there is only one,
  since whoever is there can read `hub.json` anyway (`apps/server/src/http/local.ts`).
- **No ORM.** Hand-written SQL in typed repositories. At this size an ORM adds a layer of
  indirection over queries that are already short and readable.
- **No CSS framework.** Styles are Unistyles sheets built from the tokens in
  `packages/client/src/theme/tokens.ts` — one set of values for the browser, the phone and
  the desktop app. A framework would be larger than the styles it replaced, and would not
  cross to React Native.
- **No chart library.** Three chart forms, hand-drawn as SVG. A charting library would
  outweigh the rest of the app on a page that has to load over a phone connection.
- **No state management library.** TanStack Query for server state, React state for UI
  state. There is no third category here.

---

## If you extend it

**A new API field:** add it to the schema in `packages/shared`, then follow the compile
errors. They will take you to every place that needs updating.

**A new smart-playlist rule:** add the variant to `SmartRuleSchema`, then handle it in
`packages/shared/src/smartRules.ts` — each switch there ends in `assertNever`, so nothing
compiles until you do. Add a case to `smartRules.test.ts`; `cloudIngest.test.ts` then holds
the server and the snapshot to the same answer.

**A schema change:** append a migration to the array in `db/migrate.ts`. Never edit an
existing entry, never renumber — the array index *is* the version.

**A dropdown, a menu, or anything that floats:** use `apps/app/src/ui/components/Select.tsx`
and `Popover.tsx` rather than a native `<select>` or a hand-rolled popover, and take
z-index, radii, durations and the focus ring from the tokens. See
[docs/features/design-system.md](features/design-system.md).

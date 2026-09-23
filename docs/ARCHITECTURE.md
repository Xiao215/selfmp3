# Architecture

Notes on how this is put together and, more usefully, *why*. Written for whoever
touches this next — most likely you, six months from now.

---

## The shape

```
packages/shared          the API contract (zod schemas + pure helpers)
  └── imported by the server, the app and every client package

packages/replica         a device's copy of the library in the bucket: session,
                         replica, outbox, the routes that answer from it

packages/client          what the app shares across platforms: API client, React
                         Query hooks, download queue, practice and auto-mix rules,
                         theme tokens, and the ports each platform implements

apps/server
  main.ts                boot, shutdown, signals
  config.ts              env → validated, frozen config object
  container.ts           composition root: constructs everything, once
  app.ts                 express wiring, middleware order
  http/                  route helper, error handling, range requests
  db/                    connection, migrations, row types
  storage/               StorageDriver interface + local and s3 implementations
  repositories/          all SQL lives here, nowhere else
  services/              behaviour: scanning, metadata, lyrics, imports
  routes/                thin — validate, call a service, return
  public/                the page it serves on :4600: hand-written HTML, CSS and
                         JS, the server's setup and status and nothing else

apps/app                 one Expo app for iOS, Android and the web (Foundations and Stack, below)
  app/                   expo-router file routes, one per screen
  src/features/          a folder per screen or tool; each model file is pure and tested
  src/ports/             what differs by platform: engine, offline store, prefs,
                         secrets, cloud platform, device; `name.ts` on a phone,
                         `name.web.ts` in a browser
  src/player/            queue (from packages/shared), engine port, provider (React glue)
  src/offline/           downloads, the saved library, the listen outbox
  src/shell/             the width-decided frame: tab bar or sidebar, mini player or bar
  src/ui/                components, icons, the Unistyles theme
  sw/sw.ts               service worker, bundled to public/sw.js by esbuild
  public/                manifest, icons: copied into the web export as they are

apps/doorman             Cloudflare Worker: Google sign-in and bucket access for devices

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

`StorageDriver` — `stat`, `read`, `write`, `list`, `rangeSource`, `signedUrl`, `localPath` —
is the inbox folder; `CloudStore` — `head`, `get`, `put`, `list`, `delete`, `range` — is the
bucket. Local disk implements the first; `S3CloudStore`, the doorman's store and a folder
(`bucket/local.ts`, for the dev profile and the verify lanes) implement the second, and the
sync cannot tell them apart. `localPath` returning `null` is the honest escape hatch: tools
like `ffprobe` need a real filesystem path, so those code paths know to buffer instead.

### Range requests get their own module and the most tests

`http/range.ts` is small and disproportionately important. Seeking in a track is a `Range:`
header; get the 206 response wrong and iOS Safari refuses to play at all — not "plays
badly", *refuses*. The failure mode is remote, silent and miserable to debug, so it is
isolated, pure where it can be, and covered thoroughly.

The service worker duplicates a version of this logic in `sw.ts`, because the Cache API
returns whole responses and something has to slice them when the player asks for bytes
500–999 of a cached file.

### The server keeps no copy of the library

The bucket is the library (docs/SYNC.md), and the folder the server works in is an inbox:
an import lands there, a file dropped there is an import, and once a song is wholly in the
bucket and analysed the cloud pass deletes the copy. There is no `missing` state, because
"the audio is not on this disk" is the ordinary state of every song, and there is no "keep
the file" when removing one, because a copy left in the folder is a new song to the next
sweep — which is how forty-three removed songs came back one evening. A song's audio comes
from the bucket when the server wants it: analysis fetches it to a temp file, and the stream
route forwards ranges to the bucket.

The row is what survives. Tags, play counts and playlist places belong to the song, not to
any file, and a song leaves the library only when someone removes it.

### Play events, not just counters

`play_events` stores a row per play. `songs.play_count` is also maintained, because smart
playlists and sorting want a cheap number.

Keeping the events means stats can answer questions nobody has asked yet — hourly
distribution, streaks, "what did I listen to in March" — without the underlying data having
already been thrown away. A counter is lossy the moment you write it.

### The import queue is a table

Jobs live in `import_jobs`, not a `Map`. Forty queued downloads survive a server restart,
another device can watch progress, and a job orphaned by a crash is requeued at boot rather
than lost.

The worker is pull-based: after each job finishes it asks the database for the next one. No
coordination is needed between the HTTP layer and the worker, and a job added by your phone
gets picked up by the same loop.

### Live playlist rules compile to parameterised SQL

`services/smartPlaylist.ts` is the only place in the server that builds a query string from
user input, so it follows two rules absolutely:

1. Every user **value** is a bound parameter.
2. Every user **identifier** (column, sort field, direction) is looked up in a fixed map. If
   it is not in the map, it does not exist.

The rule types are a discriminated union and every switch over them ends in
`assertNever`, so adding a variant to the shared schema makes this file — and the
in-memory matcher in `packages/shared/src/smartRules.ts` — stop compiling until the new
case is handled. The tests run the generated
SQL against a real in-memory database — asserting on the SQL *string* would be brittle and
would not prove the query is even valid.

### The player is three pieces, deliberately

- `apps/app/src/ports/engine.web.ts` — imperative, framework-free, owns two `<audio>`
  elements. On a phone, `engine.ts` beside it wraps react-native-track-player instead.
- `packages/shared/src/queue.ts` — pure functions, no side effects, fully tested, and the
  same rules on every platform.
- `apps/app/src/player/PlayerProvider.tsx` — the React glue, plus server sync and Media
  Session.

Two elements rather than one is what makes gapless and crossfade possible at all: by the
time `ended` fires on a single element, the gap has already happened. The next track is
loaded and buffered in the second element ahead of time, and the handover is either instant
or an equal-power volume ramp.

Keeping the queue rules pure means every awkward ordering question — shuffle that preserves
the current track, restoring the original order, "play next" versus "add to queue" — is
testable without mounting a component or touching audio.

### The whole library in one response

`GET /api/library` returns every song, tag and playlist. No pagination.

For a personal library — a few thousand songs at most — this is both simpler and faster
than paginating: the client filters, sorts and searches locally with zero round trips, and
the phone can mirror the entire payload into IndexedDB for offline use. Pagination would
add complexity to buy nothing at this scale. If a library ever got to six figures this
would be the first thing to revisit.

### Only an installed app keeps songs

A browser tab streams and keeps nothing; the phone app and the desktop app download, and
what they hold is always visible and countable in Settings (`ports/install.web.ts` decides
which this is, from the presence of the desktop bridge).

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
place every device points at, and the page it serves on `:4600` follows: the
library count, the Cloud section, **Publish now**, and where to go to listen.
Hand-written HTML, CSS and JS in `apps/server/public/`, a few hundred lines, no
build step. With no bucket connected the API refuses everything but connecting
one: there is no library to serve.

It used to serve `apps/app/dist` at every non-`/api` path instead, which meant
one deployment of the app was special — the one whose origin happened to be the
server's. That is exactly the thing the bucket removed: a device signs in with
Google and reads the library, wherever the page came from. Serving the app from
the server made the old shape look like it still worked, so it went, and
`SELFMP3_SERVE_WEB` and `SELFMP3_WEB_DIR` went with it.

`/api` is untouched by any of this. The browser extension still talks to a
server at its address, because only the server runs yt-dlp.

The cost is honest and current: **Stats, the Untagged inbox and metadata lookup
are server-only**, and the app hides them when its library is the bucket's.
Every surface is now cloud-only, so nothing draws them today. The routes are
still there and still tested; what is missing is a surface that asks.

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

**1. No platform in packages.** `packages/shared` and `packages/replica` already
compile without the DOM library, so a reach for `window` fails at build time.
The new `packages/client` follows the same rule. If a package needs the
platform, it declares an interface and the app supplies it — the pattern
`packages/replica/src/platform.ts` already uses for `CloudFetch` and
`DeviceStore`. *Enforced by:* `"lib": ["ES2023"]` in the package tsconfig.

**2. Every platform difference is a named port.** A port is an interface in a
package and a `.web.ts` / `.native.ts` pair in the app, resolved by Metro's
platform extensions. Screens never read `Platform.OS` for behaviour; they read
the port's declared capabilities. Adding a platform later (a desktop shell, a
TV) means implementing the ports, not touching screens. *Enforced by:* an
ESLint rule forbidding `Platform.OS` outside `src/ports/` and `src/shell/`.

**3. One folder per feature; the model file imports no UI.** A feature lives
in `apps/app/src/features/<name>/`: its screen, its components, and a
`<name>.model.ts` hook that holds every piece of state and behaviour. The
model file imports from `packages/*` and React only — never from
`react-native`, `expo-*` or a component — so vitest runs it with no
simulator, and the screen is a thin renderer of it. Adding a feature is one
folder. *Enforced by:* `no-restricted-imports` on `**/*.model.ts`, and a
vitest project that includes only those files.

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

**7. Features declare their platforms.** Each note in `docs/features/` gets a
"Where" line: which platforms carry the feature and, when one does not, why
(no server to import on; no pitch shifting on Android).

**8. Tests at the layer that can run them.** Pure logic and model files:
vitest, as now. Components and screens: `jest-expo` with React Native Testing
Library, which renders them without a device. Smoke flows: Maestro on the
phone, Playwright on the web. Nothing UI-shaped is left with zero coverage.

---

## Stack

| Concern | Choice | Why, and what was rejected |
|---|---|---|
| Framework | Expo SDK 57, React Native 0.86, New Architecture | Already what the phone runs on. Web target is Metro with `react-native-web` 0.21, which Expo bundles for this SDK and which is the mainstream universal path in 2026. |
| Routing | expo-router | Already in place. File routes work on all three platforms and give the web real URLs. `expo-router/unstable-native-tabs` gives the phone a real tab bar (Liquid Glass on iOS 26, Material on Android); `expo-router/ui` headless tabs drive the desktop sidebar from the same route files. Web output stays `single`: `static` would need every `playlist/[id]` pre-rendered, and playlist ids are runtime data. |
| Styling | Unistyles 3 | Closest to what exists: tokens plus `StyleSheet`. On web it emits real CSS classes with media queries and `:hover` / `:focus` / `:active`, and themes switch without re-rendering. Needs the New Architecture, which is on. *Tamagui* rejected: it brings its own component kit and compiler, and the app has its own design system. *NativeWind / Uniwind* rejected: Tailwind's vocabulary would replace the OKLCH tokens rather than express them; if Tailwind is ever wanted, Uniwind (same authors) is the one to evaluate. |
| Lists | FlashList v2 behind a `SongList` component | JS-only, built for the New Architecture, no size estimates. Web support is confirmed in the spike; if it falls short there, `SongList.web.tsx` uses `FlatList` and nothing else changes. |
| Data | `@tanstack/react-query` | Already on both sides; the hooks merge. No other state library: player and offline state live in their providers, as now. |
| Audio, web | the existing two-`<audio>` engine | Moved as-is behind the engine port. Gapless, crossfade, rate, pitch lock, analyser. |
| Audio, native | react-native-track-player 5 | Already in place. Gapless, lock screen, Android Auto, rate; pitch lock on iOS via `pitchAlgorithm`. It is an alpha. **Fallback:** `expo-audio`, which in SDK 57 does background playback and lock-screen controls on both platforms; it lacks a native queue (so gapless) and Android Auto, and it is a second `engine.native.ts`, not a rewrite. |
| Offline, web | Cache API + service worker | Existing code behind the offline port. |
| Service worker build | esbuild | The worker is one file with no imports, bundled to `public/sw.js` before `expo export`, which copies `public/` as it is. Metro cannot emit a separate worker entry. |
| Offline, native | files + JSON index | Existing code behind the same port. |
| Icons | `react-native-svg` | Already ported. One file for all three platforms. |
| Canvas work | A port twin per platform, sharing its model | The song visual is a canvas in a browser (`SongVisual.web.tsx`) and views moved by Reanimated on a phone (`SongVisual.tsx`), and both step the same `visualMotion.model.ts`. Expo DOM components (`'use dom'`) were the plan; a webview turned out to cost more than a second drawing, and nothing in the app uses one. |
| Errors | `@sentry/react-native` with its Expo plugin | A phone away from the server fails silently otherwise. One day of work; opt-in via an env var so the personal build can leave it off. |
| Tests | vitest for packages and model files, jest-expo + RNTL for the app, Maestro and Playwright for flows | See foundation 8. Vitest cannot yet run React Native components; Jest stays for those. |
| Repo tooling | npm workspaces, as now | pnpm + Turborepo is the 2026 default, and it is deliberately not adopted here: `docs/MOBILE.md` records how fragile the lockfile already is around React singletons, and a solo project gains nothing from a cached task graph. Revisit only when CI time hurts. |
| Desktop shell | **Electron 44.3.0** (Chromium 152, Node 24; macOS 13 or newer) | The installed desktop app wraps `apps/app`'s web export rather than drawing a second UI. One rendering engine on every OS, TypeScript end to end, and the four things the shell needs are all first-party: `protocol.handle` for `app://` with `Range`, `safeStorage` for the keychain, `navigator.mediaSession` for macOS Now Playing, `setAsDefaultProtocolClient` for the `selfmp3://` sign-in return. Tauri 2, react-native-macos and Mac Catalyst rejected; the reasoning is in [features/desktop-app.md](features/desktop-app.md). Pinned exactly: Electron ships a major every eight weeks and an upgrade is a commit of its own. |
| Desktop packaging | **electron-builder 26.15.3** | `dmg` and `zip` for macOS (arm64, x64), with `nsis` and `AppImage` listed and unbuilt. Electron Forge rejected as more than this needs. The shell has no runtime `dependencies` — esbuild bundles everything but `electron` — which is what sidesteps electron-builder's known trouble collecting workspace-hoisted packages (electron-builder #2205, #9654). |
| Desktop updates | **electron-updater 6.8.9**, from GitHub Releases | The only updater that needs no server. Squirrel on macOS refuses to apply an update to an ad-hoc signature (electron #36640), so unsigned builds only check the latest release's tag and open its page. Which tier a build is gets baked in by `apps/desktop/scripts/build.mjs`, because there is no API that asks a running app whether its own signature is one macOS would validate — and `canInstall` on the status is how the page knows never to draw a button that would fail. |
| The desktop contract | **`packages/desktop-bridge`**: zod schemas plus the `DesktopBridge` interface | The repository's rule that a contract is shared code, not documentation. `apps/desktop` implements it and `apps/app` consumes it, so a channel renamed on one side is a compile error on the other. No new dependency of its own: zod is already here. Compiled without the DOM library, like every other package. |
| Media session | **`navigator.mediaSession`**, behind a `MediaSessionPort` | Chromium bridges it to `MPNowPlayingInfoCenter` and the media keys on macOS, SMTC on Windows and MPRIS on Linux, so one web file serves the desktop app and a phone's browser alike. The native file is a no-op: track-player owns the lock screen. `globalShortcut` is not used for media keys — on macOS it registers and never fires while Electron's `HardwareMediaKeyHandling` is on (electron #20788), and turning that off would lose the Now Playing panel. |
| Electron tests | **Playwright `_electron`** (1.63, already here) plus **electron-playwright-helpers 3.1.2** | The smoke flow launches the *built* app, so the product is what is tested. `app.evaluate` reads the main process directly, which is how a 206 from `protocol.handle` is observed rather than inferred. The main process's pure modules — the range answer, the download index, the menu model, the update rule — run in the root vitest. |
| Desktop icon | **sharp**, the version `apps/server` already pins | One PNG at 1024 rendered from `apps/app/public/icons/icon.svg` by `apps/desktop/scripts/icon.mjs`; electron-builder makes the `.icns` and the `.ico` from it. Not a new dependency — the server has used sharp for cover art since before this — and rendering rather than keeping a second copy is what stops the app's mark drifting from the favicon's. Generating the container formats here would have meant macOS's `iconutil`, which CI's Linux runners do not have. |

Version notes: Unistyles 3 requires `react-native-nitro-modules` and a dev
client rebuild, which the project already does for track-player.
`react-native-web` 0.21 supports React 19.2. Both are pinned by Expo's
`bundledNativeModules.json`; run `npx expo-doctor` after adding them.

## The ports

Each is an interface in `packages/client`, implemented twice in `apps/app/src/ports`.

| Port | What it hides | Web | Native |
|---|---|---|---|
| `PlaybackEngine` | load, play, pause, seek, rate, volume, queue-ahead, events | two `<audio>` elements, Web Audio analyser, `preservesPitch`, crossfade | track-player: native queue, lock screen, remote events; `pitchAlgorithm` on iOS. Fallback: expo-audio |
| `OfflineStore` | is it here, fetch it, remove it, usage, progress | Cache API + service worker range slicing | `expo-file-system` + JSON index |
| `DeviceStore` | small persistent values | IndexedDB (exists in `packages/replica`) | files (exists) |
| `Keyboard` | global shortcuts, the command palette trigger | `document` keydown | no-op, or hardware keyboard on iPad later |
| `Share` | receive a shared link, share a wrapped card | Web Share Target, `navigator.share` | `expo-sharing`, an intent filter |
| `Files` | reveal a song's file | server endpoint (on the server itself only) | unavailable, declared |
| `Media session` | lock-screen metadata | `navigator.mediaSession` | track-player metadata |

The engine port declares capabilities — `crossfade`, `analyser`, `loop` — and
the practice panel, the visualiser and the settings page read them. A control for something the platform cannot do is not
rendered, and the settings page says why, the way the phone's About section
does for crossfade today.

## What does not port one-to-one

What React Native does differently from the DOM, and what the app does about
each.

- **Container queries and `min()`-sized artwork.** The now-playing pages size
  the cover from the room left over. React Native has `onLayout`; the shell
  measures once and passes sizes down.
- **Tooltips.** Hover-only; web-only. A `Tooltip` that renders its child and
  nothing else on native.
- **Popovers anchored to a button.** React Native has no `position: fixed`. A
  `Popover` primitive measures its anchor with `measureInWindow` and draws in
  a portal (`Modal` on native, a root-level host on web). Below the breakpoint
  it is a `Sheet`.
- **Range inputs.** The scrubber and volume become the phone's `SeekBar`
  everywhere; keyboard stepping is added on web.
- **The service worker.** Stays a separate esbuild step to `public/sw.js`,
  registered from `_layout.web.tsx`. Expo's web export copies `public/` as-is.
- **Static HTML per route.** Not used: `playlist/[id]` cannot be pre-rendered
  for ids that only exist at runtime. The export stays a single-page app, and
  the Pages workflow keeps its 404 redirect.
- **Crossfade and the analyser.** Web only, declared as engine capabilities.
  The native engine reports `crossfade: false` and the settings page says so,
  as the phone does today.
- **Pitch lock.** Web and iOS. Android's player has no pitch-preserving rate
  change; the practice panel shows speed without the lock there.
- **Reveal in Finder.** On the server itself only. Declared unavailable elsewhere.
- **Canvas drawings.** The song visual is drawn twice — a canvas in a browser,
  Reanimated views on a phone — from one shared model of the motion. Written as
  a `'use dom'` webview first, it was cheaper to draw than to embed. The wrapped
  card and the energy wave are plain views and SVG at every width.
- **Hover reveals in rows.** `Pressable` on web reports hover; rows show their
  controls on hover where there is a pointer and always where there is not,
  exactly the trade the CSS makes now.

---

## Testing

| Area | Why it is tested the way it is |
|---|---|
| `range.ts` | Highest bug density, worst failure mode, purely functional |
| `queue.ts` | All the awkward ordering rules, no mocking required |
| `smartPlaylist.ts` | Builds SQL from user input — run it against a real database |
| `lrc.ts` | The format is loose in the wild; fixtures are synthetic placeholder text |
| `format.ts` | Cheap, and formatting bugs are visible to the user everywhere |
| `metadata.ts` | Filename parsing has a long tail of real-world shapes |

Run `npm run check` for typecheck + lint + tests.

---

## Things deliberately not done

- **No account, no password, no session.** There is one person here. What guards the API is
  a single bearer token the server makes for itself and publishes into the bucket, so every
  device signed in to your Google account is given it and nobody types anything
  (`apps/server/src/repositories/auth.ts`). Requests from the server's own machine skip it,
  since whoever is there can read the database it is in (`apps/server/src/http/local.ts`).
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

**A new smart-playlist rule:** add the variant to `SmartRuleSchema`, then fix
`compileRule` (server) and `matcher` (shared) — each switch ends in `assertNever`, so
neither compiles until you do. Add a test that runs it against the in-memory database.

**A new storage backend:** implement `StorageDriver`, register it in `storage/index.ts`,
add the config branch. Nothing else changes.

**A schema change:** append a migration to the array in `db/migrate.ts`. Never edit an
existing entry, never renumber — the array index *is* the version.

**A dropdown, a menu, or anything that floats:** use `apps/app/src/ui/components/Select.tsx`
and `Popover.tsx` rather than a native `<select>` or a hand-rolled popover, and take
z-index, radii, durations and the focus ring from the tokens. See
[docs/features/design-system.md](features/design-system.md).

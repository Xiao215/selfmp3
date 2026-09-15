# The desktop app, and the iPad finished

> **Status:** phases 0 through 5 are on `main` (2026-09-14) and `apps/desktop`
> ships from them. The spike scripts and the reference captures this plan
> mentions have since been deleted; the sections about them are history. The
> run is logged in [universal-progress.md](universal-progress.md).

The plan for putting self.mp3 on a computer as an installed app — macOS first,
with the door left open for Windows and Linux — and for finishing the iPad as a
surface of its own. A companion to [UNIVERSAL.md](UNIVERSAL.md), written the
same way: for an agent with this file open and nobody watching. Every phase
ends in something that ships, every gate is a command whose exit code decides,
and the last section is the runbook.

---

## Why

The universal app already draws the desktop layout: at 820 points and above a
browser window gets the sidebar, the player bar, the popovers and the ⌘K
palette, and the server has served that build at `http://localhost:4600` since
2026-09-13. What a browser tab cannot be is *installed*:

- **It streams.** A tab always streams (decided 2026-09-12); an installed app
  downloads by default and plays from files, which is the whole point of a
  library you own. A laptop on a plane should behave like the phone does.
- **It is not a desktop app.** No Dock icon of its own, no menu bar, no media keys
  or Now Playing in Control Center, no ⌘Q, no window that remembers its size,
  no keychain for the token. Chrome's "install as app" gives a window and
  nothing else.
- **It forgets.** A tab's storage is the browser's to evict. Files in
  `~/Library/Application Support` are not.

The decision was already taken, and this document builds on it rather than
re-opening it (`docs/universal-progress.md`, "Downloading and streaming —
decided by Xiao, 2026-09-12"):

> **Toolkit: Electron**, wrapping the universal app's web export, with disk,
> keychain and updates supplied behind the ports. Not for the Mac App Store, so
> the sandbox is not a constraint. Windows is a possible future, with no plan
> for it. Nothing should close that door, and nothing is built for it. The web
> audio engine rather than a native one.

The iPad is here because it is the same unfinished edge. It gets the desktop
layout with a finger and was checked in portrait (`3c09383`), but it cannot
turn to landscape and cannot be split-screened — small, platform-specific
work of the same kind as the desktop's, under the same rule: the screens do
not change, the ports do. (Keyboard shortcuts on the iPad are deferred; see
"Later".)

## Where things stand

Facts about the tree this plan starts from, checked on `main` at `2ae1562`:

| Thing | State |
|---|---|
| The web export | `npm run export:web --workspace @selfmp3/app` → `apps/app/dist`, a single-page app with absolute `/_expo/...` asset paths and a hand-written service worker copied from `public/`. The server and GitHub Pages serve the same files. |
| The desktop hook | `apps/app/src/ports/install.web.ts` already reads `window.selfmp3Desktop`: present means an installed app, which downloads by default. Nothing sets it yet. Settings hides the Offline section, the song menu hides Download, and `playBlock` streams, when it is absent. |
| Platform differences | Some thirty named ports under `apps/app/src/ports/`, each a `name.ts` (phone) and `name.web.ts` (browser) pair, resolved by Metro. Screens never read `Platform.OS` (ESLint enforces it). |
| Downloads | One shared queue in `packages/client` (`downloads/queue.ts`) over a `DownloadStorage` port. The phone's is files + a JSON index (`ports/downloadStorage.ts`); the browser's is the Cache API behind the service worker (`ports/downloadStorage.web.ts`). The player prefers `localUri` when the storage has one (`player/PlayerProvider.tsx`). |
| Covers, words, playlists kept offline | The phone keeps covers as files (`offline/covers.ts`, expo-file-system); a browser keeps words and playlists in IndexedDB. On web `covers.ts` runs against the expo-file-system stub (`apps/app/verify/stubs/`), so a bucket library in a browser has no kept covers — confirm before relying on it. |
| Sign-in | Google, through the doorman. A browser comes back to its own origin with `#signin-code=`; a phone comes back to `selfmp3://sign-in` (`ports/cloudPlatform.ts:150`), which the doorman's `safeReturn` already allows by scheme (`apps/doorman/src/auth.ts`), and the `http://localhost` loopback is allowed too. Both paths exist; the desktop needs neither changed. |
| Server address | Every device starts with Google sign-in; the address screen renders only in development builds (`app/onboarding.tsx`) and Settings has no "Change server". The code path (`ConnectionProvider.connect`, `loadConnection`) is intact. |
| Media session | `navigator.mediaSession` is named as "its own port" in `engine.web.ts` but nothing in `apps/app/src` implements it. The phone's lock screen is track-player's. The desktop has to add it, and the browser gets it for free. |
| Keyboard | `shell/useHotkeys.web.ts` and `useEscape.web.ts` listen on the window; the native pair are no-ops. The iPad therefore has no shortcuts, and stays that way in this plan (Xiao, 2026-09-14): what it would take is under "Later". |
| iPad | Portrait at 834 checked and fixed (safe area, bar, header). `app.config.js` says `orientation: 'portrait'`, so landscape and Split View are impossible today. Landscape was never seen. |
| Verification | Root `verify/flows` (18 Playwright specs at 1280 and 375, against a running dev server with the 13-song library on 4600), `apps/app/.maestro` on the phone. |
| Server | Express 5, better-sqlite3, sharp, yt-dlp and ffmpeg; moving from the Mac to a Raspberry Pi (`docker.yml`). It is **not** part of the desktop app in this plan (see "What this is not"). |

## What "desktop" means here

An installed app on a computer that:

1. **Downloads by default and plays from files** — the phone's behaviour, on a
   disk with room, with the same 500 MB ask and the same two settings.
2. **Is a real app of its platform.** A Dock icon, an application menu with the
   standard Edit menu (without it ⌘C and ⌘V do not work in Electron), media
   keys and Now Playing, a window that remembers where it was, ⌘Q to quit and
   a red button that only hides, launch at login as a choice.
3. **Signs in the way every device does** — Google, through the doorman —
   and, because it *is* a computer that may sit beside the server, can also
   be pointed at a server directly, the way the browser on that computer is.
4. **Keeps its secrets in the keychain** (Electron's `safeStorage`) rather
   than `localStorage`.
5. **Updates itself** when the build is signed, and says where the new one is
   when it is not.

### What this is not

- **Not a second UI.** The renderer is `apps/app/dist`, byte for byte the
  build the server serves. Anything that looks different in the app and the
  browser is a bug, unless this document names it.
- **Not the server.** The desktop app does not host the library, run yt-dlp
  or open the SQLite file. The server keeps running where it runs (a launchd
  job on a Mac today, the Pi tomorrow). Embedding it is a possible later phase
  and is written up under "Later", with the reason it waits.
- **Not a Mac App Store app.** No sandbox, no App Store review, no receipt.
- **Not Windows or Linux, yet.** Nothing here reads `process.platform` to do
  something a Windows build could not; nothing here is built or tested for
  them. The packaging config lists their targets and leaves them unbuilt.

## Stack

Additions to the table in `UNIVERSAL.md`. Nothing already there changes.

| Concern | Choice | Why, and what was rejected |
|---|---|---|
| Shell | **Electron 44** (44.3.0 at the time of writing: Chromium 152, Node 24; macOS 13 or newer) | Decided 2026-09-12. Confirmed here for four reasons that hold even though the shell is thin: (1) one rendering engine on every OS — the desktop layout has only ever been verified in Chromium, and the reference captures are Chromium's; (2) TypeScript end to end, so the same agent works the whole stack in one language; (3) `protocol.handle` streams a file with `Range` support, `safeStorage` gives the keychain, `navigator.mediaSession` reaches macOS Now Playing, `app.setAsDefaultProtocolClient` gives the `selfmp3://` return; (4) it can host a Node process later (`utilityProcess`) if the server is ever embedded. *Tauri 2* rejected: a WebKit renderer on the Mac and WebView2 on Windows means two engines to verify; the shell would be Rust in a TypeScript repository; its only strong argument, size, is real (tens of MB against ~200) and Xiao accepted the size on the day. *react-native-macos* rejected: tracks older React Native than the app runs, Expo does not support it, neither Unistyles nor track-player build for it. *Mac Catalyst / "Designed for iPad"* rejected: a cloud-only client with the phone's engine, no server address, and distribution needs a paid account. |
| Renderer | `apps/app/dist`, unchanged | One export serves the server, Pages and the app. Desktop-only code lives in `apps/app/src/ports/desktop/` and is chosen at runtime by the presence of the bridge, which is what `install.web.ts` already does. A third Metro platform (`.desktop.ts`) was considered and rejected: it would add a build target to every gate for the sake of not writing `desktop ? a : b` in a handful of port files. |
| Main and preload build | **esbuild**, two entry points, CommonJS, only `electron` external | The repository already builds the service worker with esbuild. electron-vite and Electron Forge's templates bring a second bundler and a project shape of their own; the shell is small enough that a 30-line build script is clearer than either. Bundling *everything* — electron-updater included — is also what sidesteps electron-builder's known trouble with npm workspaces: it does not reliably collect dependencies hoisted to the repository root (electron-builder #2205, #9654), so the shell has no runtime dependencies to collect. `apps/desktop/package.json` lists `electron`, `electron-builder`, `electron-updater` and `esbuild` under `devDependencies` and nothing under `dependencies`. |
| Packaging | **electron-builder 26** (26.16.1 at the time of writing) | `dmg` and `zip` for macOS (arm64 and x64), with `nsis` and `AppImage` listed and not built. `files` names `dist/**` and `package.json`; `npmRebuild: false`. The shell has no native modules, so nothing is rebuilt and `asar` needs no unpacking. Forge rejected for the same reason as above; it is not wrong, it is more than this needs. |
| Updates | **electron-updater 6**, from GitHub Releases | The only updater that does not need a server. On macOS Squirrel applies an update only to an app signed with a certificate — an ad-hoc signature is rejected every time (electron #36640) — so unsigned builds get "check for updates", which compares the running version with the latest release's tag and opens the release page. |
| Signing | Two tiers, chosen by whether the secrets exist | With a Developer ID certificate and an App Store Connect API key in the environment: signed, hardened runtime, notarized, auto-updating. Without: **ad-hoc signed** — `mac.identity: "-"`, which electron-builder does not do on its own, plus the `com.apple.security.cs.allow-jit` entitlement that arm64 Electron needs to run under any signature. A downloaded ad-hoc build is "damaged" to macOS 26 until the quarantine flag is cleared: System Settings › Privacy & Security › Open Anyway, or `xattr -dr com.apple.quarantine`. (The right-click → Open bypass was removed in macOS 15.) A build made on the Mac it runs on carries no quarantine flag and simply opens. The build script is the same in both tiers; the tier is an environment fact, never a code branch the app can see. A Developer ID needs the paid Apple Developer Program. |
| The contract | **`packages/desktop-bridge`**: zod schemas for everything that crosses the preload boundary, and the `DesktopBridge` interface | The repository's rule: the contract is shared code, not documentation. Both `apps/desktop` (which implements it) and `apps/app` (which consumes it) import the same schemas; a channel renamed on one side is a compile error on the other. Compiled without the DOM library, like every other package. |
| Range parsing | The server's `http/range.ts`, pure part moved to `packages/shared` | The desktop serves files to `<audio>` and has to answer `Range:` with a correct 206 — the exact code the server already has, with the most tests in the repository. One parser, tested once. The server's file keeps its Express glue and imports the rule. |
| Media keys, Now Playing | `navigator.mediaSession`, a new port | Chromium's `system_media_controls` bridges it to `MPNowPlayingInfoCenter` and `MPRemoteCommandCenter` on macOS (Control Center's Now Playing, the media keys), to SMTC on Windows and MPRIS on Linux, through the `HardwareMediaKeyHandling` feature, which Electron leaves on. `globalShortcut` is **not** used for media keys: on macOS it registers and never fires while that feature is on (electron #20788), and turning the feature off would lose Now Playing. |
| Tests | vitest for the main process's pure modules; Playwright's `_electron` for a smoke flow; the existing web flows unchanged | The pure modules (range answers, the index, the menu model, the update-check rule) run in the root vitest. The Electron smoke launches the built app against the dev server. The 18 web flows keep running against the browser build, which is the same renderer. |
| Electron tests | **Playwright ≥ 1.59** `_electron` (the repository has 1.63) | Still marked experimental, CDP-based, and works on `macos-latest` without a virtual display. `firstWindow()` is the page; `app.evaluate` runs in the main process, which is how `protocol.handle` is observed (whether `page.route` sees custom-scheme requests is unconfirmed, so it is not relied on). `electron-playwright-helpers` 3.1 finds the packaged binary. |

**Version note.** The versions above are September 2026's; Electron ships a
major every eight weeks. The spike pins exact versions in
`apps/desktop/package.json` from `npm view` on the day, and the Stack table in
`UNIVERSAL.md` records them. An Electron upgrade is a commit of its own.

**What the research settled, for the record** (checked September 2026; the
sources are in the progress file's Desktop section once phase 0 writes it):

- Official Electron builds decode AAC and MP3 (`proprietary_codecs`,
  `ffmpeg_branding = "Chrome"`), and the default `autoplayPolicy` needs no
  gesture, so the engine's `play()` and `AudioContext.resume()` work cold.
- A privileged custom scheme (`standard`, `secure`, `supportFetchAPI`,
  `allowServiceWorkers`, `stream`) registers service workers and keeps a stable
  origin for IndexedDB; `file://` does neither. `protocol.handle` hands over the
  request's `Range:` header but `net.fetch('file://…')` ignores it and answers
  200 with the whole body, so the 206 has to be built by hand — which is why
  the server's range rule moves to `packages/shared`.
- `safeStorage` is the keychain-backed store; `utilityProcess` is the sanctioned
  way to run Node in a child if the server is ever embedded; better-sqlite3 13
  and sharp 0.35 are Node-API with prebuilds, so that later phase needs no
  rebuild step either.
- Tauri 2.11 would put the UI in WKWebView, which refuses service workers on
  custom schemes (tauri #13031) and whose `preservesPitch` with a
  `MediaElementSource` was still being fixed in Safari Technology Preview in
  2026 — the exact combination the practice panel and the analyser use. Tauri 3's
  Chromium runtime is an alpha as of 2026-09-13. Revisit only if it stabilises.
- react-native-macos is at 0.81 against the app's 0.86; Expo has no prebuild
  for it; Unistyles 3 and track-player do not build for it.
- "Designed for iPad" is Mac App Store or TestFlight only; Catalyst needs the
  paid program to distribute. Both are cloud-only clients.

## Repository layout after

```
packages/shared            + range.ts: the pure Range parser (from apps/server/src/http)
packages/replica             unchanged
packages/client              unchanged, except the port below
  ports/mediaSession.ts    + NEW: `MediaSessionPort` — metadata, action handlers, position

packages/desktop-bridge    NEW — the contract between the shell and the page
  src/schemas.ts             zod: every message and reply, both directions
  src/bridge.ts              `DesktopBridge`: what `window.selfmp3Desktop` is
  src/channels.ts            channel names, one constant each, used by both sides
  src/menu.ts                the accelerators the menu owns, so the page does not

apps/desktop               NEW — the Electron shell
  package.json               @selfmp3/desktop: electron, electron-builder,
                             electron-updater, esbuild; no native modules
  electron-builder.yml       mac (dmg, zip; arm64, x64); win and linux listed, unbuilt
  scripts/build.mjs          esbuild main + preload → dist/
  scripts/dev.mjs            build, then launch electron against Metro on 4601
  resources/                 icon.icns (from apps/app/public/icons/icon.svg),
                             entitlements.mac.plist, dmg background
  src/main/
    main.ts                  lifecycle: single instance, open-url, window, quit
    window.ts                the BrowserWindow, its saved bounds, dark background
    protocol.ts              app://selfmp3/ — serves dist/, index.html fallback,
                             and _media/ with Range → 206 (packages/shared range)
    files.ts                 songs/ and covers/ on disk: streaming downloads with
                             resume, .part files, delete, stat, list
    secrets.ts               safeStorage-encrypted JSON in userData
    menu.ts                  the application and Dock menus; sends commands
    updates.ts               electron-updater when signed; version check when not
    ipc.ts                   one handler per channel, each validating with the schemas
    *.test.ts                pure modules: bounds, index, menu model, update rule
  src/preload/
    preload.ts               contextBridge.exposeInMainWorld('selfmp3Desktop', …)
  verify/
    smoke.spec.ts            Playwright _electron: launch, sign in to a dev server,
                             play, download, relaunch offline, play

apps/app                   the renderer, with desktop branches in its ports
  src/ports/desktop/
    bridge.ts                `desktop: DesktopBridge | null` — the one place that
                             reads window.selfmp3Desktop; typed by the package
    downloadStorage.desktop.ts   files on disk through the bridge
    covers.desktop.ts        covers on disk through the bridge
    secrets.desktop.ts       the keychain through the bridge
    mediaSession.web.ts      navigator.mediaSession (browser and desktop alike)
    device.desktop.ts        "Xiao's MacBook · self.mp3", kind 'desktop'
  src/ports/*.web.ts         a handful gain `desktop ? … : …` (listed below)
  src/features/settings/     Offline: the folder and Reveal in Finder; Server:
                             connect to a server (installed desktop only);
                             App: launch at login, updates

apps/server                  unchanged, except http/range.ts imports the moved rule
apps/doorman                 unchanged
.github/workflows/desktop.yml  NEW — builds the desktop app on macos-latest
docs/DESKTOP.md              this file
docs/features/desktop-app.md NEW — the user-facing note, with its "Where" line
```

`apps/desktop` joins the root `tsconfig.json` references and the root ESLint
config, the way `apps/doorman` does: its own tsconfig names its libraries
(`ES2023`, `DOM` for the preload and for Electron's types) and stays inside its
own project. `apps/app` stays outside the graph as before. The root vitest
pattern `apps/*/src/**/*.test.ts` already picks up the shell's tests.

## The bridge

`window.selfmp3Desktop` is the whole surface between the page and the shell.
It is exposed by the preload with `contextBridge`, with `contextIsolation`
on, `nodeIntegration` off and `sandbox` on, so the renderer has no Node and
the bridge is the only door. Every argument and every reply is parsed with a
zod schema from `packages/desktop-bridge` on the receiving side; an invalid
message is an error at the boundary, not a crash in the middle.

| Member | What it does | Why the page needs it |
|---|---|---|
| `info` | `{ platform, version, hostname, userData, songsDir }` | Device name, About, the folder Settings shows |
| `secrets.get/set/remove(key)` | `safeStorage` — encrypted at rest in `userData/secrets.json` | The `secrets` port |
| `files.download({ id, url, headers, name, resumeFrom })` | Streams a URL to `songs/<name>.part`, renames when whole, reports `progress` events; honours `Range` for resume | `downloadStorage.begin().run()` |
| `files.cancel(id)` | Aborts; leaves the `.part` for a later resume or `discard` | `pause` / `cancel` |
| `files.delete(kind, name)`, `files.stat(kind, name)`, `files.list(kind)` | `kind` is `songs` or `covers` | Index reconciliation, sizes, `clear` |
| `files.fetchTo(kind, name, url, headers)` | A whole small file, no progress | Covers |
| `files.usage()` | Bytes used per kind; free space on the volume | Settings' storage numbers, the 500 MB rule |
| `files.reveal(kind, name)` | `shell.showItemInFolder` | Reveal in Finder |
| `mediaUrl(kind, name)` | `app://selfmp3/_media/<kind>/<name>` | `localUri` for the player and `<Image>` |
| `openExternal(url)` | `shell.openExternal` | Sign-in, release page, links in Settings |
| `onDeepLink(cb)` | `selfmp3://…` URLs the OS handed the app | The sign-in return |
| `onCommand(cb)` | Menu and media-key commands: `play-pause`, `next`, `previous`, `search`, `settings`, `now-playing`, `volume-up`, `volume-down`, `mute`, `shuffle`, `repeat` | The menu is the shell's; the behaviour is the page's |
| `setPlaybackState({ playing })` | Lets the shell hold a `powerSaveBlocker` while playing and label the Dock menu | Playback that survives the lid |
| `loginItem.get/set(open)` | `app.getLoginItemSettings` / `setLoginItemSettings` | Settings › App |
| `updates.check()`, `updates.install()`, `onUpdate(cb)` | electron-updater when signed; a version compare against the GitHub release when not | Settings › App and the app menu |
| `windowState` | nothing exposed — the shell saves bounds itself | — |

Events flow one way each: the page calls, the shell answers; the shell emits
`progress`, `deepLink`, `command` and `update`, the page listens. There is no
`ipcRenderer` on the page.

## The ports on the desktop

Which `*.web.ts` ports change, and to what. Everything not listed keeps its
browser behaviour, because Electron is a browser. In particular `prefs`
(`localStorage`), `idbStore` (IndexedDB), `libraryCache`, `lyricsCache`,
`playlistCache` (IndexedDB), `pointer` (a mouse), `activity`, `scrollbars`,
`appIcon`, `shareCard` (the canvas card's `<a download>` starts an ordinary
Electron download, which saves to Downloads; confirm in the spike), `listen`,
`coverPixels`, `events` (`EventSource`) and
`servedBy` (probes `app://selfmp3/api/health`, gets nothing, answers null —
correct) all stay as they are.

| Port | Browser | Desktop (`desktop !== null`) |
|---|---|---|
| `install.web.ts` | false | true — already written |
| `secrets.web.ts` | `localStorage` | `desktop.secrets` (keychain) |
| `downloadStorage.web.ts` | Cache API, not resumable, `localUri` null | `downloadStorage.desktop.ts`: files through `desktop.files`, resumable, `localUri` = `desktop.mediaUrl('songs', name)`. The index is the page's, kept where the phone keeps it (a JSON document; here `userData/downloads.json` through `files`), so `parseIndex`/`DownloadIndex` from `packages/client` are reused unchanged |
| `offline/covers.ts` | the expo-file-system stub | `covers.desktop.ts`: the phone's logic over `desktop.files` — a server's covers by song and rev, the bucket's by hash — behind a small `coverFiles` port so `covers.ts` is written once against `{ exists, fetchTo, uri, list, delete }` and the phone's expo-file-system and the desktop's bridge each implement it |
| `serviceWorker.web.ts` | registers `sw.js` in production | registers nothing. The shell is served from disk, songs and covers are files, and a second copy of audio in the Cache API would be a second truth. (The manifest and apple-touch-icon links are skipped too.) |
| `recentCopies.web.ts` | keeps played songs in the cache | unused: `keepPlayed` is only called where `installed` is false. Left as is |
| `device.web.ts` | user agent, `'desktop'` | `desktop.info.hostname` for the name ("Xiao's MacBook Pro"), kind `'desktop'` |
| `cloudPlatform.web.ts` | `returnUrl` = this origin's `/sign-in`, `openSignIn` = `location.assign` | `returnUrl` = `selfmp3://sign-in` (the phone's, already allowed by the doorman), `openSignIn` = `desktop.openExternal` (the system browser — Google refuses to sign in inside an embedded window). The code arrives through `desktop.onDeepLink`; `signInReturn.web.ts` reads it from there instead of `location.hash`. The typed-code path stays as the fallback, exactly as on the phone |
| `signInReturn.web.ts` | the fragment | the deep link, as above |
| `mediaSession.web.ts` (new) | `navigator.mediaSession` | the same file — Chromium in Electron maps it to macOS Now Playing and the media keys |
| `shell/useHotkeys.web.ts` | every combination | skips the combinations the application menu owns (`packages/desktop-bridge/src/menu.ts`), so a key fires once. Commands arrive through `desktop.onCommand` and call the same handlers |
| `keyboard`, `modalCoversScreen`, `dragCursor` | unchanged | unchanged |

**One rule for the branches.** Only files under `src/ports/` (and
`offline/covers.ts`, which is a port in all but name and should move there)
may import `ports/desktop/bridge`. Enforced by the same `no-restricted-imports`
mechanism the foundations already use. A feature that wants to know whether it
is on the desktop asks a port for the *capability*, never for the platform.

## What the player needs

Three small things in `apps/app` that are not ports:

1. **`localUri` on the web path.** `PlayerProvider.tsx:281` asks
   `downloadQueue.localUri(songId)` and prefers it; that is the phone's path. Confirm the web engine's `load()` is handed the same URL when
   the storage answers one (today the web storage answers null and the service
   worker intercepts the stream URL instead). If the web provider short-circuits
   to the stream URL, wire it — one function, and the spike's engine check
   covers it.
2. **CORS on the media scheme.** `engine.web.ts:706` sets
   `crossOrigin = 'use-credentials'` so the analyser can read the samples. The
   `app://` protocol answers `Access-Control-Allow-Origin: <the page's origin>`
   and `Access-Control-Allow-Credentials: true` — not `*`, which the
   credentials mode rejects. In development the page's origin is
   `http://localhost:4601`; in the app it is `app://selfmp3`. The handler echoes
   whichever asked.
3. **The media session port.** `PlayerProvider` publishes title, artist, album,
   artwork and position, and takes `play`, `pause`, `nexttrack`,
   `previoustrack`, `seekto`. The native file is a no-op (track-player owns the
   lock screen). The browser build gains lock-screen controls on a phone's
   browser as a side effect, which the README already promises.

## Phases

Each phase leaves `main` shippable, both current surfaces untouched until the
moment they gain something, and ends with a gate.

### Phase 0 — Record the decisions

- This file. A Stack line for Electron, electron-builder, electron-updater,
  `packages/desktop-bridge` and the media-session port in `UNIVERSAL.md`,
  with the versions the spike pins.
- `docs/features/desktop-app.md` with a "Where" line: *macOS (installed app);
  Windows and Linux: not built. The browser and the phone: see
  offline-sync.md.*
- A "Desktop" section at the end of `docs/universal-progress.md`, where each
  phase writes what it found, in the voice the file already has.

Exit: docs committed; no code.

### Phase 1 — The spike (throwaway branch `desktop/spike`)

Six checks, each a command, no product code, before anything is committed
to `main`:

1. **The export runs under `app://`.** A twenty-line main process registers
   `app` as a privileged scheme (`standard`, `secure`, `supportFetchAPI`,
   `corsEnabled`, `stream`; `allowServiceWorkers` left off on purpose, since
   the desktop registers none), serves `apps/app/dist` through `protocol.handle`
   with `index.html` for unknown paths, opens a window at 1280×800. The app
   boots, shows sign-in, and `app://selfmp3/playlist/1` reloads to the same
   page. *Fails if* expo-router or the absolute asset paths need `file://`
   assumptions changed.
2. **The engine plays and analyses from `app://`.** A local `.m4a` served at
   `app://selfmp3/_media/songs/x.m4a` with the CORS headers above plays in the
   two-element engine, seeks (a `Range:` request answered 206), crossfades
   into a second file, and the analyser reports non-zero bins. *Fails if*
   Chromium's proprietary-codec build in Electron does not decode AAC (it
   does in the official builds; the check is there because the failure would
   be total).
3. **Now Playing.** With `navigator.mediaSession.metadata` set and action
   handlers registered, the song appears in Control Center's Now Playing, the
   keyboard's play/pause key toggles it, and the artwork shows. *Fails if*
   Electron's build has the media-key feature off, in which case
   `globalShortcut` on macOS becomes the plan and the Now Playing panel is
   given up.
4. **The deep link.** `app.setAsDefaultProtocolClient('selfmp3')`; with the
   app running, `open "selfmp3://sign-in#signin-code=ABCD-EFGH"` reaches the
   `open-url` handler and, with the app closed, launches it and delivers the
   URL. A second launch focuses the first (`requestSingleInstanceLock`).
5. **The keychain.** `safeStorage.isEncryptionAvailable()` is true on a
   signed-in macOS session; a string round-trips through encrypt → disk →
   decrypt across a relaunch.
6. **Resume.** A download interrupted at 40% resumes with `Range:` from the
   `.part` size and the finished file's SHA-256 matches the whole. Against the
   dev server's `/api/stream/<id>`, which already answers ranges.

Each check was a script under `apps/desktop/verify/spike/` that exited non-zero
on failure; all six passed, the results are in the progress file, and the
scripts have since been deleted.

### Phase 2 — The shell, signing in, playing

`packages/desktop-bridge` and `apps/desktop` exist. The window opens the
export under `app://selfmp3/`, or Metro on 4601 with `npm run dev:desktop`.
The preload exposes `info`, `secrets`, `openExternal`, `onDeepLink`,
`onCommand`. The application menu has the standard roles (app, Edit, Window)
and nothing of its own yet. `device.web.ts`, `secrets.web.ts`,
`cloudPlatform.web.ts` and `signInReturn.web.ts` gain their desktop branches.

The **server address path** comes to the installed desktop: Settings › Server
shows "Connect to a server" with the address and token fields the onboarding
screen already has, and "Use the cloud instead" to go back. Either/or, as the
code is today (`connect()` answers from the server; `signedInToCloud()` from
the bucket). **Switching answerers clears the download index and the files**,
after a confirmation that says so: a song's integer id is local to whichever
answered, and an index keyed by one side's ids would offer the other side's
songs (`docs/SYNC.md`, "Identity"). This is the same "Change server" the
phone lost in "No more connecting by address"; it returns only where
`installedApp && desktop`, in the screen that already exists.

Exit:
- `npm run check` (the bridge package and the shell's tests are in it).
- `npm run build:desktop` produces `apps/desktop/release/self.mp3-<v>-arm64.dmg`.
- The Playwright smoke: launch the built app, connect to the dev server on
  4600, a row plays, the bar shows it, ⌘K opens the palette, ⌘Q quits.
- Sign-in with Google through the system browser returns by deep link and
  lands on the library — **checked by Xiao**, since an agent cannot sign in.

### Phase 3 — Files on disk

`files.*` in the shell, `_media/` in the protocol (range rule from
`packages/shared`), `downloadStorage.desktop.ts`, `covers.desktop.ts` behind
the `coverFiles` port, `serviceWorker.web.ts` registering nothing on the
desktop, `installedApp` true, the `localUri` path confirmed on web.

Settings › Offline (already there for an installed app) shows the folder and
gains "Reveal in Finder". "Remove all downloads" removes the files. The
storage numbers come from `files.usage()`. The 500 MB rule and the two
settings are the shared policy's, untouched. Every connection on a computer
counts as Wi-Fi (decided 2026-09-12): `connectionKind` answers `'wifi'`
where `desktop` is present.

Exit:
- `npm run check`; the range rule's tests run once, in `packages/shared`.
- The smoke, extended: connected to the dev server, the 13 songs download by
  themselves (they are under 500 MB) with the header counting down; quit;
  stop the server; relaunch; the library opens from its snapshot; a downloaded
  song plays from `app://selfmp3/_media/…`; a cover shows from disk; "Reveal
  in Finder" opens the folder.
- The same, signed in to the cloud — **checked by Xiao**.

### Phase 4 — Being a desktop app

- **Now Playing and media keys.** The `MediaSessionPort`, `mediaSession.web.ts`,
  the provider publishing to it. The Dock menu shows the song and Play/Pause,
  Next, Previous.
- **The menu.** *self.mp3*: About, Check for Updates…, Settings ⌘,, Quit.
  *Edit*: the standard roles. *View*: Library ⌘1, Playlists ⌘2, Now Playing
  ⌘3, Search ⌘K, Practice panel ⌘P, Enter Full Screen. *Playback*:
  Play/Pause Space, Next ⌘→, Previous ⌘←, Seek forward/back ⌥⌘→/←, Shuffle,
  Repeat, Volume Up/Down ⌘↑/↓, Mute ⌥⌘↓. *Window*: standard. *Help*: the
  docs. The menu model is a pure module with a test that asserts no
  accelerator appears twice and that every command name exists in the
  contract; `useHotkeys.web.ts` skips what the menu owns.
- **The window.** Bounds saved to `userData/window.json` and restored,
  clamped to a display that still exists; background `#14121a` before first
  paint; `titleBarStyle: 'hiddenInset'` with the sidebar's top padded for the
  traffic lights (the one deliberate visual difference from the browser, and
  it is named here); the red button hides, the Dock icon or ⌘N shows it
  again, ⌘Q quits.
- **Power.** `powerSaveBlocker.start('prevent-app-suspension')` while
  playing, stopped when paused; the lid closing still sleeps the Mac, as with
  any player.
- **Launch at login**, as a Settings toggle.
- **Deep links** beyond sign-in: `selfmp3://playlist/<id>`,
  `selfmp3://now-playing` route inside the app.

Exit:
- `npm run check`; the menu model's tests pass.
- The smoke, extended: a `command` for `play-pause` sent by the test toggles
  playback; the window's saved bounds survive a relaunch.
- By hand, once, recorded in the progress file: media keys, Now Playing in
  Control Center with artwork, the Dock menu, hide and show, ⌘Q, full screen,
  the lid.

### Phase 5 — Shipping

- `electron-builder.yml`: `appId com.selfmp3.app`, `productName self.mp3`,
  `mac.category public.app-category.music`, `hardenedRuntime`, the
  entitlements (network client; nothing else), `dmg` and `zip`, `arm64` and
  `x64`; `win` (`nsis`) and `linux` (`AppImage`) present and not in the
  default targets.
- Icons: `icon.icns` generated from `apps/app/public/icons/icon.svg` by a
  script, so the app wears the same mark as the tab and the phone.
- Signing tiers as in the Stack table, driven by `CSC_LINK`, `CSC_KEY_PASSWORD`,
  `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`. Absent, the build
  sets `mac.identity: "-"` (ad-hoc) with the allow-jit entitlement, and the
  release notes say how to open it once: Privacy & Security › Open Anyway, or
  `xattr -dr com.apple.quarantine "/Applications/self.mp3.app"`.
- `updates.ts`: electron-updater against the repository's releases when the
  build is signed; otherwise a version check against the latest release's
  tag with "Open release page". Settings › App shows the version and the
  state.
- `.github/workflows/desktop.yml`: on `workflow_dispatch` and on tags
  `desktop-v*`, on `macos-latest`: `npm ci`, build the packages and the web
  export, `npm run build:desktop`, upload the dmg and zip as artifacts, and
  on a tag attach them to a GitHub release. Signing secrets used when set.
- Docs: `docs/INSTALL.md` gains "The desktop app"; `README.md` gains the two new
  folders in "How it is put together" and a line under "What it does";
  `ARCHITECTURE.md` gains the shape.

Exit:
- `npm run build:desktop` on the Mac; the dmg mounts; a copy that has been
  through a browser download (so it carries the quarantine flag) opens on a
  second user account after Open Anyway (unsigned tier).
- The workflow runs green on `workflow_dispatch` and its artifact opens.
- With a fake newer release on a fork, "Check for updates" says so and opens
  the page (unsigned tier). The signed tier is **checked by Xiao** when there
  is a certificate.

### Phase 6 — The iPad, finished

Independent of phases 2–5; on its own branch; can run in parallel.

- **Orientation.** iPhone stays portrait. The iPad gets all four. In
  `app.config.js`, `orientation: 'portrait'` stays — Expo's plugin writes only
  `UISupportedInterfaceOrientations` and never touches the `~ipad` key — and
  `ios.infoPlist['UISupportedInterfaceOrientations~ipad']` lists the four
  orientations by name. `ios.requireFullScreen` stays at its default, false;
  Apple deprecated `UIRequiresFullScreen` in iPadOS 26 (TN3192) and iPadOS 26
  rotates an iPad regardless of the mask when rotation lock is off, so the
  key is for older iPads and the App Store's multitasking rule, not a switch
  the app relies on. No `expo-screen-orientation`: it is not needed for a
  static mask, and react-native-screens 4.23+ conflicts with its lock.
- **Widths.** The layout is width-decided, so nothing should change; check
  that it does not, at 1194 (landscape), 834 (portrait), 678 and 507 (Split
  View), 375 and 320 (Slide Over, and the phone layout narrower than it has
  ever been drawn). Crossing 820 while resizing must not remount the screen
  (`Shell.tsx` promises this; the flow in `verify/flows/navigation.spec.ts`
  checks it in a browser at 1194 → 507 as the stand-in, since `simctl`
  cannot rotate or split). One known hazard: React Native's `Dimensions`
  change event has failed to fire on the *first* entry into Split View
  (facebook/react-native #28935; its state under Fabric is unconfirmed). If
  the simulator shows it, `useLayout` takes its width from an `onLayout` on
  the root view as well, and the larger of the two signals wins.
- **Hardware keyboard.** Not now (Xiao, 2026-09-14). The iPad keeps no
  shortcuts; `useHotkeys.ts` and `useEscape.ts` stay no-ops on native and
  Settings keeps hiding its Shortcuts section there. What it would take is
  written under "Later" so the research is not redone.
- **Trackpad hover.** Declared later. `Pressable` on iPadOS reports
  `onHoverIn`; `finePointer` stays false, so controls stay finger-sized and
  always visible, which is the right default for a tablet.
- **Maestro.** `.maestro/smoke.yaml` on an "iPad Pro 11-inch" simulator,
  portrait; landscape and Split View by Xiao, once, with screenshots into the
  progress file.

Exit: `npm run check:app`; the phone flows pass in the browser at 1194 and at
507; Maestro smoke on the iPad simulator; the four orientations in
`ios/…/Info.plist` after prebuild.

### Later — not in this plan, written down so they are not re-derived

- **Streaming from the bucket on the desktop.** In cloud mode the desktop,
  like the phone, plays only what it has downloaded (`playBlock('cloud')`),
  because the player cannot send the doorman's header. The browser gets
  streaming from its service worker. The desktop's equivalent is a range
  proxy in the main process at `app://selfmp3/_stream/<key>` that adds the
  header — the service worker's `cloud` branch in Node. Worth doing; not
  needed for "download by default".
- **Windows and Linux.** `electron-builder --win --linux` on their runners,
  deep-link registration through the NSIS installer, media keys through
  Chromium's controls, and a pass over the menu's accelerators. Nothing in
  the phases above prevents it.
- **Embedding the server.** `utilityProcess.fork` of `apps/server/dist/main.js`
  with better-sqlite3 and sharp rebuilt for Electron's Node ABI, yt-dlp and
  ffmpeg found on `PATH` or bundled, the library folder chosen in Settings.
  This is what would make the app replace `scripts/setup-mac.sh` on the computer
  that holds the music. It waits because the server is moving to a Pi, and
  because it is the one thing that would put native modules and a rebuild
  step into a shell that otherwise has none.
- **A tray or a floating mini player.** Now Playing in Control Center covers
  the need on macOS.
- **Hardware keyboard shortcuts on the iPad.** Deferred by Xiao on
  2026-09-14. When wanted: React Native core delivers no key events on iOS and
  Expo has no module for it, so the way in is a local Expo module
  (`apps/app/modules/key-commands`, ~60 lines of Swift over
  `expo-modules-core`) adding `UIKeyCommand`s with a `discoverabilityTitle` to
  the root view controller and emitting `{ input, modifiers }` to JS; then
  `useHotkeys.ts` and `useEscape.ts` on native register the web's set (⌘K,
  Space, ⌘←/→, Escape, the palette's arrows and Enter, the inbox's 1–9) and
  Settings shows Shortcuts when a keyboard is attached (`sectionsFor` already
  takes the flag). Two UIKit rules: an unmodified command (Space, digits,
  arrows) beats a focused text field, so those are withdrawn while a
  `TextInput` has focus; arrows need `wantsPriorityOverSystemBehavior`. The
  packages checked in September 2026 and passed over: `react-native-key-command`
  (Expensify, 1.0.16) works but needs an `AppDelegate` patch, has no config
  plugin (its Expo issues #48 and #51 open) and no `discoverabilityTitle`;
  `react-native-keyevent` is unmaintained; `react-native-keyboard-controller`
  is the soft keyboard only; `react-native-external-keyboard` is focus-scoped.
  It needs a dev client rebuild and a Stack line.
- **Streaming and downloads from the server on a phone that is signed in**,
  when the server is reachable: shared with the phone, and it is the id
  problem above — a device would need one identity for a song across both
  answerers, which is `uid`, and the download index keyed by it. A real
  feature, not a desktop one.

## Verification

The reference for the desktop app is the browser at 1280: the same renderer,
so a screen that differs is a bug, with one named exception (the inset title
bar). For every phase that touches the page:

1. `npm run dev` for the server and Metro; `npm run dev:desktop` for the
   window; the browser at `http://localhost:4601` for the reference.
2. The same state in both; screenshot the window with
   `screencapture -l <windowid>` (the id from `osascript`), or through the
   Playwright smoke's `page.screenshot()`, which is simpler.
3. Compare, fix, note every deliberate difference in the commit.

The flows: the 18 web specs keep running against the browser build and are
the regression suite for the renderer. The desktop's own checks are the
Playwright `_electron` smoke in `apps/desktop/verify/`, which launches the
*built* app (`release/mac-arm64/self.mp3.app`, found with
`electron-playwright-helpers`) with `SELFMP3_APP_API` pointing at the dev
server, so the product is what is tested, not a dev window. `firstWindow()`
is the page; anything about the main process — did `protocol.handle` answer
a `Range:` with 206, is the power-save blocker held while playing — is read
with `app.evaluate`, not inferred from the page. It runs on the server, like the
flows, because it needs the dev library; CI runs `npm run check` and the
build, and could run the smoke on `macos-latest` (no virtual display needed)
the day a seeded library exists there.

## Risks, and what retires them

| Risk | Retired by |
|---|---|
| Electron cannot serve the export under a custom scheme without changes to the export | Spike 1. Fallback: a loopback HTTP server in the main process on a *fixed* port — a random one would change the origin and lose IndexedDB and every kept preference on each launch — and `servedBy` told that this origin is not a server |
| The two-element engine or the analyser misbehaves against `app://` media | Spike 2. The CORS-with-credentials detail is the likely cause of a silent analyser |
| Media keys are Chromium's and the OS's Now Playing is not populated | Spike 3. Fallback: turn `HardwareMediaKeyHandling` off and take the keys with `globalShortcut` (which needs the app to be a trusted accessibility client on macOS); no Now Playing panel, said so in the feature note |
| Google refuses to sign in inside the app | Not a risk: sign-in opens the system browser and comes back by deep link, which the doorman already allows for `selfmp3://`. Spike 4 proves the return |
| `safeStorage` unavailable on a headless or freshly created account | Spike 5. Fallback: plain JSON with a warning in Settings — the browser's promise, no worse |
| Unsigned builds on macOS 26 show "damaged" and no Open button | Known (the research found it): the quarantine flag is the cause, and Privacy & Security › Open Anyway or `xattr -dr` clears it. Phase 5 checks the words in the release notes on a second account. macOS 26.6 also narrowed `spctl --master-disable` to signed-but-unnotarized apps, so that is not a workaround worth writing down |
| electron-updater cannot apply an update to an ad-hoc build | Known (electron #36640); that is why the unsigned tier only checks and opens the page |
| electron-builder and npm workspaces: the shell's dependencies are hoisted to the root and not collected | Retired by design: esbuild bundles everything but `electron` into `dist/`, the shell has no runtime `dependencies`, and `files` names `dist/**` and `package.json`. Phase 2's build gate proves it |
| Media session sets metadata but Control Center shows no artwork | Spike 3 looks. Chromium's macOS bridge carries artwork; no Electron-specific confirmation was found, so it is checked rather than assumed. Without it the title and controls still work |
| The renderer's downloads-keyed-by-id assumption breaks when switching answerers | Phase 2 clears the index on switch, with a confirmation. The permanent fix is the `uid` work under "Later" |
| Playwright cannot drive Electron 44 | Playwright 1.63 is in the tree and the 1.57–1.58 regression is fixed. If `_electron.launch` fails on the day, the smoke drives the dev window through Chrome DevTools Protocol directly (`--remote-debugging-port`), which is what Playwright does underneath |
| A second Electron major lands mid-work | Pin exact versions in `apps/desktop/package.json`; upgrade in a commit of its own |

## Sizing

Lines to write, from what exists:

| Phase | Roughly | Notes |
|---|---:|---|
| 1 spike | 300, thrown away | six scripts |
| 2 shell + bridge + sign-in + server path | 1,200 | 400 of it is the contract and its tests; the Settings screen exists |
| 3 files on disk | 900 | half in the main process, half the two desktop ports; the range rule moves |
| 4 desktop app | 700 | menu, window, power, media session port |
| 5 shipping | 300 + config | mostly YAML and a workflow |
| 6 iPad | 150 | the orientation entry, the width checks, and whatever they turn up |

Against that, nothing in `apps/app/src/features` changes except Settings.

## Runbook for an unattended agent

Executed, not read. The agent has the repository, a Mac with Xcode and a
booted simulator (for phase 6), the dev server, and this file. Phases 2–5 in
order; phase 6 in parallel on its own branch; phase 1 first and thrown away.

### Ground rules

Those of `UNIVERSAL.md` apply unchanged — one phase per branch (`desktop/phase-N`,
`ipad/phase-6`), commit at every green gate and never on red, no new
dependency without a Stack line, ports before screens. Added for this work:

- **The renderer is one build.** Never add a Metro platform, a second
  `expo export`, or a `process.env` switch that makes the desktop's bundle
  differ from the server's. If a desktop difference cannot be expressed as a
  port choosing at runtime, stop and write down why.
- **The bridge is the only door.** No `nodeIntegration`, no `remote`, no
  `ipcRenderer` on the page, no `webSecurity: false`, no
  `allowRunningInsecureContent`. Every channel has a schema on both sides.
- **The shell has no native modules.** If a phase seems to need one, it is
  the "embedding the server" phase in disguise; stop.
- **Secrets never touch the renderer's storage.** Tokens go through
  `desktop.secrets`; nothing else.
- **Stop and ask** at: a spike check fails; a gate fails twice on the same
  cause; anything needing Apple signing, a GitHub token, a Google sign-in, or
  the Simulator app's GUI (rotation, Split View); a visible difference from
  the browser at 1280 beyond the inset title bar; a change to a
  `packages/shared` *schema* (moving the range helper is not a schema).
- **Never** commit `release/`, a `.p12`, an API key, or `ios/`; never run
  `expo prebuild --clean` with uncommitted native changes.

### Environment

```
node >= 22, npm >= 10; Xcode 16+ and a booted iPad simulator for phase 6
npm install
npm run build --workspace @selfmp3/shared && npm run build --workspace @selfmp3/replica && npm run build --workspace @selfmp3/client
npm run dev                          # server on 4600, Metro web on 4601 — keep running
npm run dev:desktop                  # phase 2 on: electron against 4601, DevTools open
npm run export:web --workspace @selfmp3/app && npm run build:desktop   # the real thing
```

The dev library is the thirteen songs in `~/Music/selfmp3-dev`
(`SELFMP3_PROFILE=dev`), never the real one; the flows need it and say so
when it is empty.

### Root scripts to add

```
"dev:desktop":    "npm run dev --workspace @selfmp3/desktop"
"build:desktop":  "npm run build --workspace @selfmp3/shared && … @selfmp3/client && npm run export:web --workspace @selfmp3/app && npm run dist --workspace @selfmp3/desktop"
"verify:desktop": "playwright test -c apps/desktop/verify/playwright.config.ts"
```

`npm run check` gains nothing to add: the bridge package and the shell join
the root project graph, so `typecheck`, `lint` and `test` already cover them.

### Gates

**Spike (phase 1)** — six throwaway scripts, all passed and since deleted; see
the progress file.

**Phase 2**

```
npm run check                                              # bridge + shell in the graph
npm run build:desktop && test -f apps/desktop/release/*.dmg
npm run verify:desktop -- --grep "connects and plays"      # built app against 4600
```

**Phase 3**

```
npm run check                                              # range rule tested once, in packages/shared
grep -rn "range" apps/server/src/http/range.ts | grep -q "@selfmp3/shared"
npm run verify:desktop -- --grep "downloads|offline|reveal"
```

**Phase 4**

```
npm run check                                              # menu model: no duplicate accelerator, every command in the contract
npm run verify:desktop -- --grep "command|window bounds"
```

**Phase 5**

```
npm run build:desktop                                      # unsigned tier, locally
gh workflow run desktop.yml && gh run watch                # green on macos-latest
```

**Phase 6**

```
npm run check:app
cd apps/app && npx expo prebuild --platform ios && /usr/libexec/PlistBuddy -c 'Print :UISupportedInterfaceOrientations~ipad' ios/*/Info.plist | grep -c UIInterfaceOrientation | grep -qx 4
/usr/libexec/PlistBuddy -c 'Print :UISupportedInterfaceOrientations' ios/*/Info.plist | grep -c UIInterfaceOrientation | grep -qx 1   # the iPhone stays portrait
npx playwright test verify/flows --project=desktop --project=phone
maestro --device "iPad Pro 11-inch" test .maestro/smoke.yaml
```

### Order of work inside a phase

1. Read the phase, the bridge table, the ports table and the risks.
2. Write the schema (or the port) and its test first; make it pass.
3. Implement the shell side, then the page side, against the schema.
4. Run the window beside the browser at 1280; compare; fix.
5. Extend the smoke spec for the change.
6. Run the phase gate. Write the progress entry. Commit.

### What an overnight run cannot do

Sign in to Google (so every cloud-mode check is Xiao's), sign or notarize a
build, create a GitHub release, press a media key, rotate or split the
Simulator. Everything else — the spike, phases 2 through 4 entirely, phase 5
up to the unsigned build and the workflow, phase 6 up to the simulator's
portrait — is within reach with the dev server and the simulator running.

## What to do first

1. Phase 0: commit this file, the Stack lines and the feature note.
2. Phase 1, on a throwaway branch: six scripts, six results, in the progress
   file. Half a day. If 1 and 2 pass, the rest is engineering.
3. Phase 2. It is the smallest phase that puts a Dock icon on the screen, and
   the server-address path means it is useful beside the server that day.

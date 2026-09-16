# The browser extension

> **Status:** 2026-09-15. Phases 0 to 4 and Phase 6 are done (branches
> `extension/phase-1` … `extension/phase-4`, then `extension/phase-6`): the
> extension imports through your server from the popup, the page and a
> right-click, and `npm run zip:extension` packages it.
>
> **Phase 5 — the bucket — is the one left.** It waited on a doorman carrying
> the extension's origin; that was deployed on 2026-09-16, so nothing blocks it
> now. Until it is built, importing needs the server awake.
>
> It has been loaded in Xiao's own Chrome since 2026-09-16, and the pill was
> seen working on a real YouTube watch page — it lands in YouTube's own button
> row, left of Like, and reads the library correctly. Everything else below was
> proven in Playwright's Chromium against a fake server. Written for an agent with this
> file open and nobody watching, the way [DESKTOP.md](DESKTOP.md) was: every
> phase ends in something that works, every gate is a command whose exit code
> decides, and the last section is the runbook.

The first version of a Chrome extension that imports what you are already
looking at. The proposals were reviewed as lettered mocks
(https://claude.ai/artifact/VRo8RvGxreQtHUqYsWhaDK) and Xiao accepted every
recommendation. This plan builds the "first version" set only:

| Letter | What | Chosen option |
|---|---|---|
| A | The popup on a song page: cleaned title, tags, playlist, queue footer, and a state for every situation | — |
| B | Importing from the page itself | **B3**: a pill on YouTube and YouTube Music pages, and "Import link to self.mp3" on right-click everywhere |
| C | Playlists, albums and artists reviewed in the popup | — |
| F | The queue without opening the app | **F1**: toolbar badge, one notification per finished batch |
| I | How it reaches the library | **I3**: the server directly when it answers, the bucket otherwise |
| K | Which browsers | **K1**: Chromium (Chrome, Edge, Brave, Arc), Manifest V3 |

Accepted for later, and **not** in this plan: E2 (other sites' track lists →
Migrate), H1 (YouTube sign-in handoff), D1 (checks on thumbnails), G1 (live
version suggestion). J (now playing in the popup) was declined. See "Later".

---

## Where things stand

Facts about the tree this plan starts from, checked on `main` at `20c91ec`.

| Thing | State |
|---|---|
| Import API | `apps/server/src/routes/imports.ts`: `POST /import/preview {url}` → `ImportPreview {kind: single\|playlist, playlistTitle, items[{url,title,artist,album,duration,thumbnail,alreadyHave}]}`; `POST /import/enqueue {items, tagIds, playlistId, createPlaylistName}`; `GET /import/queue`; `GET /import/jobs/:id`; cancel, retry, clear. Everything the popup needs already exists. |
| Progress | Polling only. `ImportJob.status` is `queued/running/done/error/cancelled`, `step` is `waiting…finished` (`IMPORT_STEP_LABELS`), `progress` is set only while downloading. `GET /api/events` carries no import events. |
| Already have | Preview's `alreadyHave` is an exact, case-folded `artist::title` match (`services/importPreview.ts:44-66`). No lookup by link, but `Song.sourceUrl` is stored on import, is in `GET /api/library` and in the cloud snapshot (`schemas/cloud.ts:119`), and `youtubeVideoId()` is in `packages/shared/src/links.ts`. |
| Default tags | `settings.defaultImportTagIds`, added by the worker when a song is saved (`importQueue.ts:434`) — so every path, the bucket's included, gets them without the client sending them. |
| Titles | Nothing tidies a music video's title: "YOASOBI「アイドル」Official Music Video" is stored as it is. `cleanTitle`/`cleanArtist` exist, pure, in `apps/server/src/services/migrateParse.ts:18-45`, used only by Migrate; neither handles 「」. |
| Origins | `sameOriginWrites` (`http/middleware.ts:115`) refuses any write whose `Origin` is not the server itself, `SELFMP3_CORS_ORIGINS`, or `DESKTOP_APP_ORIGIN`. Chrome sends `Origin: chrome-extension://<id>` on an extension's POST, so **every import from the extension is a 403 today.** |
| Reaching the server from the bucket | The snapshot carries `server {addresses, token}` (`container.ts:186`); `serverReach.model.ts` probes `GET /api/health` on every address in parallel and takes the first answer. Pure. The app never falls back to the bucket when the probe fails; the extension will. |
| Bucket imports | `POST /api/cloud/imports {url, tagIds, playlistId}` in `packages/replica/src/routes.ts:418` writes an `importRequested` change (`schemas/sync.ts:144`: `url`, `tagUids`, `playlistUid` — **no title, no artist, no new-playlist name**). Status comes back in the snapshot as `waiting/working/done/failed/cancelled`. |
| Replica | Platform-free. Needs one `CloudPlatform` (`packages/replica/src/platform.ts:61`): store, fetch, randomBytes, returnUrl, openSignIn, deviceKind, onWake, decodeText. Opening it replays the newest snapshot into the store. |
| Doorman | `APP_ORIGINS` in `apps/doorman/wrangler.toml:30,50` is both the CORS list and the list `safeReturn` accepts for the post-sign-in redirect, which lands on `returnTo#signin-code=<code>`. Deployed by hand. |
| `packages/client` | `createApi`, `serverTransport`, errors and `theme/tokens` are free of React Native and the DOM, but the package's only export is its barrel, which pulls in React and React Query. |
| Tooling | Workspaces are `apps/*`, so `apps/extension` is picked up. esbuild 0.28.2, react/react-dom 19.2.3, Playwright 1.63 are installed. `@types/chrome`, `@types/react-dom` and jsdom are not. ESLint lints every workspace type-aware; vitest already globs `apps/*/src/**/*.test.ts`. The Dockerfile copies every workspace's `package.json` for `npm ci`. |

---

## Shape

Three places code runs, and one rule: **only the background talks to a server
or the doorman.**

```
 youtube.com tab                 extension origin (chrome-extension://<id>)
┌───────────────────────┐       ┌──────────────────────────────────────────────┐
│ content/youtube.ts    │ msg   │ background.ts (service worker)               │
│  page kind, the pill  ├──────►│  connection: server direct, else bucket (I3) │
│  no network, no token │◄──────┤  api (createApi) · replica (bucket)          │
└───────────────────────┘       │  job watcher → badge, notifications (F1)     │
                                │  context menus (B2) · library link index     │
 popup.html / review.html       │                                              │
┌───────────────────────┐ msg   │  secrets in IndexedDB, never storage.local   │
│ React DOM: A and C    ├──────►│                                              │
└───────────────────────┘       └──────────────────────────────────────────────┘
 options.html: connect (Google, or address + token)
```

Why the background owns the network:

- **One writer.** The replica's outbox must never reuse a sequence number; one
  context holding it is the simplest way to keep that true.
- **Secrets stay out of pages.** `chrome.storage.local` is readable by content
  scripts, and content scripts run inside youtube.com. The doorman session and
  the server token live in the extension origin's IndexedDB, which no content
  script can open.
- **One poll loop.** The badge and the notifications need something that
  outlives the popup.

**The bridge** (`src/bridge.ts`) is the only door between contexts, following
`packages/desktop-bridge`: every message type has a zod schema for its request
and its reply, checked on both sides. The popup wraps bridge calls in React
Query; the content script calls them directly.

### Connecting (I3)

The options page offers two ways in:

1. **Sign in with Google** — the same account as every other device. The
   background opens the replica with an extension `CloudPlatform`:

   | Member | Extension |
   |---|---|
   | `store` | IndexedDB, a copy of `apps/app/src/ports/idbStore.web.ts` |
   | `fetch`, `randomBytes`, `decodeText` | `fetch`, `crypto.getRandomValues`, `DecompressionStream('gzip')` as in `cloudPlatform.web.ts` |
   | `returnUrl` | `https://<id>.chromiumapp.org/` |
   | `openSignIn` | `chrome.identity.launchWebAuthFlow`, then read `#signin-code` and call `claimSignIn` |
   | `deviceKind` | `'extension'` |
   | `onWake` | the worker's `online` event |

   The server's addresses and token come from `cloudServer()`, as they do for
   the app.

   Sign-in starts from the **options page**, not the worker: `beginSignIn`
   saves the attempt before opening the window, but the code comes back only in
   the redirect, and a worker suspended during a slow Google sign-in would lose
   it. The page lives as long as its tab. Connecting also opens the library
   once, so the first download (1.3 MB gzipped at 5,000 songs) happens there
   and not on the first popup.

   After recording a change the background calls `flushCloudChanges()` straight
   away, and opens the library whenever the worker starts with a non-empty
   outbox: the 1.5 s timer does fire, but a worker stopped before it leaves the
   change waiting for the next open. A write the doorman refuses is retried
   under the same seq and never reported, so the popup shows an outbox that has
   not emptied for a minute as not sent yet.
2. **A server address and token** typed in, for a server with no bucket.

Before a preview or an import, and each time the popup opens, the background
probes every candidate address with `reachServer` (moved to `packages/client`,
below) and keeps the answer for 60 seconds. The header pill shows what won:
"Home server" or "Via your bucket".

The two paths do not offer the same things, and the popup must not pretend
they do:

| | Server direct | Via the bucket |
|---|---|---|
| Details before importing | Preview; title and artist editable | No preview. The page's own title and channel (YouTube oEmbed) shown read-only, with "Your server will read the details when it fetches this." |
| Tags and playlists | The server's ids | The replica's ids, mapped to uids by `requestImport` |
| C: a playlist's tracks | Listed, with ticks | Not listed; one "Request the whole playlist" (the server skips what you have) |
| C: "Also create playlist" | Yes (`createPlaylistName`) | Hidden: `importRequested` has no name field |
| Progress | Job step and percent | Request state from the next snapshot |
| Cancel | `cancelImport` | `cancelCloudImport` |
| Already have | Link index + preview `alreadyHave` | Link index from the replica's songs |

Tag and playlist ids from one path are never used with the other: a
connection object carries its own api, and everything the popup shows is read
through it.

---

## Changes outside the extension (Phase 1)

1. **A fixed extension id.** Commit the public key as `"key"` in
   `manifest.json`, so an unpacked install always has the same id. Add
   `EXTENSION_ORIGIN = 'chrome-extension://<id>'` to
   `packages/shared/src/origins.ts`, and let it through beside
   `DESKTOP_APP_ORIGIN` in both sets in `http/middleware.ts` (lines 116 and
   139), with tests in `middleware.test.ts`. No other extension can claim that
   id, which is the same argument that lets `app://selfmp3` through. The private
   key is not needed for loading unpacked and stays out of the repo.

   The key, generated in Phase 0 and used by every spike, gives the id
   `ojgfoohmmkangonahnbdpelfgmkjkfpi`:

   ```
   MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwwt/kIPLmtnBQ1iOOLLzSGPmc+LEXLIYh4rABc6ieaSiM8dT9XQ9w68fpjweSCQ0XN6QNaN1LVO0pTeTy4MSHbfycnJYgfhZFGoHCNXJo9jr0v797Pys7fbGI8JO+56XW7Ixt7tZrMOelZhR34cpodGqVXgrLFfGPalpV6+eJeocfeaOv17Wu47azPCK+EGS3f3k9XHPY1OXQhw869cwGlKPFJErwH/2th7LcYxXfIrrIXCyQDyLnEX/ctnutfmIo1NLYn13E9q8dnyB4Q1PcXdXr4/bUsFFs0vKb7wqjrpi2Rv1WefK3CdOd+kcBFfqTVNyqoI8frAhKOrcRS7yiwIDAQAB
   ```
2. **Doorman.** Add `chrome-extension://<id>` and `https://<id>.chromiumapp.org`
   to `APP_ORIGINS` in both `[vars]` and `[env.dev.vars]`, with a `cors.test.ts`
   case for each. Xiao redeploys by hand. Both are required (Phase 0): Chromium
   sends the extension's `Origin` on the claim and on every log `PUT`, and
   `safeReturn` only follows a return address on the list. Google's console
   needs no change.
3. **Tidy titles in shared.** Move `cleanTitle`/`cleanArtist` to
   `packages/shared/src/titles.ts` (Migrate imports them from there), and add
   `tidyVideoTitle(title, channel)`:
   - `Artist「Title」…` and `Artist『Title』…` → the bracketed title
   - `Artist - Title (Official Music Video)` → `Title`, when the left side
     matches the channel
   - trailing `Official Music Video`, `MV`, `Lyric Video`, `Official Audio`
     outside brackets as well as inside
   - tested with real titles from the dev library

   The server's preview uses it too (decided, below).
4. **Subpath exports in `packages/client`.** `./api`, `./connection`,
   `./theme/tokens`, `./import` in `package.json#exports`, so the background
   bundle never pulls in React.
5. **Move two pure models out of the app.** `import.model.ts` →
   `packages/client/src/import/model.ts` and `serverReach.model.ts` →
   `packages/client/src/connection/reach.ts`, with their tests. The app imports
   them from the package. Both already depend on nothing but shared.
6. ~~Dockerfile~~ — moved to Phase 2: `COPY apps/extension/package.json` fails
   the image build until the workspace exists.

---

## Repository layout after

```
apps/extension/                          NEW
  package.json          @selfmp3/extension; build, dev, typecheck, verify
  tsconfig.json         lib ES2023+DOM, types chrome, jsx react-jsx, bundler resolution
  (no separate worker tsconfig: the worker shares the pages' project)
  manifest.json         MV3; key; permissions below
  scripts/build.mjs     esbuild, in the style of apps/desktop/scripts/build.mjs
  scripts/zip.mjs       dist → selfmp3-extension-<version>.zip
  src/
    bridge.ts           message schemas (zod), send/handle helpers
    pageKind.ts         tab URL → song | playlist | album | artist | search | other
    background/
      index.ts          wiring, listeners
      connection.ts     server-or-bucket (I3), the 60 s memo
      cloudPlatform.ts  the replica's port
      idbStore.ts
      jobs.ts           batches, polling, badge, notifications (F1)
      jobs.model.ts     pure: batch progress, badge text, notification copy
      linkIndex.ts      videoId → song, rebuilt when the library version changes
      menus.ts          context menus (B2)
      quickImport.ts    one-click import for the pill and the menu
    content/
      youtube.ts        page watcher, the pill (B1)
      anchors.ts        where the pill goes, ordered fallbacks
      pill.ts           shadow-root element, states
    popup/
      main.tsx          popup.html and review.html share it
      Popup.tsx         what it asks for, and which state it draws
      popup.model.ts    pure: inputs → the state to draw
      page.ts           the tab's link and title, or the one given as ?url=
      views.tsx         each state drawn: header, song form, queue footer
      popup.css         tokens copied from packages/client/src/theme/tokens.reference.css
    options/
      main.tsx          connect, disconnect, the pill on or off
  verify/
    playwright.config.ts
    launch.ts           launchPersistentContext with --load-extension
    fakeServer.ts       the import API with fixtures
    popup.spec.ts, pill.spec.ts, badge.spec.ts
```

`apps/extension` is added to the root `tsconfig.json` references, and
`apps/extension/scripts/**/*.mjs` to the plain-node block in `eslint.config.js`.
Root scripts: `build:extension` (shared → replica → client → extension) and
`verify:extension`.

**Dependencies to add** (each gets a Stack line in the progress log first, pinned
from `npm view` on the day): `@types/chrome`, `@types/react-dom`, `jsdom`
(dev, for the anchor tests). esbuild, react, react-dom and React Query are
already in the tree.

**Permissions** in `manifest.json`:

| Permission | For |
|---|---|
| `host_permissions`: `https://www.youtube.com/*`, `https://music.youtube.com/*`, `https://m.youtube.com/*`, the doorman | the pill, oEmbed, sign-in |
| `activeTab` | the popup reading the tab's link, without the "browsing history" warning `tabs` brings |
| `storage`, `alarms`, `notifications`, `contextMenus`, `identity` | settings, the watcher, F1, B2, Google sign-in |

No host permission for the server: once it lets the extension's origin
through, ordinary CORS reaches it, and Chrome's Local Network Access rules did
not block the extension's own pages or worker (Phase 0).

---

## The popup, state by state

`popup.model.ts` turns five inputs into one state: the page kind (from the tab
URL through shared's `youtubeVideoId`, `youtubePlaylistId`, `youtubeMusicAlbum`,
`youtubeChannel`), the connection, a hit in the link index, the preview, and a
job for this link. It is pure and has the most tests.

| State | Shown when | Drawn as |
|---|---|---|
| Not a music page | No YouTube link, or no page kind | Paste box (one link or twenty) and the last five imports |
| Looking up | Preview running (yt-dlp, ~2–3 s) | The song card as a skeleton, with the page title |
| Song | Single, not in the library | Card, "Cleaned from …" when `tidyVideoTitle` changed it, title and artist fields, tag chips with the default tags ticked, manual playlists (pinned first), Import |
| Already in your library | Link index hit, or `alreadyHave` | "In your library since … · played N times", Open in self.mp3, Import anyway |
| Playlist, album, artist (C) | `kind: 'playlist'` | Track rows with ticks, "have" rows unticked, "Also create playlist", tags, "Import N songs", and "Open the full review" past 30 tracks |
| Importing | A job for this link is not finished | Step label, a bar while downloading, Cancel while it can still be cancelled |
| Added | Job done | Tags and playlist it went to |
| Waiting for your server | Bucket request `waiting` | The sentence from the mock |
| Can't import | Job `error`, or the preview refused | The server's own message, which already names the fix |

Two small corrections to the mock, found in the code:

- The added state shows tags and playlist but not BPM and key: analysis runs
  after an import finishes, so they are rarely known in time.
- The cleaned title for the example is アイドル, not "Idol". The tidy rule
  takes what is inside 「」; it does not translate.

**Open in self.mp3** opens the app's Import page at `<app>/import`, where the
queue and the song are. The app has no song route and the library does not read
a search from the URL. `<app>` is the server's own address when connected
directly, `https://xiao215.github.io/selfmp3` through the bucket. **Open the full
review** opens `<app>/import?url=<link>`, which the Import page already
understands from the share target.

---

## The pill (B1) and the menu (B2)

- The content script runs on `www.youtube.com`, `m.youtube.com` and
  `music.youtube.com`. The page kind comes from the URL alone (`pageKind`):
  only `/watch?v=` gets a pill, whatever `list=` says. YouTube Music's album
  links turn into `/playlist?list=OLAK5uy_…`, and its artists are `/@handle`.
- **When to look again.** One `ensure()` runs at start; on the Navigation API's
  `currententrychange` (available in the content script's world, fires within
  10 ms of every URL change on all three sites, Back included); on
  `yt-navigate-finish` on www as a backup; and from a `MutationObserver`
  debounced to 200 ms. The observer matters: YouTube redraws the button row
  1.1–1.7 s after each navigation and deletes whatever was put in it.
- **Where it goes** lives in `anchors.ts` alone. The first *visible* match wins,
  because the last watch page stays in the DOM, hidden:

  | Site | In order |
  |---|---|
  | www | `ytd-watch-metadata #top-level-buttons-computed` (prepend, left of Like; repaired after each navigation) · `ytd-watch-metadata #owner` (append) · `ytd-watch-metadata #top-row` (append) |
  | m. | `ytm-slim-video-action-bar-renderer .slim-video-action-bar-actions` (prepend) · `ytm-slim-video-action-bar-renderer` |
  | music | `ytmusic-player-bar .right-controls-buttons` (prepend; visible during ads and at 800 px) · `ytmusic-player-bar .middle-controls-buttons` (hidden during ads and when narrow) |

  Never a sibling of `#actions-inner` or `#menu`, where YouTube's CSS stretches
  it. No visible anchor within 5 seconds means no pill, and there are at most
  five repairs per URL: below ~600 px YouTube Music hides its bar, and an
  uncapped observer loops. It never throws into the page.
- The pill is `document.createElement('selfmp3-pill')` with a closed shadow
  root and an inline layout style on the outer element: content scripts have no
  `customElements`, and `:host` rules lose to YouTube's CSS. The video id is
  read from `location` at click time, since the row lags the URL by a second.
  Its states: **self.mp3** → **Importing 40%** → **Added · Undo** (Undo cancels
  while the job can still be cancelled, for six seconds) → **In library**.
- Unit tests use small hand-written fixtures of those structures in jsdom, with
  `isVisible` and the navigation source passed in, since jsdom has neither
  layout nor the Navigation API.
- A click sends `quickImport {url}`. The background resolves the connection.
  Direct: preview, stop at "In library" if `alreadyHave`, otherwise enqueue
  with the tidied title, no tags (the worker adds the defaults), no playlist.
  Bucket: `requestCloudImport({url})`. The pill follows the job through the
  same watcher as the badge.
- v1 shows the pill on watch pages only. Playlist pages use the popup (C).
- **Menus:** "Import link to self.mp3" (the same quick import) and "Import with
  tags and playlist…", on links on any page and on the page itself on YouTube.
  The second opens `review.html?url=` in a small window, the popup's UI with a
  link given instead of a tab, because a context-menu click cannot open the
  action popup reliably.

## The watcher (F1)

- Every import the extension starts is a **batch**: the job ids (or request
  uids) one click created, kept in `chrome.storage.local`. These are not secret.
- While a batch is open the background polls `importQueue()` (or
  `cloudImports()`) every 2 seconds while it is awake. A `chrome.alarms` alarm
  every 30 seconds, Chrome's floor, wakes it if it was suspended.
- **Badge:** the number of unfinished jobs across open batches. A red "!" once
  a batch finished with a failure, cleared when the popup opens. Nothing while
  idle.
- **One notification per batch**, with copy from `jobs.model.ts`: "Idol added",
  or "18 songs added · City pop night drive · 1 couldn't be downloaded". A click
  opens the app's Import page.
- The **link index** (`videoId → song`) is rebuilt when `GET /api/library/version`
  (direct) or the cloud library (bucket) changes, and stored in IndexedDB so the
  popup's "already have" answer is instant.

---

## Phases

Server-direct first: it needs no doorman deploy and no Google sign-in, and it
runs against the dev server. The bucket comes last because it needs both.

### Phase 0 — The spike (throwaway branch `extension/spike`)

Answer the questions that could change the plan, with a scrap MV3 extension and
a written result for each in the progress log:

1. **Local network.** Can the service worker `POST` to
   `http://100.x.y.z:4600`, to a LAN address, and to the `https://….ts.net`
   address from SETUP.md, with the server letting the extension's origin
   through? Chrome's Local Network Access rules are the unknown. If only HTTPS
   works, the options page prefers the `ts.net` address and says why. If a
   permission is needed, the options page asks for that one origin.
2. **Sign-in.** Does `launchWebAuthFlow` against `wrangler dev` finish on
   `https://<id>.chromiumapp.org/#signin-code=…`, with the dev vars changed?
3. **Replica in a worker.** Does `createCloudLibrary` open in an MV3 service
   worker on IndexedDB, and how long does it take on the real bucket? If it is
   too slow, fall back to writing the `importRequested` log file directly
   (`HlcClock`, `newUid`, `logKey`) with no tags or playlist in bucket mode.
4. **The pill's anchors** on today's YouTube watch page and YouTube Music player,
   across in-app navigation.

**Gate:** results written. Stop and ask if 1 or 2 fails.

**Result, 2026-09-15 (Playwright's Chromium 153, headless): all four pass.**
The long form is in [universal-progress.md](universal-progress.md).

| Question | Answer | What it changed |
|---|---|---|
| 1. Local network | The worker and extension pages reached loopback and a local-marked address with no Local Network Access block, preflight header or prompt. Chrome sends `Origin: chrome-extension://<id>` on every POST, with or without host permissions, so today's server answers 403. A content script on a public page is blocked before the request leaves. | Phase 1 item 1 is required; no host permission for the server; only the background talks to it |
| 2. Sign-in | `launchWebAuthFlow` (`interactive: true`) returned `https://<id>.chromiumapp.org/#signin-code=…` with the fragment intact. The doorman's own code, with both addresses in `APP_ORIGINS`, redirects there and accepts the claim and the log `PUT`s; today it refuses both. The replica needs no change. | Sign-in from the options page |
| 3. Replica in a worker | Runs unchanged. At 5,000 songs: cold open 150 ms (620 ms with 150 ms added per request), 45 ms after a worker restart, 3.9 MB of IndexedDB, a 36 KB gzipped bundle. No seq reused across worker and browser restarts; 600 concurrent `store.update`s from the worker and a page ended at 600. | The full replica, no log-only fallback; explicit flush; first open while connecting |
| 4. Anchors | Exactly one pill on every watch page on all three sites, through sidebar clicks, Back and every page type; none elsewhere. | The pill section above |

Not testable on this Mac: Tailscale (`100.x` and `https://….ts.net`), real
Chrome 152 (it ignores `--load-extension`), real Google sign-in. They are in the
by-hand list.

### Phase 1 — Groundwork (branch `extension/phase-1`)

The six changes above, each with its tests. No extension yet.

**Gate:** `npm run check && npm run check:app`.

### Phase 2 — The workspace, and A through the server

The Dockerfile's `COPY apps/extension/package.json apps/extension/` in both
stages, manifest, build script, bridge, background with a typed-in server connection,
the link index, the popup's single-song states, the queue footer, the options
page (address and token only).

**Gate:** `npm run check`, `npm run build:extension`, `npm run verify:extension`
(popup spec against the fake server: song → import → importing → added; already
have; error).

**Done, 2026-09-15.** Seven specs pass against the fake server, the last of them
proving the write leaves with the extension's own origin. Two things came out
differently from the tree above: the popup's states are drawn by one `views.tsx`
rather than `screens/` and `parts/` folders, and the worker shares the pages'
tsconfig — what it touches is typed the same in `DOM`, so a second project for
one file would have been a second graph to keep in step.

### Phase 3 — C, F1 and B2

Playlist review, batches, badge, notifications, both context menus and
`review.html`.

**Gate:** as Phase 2, plus the badge spec (enqueue three, badge reads 3, finishes,
one notification).

**Done, 2026-09-15.** Eight specs pass; the playlist one ticks through a list,
creates the playlist, watches the badge count the batch and clear, and reads
back the notice the worker sent. Three things differ from the plan:

- **No `review.html`.** The popup already takes `?url=`, so "Import with tags and
  playlist…" opens *it* in a window of its own. One page, not two.
- **The popup follows a batch it started.** A playlist's tracks are queued under
  their own links, so the job for the page's link (`jobForLink`) finds nothing
  and the popup sat on the list saying nothing — caught by the spec, not by
  hand. `batchProgress` follows the first track still going, and the added state
  says "2 songs added to your library" when several landed.
- **The badge counts only this extension's imports** (`jobs.model.ts`): a share
  from a phone and a folder scan both add jobs nobody at this computer asked
  for, and a badge that counted those would be noise.

### Phase 4 — B1, the pill

Content script, anchors, the pill's states, Undo.

**Gate:** as Phase 2, plus anchor tests in jsdom against minimal saved page
skeletons, and the pill spec on a fixture page served under a YouTube host via
Playwright `context.route`.

**Done, 2026-09-15.** Thirteen specs across two files; the pill ones serve their
own watch page at a youtube.com address, so the real content script runs in a
real page without depending on YouTube's markup of the day. Four things to know:

- **A content script may ask far less than a page of the extension may.** The
  bridge still refuses them; they get their own channel — hand over a link, be
  told what the pill should draw — and are never told the server's address or
  its token, never offered the tags or the playlists, and cannot choose what an
  import is tagged with. An import from the pill takes your defaults, as the
  right-click item does.
- **No zod in the content script.** The worker checks what arrives from a page,
  which is the side with something to protect, so the script carries a plain
  typed wrapper instead — 196 KB rather than the schema library on top.
- **The shadow root stays closed**, so the pill reports its state on the host
  element. That is what keeps YouTube's own scripts out and still lets a spec
  read it.
- **Undo is not built.** The pill says "Added" and stops being pressable once
  the song is yours, rather than offering an undo that does nothing.

### Phase 5 — I3, the bucket

Google sign-in on the options page, the replica in the background, the fallback,
the waiting state, bucket-mode differences in the popup. Needs Xiao's doorman
deploy.

**Gate:** as Phase 2, plus connection tests with a fake probe (answers → direct;
no answer in time → bucket; bucket session missing → "Connect in options").

### Phase 6 — Packaging and docs

`scripts/zip.mjs`, `docs/features/browser-extension.md` (install unpacked,
connect, what each part does), a README section, the progress log, and an
optional `extension.yml` that builds the zip on an `extension-v*` tag, modelled on
`desktop.yml`.

**Gate:** `npm run build && npm run build:extension`, zip produced.

**Done, 2026-09-15**, out of order: Phase 5 waits on the doorman, and packaging
does not. `npm run zip:extension` writes
`apps/extension/release/selfmp3-extension-<version>.zip` (1.2 MB) with the `zip`
command rather than a new dependency;
[browser-extension.md](features/browser-extension.md) says how to load and
connect it, what each part does, and what it cannot do yet; `extension.yml`
builds and zips on demand or on an `extension-v*` tag and drafts a release, with
nothing to sign, because Chrome signs at upload and an unpacked folder needs no
signature.

This branch also merged `main`, so it carries the rewritten README and the
licence. The README's extension paragraph was out of date the moment Phase 3
landed — it still said the pill and the badge were to come — and now describes
what is there, pointing at the feature doc rather than this plan.

### Later — not in this plan

E2 (read another site's track list, hand it to Migrate), H1 (YouTube sign-in
handoff, straight to the server only), D1 (checks on thumbnails, built on the
link index from Phase 2), G1 (live-version suggestion, reusing `migrateScore`),
Firefox (K2), Safari inside the Mac app (K3).

---

## Verification

- **Unit (vitest):** `pageKind`, `tidyVideoTitle`, `popup.model`, `jobs.model`,
  bridge schemas, the connection resolver with a fake probe, anchors (jsdom
  per file).
- **End to end (`apps/extension/verify`):** Playwright 1.63
  `chromium.launchPersistentContext` with `--load-extension=<dist>` and a fresh
  profile, as `apps/desktop/verify/launch.ts` does for Electron. An action popup
  cannot be opened by Playwright, so specs open
  `chrome-extension://<id>/popup.html?url=<link>` in a tab; the popup uses a
  given link in place of the tab's. The server is `fakeServer.ts`: health,
  preview, enqueue, queue, jobs, library, tags, playlists, with fixtures and
  jobs that advance on a clock, so no spec touches YouTube.
- **By hand, for Xiao, at the end:** load unpacked in real Chrome; import a song
  from YouTube and from YouTube Music; a playlist with "Also create playlist";
  the pill on three videos in a row without reloading; a right-click import from
  a Reddit link; a batch notification; server asleep → "Waiting for your server"
  → wake it → added. From the worker's DevTools, `GET /api/health` and a `POST`
  to the server's `100.x` and `ts.net` addresses, expecting no prompt and no
  address-space error. After the doorman deploy, Google sign-in from the options
  page with an allowed and a refused account.

## Risks, and what retires them

| Risk | Retired by |
|---|---|
| Chrome blocks an extension from `http://` local addresses | Spike 1 found no block from the extension's own contexts in Chromium 153; Tailscale's `100.x` range in Chrome 152 is checked by hand, and the options page prefers the `ts.net` address if it fails |
| YouTube's markup changes and the pill loses its place | The pill hides itself; the popup and the menu never depend on page markup |
| MV3 suspends the worker and loses timers | Alarms as the backstop; flush the outbox straight after writing to it |
| Replaying the snapshot is too heavy for a worker | Spike 3, and the log-file-only fallback |
| Server ids and replica ids get mixed | One api per connection; tests for bucket mode never see a server id |
| Exact `artist::title` misses a music video's title | `tidyVideoTitle` before comparing, and the link index |

## Sizing

Phase 0 half a day; 1 one day; 2 two days; 3 one and a half; 4 one; 5 one and a
half (plus the deploy); 6 half. About eight working days.

---

## Decided by Xiao, 2026-09-15

1. **The server's preview tidies titles too.** `importPreview.ts` runs
   `tidyVideoTitle` on items yt-dlp resolved (YouTube Music's own API already
   returns clean track names), so the app's Import page and the share Shortcut
   get "アイドル" as well as the extension. Part of Phase 1.
2. **The extension's public key is committed** as `"key"` in `manifest.json`, so
   its id and origin are fixed and allowed in code beside `app://selfmp3`.
3. **The doorman redeploy** at Phase 5 is Xiao's, as always.

---

## Runbook for an unattended agent

### Ground rules

- One phase per branch (`extension/phase-N`), merged forward. Commit only on a
  green gate. Never commit `dist/`, zips or a private key.
- No new dependency without its line in the progress log first.
- `packages/*` stay free of DOM and extension APIs; `chrome.*` is used only in
  `apps/extension`.
- The bridge is the only door; every message has a schema on both sides.
- The token and the doorman session never go in `chrome.storage.*`.
- **Stop and ask when:** a spike question fails; a gate fails twice on the same
  cause; a `packages/shared` schema would change; Google sign-in, a deploy or a
  key is needed; the popup would show something the mock did not.

### Environment

- `npm install` in the worktree first. Port 4600 may already be another
  worktree's server on the dev profile; the verify specs use the fake server on
  a free port instead.
- Chromium for Playwright is already in `~/Library/Caches/ms-playwright`.

### Gates

```bash
npm run check                          # every phase
npm run check:app                      # phase 1 (models move out of the app)
npm run build:extension                # phases 2–6
npm run verify:extension               # phases 2–5
```

### Order of work inside a phase

Model and its test → implementation → spec → gate → progress entry → commit.

### What an overnight run cannot do

Deploy the doorman, sign in with Google, load the extension into Xiao's own
Chrome, or check the pill on live YouTube. Phase 5 stops at a green gate with
the fake doorman, and says so.

## What to do first

Phase 0.

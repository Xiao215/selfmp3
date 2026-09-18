# The browser extension

Import the song you are already listening to. A button in the YouTube page, a
popup in the toolbar, and a right-click item anywhere — each of them hands a
link to your own server, which does the fetching as it always has. With the
server asleep the link waits in your bucket until it wakes.

Chrome, Edge, Brave and Arc. Firefox and Safari are not built.

---

## Installing it

```bash
npm run build:extension
```

Then in Chrome: **chrome://extensions** → turn on **Developer mode** → **Load
unpacked** → choose `apps/extension/dist`.

It is not in any store, so this is the way to install it. The extension carries
a fixed key, so its address is always
`chrome-extension://ojgfoohmmkangonahnbdpelfgmkjkfpi` — which is what your
server already allows, with nothing to configure.

`npm run zip --workspace @selfmp3/extension` writes
`apps/extension/release/selfmp3-extension-<version>.zip` if you want to keep a
copy or upload one.

## Connecting it

The options page opens the first time you install it, and from the gear in the
popup after that. **Sign in with Google** — the same account as your phone and
the app — and there is nothing to type: your server's addresses come with every
sync, and the extension tries them all each time it needs one.

Importing still goes through the server, because the server is what runs yt-dlp.
What signing in changes is what happens when the server is off: the link is
written into your bucket instead, and the server fetches it the next time it is
awake. See *Importing while your server is asleep*, below.

**Or point it at one server.** Under the sign-in there is still an address —
`http://localhost:4600` on the same computer, or its `https://….ts.net` address
over Tailscale — for a library with no bucket, or a server this computer can
reach that your library has never been told about. An address here is tried
before the ones from your sync.

A token is asked for only if that server turns out to want one, so the page tries
the address on its own first and the token field appears if the server refuses
without it. Pointed at `http://localhost:4600` it will not: the server does not
ask its own machine for a token. Over Tailscale or across the Wi-Fi it will, and
the token is the one in the server's startup log — or in `SELFMP3_AUTH_TOKEN`,
if you set one of your own.

The address is checked before it is kept: it has to answer, and the token, where
there is one, has to be right. Everything the extension knows — the session, the
token, your copy of the library — lives in the extension's own storage, which no
web page can read, not even the script it runs inside YouTube.

## What it does

**The pill, in the page.** On a YouTube, YouTube Music or m.youtube.com watch
page there is a **self.mp3** button beside Like. It says *In library* when the
song is already yours; otherwise pressing it imports the song with your default
tags, and it follows the download — *Importing 40%* — to *Added*. It finds its
place from the address, so it follows you from video to video without a reload,
and it is not drawn where there is no song.

**The popup, from the toolbar.** The same song, with everything to decide first:
the title tidied out of the video's own (see the importing section of the
[README](../../README.md)), the artist, your tags, and a playlist to drop it
into. The tags your server adds to every import are shown already on and cannot
be turned off, because the server adds them whatever the popup sends.

It has a state for each way this goes: the song, one already in your library
(*In your library since 12 Aug · played 41 times*), an import in progress, one
that landed, and the server's own words when a link cannot be read — a private
video, say. On a page with nothing to import it offers a box to paste a link
into, under the last few songs you imported.

**A playlist, an album or an artist.** The popup lists what the link holds, with
the songs you already have unticked, and offers to create a playlist of the same
name. Long lists show the first eight and a link to the full review on the
Import screen.

**Right-click, anywhere.** *Import link to self.mp3* takes any link — a YouTube
one, or anything else yt-dlp can read — with your defaults. *Import with tags and
playlist…* opens the popup on that link instead. Both work on a link, on
selected text holding one, or on the page you are reading.

**Importing while your server is asleep.** Signed in, the extension asks your
server directly whenever one of its addresses answers, and when none does it
writes the link into your bucket instead — your server downloads it the next
time it is awake, and it arrives in your library with the sync after that. The
header says which is happening: your server's address, or *Via your bucket*.

What that costs is the *looking*, not the importing. Only your server can read a
link at all, so through the bucket there is no title tidied out of the video's,
no track list to tick through, and no playing a song before it is added: the
popup takes the link as it is, with your tags and a playlist, and says *Waiting
for your server* until it has been taken. *Don't bother* calls one off. A
playlist goes in whole — your server skips what you already have.

**The toolbar counts.** While imports you started here are going, the button
carries their number; when they finish, one notification says what landed —
*2 songs added · City pop night drive · 1 couldn't be downloaded*. Imports from
anywhere else — your phone's share sheet, a folder scan — are not counted, so
the badge is only ever about what you did here.

## What it does not do yet

- **Undo.** Once a song is in, the pill says *Added* and stops there; cancelling
  is in the popup while the download is still running.
- **Anything but Chromium.** Firefox needs a little of its own, and Safari would
  ride along inside the Mac app.
- **Read what is on the page.** It knows the address of the tab you are on and
  nothing else — no watch history, no page contents.

## What it asks Chrome for

| Permission | What for |
|---|---|
| `activeTab` | the address of the tab when you open the popup |
| `identity` | the Google sign-in window, and the address it comes back to |
| youtube.com, m.youtube.com, music.youtube.com | the pill in the page |
| `contextMenus` | the two right-click items |
| `notifications` | one notice when a batch of imports finishes |
| `alarms` | keeping the badge right when Chrome has stopped the worker |
| `storage` is **not** asked for | what it keeps lives in the extension's IndexedDB, which content scripts cannot read |

## How it is put together

| What | Where |
|---|---|
| The one part that talks to a server: the connection, the library index, the handlers | `apps/extension/src/background/` |
| Which way in wins — the server, or the bucket | `apps/extension/src/background/connection.ts` |
| Your copy of the library, and the session behind it | `apps/extension/src/background/cloud.ts`, `cloudPlatform.ts` |
| The typed door between the pages and that worker | `apps/extension/src/bridge.ts` |
| The popup: what it shows, and what draws it | `apps/extension/src/popup/popup.model.ts`, `views.tsx` |
| The pill: where it goes, what it is, when to look again | `apps/extension/src/content/` |
| The badge and the notification | `apps/extension/src/background/jobs.model.ts`, `watcher.ts` |
| Options | `apps/extension/src/options/` |
| The end-to-end specs, and the fake server they run against | `apps/extension/verify/` |

Two rules the code keeps, and the reasons:

- **Only the worker talks to a server.** It holds the address, the token and the
  Google session, and a script running inside youtube.com can reach none of
  them. Chrome would block that script from reaching a local address anyway,
  which is a second reason for the same arrangement. It is also the only place
  your copy of the library lives: two copies would hand out the same log
  sequence number twice, which is the one thing the bucket cannot survive.
- **A content script is treated as the page it runs in.** It has a channel of its
  own that can do exactly one thing — hand over a link, and be told what the pill
  should say. It is never told your tags, your playlists, your server's address
  or its token.

What is not built yet is in [`docs/FEATURE_TODO.md`](../FEATURE_TODO.md).

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
probes every candidate address with `reachServer` (`packages/client`) and keeps the answer for 60 seconds. The header pill shows what won:
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

## What the spike settled

Four questions that could have changed the design were answered with a scrap
MV3 extension before anything was built (2026-09-15, Playwright's Chromium 153,
headless). Code comments cite them by number.

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


| Question | Answer | What it changed |
|---|---|---|
| 1. Local network | The worker and extension pages reached loopback and a local-marked address with no Local Network Access block, preflight header or prompt. Chrome sends `Origin: chrome-extension://<id>` on every POST, with or without host permissions, so today's server answers 403. A content script on a public page is blocked before the request leaves. | Phase 1 item 1 is required; no host permission for the server; only the background talks to it |
| 2. Sign-in | `launchWebAuthFlow` (`interactive: true`) returned `https://<id>.chromiumapp.org/#signin-code=…` with the fragment intact. The doorman's own code, with both addresses in `APP_ORIGINS`, redirects there and accepts the claim and the log `PUT`s; today it refuses both. The replica needs no change. | Sign-in from the options page |
| 3. Replica in a worker | Runs unchanged. At 5,000 songs: cold open 150 ms (620 ms with 150 ms added per request), 45 ms after a worker restart, 3.9 MB of IndexedDB, a 36 KB gzipped bundle. No seq reused across worker and browser restarts; 600 concurrent `store.update`s from the worker and a page ended at 600. | The full replica, no log-only fallback; explicit flush; first open while connecting |
| 4. Anchors | Exactly one pill on every watch page on all three sites, through sidebar clicks, Back and every page type; none elsewhere. | The pill section above |

Not testable on this Mac: Tailscale (`100.x` and `https://….ts.net`), real
Chrome 152 (it ignores `--load-extension`), real Google sign-in. They are on the
by-hand list in [`docs/FEATURE_TODO.md`](../FEATURE_TODO.md).

# The browser extension

Import the song you are already listening to. A button in the YouTube page, a
popup in the toolbar, and a right-click item anywhere — each of them hands a
link to your own server, which does the fetching as it always has.

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
popup after that. It wants:

- **Address** — your **server's** address: `http://localhost:4600` on the same
  computer, or its `https://….ts.net` address over Tailscale. Not where you
  listen. The extension is the one part of self.mp3 that still points at a
  server by address, and it has to be, because only the server runs yt-dlp.
- **Token** — only if you set `SELFMP3_AUTH_TOKEN` on the server.

It checks both before keeping them: the address has to answer, and the token has
to be right. Everything the extension knows lives in the extension's own
storage, which no web page can read — not even the script it runs inside
YouTube.

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

**The toolbar counts.** While imports you started here are going, the button
carries their number; when they finish, one notification says what landed —
*2 songs added · City pop night drive · 1 couldn't be downloaded*. Imports from
anywhere else — your phone's share sheet, a folder scan — are not counted, so
the badge is only ever about what you did here.

## What it does not do yet

- **Import while your server is asleep.** Everything goes through the server,
  which is what runs yt-dlp. Signing in with Google and leaving the request in
  your bucket for the server to pick up later is planned, not built
  ([EXTENSION.md](../EXTENSION.md), Phase 5).
- **Open the app from the popup.** *Review the full list* and the queue footer
  open the configured address with `/import` on the end, which was the app when
  the server served it and is now the server's own page. They need to open the
  Pages build, or the desktop app, instead (`apps/extension/src/popup/Popup.tsx`,
  `openApp`).
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
| youtube.com, m.youtube.com, music.youtube.com | the pill in the page |
| `contextMenus` | the two right-click items |
| `notifications` | one notice when a batch of imports finishes |
| `alarms` | keeping the badge right when Chrome has stopped the worker |
| `storage` is **not** asked for | what it keeps lives in the extension's IndexedDB, which content scripts cannot read |

## How it is put together

| What | Where |
|---|---|
| The one part that talks to a server: the connection, the library index, the handlers | `apps/extension/src/background/` |
| The typed door between the pages and that worker | `apps/extension/src/bridge.ts` |
| The popup: what it shows, and what draws it | `apps/extension/src/popup/popup.model.ts`, `views.tsx` |
| The pill: where it goes, what it is, when to look again | `apps/extension/src/content/` |
| The badge and the notification | `apps/extension/src/background/jobs.model.ts`, `watcher.ts` |
| Options | `apps/extension/src/options/` |
| The end-to-end specs, and the fake server they run against | `apps/extension/verify/` |

Two rules the code keeps, and the reasons:

- **Only the worker talks to a server.** It holds the address and the token, and
  a script running inside youtube.com can reach neither. Chrome would block that
  script from reaching a local address anyway, which is a second reason for the
  same arrangement.
- **A content script is treated as the page it runs in.** It has a channel of its
  own that can do exactly one thing — hand over a link, and be told what the pill
  should say. It is never told your tags, your playlists, your server's address
  or its token.

The plan it was built to, phase by phase, is [EXTENSION.md](../EXTENSION.md).

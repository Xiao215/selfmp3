# Downloading songs in the browser, or on the phone

When you import from the web app in Chrome with the self.mp3 extension
installed, or from the phone app, the YouTube songs are downloaded by your
browser or phone instead of by the server — and a single video is also looked
up and listened to there, so the server never asks YouTube about it at all.
The server still does everything after the download — tags, lyrics, cover,
library, bucket — exactly as for a song it downloaded itself. Nothing changes
anywhere else: in the Mac app, in a browser without the extension, or when no
server answers, the server downloads as before. It can be turned off in
Settings (below).

A phone is where this helps most: on mobile data it is on another network from
the server, so its downloads count against a different address (_On a phone_,
below).

**Where:** the download code is `packages/ytclient`, run in a sandbox frame
(`src/sandbox/`, bundled into `apps/app/public/yt-sandbox.js`) in a browser, and
in a hidden WebView on a phone (`src/webview/`, bundled into
`apps/app/public/yt-webview.js`, held by `src/ports/youtubePage.tsx`); the app drives it
from `apps/app/src/features/import/deviceImports*.ts`, `devicePreview.model.ts`,
`devicePrefs.ts` and `src/ports/deviceDownloads*.ts`;
the extension forwards its requests in `apps/extension/src/background/ytProxy.ts`;
the server's side is `apps/server/src/routes/importDevice.ts` and
`receiveDeviceFile` in `services/importQueue.ts`.

## Why

YouTube limits how often one address may ask it for videos. Every download used
to come from the server's address, and on a server shared by several people
(`docs/features/shared-server.md`) they all shared one limit. A download in the
browser comes from the listener's own connection instead.

The work is split so that the part YouTube keeps breaking lives in the web page,
which is redeployed whenever we like:

- **The page** runs youtubei.js and BotGuard (YouTube's bot check), and decides
  which YouTube client to pretend to be.
- **The extension** only forwards requests, because a web page is not allowed
  to talk to YouTube directly (CORS). It knows nothing about YouTube's formats,
  so it should rarely need an update — and Chrome extensions may not download
  new code anyway.

## What happens when you press Import

1. The app checks that the extension answers (one request to YouTube's empty
   `generate_204` page). If it does not, the import goes to the server as before.
2. The app sends the import with `fetchOnDevice: true`. The server queues the
   songs as usual, but **holds the YouTube ones for this device** under a lease
   that lasts five minutes unless the device renews it. 网易云 songs are still
   the server's.
3. One song at a time, the app tells the server it is starting, downloads the
   m4a through the extension, and uploads it (`PUT /api/import/device/jobs/:id/file`),
   with its SHA-256 and the video's description in two headers.
4. The server checks the file: the right hash, no bigger than any song, and
   ffprobe finds audio as long as the song. Only then does the job leave the
   device. A file that fails a check is refused and never reaches the library.
   A file that passes waits for a free place among the downloads in flight
   (Settings → Importing → Downloads at once), as the server's own do, so
   several devices sending at once cannot run more than the machine allows.
   While it waits it shows as waiting and can still be paused or removed; the
   file goes with it.
5. From there the server finishes the job as it finishes its own downloads,
   with one extra step: it writes the tags yt-dlp would have written —
   title, artist and album as you confirmed them in the review, the release
   date from the video's description (`releaseOf` in `packages/shared`), and
   the cover inside the file (`services/tagWriter.ts`).

The import screen shows these jobs like any other: waiting, downloading, adding,
done.

## Looking a video up, and listening to it

Before you import, the review shows the song and lets you hear it. For a link to
**one YouTube video** — not a playlist, a search, an album or a channel, which
the server still reads — both happen in the browser too:

- **Looking it up** (`previewImport`): one player request through the extension
  gives the title, channel, length, cover and description. The song is named by
  the same rules the server uses on yt-dlp's answer (`toProbedTrack`, now in
  `packages/shared`), and a YouTube Music track's description gives its song,
  artists and album, as yt-dlp reads them (`musicCredits`). Whether the library
  has it already is asked of the server (`/import/already-have`), which answers
  without asking YouTube.
- **Listening** (`listenSource`): the browser downloads the whole song — about
  a second — and plays it from memory. The last eight songs are kept, so
  pressing Import afterwards uploads the song you heard without asking YouTube
  for it again.

Each takes a turn from the browser's budget (below) and does not wait for one:
with no turn to spare, or if anything fails, the server looks the link up or
plays the song as before. For a link the server reads, it is told not to look
up where the first rows' audio is (`warmListen: false`), since the browser
would be the one listening.

## Settings

Two switches in the app, under **Settings → Advanced → In this browser** (on a
phone, **On this device**), kept on the device (`devicePrefs.ts`) and shown on a
phone and in a browser tab the extension runs in — Chrome and the browsers made
from it, not Safari or Firefox:

- **Download songs here** (on): whether this browser looks up, plays and
  downloads YouTube songs at all. Off, the server does all of it, as before.
  Turned off partway through an import, the songs this browser has not started
  go to the server at once; the one downloading finishes.
- **Let the server take over when YouTube slows this browser down** (on): when
  YouTube refuses this browser for rate, the songs it has not downloaded go to
  the server, and so does anything imported while the pause lasts — 15
  minutes from each refusal.
  Off, the browser waits the pause out and downloads them itself, its lease
  kept alive meanwhile. Looking up and listening go to the server during a
  pause either way: a person is waiting for those.

Below them, once YouTube has refused this browser, **Pace at YouTube** says how
far its budget was cut and how long a pause has left, with **Reset**. Each
refusal halves the browser's pace for good, as a server's does, and only a
person puts it back.

And one in the extension's own options page: **Use my YouTube sign-in** (off),
under _Signed in_ below. It lives in the extension because the extension is
what would send the sign-in; no page can turn it on.

## On a phone

A phone app is not a web page, so nothing stops it asking YouTube, and it needs
no extension. youtubei.js, the player script and BotGuard run in a WebView the
app keeps out of sight (`YouTubePage`), whose page is given YouTube's own
address (`https://www.youtube.com/`): its requests are YouTube's page asking its
own site, and the media and BotGuard's servers answer it as they answer
YouTube's player. Nothing is forwarded, and BotGuard runs in the page itself —
the page is at the address its verdict is about, which the browser's sandbox
frame is not.

- **Kept apart.** The WebView is a browser of its own: it shares no cookies with
  the app and holds no self.mp3 session, and the app talks to it only by
  messages (`packages/ytclient/src/webview/protocol.ts`) — describe this video,
  download that one; the facts come back, or the file in base64 chunks. It
  follows no link away from its page.
- **Brought up to date with the web app.** The page's script is the web app's
  `yt-webview.js`, loaded from its address, so a change YouTube makes is met
  by publishing the web app, not by a new build of the phone's. Until the web
  app with that file is published, the phone finds no page and the server
  downloads, as before.
- **Opened as Import opens**, not when the app starts: loading the script and
  BotGuard's first run are a few seconds of a phone's time, and most launches
  import nothing. A look-up, a listen or an import never waits for it: until
  the page says it is ready, the server takes that one. A page that does not
  load within 30 seconds is not tried again for a minute.
- **In the foreground.** iOS stops the app's JavaScript and the WebView soon
  after the app leaves the screen; the lease runs out and the server takes the
  songs, as for a closed tab. A page the system closes is opened again at the
  next ask.
- **Its own budget**, kept with the phone's other small things (`prefs.ts`),
  and the same two switches in **Settings → Advanced → On this device**.

Checked in Chromium with the page served at YouTube's address and no extension
(`npx playwright test -c packages/ytclient/verify webview`): described and
downloaded whole, 5.8 MB in about 3 seconds (2026-10-28). **Not yet tried in
iOS's or Android's own WebView** on a phone.

## Finding the extension

The app looks for the extension the first time it would use it. A way found is
kept; a look that found none is believed for 30 seconds and then made again, so
an extension that was asleep, turned off and on, or slow to answer is found
without a reload. One installed after the page was opened is not: Chrome gives a
page its way to an extension as the page loads, so that takes one reload.

## When something goes wrong, the server takes over

The device never fails a song. Whatever it cannot do, it hands back, and the
server downloads that song itself with yt-dlp:

| What happened                                            | What the app does                                                                                                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The download failed                                      | Hands that song back (`/import/device/release`) and goes on to the next                                                                                    |
| The server refused the file                              | The same                                                                                                                                                   |
| YouTube refused this browser for rate ("not a bot", 429) | Hands back **every** song still waiting, and stays away from YouTube for 15 minutes — or, with the second switch off, waits the 15 minutes out and goes on |
| You closed the tab, or the computer slept                | Nothing: the lease runs out and the server takes the songs                                                                                                 |
| You cancelled or removed the song                        | The next renewal says the server no longer holds it, and the app stops                                                                                     |
| The server restarted                                     | A download in progress stays the device's; nothing is lost                                                                                                 |

The app renews its lease every minute. A lease is five minutes because a
background tab's timers can be slowed to once a minute.

## Pacing

The browser keeps its own budget at YouTube, by the same rules as the server's
(`packages/shared/src/ytBudget.ts`), stored in the tab's `localStorage`. The
first few songs go at once; after that, about one every 24 seconds, as on a
server with no YouTube cookies.

## The sandbox

YouTube's player script, which youtubei.js has to run to read a video's links,
is code YouTube sends, and the app's page holds your self.mp3 sign-in. So the
page does not run it. youtubei.js and the player script run in a hidden iframe
with `sandbox="allow-scripts"` and nothing else (`packages/ytclient/src/sandbox/`):
an origin of its own, with no way to the page's storage, its cookies or its
session. The frame can only ask the page to fetch, and the page fetches only
YouTube's addresses, through the extension. The page asks the frame to describe
or download a video and gets the facts or the file back. The app's own bundle
no longer contains youtubei.js at all; it imports `@selfmp3/ytclient/host`.

**BotGuard is the one exception, and still runs in the page.** Run in the frame,
it gave an answer YouTube would not issue an integrity token for (2026-10-18):
BotGuard reports the environment it runs in, and a frame with no origin is not
one YouTube accepts. Making the frame look like something it is not would be
working against Google's bot check, so the page runs BotGuard (bgutils-js) and
hands the frame each anti-bot token it asks for.

## Signed in

With **Use my YouTube sign-in** on in the extension's options, the player
request — the one YouTube counts against an account rather than an address —
goes with this browser's YouTube sign-in: Chrome's own cookies, and the
`SAPISIDHASH` header YouTube's pages send, made by the extension from the
`SAPISID` cookie (`signsIn` and `sapisidHash` in `packages/shared/src/ytProxy.ts`).
Nothing else goes signed in, whatever the option — not the media, and nothing
that could like, subscribe or comment. The page never sees a cookie. The
extension has no access to cookies until the option is turned on: `cookies`
is an optional permission, taken on the click that turns the option on and
given back when it is turned off. Chrome shows no prompt for it — `cookies`
carries no install warning, and Chrome asks only for permissions that do.

The risk is the account's: YouTube may flag an account that downloads a lot,
which is why it is off.

Signed in, the clients that give whole songs signed out do not: the page
cannot see the extension's option, so a download learns it from YouTube's
answers and asks the clients that suit (`SIGNED_IN_CLIENTS` in
`packages/ytclient/src/download.ts`). Tried with a throwaway account on
2026-10-29, the player request signed in and every other request without:

| Client | Signed in | Signed out |
|---|---|---|
| `VISIONOS`, `IOS`, `ANDROID_VR`, `TV_SIMPLY` | 400 `INVALID_ARGUMENT` — they take no account. The cookie alone, or the header alone, is taken as signed out | `VISIONOS`: the whole song |
| `WEB_CREATOR` | the whole song, age-restricted ones too (`logged_in=1`) | `LOGIN_REQUIRED: Please sign in` |
| `YTMUSIC` | the whole song; music tracks only | the whole song |
| `MWEB` | refused at the first megabyte, whatever its token was bound to — the video, the visitor, the account's DataSync ID | the same |
| `WEB` | SABR only | the same |
| `TV` | `The page needs to be reloaded` | — |

So a download asks `VISIONOS` first; a 400 from it says the request went
signed in, and the session asks `WEB_CREATOR` then `YTMUSIC` from then on. A
`Please sign in` from `WEB_CREATOR` says the option was turned off, and it
goes back. The first song after the option changes costs one player request
more. Checked end to end in an off-screen Chromium on that account: a song, an
age-restricted video and a music track signed in through `WEB_CREATOR`, and
`VISIONOS` again once the option was off.

## What the extension is allowed to do

It forwards requests for self.mp3's own pages only — the app's path, not the
rest of the site it is published on (`YT_PROXY_PAGES`) — to YouTube's
addresses only,
and **without your YouTube cookies** unless you turned the sign-in on — and
then only for the player request, as above. One rule rewrites the `Origin` header on the
extension's requests to YouTube's API and video servers, because YouTube refuses
any other origin. See _What it asks Chrome for_ in
[browser-extension.md](browser-extension.md).

## What we found while building it (2026-10-13)

YouTube changes these from month to month; check the date before relying on them.

| Finding                                                    | Detail                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| YouTube refuses requests that do not come from youtube.com | Its API answered 403 to `Origin: chrome-extension://…` and to `localhost`, hence the header rule                                                                                                                               |
| …except BotGuard, which wants the page's own               | With the rewrite, YouTube issued no integrity token. The rule leaves BotGuard's requests alone                                                                                                                                 |
| The anti-bot token is per video                            | A token made for the session was refused like none at all. yt-dlp's PO Token Guide says the same                                                                                                                               |
| Only one YouTube client gives whole files                  | `VISIONOS` (Apple Vision Pro). `MWEB` and `YTMUSIC` stopped after 1 MB; `WEB` only offers SABR, a streaming format this does not speak                                                                                         |
| An occasional 403                                          | 4 of the first 26 downloads. Asking for a fresh link and resuming at the same byte fixes it                                                                                                                                    |
| Speed                                                      | Under a second for a 3–6 MB song, after 1–2 seconds to start a session                                                                                                                                                         |
| Metro and youtubei.js                                      | Metro could not load youtubei.js's own modules ("Cannot access 'Platform' before initialization"); the prebuilt `youtubei.js/web.bundle` works. It is bundled by esbuild into the sandbox frame now, and not in the app at all |
| A static `regexFilter` rule stops the extension loading    | Three `urlFilter` rules do the same job                                                                                                                                                                                        |
| BotGuard in the sandbox frame (2026-10-18)                 | YouTube issued no integrity token for its answer, with or without storage the frame could use. It runs in the page instead                                                                                                     |
| A whole review in the browser (2026-10-14)                 | Looked up in 2.6 s, playing 4.9 s after the press, imported with no second download — and the server's log shows no preview and no listen, only the library check, the queue and the file                                      |

## Trying it

In the app: load `apps/extension/dist` in Chrome (_Load unpacked_), open the web
app on `localhost:4601` (`npm run dev:web`) or the GitHub Pages address, and
import a YouTube link. The browser's console says `[device import] …` for what
it downloaded, or why the server is downloading instead.

Just the download, without a server:

```bash
npm run build:extension
npm run verify:ytclient                     # downloads a song, checks it with ffprobe
YT_VIDEOS=SJKoWAd5ySo,dQw4w9WgXcQ npm run verify:ytclient
```

`YT_CLIENTS=VISIONOS,MWEB` picks clients, `YT_PO=0` turns the anti-bot token
off, `HEADED=1` shows the browser. These ask the real YouTube, so they are not
part of `npm run check`. By hand: `npm run harness --workspace @selfmp3/ytclient`
and open `http://localhost:4602`.

## Not done

- **Google's /sorry/ page reached by a redirect.** The extension says a
  redirect to it as a refusal for rate, but only if Chrome lets the answer
  through: the extension may reach `www.google.com/js/th/` and no other part
  of that host, so a redirect from YouTube to `/sorry/` most likely fails as
  a fetch, and the song goes to the server as an ordinary failure. Letting
  it through would mean asking for more of google.com than BotGuard needs.

- **Without a server.** When no server answers, the import goes into the bucket
  as a link, as before, and the server downloads it later. A device could upload
  its file into the bucket instead, but that needs a new kind of change in the
  sync log and a place in the bucket for files waiting to be added.
- **The Mac app.** It runs the same page, but from `app://selfmp3`, which the
  extension does not talk to. Its own shell could host the phone's page in a
  window of its own, as the phone's WebView does.
- **In the background on a phone.** Downloads stop when the app leaves the
  screen (_On a phone_); the server takes over.
- **Firefox and Safari.** Neither lets a web page talk to an extension directly.
- **Playlists, searches, albums and channels** are still read by the server.
  It asks YouTube Music's own API for them, which it does not pace, so moving
  them would move code rather than load.
- **SABR.** If `VISIONOS` stops giving plain links, the `googlevideo` package
  (by youtubei.js's author) is the way on.
- **Chrome Web Store.** The extension is installed unpacked. An extension that
  helps download from YouTube would likely not pass the store's review.

# Downloading songs in the browser

When you import from the web app in Chrome with the self.mp3 extension
installed, the YouTube songs are downloaded by your browser instead of by the
server. The server still does everything after the download — tags, lyrics,
cover, library, bucket — exactly as for a song it downloaded itself. Nothing
changes anywhere else: on a phone, in the Mac app, in a browser without the
extension, or when no server answers, the server downloads as before.

**Where:** the page's download code is `packages/ytclient`; the app runs it from
`apps/app/src/features/import/deviceImports*.ts` and `src/ports/deviceDownloads*.ts`;
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
5. From there the server finishes the job as it finishes its own downloads,
   with one extra step: it writes the tags yt-dlp would have written —
   title, artist and album as you confirmed them in the review, the release
   date from the video's description (`releaseOf` in `packages/shared`), and
   the cover inside the file (`services/tagWriter.ts`).

The import screen shows these jobs like any other: waiting, downloading, adding,
done.

## When something goes wrong, the server takes over

The device never fails a song. Whatever it cannot do, it hands back, and the
server downloads that song itself with yt-dlp:

| What happened | What the app does |
|---|---|
| The download failed | Hands that song back (`/import/device/release`) and goes on to the next |
| The server refused the file | The same |
| YouTube refused this browser for rate ("not a bot", 429) | Hands back **every** song still waiting, and stays away from YouTube for 15 minutes |
| You closed the tab, or the computer slept | Nothing: the lease runs out and the server takes the songs |
| You cancelled or removed the song | The next renewal says the server no longer holds it, and the app stops |
| The server restarted | A download in progress stays the device's; nothing is lost |

The app renews its lease every minute. A lease is five minutes because a
background tab's timers can be slowed to once a minute.

## Pacing

The browser keeps its own budget at YouTube, by the same rules as the server's
(`packages/shared/src/ytBudget.ts`), stored in the tab's `localStorage`. The
first few songs go at once; after that, about one every 24 seconds, as on a
server with no YouTube cookies.

## What the extension is allowed to do

It forwards requests for self.mp3's own pages only, to YouTube's addresses only,
and **never with your YouTube cookies** — so nothing that got into the page can
act as you on YouTube through it. One rule rewrites the `Origin` header on the
extension's requests to YouTube's API and video servers, because YouTube refuses
any other origin. See *What it asks Chrome for* in
[browser-extension.md](browser-extension.md).

## What we found while building it (2026-10-13)

YouTube changes these from month to month; check the date before relying on them.

| Finding | Detail |
|---|---|
| YouTube refuses requests that do not come from youtube.com | Its API answered 403 to `Origin: chrome-extension://…` and to `localhost`, hence the header rule |
| …except BotGuard, which wants the page's own | With the rewrite, YouTube issued no integrity token. The rule leaves BotGuard's requests alone |
| The anti-bot token is per video | A token made for the session was refused like none at all. yt-dlp's PO Token Guide says the same |
| Only one YouTube client gives whole files | `VISIONOS` (Apple Vision Pro). `MWEB` and `YTMUSIC` stopped after 1 MB; `WEB` only offers SABR, a streaming format this does not speak |
| An occasional 403 | 4 of the first 26 downloads. Asking for a fresh link and resuming at the same byte fixes it |
| Speed | Under a second for a 3–6 MB song, after 1–2 seconds to start a session |
| Metro and youtubei.js | Metro could not load youtubei.js's own modules ("Cannot access 'Platform' before initialization"); the prebuilt `youtubei.js/web.bundle` works. Metro puts it in a separate 1 MB file loaded only when needed |
| A static `regexFilter` rule stops the extension loading | Three `urlFilter` rules do the same job |

## Trying it

In the app: load `apps/extension/dist` in Chrome (*Load unpacked*), open the web
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

- **Without a server.** When no server answers, the import goes into the bucket
  as a link, as before, and the server downloads it later. A device could upload
  its file into the bucket instead, but that needs a new kind of change in the
  sync log and a place in the bucket for files waiting to be added.
- **The Mac app.** It runs the same page, but from `app://selfmp3`, which the
  extension does not talk to. Its own shell could forward the requests instead.
- **Firefox and Safari.** Neither lets a web page talk to an extension directly.
- **Looking links up.** The review's lookup still asks YouTube from the server.
- **SABR.** If `VISIONOS` stops giving plain links, the `googlevideo` package
  (by youtubei.js's author) is the way on.
- **Chrome Web Store.** The extension is installed unpacked. An extension that
  helps download from YouTube would likely not pass the store's review.

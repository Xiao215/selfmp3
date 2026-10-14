# Downloading in the page (spike)

**Status:** a spike, on `claude/client-yt-download-spike`. Nothing in the app
uses it yet. It answers one question: can the page download a song from
YouTube itself, with the extension doing nothing but carrying its requests?
**Yes, as of 2026-10-13** — whole songs, checked byte for byte and by length.

**Where:** `packages/ytclient` (the page's side), `apps/extension/src/background/ytProxy.ts`
and `apps/extension/rules/youtube-origin.json` (the extension's side),
`packages/shared/src/ytProxy.ts` (the protocol between them).

## Why

Every download today is the server's: yt-dlp, from the server's address, paced
by one budget for every account on it (`services/ytThrottle.ts`). A download in
the page asks YouTube from the listener's own address instead. The split is the
point of the design:

- **The page holds everything that follows YouTube** — youtubei.js, BotGuard,
  which client to ask. The page updates on every deploy.
- **The extension holds nothing that does.** It is a carrier: a port, an
  allowlist of hosts, and one header rule. Manifest V3 forbids it remote code,
  and it has no reason to want any, so it should rarely need a new version.

## How it works

1. The page opens a port to the extension (`chrome.runtime.connect`, allowed by
   `externally_connectable` for the app's pages — `YT_PROXY_ORIGINS`).
2. youtubei.js is given a `fetch` that sends each request down the port
   (`portFetch`). The extension fetches it, **without cookies**, and only on
   YouTube's hosts (`isYtProxyUrl`), and sends back a head, the body in base64
   chunks of a megabyte, and an end. Chrome serializes extension messages as
   JSON, so bytes cannot cross any other way.
3. BotGuard runs in the page (bgutils-js), and mints a PO token **per video**.
4. The `VISIONOS` client's player response gives an m4a link (itag 140), which
   is fetched a megabyte at a time with `range=`. A link refused part way is
   replaced by a fresh one, picking up at the byte where it stopped.

## What the spike found

Measured from a home connection in the US. YouTube changes these from month to
month, so date them before believing them.

| Finding | Detail |
|---|---|
| YouTube refuses a foreign `Origin` | InnerTube answered 403 with Google's *Sorry* page to `Origin: chrome-extension://…` and to `http://localhost:4602`, and 200 to none or to `https://www.youtube.com`. Hence the extension's static rule, which sets it on InnerTube and media requests the extension itself makes. |
| …but BotGuard wants its own | With the same rewrite on `/api/jnn/v1/GenerateIT`, YouTube issued no integrity token (`[null, 43200, null, "<fallback>"]`). The rule leaves those requests alone. |
| `regexFilter` breaks loading | A static rule with a `regexFilter` kept the unpacked extension from loading at all in Playwright's Chromium 153. Three `urlFilter` rules do the same job. |
| GVS PO tokens are bound to the video | A token minted for the session's visitor data was refused exactly like none at all, at the first megabyte. yt-dlp's PO Token Guide says the same. |
| Which client | `VISIONOS` gave whole songs: 10 of 10 downloads once retries were in. `MWEB` and `YTMUSIC` gave links refused after a megabyte, with a token or without one; `WEB` answers only in SABR; `TV` said "The page needs to be reloaded"; `WEB_EMBEDDED` said the video was unavailable. yt-dlp's own defaults are `tv_samsung, visionos, web`. |
| Is the token needed for VISIONOS? | Not clearly. Before retries existed, 13 of 15 downloads went through with one and 9 of 11 without. It is cheap (one BotGuard run per session, a mint per song), so it stays. |
| Occasional 403 | Those failures were a 403 the next link did not share, so a refused link is replaced and the download resumes (`TRIES_PER_CLIENT`). Three of the four came on 4 MB ranges, one on 1 MB — thin evidence, but the default range is a megabyte. |
| Speed | 0.4–0.9 s for a 3–6 MB song through the extension, after a session of about 1–2 s. |
| Automation | Results under Playwright, headless or headed, matched a Chromium started with no automation at all (`verify/plainBrowser.mjs`). The PO token failures were not BotGuard spotting DevTools. |

Songs tried: `dQw4w9WgXcQ`, `kJQP7kiw5Fk`, `9bZkp7q19f0`, `fJ9rUzIMcZQ`, and
`SJKoWAd5ySo` (晴天, a YouTube Music "Topic" track).

## Trying it

```bash
npm run build:extension
npm run verify:ytclient                     # downloads fJ9rUzIMcZQ, checks it with ffprobe
YT_VIDEOS=SJKoWAd5ySo,dQw4w9WgXcQ npm run verify:ytclient
```

`YT_CLIENTS=VISIONOS,MWEB` picks clients, `YT_PO=0` turns the PO token off,
`YT_CHUNK=4194304` sets the range size, `HEADED=1` shows the browser. These ask
the real YouTube, so they are not part of `npm run check`.

By hand: `npm run harness --workspace @selfmp3/ytclient`, load
`apps/extension/dist` unpacked in Chrome, and open `http://localhost:4602`.

## Safety

The carrier hands the app's pages a cross-origin `fetch`, so it is held small:

- **No cookies, ever** (`credentials: 'omit'`). A script that got into the page
  can do nothing through it that a public proxy could not, and cannot act as
  the person on YouTube. Signed-in downloads (private playlists, Premium) would
  need this reopened, with a path allowlist to go with it.
- **YouTube's hosts only**, checked again after redirects.
- **Only the pages listed** may connect: the manifest says so, and the
  extension checks the sender's origin again.

## Not done

- **Getting the file into the library.** A device may write `audio/<sha256>.<ext>`
  to the bucket today, but only a server creates songs. The smallest next step
  is an import request that carries the file's hash instead of a link, which the
  server ingests without running yt-dlp.
- **The app.** Nothing in `apps/app` calls this. It would want a `YtTransport`
  port: the extension in a browser tab, the desktop bridge in the Mac app, and
  the server's import as the fallback everywhere else.
- **Pacing.** The server's budget does not see these requests. `ytThrottle.ts`'s
  bucket is pure functions and could run per device.
- **Firefox and Safari.** Neither lets a web page connect to an extension; a
  content script on the app's page would relay instead.
- **SABR.** `WEB` and `MWEB` are headed there. When `VISIONOS` stops giving
  plain links, the `googlevideo` package (by youtubei.js's author) is the way on.
- **Chrome Web Store.** The extension is installed unpacked. A carrier for
  downloading from YouTube would likely not pass the store's review.

# Bring my YouTube Music library

Liked Music (`list=LM`) and your own private playlists only resolve when YouTube sees a
signed-in session. yt-dlp can read a Netscape-format `cookies.txt`, or borrow the login
from a browser on the same computer (`--cookies-from-browser`). self.mp3 keeps that as
settings of the library on the server and applies it to **every probe and download**
(`apps/server/src/services/ytCookies.ts`, `ytdlp.ts`), so once configured, private links
just work everywhere — the Import page, the share endpoint and the extension.

## Settings

| Setting | Values | Meaning |
|---|---|---|
| `ytCookieSource` | `none` (default) / `browser` / `file` | Where cookies come from |
| `ytCookieBrowser` | `chrome` / `safari` / `firefox` / `brave` / `edge` / `chromium` | Which browser, for `browser` |
| `ytCookieFile` | absolute path on the server | A `cookies.txt`, for `file` |

The app has no controls for these at the moment (Settings lost them, "off for now"), so
they are set with `PATCH /api/settings` against the library's server. Changes apply to
the next yt-dlp call; no restart. A signed-in library also raises the server's YouTube
budget (`ytThrottle.ts`: roughly 2000 requests an hour signed in against 300 signed out,
of which the server uses half).

**On a server in Docker** (the usual case) there is no browser to borrow from, so use
`file`. Export `cookies.txt` with a "Get cookies.txt LOCALLY"-style extension while
signed in to music.youtube.com, put it in the data folder beside the compose file
(`./data/cookies.txt`), and set `ytCookieFile` to the path inside the container,
`/app/data/cookies.txt`. The file is read on each call, so a fresh export just replaces it.

**Borrowing from a browser** only works where the server runs on a computer with that
browser signed in (the non-Docker install, docs/INSTALL.md). On a Mac: Safari's cookie
file is protected, so the process running the server needs Full Disk Access; Chrome,
Brave, Edge and Chromium keep their key in the keychain, so allow yt-dlp's first keychain
prompt; Firefox locks its database while it runs, so quit it or use a file.

Every yt-dlp call also carries `-4`. Google rate-limits IPv6 by the whole /64 an ISP
hands out, so one neighbour's abuse can put a home network's every IPv6 address behind
"Sign in to confirm you're not a bot" while its IPv4 answers normally; that reads as a
cookie problem and is not one.

## What to paste

The Import page's box takes all of these; **Look it up** opens the review list, where
every song is coming in unless it is left out:

- **Liked Music** — `https://music.youtube.com/playlist?list=LM`, with cookies configured
  (the section above).
- **A playlist of yours** — one or more YouTube Music playlist links.
- **An artist** — their page, `music.youtube.com/@YOASOBI_Official` or the same channel on
  youtube.com (`/@handle` or `/channel/UC…`). You get their **Top songs → See all** list
  from YouTube Music (71 songs for YOASOBI), named after the artist.

Importing only ever tags: the review offers "Tag them", never a playlist. A playlist of
the imported songs is one step away on the Playlists page, from their tag.

## Artist links

yt-dlp reads a channel link as the channel's tabs — Videos, Live, Shorts — and the Videos
tab is vlogs and TV appearances as much as songs. So a link to a channel's front page never
goes to yt-dlp as it is (`apps/server/src/services/youtubeMusicArtist.ts`):

1. A handle is resolved to a channel id with YouTube Music's `navigation/resolve_url`,
   asked as a music.youtube.com link — the only form it resolves.
2. The channel's YouTube Music page is fetched (`browse`). Its songs are the page's one
   list (`musicShelfRenderer`); its "See all" is a playlist, `VL` + the playlist id.
3. That playlist goes through yt-dlp like any other, so the review list and duplicates work
   as usual. An artist with too few songs for a See all gets the rows on the page itself.

YouTube calls almost every channel an artist, so the test is the songs list, not the page
type: a channel without one is refused. A link to a tab (`/@handle/videos`) is left to
yt-dlp as it always was.

This uses the same unofficial API as the timed lyrics (`youtubeMusicApi.ts`) and can break
the same way when YouTube changes it; then artist links are refused and everything else
still works.

## Listen before importing

On the review every YouTube (and 网易云) track's thumbnail is a play button. It plays in a
bar under the list with a playhead you can drag anywhere, so you can check it is the right
version (studio, not live; the full song, not a cut) before downloading anything
(`apps/app/src/features/import/ImportListen.tsx`).

- The audio comes through the server, `GET /api/import/listen?url=…`
  (`apps/server/src/services/listen.ts`): yt-dlp names where the audio lives, and the
  server proxies it. YouTube only honours that link from the machine that asked for it,
  so this is also what makes it work from a phone away from home.
- Range requests pass straight through, so seeking works. The link is kept until shortly
  before YouTube says it expires, so a track costs one yt-dlp run however much you drag,
  and the first few rows of a review are looked up ahead of a tap; a link YouTube turns
  down is looked up once more.
- It is a separate player from the main one, so the queue is untouched. Whatever was
  playing pauses while you listen and carries on when you close the bar — unless you
  pressed play on it yourself meanwhile, which pauses the preview instead.
- The endpoint refuses anything but YouTube and 网易云 links.

## Failure modes

Errors from yt-dlp are translated into messages a person can act on
(`explainCookieError` in `ytCookies.ts`):

| yt-dlp says | You see |
|---|---|
| Safari `Operation not permitted` | Give the process Full Disk Access |
| `database is locked` | Quit the browser and retry, or switch to a file |
| `could not find … cookies database` | Is that browser installed and opened once on the server? |
| `failed to decrypt` / keychain | Allow the keychain prompt or use a file |
| missing `cookies.txt` | The path is wrong (checked before yt-dlp runs — yt-dlp itself silently ignores a missing file) |
| "not a bot" / rate limited | YouTube is rate-limiting the network, not a cookie problem; downloads pause and pick up by themselves |
| `Sign in` / `private` / `does not exist`, no cookies | Needs a signed-in account; make it public or unlisted on YouTube (the app has no cookie setting to point at) |
| `Sign in` / `private` / `does not exist`, with cookies | The cookies aren't a signed-in session; log the browser in to YouTube Music |
| `Video unavailable`, an age check | Left as yt-dlp said it; the queue row has its own words for it (`packages/client/src/import/failure.ts`) |
| `HTTP Error 403` | yt-dlp is out of date; the update named is `docker compose pull && docker compose up -d` in Docker, `brew upgrade yt-dlp` elsewhere (`ytdlpUpdate.ts`) |

## A note on terms

Cookies let yt-dlp act as you. Downloading from YouTube Music is governed by its terms and
by copyright law where you live; this feature assumes you are keeping music you have the
right to keep.

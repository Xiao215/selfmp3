# Bring my YouTube Music library

Liked Music (`list=LM`) and your own private playlists only resolve when YouTube sees a
signed-in session. yt-dlp can borrow the login from a browser on the server
(`--cookies-from-browser`) or read a Netscape-format `cookies.txt`. self.mp3 wires that up
as settings and applies it to **every probe and download**, so once configured, private
links just work everywhere — the import box, the share endpoint and the extension.

## Settings (Settings → Importing)

| Setting | Values | Meaning |
|---|---|---|
| `ytCookieSource` | `none` (default) / `browser` / `file` | Where cookies come from |
| `ytCookieBrowser` | `chrome` / `safari` / `firefox` / `brave` / `edge` / `chromium` | Which browser, for `browser` |
| `ytCookieFile` | absolute path | A `cookies.txt`, for `file` |

Changes apply to the next yt-dlp call — no restart.

### Browser notes (macOS)

- **Safari** stores cookies in `~/Library/Cookies/Cookies.binarycookies`, which macOS
  protects. The process running self.mp3 — **Terminal** if you start it by hand, or
  **node** / the launchd service otherwise — needs **Full Disk Access** in
  *System Settings → Privacy & Security → Full Disk Access*. Without it the Test button
  reports exactly that.
- **Chrome / Brave / Edge / Chromium** encrypt cookies with a key in the macOS keychain;
  the first read may pop a keychain prompt for `yt-dlp` — allow it. The database is copied
  before reading, so the browser can stay open.
- **Firefox** locks its cookie database while running. Quit Firefox, or use a file.
- **cookies.txt**: export with a "Get cookies.txt LOCALLY"-style extension while logged in
  to music.youtube.com, save it somewhere the server can read, and paste the path.

## What to paste

The Import page's one field takes all of these (docs/ui-mock `P29`, `C13`); **Look it up**
opens the review list, where every song is coming in unless it is left out:

- **Liked Music** — `https://music.youtube.com/playlist?list=LM`, with cookies configured in
  Settings (the section above).
- **A playlist of yours** — one or more YouTube Music playlist links.
- **An artist** — their page, `music.youtube.com/@YOASOBI_Official` or the same channel on
  youtube.com (`/@handle` or `/channel/UC…`). You get their **Top songs → See all** list
  from YouTube Music (71 songs for YOASOBI), named after the artist.

Importing only ever tags: the review offers "Tag them", never a playlist
(docs/UI-MIGRATION.md, Phase 7). A playlist of the imported songs is one step away on the
Playlists page, from their tag.

## Artist links

yt-dlp reads a channel link as the channel's tabs — Videos, Live, Shorts — and the Videos
tab is vlogs and TV appearances as much as songs. So a link to a channel's front page never
goes to yt-dlp as it is (`apps/server/src/services/youtubeMusicArtist.ts`):

1. A handle is resolved to a channel id with YouTube Music's `navigation/resolve_url`,
   asked as a music.youtube.com link — the only form it resolves.
2. The channel's YouTube Music page is fetched (`browse`). Its songs are the page's one
   list (`musicShelfRenderer`); its "See all" is a playlist, `VL` + the playlist id.
3. That playlist goes through yt-dlp like any other, so the review list and duplicates work
   as usual. An artist with too few songs for a See all
   gets the rows on the page itself, without lengths until they download.

YouTube calls almost every channel an artist, so the test is the songs list, not the page
type: a channel without one is refused with a pointer to its Videos tab, playlists or
videos. A link to a tab (`/@handle/videos`) is left to yt-dlp as it always was.

This uses the same unofficial API as the timed lyrics (`youtubeMusicApi.ts`) and can break
the same way when YouTube changes it; then artist links are refused and everything else
still works.

## Listen before importing

On the review screen every YouTube track's thumbnail is a play button. It plays in a bar
under the list with a playhead you can drag anywhere, so you can check it is the right
version (studio, not live; the full song, not a cut) before downloading anything.

- The audio comes through the server, `GET /api/import/listen?url=…`
  (`apps/server/src/services/listen.ts`): yt-dlp names where the audio lives on YouTube
  (`--get-url`, m4a first because Safari cannot play webm), and the server proxies it.
  YouTube only honours that link from the machine that asked for it, so this is also what
  makes it work from a phone away from home.
- Range requests pass straight through, so seeking works. The link is kept until shortly
  before YouTube says it expires, so a track costs one yt-dlp run (~2.5 s before the
  first sound) however much you drag; a link YouTube turns down is looked up once more.
- It is a separate audio element from the player, so the queue is untouched. Whatever
  was playing pauses while you listen and carries on when you close the bar — unless you
  pressed play on it yourself meanwhile, which pauses the preview instead.
- Only YouTube links: the endpoint refuses anything else. The service worker leaves the
  URL alone, like the event stream.

## Failure modes

Errors from yt-dlp are translated into actionable messages
(`apps/server/src/services/ytCookies.ts`):

| yt-dlp says | You see |
|---|---|
| Safari `Operation not permitted` / cookie file not found | Give the process Full Disk Access |
| `database is locked` | Quit the browser and retry, or switch to a file |
| `could not find … cookies database` | Is that browser installed / opened once? |
| `failed to decrypt` / keychain | Allow the keychain prompt or use a file |
| missing `cookies.txt` | The path is wrong (checked before yt-dlp runs — yt-dlp itself silently ignores a missing file) |
| `Sign in` / `private` / `does not exist` | Not signed in — set up cookies, or the browser is logged out |

## API

- `POST /api/import/youtube/test` → `{ ok, source, count, playlistTitle, error }`
- `POST /api/import/enqueue` accepts `createPlaylistName` (ignored when `playlistId` set)
- `POST /api/import/share` accepts `createPlaylist: true`

## A note on terms

Cookies let yt-dlp act as you. Downloading from YouTube Music is governed by its terms and
by copyright law where you live; this feature assumes you are keeping music you have the
right to keep.

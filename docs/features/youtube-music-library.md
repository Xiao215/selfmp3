# Bring my YouTube Music library

Liked Music (`list=LM`) and your own private playlists only resolve when YouTube sees a
signed-in session. yt-dlp can borrow the login from a browser on the Mac
(`--cookies-from-browser`) or read a Netscape-format `cookies.txt`. self.mp3 wires that up
as settings and applies it to **every probe and download**, so once configured, private
links just work everywhere — the import box, the share endpoint, and the panel below.

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

## The Import page panel

*Import → Import my YouTube Music library*:

- A status line saying whether cookies are configured and from where, with a link to
  Settings and a **Test** button. Test probes `https://music.youtube.com/playlist?list=LM`
  and reports "Signed in. Liked Music has N tracks" or the reason it failed.
- **Liked Music** — one tap pushes `list=LM` through the normal probe → review → enqueue
  flow, so you still see and untick tracks before anything downloads.
- **A playlist of yours** — paste one or more YouTube Music playlist links.
- On the review screen, tick **Also create playlist "<name>"** to get a manual playlist
  with the same name here. Importing the same playlist again reuses it rather than making
  "Liked Music (2)".

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
- `POST /api/imports/share` accepts `createPlaylist: true`

## A note on terms

Cookies let yt-dlp act as you. Downloading from YouTube Music is governed by its terms and
by copyright law where you live; this feature assumes you are keeping music you have the
right to keep.

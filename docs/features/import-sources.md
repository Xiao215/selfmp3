# Import sources

Import's one box takes a link from YouTube, YouTube Music, 网易云音乐 or Spotify, or a list
of song names, and shows every song on the same review before anything downloads. Under
the box it says what it read ("网易云 playlist", "Spotify album", "A list of song names").

Each song comes from one of two places: YouTube, or 网易云 itself. Spotify's audio cannot
be downloaded, so a Spotify song is found on YouTube by its name, as is a song from a
list of names.

## 网易云音乐

A song, an album, a playlist (a chart is one) or an artist link (the fifty songs their
page lists first, as with a YouTube artist link), in any of the spellings the
site and the app use: `music.163.com/#/playlist?id=…`, the app's share text
(`分享…的歌单《…》: https://y.music.163.com/m/playlist?id=… (来自@网易云音乐)`), and the short
`163cn.tv/…` link, which the server follows.

The server reads the list from the web API 网易云's own site uses, without signing in
(`services/netease.ts`). What matters is which songs 网易云 gives out whole: asked for a VIP
song, or one it may not play in this country, it hands over a 30–45 second preview, and
yt-dlp downloads that without complaint. Each song's `privileges` say what this server may
play (`pl`, the bitrate, 0 for none). Many songs are free on the mainland and locked
everywhere else; yt-dlp downloads those whole by retrying from a Chinese address, so the
server asks 网易云 as if from the mainland too (`X-Real-IP`). So:

- a song this server may play comes from 网易云: yt-dlp downloads it, at up to 320 kbps;
- any other comes from YouTube, found by its name, keeping 网易云's cover.

The queue checks the file's length too: a 网易云 download much shorter than the song is
a preview, and fails with a sentence that says so rather than going into the library
(`importQueue.ts`). A 网易云 download does not wait for YouTube's pacing
(`ytThrottle.ts`): it asks YouTube nothing.

Lyrics follow the source. A song from 网易云 gets 网易云's timed lyrics, with the credit
lines it writes as lyrics ("作词 : …", "制作人：…") taken off the start and end, and its
"pure music" answer kept as instrumental. A song from YouTube gets YouTube Music's.
lrclib.net is the fallback for both (`services/lyrics.ts`).

## Spotify

A public playlist, album or track link. The server reads the names and lengths from
Spotify's embed page (`services/spotify.ts`), which needs no sign-in; a private playlist
says so, with the way round it: paste its songs as a list, or a CSV from
[Exportify](https://exportify.net).

## A list of song names

Words with no link in them are a list (`services/trackLists.ts`):

- **Plain text**, one song per line: `Artist - Title`, `Title - Artist`, `Title by Artist`,
  `Artist — Title`, or just `Title`. Numbering (`1.`, `2)`) and trailing durations (`3:45`)
  are ignored; `(Official Video)`, `[Remastered 2011]`, `feat. …` and similar noise is
  stripped. Whether lines are `Artist - Title` or `Title - Artist` is guessed from the whole
  list (the side that repeats is the artist), defaulting to artist first.
- **A CSV/TSV export**: Exportify, TuneMyMusic, or Apple Music's *File → Library → Export
  Playlist*. Recognised columns: Track Name / Name / Title, Artist Name(s) / Artist, Album,
  Duration (ms) / Time, Playlist name.

## Finding a song on YouTube

A song known only by its name is looked for with YouTube Music's song search
(`services/youtubeMatch.ts`): one plain web request per song, not a paced yt-dlp run, and
its answers are songs with their artist, album, length and square art. Each answer is
scored 0–1 on title and artist similarity (multiplied, so the right artist cannot rescue a
wrong title), length, and penalties for live, cover, remix and the like unless the name
asks for that version. YouTube Music's first answer gets a little more trust: it knows an
artist by every name, so 陈奕迅's "Eason Chan" is still his. Chinese names are compared
as pinyin, so 周杰伦 and 周杰倫 are the same; a run of characters is one word
("zhoujielun"), so 忘我 is not found inside 我不曾忘记 just because it shares its characters.

- 0.7 and up is a match taken as it is;
- 0.4 to 0.7 is **not sure**, said on the row, worth a listen;
- below that is **not found**: the row has no box and nothing to import.

The review shows at once and fills in as songs are found, eight at a time
(`useFindSongs.ts`), so a long list never waits on one request; Import waits until the
ticked songs are found ("Finding 3 on YouTube…").

## The review

The same review as a YouTube link (`ImportReview.tsx`):

- Each row of a 网易云 list says where it comes from: "网易云", or "YouTube" in amber. A
  weak match says "not sure"; a song being looked for says "Looking…". A computer has a
  From column for it.
- Open a 网易云 row and choose: **网易云** (the whole song, or "Only a preview there" for a
  VIP song, which cannot be chosen) or **YouTube** (found on first choosing it, and kept
  for switching back).
- Open a song found by its name and **Look again**: by its name as it stands now, after
  fixing a title or an artist.
- A song from 网易云 or YouTube can be heard before importing; a song still being looked
  for cannot yet.

Songs already in the library are "In library" by the usual rule (`alreadyHave.ts`): the
source link, a 网易云 song in any spelling, or the name and length.

## Where it does not work

- The share sheet and a link sent from another device have nobody to review them: every
  song is found on YouTube before enqueuing, and one not found is left out.
- The browser extension still reads YouTube pages and links only.

## API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/import/preview` | `{ url }`: links or song names → `{ kind, playlistTitle, from, items }`. Each item says its `source`, its `netease` song, and its `youtube` match (`looking` until found). |
| `POST` | `/api/import/find` | `{ tracks }` (up to 25) → `{ found }`, one YouTube match or null per track. |
| `GET` | `/api/import/listen?url=` | A YouTube or 网易云 song's audio, for hearing it on the review. |

## Code

- `packages/shared/src/links.ts` — `neteaseLink`, `spotifyLink`, `isNeteaseUrl`.
- `packages/shared/src/schemas/import.ts` — the review's `source`, `netease`, `youtube` and `from`.
- `apps/server/src/services/netease.ts` — 网易云 lists, privileges and lyrics.
- `apps/server/src/services/spotify.ts` — Spotify's embed page.
- `apps/server/src/services/trackLists.ts` — text and CSV.
- `apps/server/src/services/youtubeMatch.ts` — scoring and the YouTube Music search.
- `apps/server/src/services/importPreview.ts` — every kind of paste into one review.
- `packages/client/src/import/model.ts` — `describePaste`, `withFound`, `chooseSource`, `lookAgain`.
- `apps/app/src/features/import/useFindSongs.ts`, `ImportReview.tsx` — the review.

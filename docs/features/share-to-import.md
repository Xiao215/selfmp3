# Share to import

Send a link from any app straight into the import queue — no copy, paste, open self.mp3,
paste again.

## Android / Chrome (installed PWA)

The web manifest declares a **Web Share Target**. Once self.mp3 is installed to the home
screen — from <https://xiao215.github.io/selfmp3>, which is where the app is served — it
appears in the system share sheet. Share a link (or text containing one) from YouTube,
YouTube Music or a browser and Chrome opens `/import?url=…&text=…&title=…`.

The Import page reads those parameters, pulls every `http(s)` link out of them (the
YouTube app puts the link in `text`, after the title), prefills the field and immediately
looks it up. You land on the review (`/import/review`), where every song starts ticked and
only ticked songs are imported: a song you already have says *In library* and is skipped,
the box at the left of a row unticks it and ticks it back (the head's box does that for all
of them), and a song's title, artist and album can be fixed before *Import N songs*. The songs arrive with the tags chosen under *Tag it … as it arrives* on the Import
page, plus any added under *Tag them* on the review. Importing only ever tags; it never
offers a playlist. The query string is stripped from the address afterwards so a reload
does not look it up twice.

Nothing is downloaded without your confirmation on this path.

## iOS (Shortcut)

iOS has no Web Share Target, so the server exposes a one-shot endpoint that probes and
enqueues in a single request:

```
POST /api/import/share
Content-Type: application/json

{ "url": "https://music.youtube.com/watch?v=…", "tagIds": [3], "createPlaylist": false }
```

- `url` — one link, or free text containing links (what a share sheet hands over).
- `tagIds` — optional; the **default import tags** from Settings are always added too.
- `createPlaylist` — when the link is a playlist, also create (or reuse) a manual playlist
  with the same name and drop the tracks into it.

Response: `{ jobs, skipped, playlistId, kind, playlistTitle }` — the created jobs, how many
were already queued, and the playlist the tracks will land in. Tracks that are already in
your library (same artist + title) are skipped; if nothing is left, you get `409`. A link
yt-dlp cannot read returns `422` with the reason (private, not signed in, wrong link…).

### Auth

If `SELFMP3_AUTH_TOKEN` is set, the endpoint uses the same mechanism as everything else:
either an `Authorization: Bearer <token>` header or `?token=<token>` on the URL. Both work
from a Shortcut; the header is tidier.

### Building the Shortcut

1. Open **Shortcuts** → **+** → name it "Add to self.mp3".
2. Tap the **ⓘ** (details) → turn on **Show in Share Sheet** → under *Share Sheet Types*
   keep **URLs** and **Text** ticked. This makes the Shortcut receive whatever was shared.
3. Add action **Get Contents of URL**:
   - URL: `https://<your-server>.<tailnet>.ts.net/api/import/share`
     (or `http://<tailscale-ip>:4600/api/import/share`)
   - Method: **POST**
   - Headers: `Authorization` → `Bearer <your token>` (only if you set one)
   - Request Body: **JSON**, add a field `url` of type **Text** and set its value to the
     **Shortcut Input** variable.
     Optional: `createPlaylist` (Boolean) → true if you want shared playlists mirrored.
4. Add action **Get Dictionary Value** → key `jobs` from *Contents of URL*, then
   **Count** items — or skip straight to step 5.
5. Add action **Show Notification** → "Queued ✓" (include *Count* if you added step 4).
   For failures, wrap step 3 in **If** / *Contents of URL has any value* and show the
   `error` key otherwise.
6. Done. In the YouTube or YouTube Music app: **Share → Add to self.mp3**. The download
   starts on the server within a second; open self.mp3 → Import to watch it.

Tip: to route everything shared this way into one tag, set that tag under
*Settings → Importing → default import tags* rather than hard-coding `tagIds` in the
Shortcut.

## Implementation notes

- `packages/shared/src/links.ts` — `extractUrls()` is the one link parser, used by the
  server for the import box and share endpoint and by the client for the share target.
- `apps/app/public/manifest.webmanifest` — declares the share target.
- `sharedLinks` in `packages/client/src/import/model.ts` — reads `url` / `text` /
  `title` from the query; `ImportScreen.tsx` prefills the field, clears them, and opens
  the review once the lookup answers.
- The review is `apps/app/src/features/import/ImportReview.tsx`, a page of its own
  (`app/import/review.tsx`) that reads the looked-up link from the import draft
  (`importDraft.ts`), so Back keeps it and Import offers it again. What it does without
  the screen — ticking and unticking, renaming, the counts, "In library", the request
  with no playlist — is `review.model.ts`. The bar a song is heard with before importing
  (`ListenBar` in `ImportListen.tsx`) is a plain track, not a waveform: the audio is not
  downloaded yet.
- `apps/server/src/services/importPreview.ts` — the probe step, shared by
  `/import/preview` and `/import/share` so both resolve links identically.

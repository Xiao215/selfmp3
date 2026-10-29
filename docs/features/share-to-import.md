# Share to import

Send a link from any app straight into the import queue — no copy, paste, open self.mp3,
paste again.

## Android / Chrome (installed web app)

The web manifest declares a **Web Share Target**. Once self.mp3 is installed to the home
screen — from <https://xiao215.github.io/selfmp3>, which is where the app is served — it
appears in the system share sheet. Share a link (or text containing one) from YouTube,
YouTube Music or a browser and Chrome opens `/import?url=…&text=…&title=…`.

The Import page reads those parameters, pulls every `http(s)` link out of them (the
YouTube app puts the link in `text`, after the title), prefills the field and immediately
looks it up on your server, which it reaches by the addresses in your bucket's snapshot
([native-app.md](native-app.md)). You land on the review (`/import/review`), where every
song starts ticked and only ticked songs are imported: a song you already have says *In
library* and is skipped, the box at the left of a row unticks it and ticks it back (the
head's box does that for all of them), and a song's title, artist and album can be fixed
before *Import N songs*. The songs arrive with the tags chosen under *Tag them* on the
review (and a tag named like the link, which is ticked for you). Importing only
ever tags; it never offers a playlist. The query string is stripped from the address
afterwards so a reload does not look it up twice.

Nothing is downloaded without your confirmation on this path.

When the server cannot be reached, Import shows its away form instead, which leaves a link
in the bucket for the server to take later. The shared link is already in its box — the
first one, if the share held several, since a bucket request carries one link — and goes
in with **Add for later**; the share is cleared from the address once it is added, so a
server that comes back meanwhile does not look it up again.

## iOS (Shortcut)

iOS has no Web Share Target, so the server exposes a one-shot endpoint that probes and
enqueues in a single request. A Shortcut posts to it directly, at the server's public
address; there is no bucket fallback on this path, so the server has to be answering.

```
POST /api/import/share
Authorization: Bearer <your library's token>
Content-Type: application/json

{ "url": "https://music.youtube.com/watch?v=…", "tagIds": [3], "createPlaylist": false }
```

- `url` — one link, or free text containing links (what a share sheet hands over).
- `tagIds` — optional, the server's tag ids (`GET /api/tags`).
- `createPlaylist` — when the link is a playlist, also create (or reuse) a playlist with
  the same name and drop the tracks into it.

Response: `{ jobs, skipped, playlistId, kind, playlistTitle }` — the created jobs, how many
were already queued, and the playlist the tracks will land in. Tracks that are already in
your library are skipped; if nothing is left, you get `409`. A link yt-dlp cannot read
returns `422` with the reason (private, not signed in, wrong link…).

### Auth

Every request to the server carries a token, and the server routes it to your library by
that token ([shared-server.md](shared-server.md)): each library on a server has its own,
which reaches your devices in the bucket's snapshot so nobody types it. A Shortcut is not
one of those devices, so it needs the token written into it. It is kept on the server:
your library's `token` in the server's `data/hub.json`
([INSTALL.md](../INSTALL.md#the-selfmp3-command) says how to find it), and the server
prints it in its log when it starts holding a single library (`its token is …`). Send it as an
`Authorization: Bearer <token>` header (or `?token=<token>` on the URL). A request
without one is refused with `401`.

### Building the Shortcut

1. Open **Shortcuts** → **+** → name it "Add to self.mp3".
2. Tap the **ⓘ** (details) → turn on **Show in Share Sheet** → under *Share Sheet Types*
   keep **URLs** and **Text** ticked. This makes the Shortcut receive whatever was shared.
3. Add action **Get Contents of URL**:
   - URL: `https://<your server's public address>/api/import/share` — the `https://…ts.net`
     address Tailscale Funnel gives the server ([INSTALL.md](../INSTALL.md)), with
     `/api/import/share` after it.
   - Method: **POST**
   - Headers: `Authorization` → `Bearer <your token>` (from the server, as above)
   - Request Body: **JSON**, add a field `url` of type **Text** and set its value to the
     **Shortcut Input** variable.
     Optional: `createPlaylist` (Boolean) → true if you want shared playlists mirrored.
4. Add action **Get Dictionary Value** → key `jobs` from *Contents of URL*, then
   **Count** items — or skip straight to step 5.
5. Add action **Show Notification** → "Queued" (include *Count* if you added step 4).
   For failures, wrap step 3 in **If** / *Contents of URL has any value* and show the
   `error` key otherwise.
6. Done. In the YouTube or YouTube Music app: **Share → Add to self.mp3**. The download
   starts on the server within a second; open self.mp3 → Import to watch it.

## Implementation notes

- `packages/shared/src/links.ts` — `extractUrls()` is the one link parser, used by the
  server for the import box and share endpoint and by the client for the share target.
- `apps/app/public/manifest.webmanifest` — declares the share target.
- `sharedLinks` in `packages/client/src/import/model.ts` — reads `url` / `text` /
  `title` from the query; `ImportScreen.tsx` prefills the field, clears them, and opens
  the review once the lookup answers. `ImportViaServer.tsx` decides between that screen
  and the away form (`QueueViaBucket.tsx`), which reads the same parameters into its box.
  Both paths are tested: `ImportLookUp.test.tsx` and `QueueViaBucket.test.tsx`.
- The review is `apps/app/src/features/import/ImportReview.tsx`, a page of its own
  (`app/import/review.tsx`) that reads the looked-up link from the import draft
  (`importDraft.ts`), so Back keeps it and Import offers it again. What it does without
  the screen — ticking and unticking, renaming, the counts, "In library", the request
  with no playlist — is `review.model.ts`. The bar a song is heard with before importing
  (`ListenBar` in `ImportListen.tsx`) is a plain track, not a waveform: the audio is not
  downloaded yet.
- `apps/server/src/routes/imports.ts` — the `/import/share` route.
  `apps/server/src/services/importPreview.ts` is the probe step, shared by
  `/import/preview` and `/import/share` so both resolve links identically.

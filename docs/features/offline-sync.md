# Offline sync

Keeping a device's music, and its listening, in step with the server — without being asked.

Before this, offline was a button. "Download everything" lived in Settings, and a song
imported afterwards (say, one shared from the YouTube Music app on the phone) stayed on the
server until you went back and pressed it again. Worse, a play made with the server asleep was
sent, failed, and was thrown away: every song heard on a train was missing from play counts,
stats, Wrapped and forgotten gems — which is exactly the listening this app exists for.

Files:

| What | Where |
|---|---|
| The listening outbox, shared rules | `packages/shared/src/outbox.ts`, `packages/client/src/listens/outbox.ts` |
| …kept on the device (a JSON file) | `apps/app/src/offline/listenOutbox.ts` |
| Automatic downloads | `apps/app/src/offline/DownloadsProvider.tsx` |
| Per-device preferences, connection type | `packages/client/src/downloads/syncPolicy.ts`, `apps/app/src/offline/connectionKind.ts` |
| Download, prune, storage guard | `packages/client/src/downloads/queue.ts`, `apps/app/src/ports/downloadStorage.ts` (+ `.web.ts`), `apps/app/src/ports/offline.web.ts` |
| Which address a song plays and draws from | `apps/app/src/api/mediaAddress.model.ts`, `apps/app/src/ports/bucketMedia.ts` (+ `.web.ts`), `apps/app/sw/sw.ts` |
| Row mark, status line | `apps/app/src/ui/components/SongRow.tsx`, `apps/app/src/ui/components/SyncStatus.tsx` |
| Late plays on the server | `apps/server/src/routes/songs.ts`, `repositories/stats.ts` |
| Tests | `packages/shared/src/outbox.test.ts`, `apps/server/src/repositories/plays.test.ts` |

## Plays made offline

A play is written to the device first and sent from there: at once if the server answers,
otherwise the next time it does — when the app comes back to the foreground, when the
reachability probe succeeds, or when the browser says it is online again.

Each play carries two things it did not before:

- **`playedAt`** — when it happened. The server stores that rather than the time the play
  arrived, so Tuesday's listening lands on Tuesday. A time in the future (a phone clock
  running fast) is treated as now.
- **`clientId`** — unique per play. A send whose response is lost gets retried, and the server
  ignores an id it has already recorded. There is a partial unique index on
  `play_events.client_id`, so live plays without one are unaffected.

"Last played" only ever moves forward: a late play from last week does not overwrite one from
an hour ago.

A failed send is judged by status: no response, 401, 408, 429 and 5xx wait for next time;
anything else the server will never accept (a song deleted meanwhile) is dropped. The queue is
bounded — 5,000 events or 400 days — and in practice never trimmed.

## Automatic downloads

On the devices that keep songs — the phone app and the desktop app — on by default, per
device. A browser tab streams and downloads nothing, so none of this applies there. Whenever
the library is reachable and something changes — a song imported, the app opened, the
connection switching to Wi-Fi — the device works out what it is missing and fetches it, one
song at a time.

- **Only on Wi-Fi** (on by default). A phone reports its connection type
  (`connectionKind.ts`). A computer reports nothing, and is taken to be on Wi-Fi or a cable
  rather than refusing to download on a desk (`onWifi` in `syncPolicy.ts`). On mobile data,
  or for any sync over 500 MB (`LARGE_SYNC_BYTES`), it shows "12 to download · Download" and
  waits for a tap rather than spending the allowance for you.
- **Keep offline: every song, or songs in playlists.** The second resolves live playlists on
  the server (`GET /api/library/manifest?scope=playlists`), so a live playlist like "loved,
  played in the last 30 days" keeps the phone current by itself.
- **Storage.** Before each song the space available is checked, and downloading stops at 90%
  of it — filling it completely gets the whole origin's storage evicted on some browsers,
  downloads and all. The status then says how many songs did not fit.
- **Songs removed by hand stay removed.** "Remove download" remembers the song, so the next
  pass does not put it straight back; downloading it again by hand forgets that.
- **Remove all downloads** also turns automatic downloads off, or the cache would simply fill
  again.

Songs that leave the library are dropped from the cache, but only against a fresh answer from
the server and never a song the library still has, even one whose file is missing today.

A pass that finds nothing to do remembers the manifest it saw, so the next library bump that
changes no file — a tag, a rename — skips reading every cached entry's size again.

## What you see

- **A disc before the artist means "this song is on this device"** — the same meaning on
  every device, answered differently. A phone answers from what it has downloaded; a ring
  fills as the bytes arrive while one downloads, for a single song asked for by hand as well
  as during an automatic pass. A song that is not on the device carries no mark; Song details
  (in the ⋯ menu) says what will happen to it.
- **A browser tab streams** and keeps nothing — it has no Offline music settings at all; the
  installed desktop app downloads the way a phone does (see [desktop-app.md](desktop-app.md)).
  With the library in the cloud a tab streams from the bucket itself: it asks for
  `api/stream/<id>` and `api/art/<id>` under the app's own base, and the service worker
  fetches the file with the doorman's bearer header — which an `<audio>` element and an
  `<img>` are never given the chance to send — passing the player's range straight through.
  That is also where a cloud library's covers come from in a tab; before it was wired up,
  every row drew its letter tile and nothing played at all.
- **Offline, a song that is not on the device is dimmed**, and tapping it says why instead of
  starting a track that fails half a second later. Play and Shuffle use only what is here.
- **A pill under the library title** when there is something to say: downloading, waiting for
  Wi-Fi, storage full, or offline.
- **Settings → Offline music** has the switches, the reason for any wait with a Download now
  button, and how many plays are waiting to be sent.

## Not done yet

- Loves and tag edits made offline still fail rather than queue. The outbox is the place they
  would go.

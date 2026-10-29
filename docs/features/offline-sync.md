# Offline sync

Keeping a device's music, and its listening, in step with the library — without being asked.

The library is the bucket's (docs/SYNC.md), and every device keeps its own copy of the
library's metadata. What this page is about is the rest: which songs an installed app keeps
on the device, and how a play or an edit made with no connection still counts. A song
imported on another device turns up here by itself, and every song heard on a train is in
the play counts, Stats, the Report and forgotten gems like any other.

Files:

| What | Where |
|---|---|
| The listening outbox, shared rules | `packages/shared/src/outbox.ts`, `packages/client/src/listens/outbox.ts` |
| …kept on the device (a JSON file, IndexedDB in a browser) | `apps/app/src/offline/listenOutbox.ts` (+ `.web.ts`) |
| Edits made offline | the outbox of this device's copy of the library, `packages/replica/src/library.ts`; a browser's held edits, kept through a reload: `apps/app/src/offline/waitingEdits.ts` (+ `.model.ts`), `editKeys` in `packages/client/src/queries/queries.ts` |
| Automatic downloads | `apps/app/src/offline/DownloadsProvider.tsx` |
| Per-device preferences, connection type | `packages/client/src/downloads/syncPolicy.ts`, `apps/app/src/offline/connectionKind.ts` |
| Download, prune | `packages/client/src/downloads/queue.ts`, `apps/app/src/ports/downloadStorage.ts` (+ `.web.ts`), `apps/app/src/ports/offline.web.ts` |
| Which address a song plays and draws from | `apps/app/src/api/mediaAddress.model.ts`, `apps/app/src/ports/bucketMedia.ts` (+ `.web.ts`), `apps/app/sw/sw.ts` |
| Row mark, status line | `apps/app/src/ui/components/SongRow.tsx`, `apps/app/src/ui/components/SyncStatus.tsx` |
| What the counts mean | `downloadTally` in `packages/client/src/downloads/downloadIndex.ts` |
| Late plays on the server | `apps/server/src/services/cloudIngest.ts`, `repositories/stats.ts`, `services/playsArchive.ts` |
| Tests | `packages/shared/src/outbox.test.ts`, `apps/server/src/repositories/plays.test.ts`, `packages/client/src/downloads/downloadIndex.test.ts`, `apps/app/src/features/settings/OfflinePanel.test.tsx`, `apps/app/src/ui/components/SongMenu.test.tsx` |

## Plays made offline

A play is written to the device first and handed from there to this device's copy of the
library (`POST /api/songs/:id/played`, answered by `packages/replica`), which records it as a
change in the device's log. The log goes up to the bucket when it can; the server folds it in,
and the play lands in the month's plays file in the bucket (docs/SYNC.md, "Plays"). The
listening outbox sends again when the app comes back to the foreground.

Each play carries two things:

- **`playedAt`** — when it happened. The server stores that rather than the time the play
  arrived, so Tuesday's listening lands on Tuesday. A time in the future (a phone clock
  running fast) is treated as now.
- **`clientId`** — unique per play. A play sent twice is recorded once: the device's copy of
  the library remembers the ids it has counted, and the server has a partial unique index on
  `play_events.client_id`.

"Last played" only ever moves forward: a late play from last week does not overwrite one from
an hour ago.

A failed send is judged by status: no response, 401, 408, 429 and 5xx wait for next time;
anything else that will never be accepted (a song deleted meanwhile) is dropped. The queue is
bounded — 5,000 events or 400 days — and in practice never trimmed.

## Edits made offline

A love, a tag, a playlist change made with no connection is applied to this device's copy of
the library at once and kept in its outbox, which goes up to the bucket once it answers again
(docs/SYNC.md, "Editing from anywhere"). Nothing has to be redone by hand.

A browser that says it is offline holds every edit back before any library hears of it, a
server's or the bucket's. The taps that can wait — a tag, a heart, a song onto or off a
playlist, a new order (`editKeys`) — are kept on the device while they wait
(`waitingEdits.ts`), put back when the app opens again on the same library, and sent once it
is online; the sidebar says "Offline" and how many are waiting, never "All saved". Each says
only what it changes — a tag edit names the tags it puts on and takes off
(`PATCH /api/songs/:id/tags`), never the whole set — so one sent late leaves what another
device did meanwhile.

## Automatic downloads

On the devices that keep songs — the phone app and the desktop app — per device: on by
default on a computer or an iPad, off on a phone, which plays from the bucket and keeps what
it played. First sync asks the same question once (`keepEverySongUnasked` and
`keepEverySongByDefault` in `firstSync.model.ts`), so a phone that never reaches that page
downloads nothing nobody asked for. A browser tab streams and downloads nothing, so none of this applies there. Whenever
something changes — a song imported, the app opened, the connection switching to Wi-Fi — the
device works out what of the library it is missing and fetches it from the bucket, one song
at a time.

- **Download automatically on Wi-Fi** (off on a phone, on elsewhere). A phone reports its connection type
  (`connectionKind.ts`). A computer reports nothing, and is taken to be on Wi-Fi or a cable
  rather than refusing to download on a desk (`onWifi` in `syncPolicy.ts`). On mobile data
  it shows "12 not on this phone · on data · Download" and waits for a tap rather than
  spending the allowance for you; a sync over 500 MB (`LARGE_SYNC_BYTES`) waits for one too,
  quietly: Library's ⋯ has **Download all**, beside its size.
- **The whole library.** What to keep is every song the library has (`GET
  /api/library/manifest`, worked out from this device's copy).
- **A capped bucket waits.** While the bucket refuses reads for the day (docs/SYNC.md, "Caps"),
  no download starts; each would only be refused again.
- **Songs removed by hand stay removed.** "Remove from this phone" remembers the song, so the
  next pass does not put it straight back; downloading it again by hand forgets that.
- **A song that leaves the library is forgotten rather than remembered.** Removing the row is
  not "don't download this": the id can be handed to a different song later, so remembering
  it would keep the wrong song off the device.
- **Remove all from this phone** also turns automatic downloads off, or the cache would simply
  fill again. While it runs, it and "Remove leftover files" both read "Removing…" and neither
  can be pressed: two passes over one index would have the later one write back what the
  earlier one deleted.

Songs that leave the library are dropped from the cache, but only once the library has
actually answered, and never a song the library still has.

## Removing a song

Removing has one meaning on every device (docs/SYNC.md): the song leaves the library
everywhere, and whatever this device downloaded of it is deleted with it. "Remove from
library…" asks once and does that. There is no "keep the file" — the server keeps no copy of
the library, so there is nothing to keep, and a copy left anywhere is how removed songs used
to come back.

A song removed on *another* device goes here too: when the library the device reads no longer
names a song it kept, the download queue deletes the copy (`configure` in
`packages/client/src/downloads/queue.ts`, only once the library has actually answered).

## The two numbers

"How much of my library is here" and "what is this device keeping" are different questions and
`downloadTally` answers both, so nothing has to work it out twice.

The first is asked of the library in front of you. A song stops counting the moment it leaves
it — removed here, or removed on another device and arrived by sync — without waiting for
anything to agree. It is the sidebar foot's hover, "All saved · 45 songs · 41 on this
computer", and Settings' "41 of 43 songs on this phone", and both fall together.

The second is asked of the index, which outlives the library it was filled from. A file left
behind by a departed song is still a file taking up room, so it is what "Remove all from this
phone" is offered for, and what the leftovers line above it counts.

A pass that finds nothing to do remembers the manifest it saw, so the next library bump that
changes no file — a tag, a rename — skips reading every cached entry's size again.

## What you see

- **A disc before the artist means "this song is on this device"** — the same meaning on
  every device, answered differently. A phone answers from what it has downloaded; a ring
  fills as the bytes arrive while one downloads, for a single song asked for by hand as well
  as during an automatic pass. A song that is not on the device carries no mark; the song's own
  page (Song details, in the ⋯ menu) says what will happen to it.
- **A browser tab streams** and keeps only the last few songs it played — it has no settings
  for this at all; the installed desktop app downloads the way a phone does (see
  [desktop-app.md](desktop-app.md)). A tab streams from the bucket itself: it asks for
  `api/stream/<id>` and `api/art/<id>` under the app's own base, and the service worker
  fetches the file with the doorman's bearer header — which an `<audio>` element and an
  `<img>` are never given the chance to send. Each request is a read against the bucket's
  daily count (docs/SYNC.md, "Caps"), so a song loaded to sit paused fetches nothing until it
  is played, a cover is kept once under one address however it is asked for, and the words
  and motion a tab has read survive a deploy.
- **Offline, a song that is not on the device is dimmed**, and tapping it says why instead of
  starting a track that fails half a second later. Play and Shuffle use only what is here.
- **A line at the top of the Library** when there is news: downloading, a failure, waiting
  for Wi-Fi, the bucket's cap, or offline. A wait only a tap ends (automatic downloads off,
  or over 500 MB) is no news, and says nothing there.
- **Only a song that is here is marked**, with a small filled mark before its artist. A song
  that is not carries nothing: in a library that lives in its storage that is most of them.
- **Settings** has the switches as two quick tiles, Wi-Fi downloads and Stream the rest. Its
  **On this phone** card (*On this computer* in the desktop app) shows how much of the library
  is on the device and the room it takes, with one Download button and the leftover files;
  removing every song is at the foot of Settings.

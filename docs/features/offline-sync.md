# Offline sync

Keeping a device's music, and its listening, in step with the Mac — without being asked.

Before this, offline was a button. "Download everything" lived in Settings, and a song
imported afterwards (say, one shared from the YouTube Music app on the phone) stayed on the
Mac until you went back and pressed it again. Worse, a play made with the Mac asleep was sent,
failed, and was thrown away: every song heard on a train was missing from play counts, stats,
Wrapped and forgotten gems — which is exactly the listening this app exists for.

Files:

| What | Where |
|---|---|
| The listening outbox, shared rules | `packages/shared/src/outbox.ts` |
| …on the web (IndexedDB) | `apps/web/src/offline/playOutbox.ts` |
| …on the phone (a JSON file) | `apps/mobile/src/offline/listenOutbox.ts` |
| Automatic downloads | `apps/web/src/offline/OfflineProvider.tsx` |
| Per-device preferences, connection type | `apps/web/src/offline/autoDownload.ts` |
| Download, prune, storage guard | `apps/web/src/offline/audioCache.ts` |
| Row mark, status pill, Settings sentence | `apps/web/src/offline/OfflineStatus.tsx` |
| Late plays on the server | `apps/server/src/routes/songs.ts`, `repositories/stats.ts` |
| Tests | `packages/shared/src/outbox.test.ts`, `apps/server/src/repositories/plays.test.ts` |

## Plays made offline

A play is written to the device first and sent from there: at once if the Mac answers,
otherwise the next time it does — when the app comes back to the foreground, when the
reachability probe succeeds, or when the browser says it is online again.

Each play carries two things it did not before:

- **`playedAt`** — when it happened. The server stores that rather than the time the play
  arrived, so Tuesday's listening lands on Tuesday. A time in the future (a phone clock
  running fast) is treated as now.
- **`clientId`** — unique per play. A send whose response is lost gets retried, and the server
  ignores an id it has already recorded. There is a partial unique index on
  `play_events.client_id` (migration 6), so live plays without one are unaffected.

"Last played" only ever moves forward: a late play from last week does not overwrite one from
an hour ago.

A failed send is judged by status: no response, 401, 408, 429 and 5xx wait for next time;
anything else the server will never accept (a song deleted meanwhile) is dropped. The queue is
bounded — 5,000 events or 400 days — and in practice never trimmed.

## Automatic downloads

On by default, per device. Whenever the Mac is reachable and something changes — a song
imported, the app opened, the connection switching to Wi-Fi — the device works out what it is
missing and fetches it, one song at a time.

- **Only on Wi-Fi** (on by default). Chrome on Android reports the connection type. Safari
  never does, so on an iPhone the app cannot tell Wi-Fi from mobile data — and rather than
  guess, it shows "12 to download · Download" and waits for a tap. Desktop browsers report
  nothing either; a machine with a mouse is assumed to be on Wi-Fi or a cable.
- **Keep offline: every song, or songs in playlists.** The second resolves smart playlists on
  the server (`GET /api/library/manifest?scope=playlists`), so a smart playlist like "loved,
  played in the last 30 days" keeps the phone current by itself.
- **Storage.** Before each song the browser's quota is checked, and downloading stops at 90%
  of it — filling it completely gets the whole origin's storage evicted on some browsers,
  downloads and all. The status then says how many songs did not fit.
- **Songs removed by hand stay removed.** "Remove download" remembers the song, so the next
  pass does not put it straight back; downloading it again by hand forgets that.
- **The Mac itself.** On `localhost` automatic downloads start off: the songs are already on
  that disk.
- **Remove all downloads** also turns automatic downloads off, or the cache would simply fill
  again.

Songs that leave the library are dropped from the cache, but only against a fresh answer from
the server and never a song the library still has, even one whose file is missing today.

A pass that finds nothing to do remembers the manifest it saw, so the next library bump that
changes no file — a tag, a rename — skips reading every cached entry's size again.

## What you see

- **A mark before the artist on a downloaded song**: a solid accent disc, or a ring that fills
  as the bytes arrive while it downloads — for a single song asked for by hand as well as
  during an automatic pass. A song that is not on the device carries no mark, the way other
  music apps do it; Song details (in the ⋯ menu) says what will happen to it.
- **On the Mac that runs self.mp3**, the song menu offers **Show in Finder** instead of
  "Download for offline": the song is already a file on that disk, and a browser copy would
  only double it. The server opens Finder only for a request made on that machine
  (`services/reveal.ts`) — loopback *and* a loopback Host, since `tailscale serve` also
  connects from loopback.
- **Offline, a song that is not on the device is dimmed**, and tapping it says why instead of
  starting a track that fails half a second later. Play and Shuffle use only what is here.
- **A pill under the library title** when there is something to say: downloading, waiting for
  Wi-Fi, storage full, or offline.
- **Settings → Offline music** has the switches, the reason for any wait with a Download now
  button, and how many plays are waiting to be sent.

## Not done yet

- The native app keeps plays offline but does not download automatically: Wi-Fi detection
  there needs `expo-network` or `@react-native-community/netinfo`, which are not installed.
- Loves and tag edits made offline still fail rather than queue. The outbox is the place they
  would go.

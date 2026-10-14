# The app on a phone (iOS and Android)

`apps/app` is one Expo / React Native app for iOS, Android and the web. On a
phone it has what a browser cannot give: dependable background audio on iOS, and
real downloaded files instead of an evictable cache. The screens are the web's,
drawn at phone width; the layout is decided by width, not by platform.

**The full guide is [`docs/MOBILE.md`](../MOBILE.md)**: prerequisites, running
it on the simulator, a release build on your own iPhone, Android, and Android
Auto testing with the Desktop Head Unit. [`docs/PREPROD.md`](../PREPROD.md) is
what to check before calling a build good. iOS runs; no Android binary has ever
been built.

## Using it

First launch opens on Welcome, whose one button is Continue with Google; the
library is then the one in your bucket, and the server does not have to be
answering. A device's first sign-in is followed, once, by First sync: the
library arriving, and whether to keep every song on the device (off on a phone,
on on a computer). Signing out returns to Welcome. There is no address to type
in a normal build; a development build keeps a "Connect to a server by address"
text action on Welcome, because the simulator flows cannot sign in to a Google
account. The tabs are **Home · Library · Playlists**; Home's avatar opens
Profile, which holds Stats, the report and Settings, and its + opens Import.

What needs the server itself — importing, Stats, metadata lookup, the smart
features — talks to it directly, by the addresses the server writes into the
bucket's snapshot, or the shared server when the bucket names none
([shared-server.md](shared-server.md)). When it does not answer, each of those
screens says so; Import still takes a link, leaves it in the bucket, and the
server fetches it when it is next reachable.

## Offline

A phone downloads what it keeps: automatically on Wi-Fi if that is on, asking
first on mobile data and over 500 MB, or by hand from a song or playlist. A
downloaded song plays from disk; anything else streams from the bucket. A song
removed by hand stays removed.

Streaming from the bucket is the doorman's address with the session's bearer
sent as a header on the track (`src/ports/bucketMedia.ts`), and it answers to
the same two settings any stream does: "Play songs that aren't downloaded", and
the ask before using mobile data. With automatic downloads off — a phone short
of room — a song that counts as a play is also kept as a file, so the songs
actually listened to are not fetched from the bucket every day. Those copies are
a cache and not downloads (`src/ports/recentCopies.ts`): they live in the
system's cache folder, never show as "on this device", take at most a quarter of
the free space up to 2 GB, and the least recently played go first. Asking for
one by hand turns the copy into a download without fetching it again. The
library itself is kept on the device too, so the app opens and browses with no
connection.

## In the car

**CarPlay has been removed.** It needed Apple's `carplay-audio` entitlement,
which is granted only to a paid developer team and only on request, and this is
a personal app built on a free account. The browse tree it used is still here
and unit-tested (`apps/app/src/ports/car/browseTree.ts`), because Android Auto
would resolve against the same one.

**Android Auto** should get transport controls, metadata and artwork from the
current queue, which is what react-native-track-player's media session exposes.
There is no browsable menu in the car's own UI and no voice search: the
installed track-player has neither the JavaScript API nor the native callbacks
for them. Nothing has been tried in a car or a head unit; `docs/MOBILE.md`
explains what was found and what a fix would take.

## Notes for whoever touches it next

- The queue rules are `packages/shared/src/queue.ts`, shared with the web build.
- Gapless is the native player's job. Crossfade cannot be done with one native
  player, so the crossfade setting applies in a browser and not on a phone.
- The app is outside the root TypeScript project graph and the root ESLint config
  (React Native's globals versus the DOM's). `npm run check:app` checks it,
  and `npm run check` runs that too. Its pure tests run in the root vitest suite.

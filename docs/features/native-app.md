# The app on a phone (iOS and Android)

`apps/app` is one Expo / React Native app for iOS, Android and the web. On a
phone it has what a browser cannot give: dependable background audio on iOS, and
real downloaded files instead of an evictable cache. The screens are the web's,
drawn at phone width; the layout is decided by width, not by platform.

**The full guide is [`docs/MOBILE.md`](../MOBILE.md)**: prerequisites, running
it on a phone, local builds, Android Auto testing with the Desktop Head Unit.
[`docs/PREPROD.md`](../PREPROD.md) is what to check before calling a build good.

## Using it

First launch asks you to sign in with Google; the library is then the one in
your bucket, and the server does not have to be running. There is no address to
type — a development build keeps the `/onboarding` address screen, because the
simulator flows cannot sign in to a Google account, and that is the only place
it survives. The tabs are **Library · Playlists · Import · You**, where You
holds Stats & report, Tags and Settings.

Importing works: the Import screen reaches the server directly when it can, by
the addresses in the bucket's snapshot, and leaves the request in the bucket when
it cannot. The other things that need the server itself — Stats and
looking metadata up — are hidden from a cloud library, and since every surface is
now a cloud library, they are not reachable anywhere today. The server's own page
does not draw them either; it is setup and status. That is a gap, and it is
recorded as one in [`docs/SYNC.md`](../SYNC.md).

## Offline

A phone downloads what it keeps: automatically on Wi-Fi if that is on, asking
first on mobile data and over 500 MB, or by hand from a song or playlist. A
downloaded song plays from disk; anything else streams from the bucket, or from
the server when the app is pointed at one. A song removed by hand stays removed.

Streaming from the bucket is the doorman's address with the session's bearer
sent as a header on the track (`src/ports/bucketMedia.ts`), and it answers to
the same two settings any stream does: "Play songs that aren't downloaded", and
the ask before using mobile data. With automatic downloads off — a phone short
of room — a song that counts as a play is also kept as a file, so the songs
actually listened to are not fetched from the bucket every day. Those copies are
a cache and not downloads (`src/ports/recentCopies.ts`): they live in the
system's cache folder, never show as "on this device", take at most a quarter of
the free space up to 2 GB, and the least recently played go first. Asking for
one by hand turns the copy into a download without fetching it again.
The last library response is saved too, so the app opens and browses with no
connection.

## In the car

**CarPlay has been removed.** It needed Apple's `carplay-audio` entitlement,
which is granted only to a paid developer team and only on request, and this is
a personal app built on a free account. The browse tree it used is still here
and unit-tested (`apps/app/src/ports/car/browseTree.ts`), because Android Auto
resolves against the same one.

**Android Auto** gets transport, metadata, artwork and voice search, which is
what react-native-track-player exposes. The browsable menu inside the car's own
UI is not there yet; `docs/MOBILE.md` explains what was found.

## Notes for whoever touches it next

- The queue rules are `packages/shared/src/queue.ts`, shared with the web build.
- Gapless is the native player's job. Crossfade cannot be done with one native
  player, so the server's crossfade setting applies in a browser and not on a phone.
- The app is outside the root TypeScript project graph and the root ESLint config
  (React Native's globals versus the server's). `npm run check:app` checks it,
  and `npm run check` runs that too. Its pure tests run in the root vitest suite.

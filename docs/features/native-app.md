# The app on a phone (iOS and Android)

`apps/app` is one Expo / React Native app for iOS, Android and the web. On a
phone it has what a browser cannot give: dependable background audio on iOS, and
real downloaded files instead of an evictable cache. The screens are the web's,
drawn at phone width; the layout is decided by width, not by platform.

**The full guide is [`docs/MOBILE.md`](../MOBILE.md)**: prerequisites, running
it on a phone, local builds, Android Auto testing with the Desktop Head Unit.
[`docs/universal-progress.md`](../universal-progress.md) records what has been
checked, on which simulator, and how.

## Using it

First launch asks you to sign in with Google; the library is then the one in
your bucket, and the server does not have to be running. The things that need
the server itself (Stats, the tag inbox, looking metadata up, picking tracks
while importing) are on the server's own page: its address in a browser.

## Offline

A phone downloads what it keeps: automatically on Wi-Fi if that is on, asking
first on mobile data and over 500 MB, or by hand from a song or playlist. A
downloaded song plays from disk; anything else streams while the Mac is
reachable. A song removed by hand stays removed. The last library response is
saved too, so the app opens and browses with no connection.

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
  player, so the Mac's crossfade setting applies in a browser and not on a phone.
- The app is outside the root TypeScript project graph and the root ESLint config
  (React Native's globals versus the server's). `npm run check:app` checks it,
  and `npm run check` runs that too. Its pure tests run in the root vitest suite.

# Native app (iOS and Android)

`apps/mobile` is an Expo / React Native app: the same library, the same server,
but with the three things a PWA cannot do — dependable background audio on iOS,
and real downloaded files instead of an evictable cache.

**The full guide is [`docs/MOBILE.md`](../MOBILE.md)** — prerequisites, running
it on a phone, local builds, Android
Auto testing with the Desktop Head Unit, and an explicit list of what has and
has not been verified. This page is the short version.

## Using it

First launch asks for the server address — the Tailscale name, so it keeps
working away from home (`mac-mini.tail1234.ts.net`) — and a bearer token
if the server has one. Both go in the device keychain. The address is tested
before it is saved, and a bad token is reported differently from a bad address.

Four screens:

- **Library** — search, sort chips, tag chips, and a "downloaded only" filter,
  all applied locally to the one `/api/library` response.
- **Playlists** and one playlist — play, shuffle, or download the whole thing.
- **Now playing** — artwork, scrubber, transport, and a panel that switches
  between synced lyrics (karaoke highlight, self-scrolling) and the queue.
- **Settings** — server, downloads, storage used, about.

Tap a song to play the list from there; long-press to play it next.

## Offline

Nothing is downloaded by accident. "Download everything" in Settings, or
"Download" on a playlist, queues files into the app's document directory one at
a time, resumable and pausable. A downloaded song plays from disk; anything else
streams. Settings shows the count, the bytes, and how much the rest would take.

The last library response is cached to disk too, so the app opens and browses
with no server at all.

## In the car

**CarPlay has been removed.** It needed Apple's `carplay-audio` entitlement,
which is granted only to a paid developer team and only on request — and this
is a personal app built on a free account. The browse tree it used is still
here, and still unit-tested, because Android Auto resolves against the same one.

**Android Auto** gets transport, metadata, artwork and voice search ("play Kind
of Blue"), which is what react-native-track-player currently exposes. The
browsable menu inside the car's own UI is not there yet, because the library has
no API to publish one — `docs/MOBILE.md` explains what was found and what the
alternatives are. The tree itself is built and unit-tested regardless.

## Notes for whoever touches it next

- Queue mechanics moved to `packages/shared/src/queue.ts` so both clients share
  them; `apps/web/src/player/queue.ts` is now a one-line re-export.
- Gapless is the native player's job. Crossfade is not implemented and cannot
  be with one player — the server's `crossfadeSeconds` does nothing here.
- The workspace is deliberately outside the root TypeScript project graph and
  the root ESLint config (React Native's globals versus the DOM's). Use
  `npm run check:mobile`. Its pure tests still run in the root vitest suite.
- No binary has ever been built from this code; it has been type-checked, linted
  and prebuild-tested only. `docs/MOBILE.md` lists exactly what that leaves
  unproven.

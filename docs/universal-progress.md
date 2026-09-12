# Universal migration — progress

A log of the overnight run against `docs/UNIVERSAL.md`, written for whoever
reads it in the morning. Newest phase last. Times are UTC on 2026-09-12.

Nothing has been merged to `main`. Every branch is pushed to `origin` and
nothing else. Each branch is based on the one before it: spike, then phase-1,
then phase-2 from phase-1, then phase-3 from phase-2.

---

## Spike — branch `universal/spike`

One commit, `99f51fa` at 05:45. Full results table is in `docs/UNIVERSAL.md`
under *Risks*, on that branch.

**Outcome: checks 1 and 4 both pass, so the plan does not stop at phase 1.**

`apps/mobile` was copied to `apps/app` first, since none of the spike commands
exist without it. Six checks; every one with a device half is split, because
this ran on Linux with no Mac, no simulator, no Android SDK and no Maestro.

| Check | Web half | Device half |
|---|---|---|
| 1 — web export, and under `/selfmp3/` | **pass** — 970 modules, 1.6MB | n/a |
| 2 — Unistyles hover and breakpoints | **pass** | not run — needs Xcode and the Android SDK |
| 3 — headless tabs as sidebar and bottom row | **pass** | not run — flow written, needs a simulator |
| 4 — the web audio engine under Metro web | **pass** — plays, preloads, crossfades | n/a |
| 5 — `'use dom'` canvas | companion spec **passes**, so the drawing works | **not run at all** — needs a simulator |
| 6 — FlashList at 2,000 rows | **pass** — no blank frame in 30 scroll steps | not run — flow written, needs a simulator |

Four Maestro flows are written and committed in `apps/app/.maestro/` for a Mac
to run. Check 5 is the only one with no evidence at all from here; its
companion Playwright spec proves `visualDraw.ts` paints, so a red Maestro run
would mean the webview rather than the drawing.

---

## Phase 1 — `packages/client` — branch `universal/phase-1`

Seven commits, `9d725a7` (06:02) through `35e6ab6` (06:38).

### Gates

The plan's four phase 1 commands. Run at 06:38, on `35e6ab6`.

| Command | Result |
|---|---|
| `npm run check` | **pass** — 1085 tests, 94 files (baseline on `main` was 1043) |
| `npm run check:mobile` | **pass** — clean |
| `grep -rn "'/api/" apps/web/src apps/mobile/src \| grep -v packages` | **pass** — no matches; every route string is in the package |
| `npx playwright test verify/flows --project=desktop --project=phone` | **pass** — 18 tests at both widths, on the Mac, 2026-09-12. See *The fourth gate, run* below. |

`npm run build` was also run at each commit, since `npm run check` does not
build the web bundle and a broken Vite build would not have shown up otherwise.

### What moved

Everything phase 1 names, and everything under *Also move*:

- The API client and all 74 endpoints, the error type, the media URLs.
- Connection handling and `normaliseBaseUrl`, which had no tests and now has 17.
- Every query hook, from both apps, merged into one set.
- The download index (was pure already), the listen outbox, the theme tokens
  and the OKLCH converter.
- The play-counting rules — the two-second listening gap and the four-minute
  threshold cap, which were written out twice.

### What the phone gained

Every mutation the web app had and the phone did not: love, tag, playlist
membership, song edits, settings. No line was written for any of them; they
were already on the other side of a file boundary.

It also now has `recordSkipListen` and `subscribePendingListens` available and
unused — see the open questions.

### Deliberate differences

All recorded in the commit messages that made them. In summary:

1. **A stale library now stands in for any failed request, on the web too.**
   The web used to fall back only when the network was gone. Xiao decided this
   one at 06:30: a music library is not a dashboard, and one song missing beats
   all of them missing. Visible on the web: an erroring Mac shows the last
   library rather than an error screen. Other screens still report the failure.
2. **The phone's library refetches after 30 seconds rather than 60, and
   retries twice rather than once** — but no longer retries when offline, which
   is where that retry was being spent. Consequence of taking the web app's
   version of the hook.
3. `verify/` is at the repository root, not `apps/app/verify/` as the plan has
   it, because `apps/app` does not exist until phase 2.

### What did not get done, and why

- **The fourth gate command has never been run.** It needs a server with songs
  in it. The thirteen-song dev library is not in the repository, and
  fabricating one would make the command green anywhere while making the phase
  4 comparison meaningless. It runs on the Mac: `npm run dev`, then
  `npm run verify:flows`.
- **No reference captures.** Same reason. `docs/reference/<sha>/` is still
  empty, and phase 4 depends on it.
- **The queue-to-engine glue was not moved.** Looking at it, the queue half is
  already shared — both `PlayerProvider`s import `enqueue`, `moveItem`,
  `playNext`, `removeAt` and `resolveQueue` from `packages/shared` and have
  done for a while. What is actually duplicated is the *engine* half: the web
  drives an `<audio>` element through `loadIndex`, the phone drives
  react-native-track-player's own queue through `loadQueue`. Those cannot be
  merged without the `PlaybackEngine` port, which the plan itself schedules for
  phase 3. Moving it early, in phase 1, unverifiable here, is how the player
  gets broken. Left for phase 3, where it belongs.

### Phases 2 and 3

**Not started at the time this was written** — both gates need a Mac: phase 2
requires `expo run:ios`, `expo run:android` and `maestro test`, and phase 3
requires Maestro for the offline and devices flows. Starting them there would
have produced branches that cannot be shown to be green, against a ground rule
that says commit only on green gates.

They were begun later in the same run, as far as a container could take them.
See the two sections below.

---

## The fourth gate, run — on the Mac, 2026-09-12

Commit `17f4571` on `universal/phase-1`. The flow suite had never met a running
app; this is what happened when it did.

**All four phase 1 gates are now green on one commit**, so phase 1 is done.

| Command | Result |
|---|---|
| `npm run check` | **pass** — 94 files, 1085 passed, 1 skipped |
| `npm run check:mobile` | **pass** — clean |
| `grep -rn "'/api/" apps/web/src apps/mobile/src \| grep -v packages` | **pass** — no matches |
| `npm run verify:flows` | **pass** — 18 passed, desktop and phone, stable over three runs |

`npm run build` was run too, since `npm run check` does not build the web bundle.

### What the gate found

Three faults, every one of them in the tests. No product code was touched and
nothing about how the app looks or behaves changed. The question the runbook
asks — real regression from the `packages/client` move, or a selector guessed
by someone who never saw the app run — came back "selector" all three times,
and the evidence for that is below rather than asserted.

1. **The gate command could not have worked.** `playwright test verify/flows`
   looks for a config in the working directory and there is none at the root,
   so it ran with defaults and failed with *no such project: available
   projects: ""*. It now passes `-c verify/playwright.config.ts`.

2. **A song could not be started, at either width, for two different reasons.**
   Above the 820 breakpoint `.song-index-play` is `display: none` until
   `.song-row:hover`, so Playwright waited on a button with no box. Below 820
   that button is not hidden but *absent* — the phone has no index column,
   `showIndex={!isMobile}` — and the row itself is the control. Both now go
   through one `playSong` helper.

3. **"The audio is really advancing" could never have been true.** It read
   `document.querySelector('audio').currentTime`. There are no `<audio>`
   elements in the document at all: `engine.ts` builds its two with
   `new Audio()` and never appends them, so the selector was always null and
   the value always 0. Instrumenting the page confirmed it — zero elements, at
   both widths, with no console errors. It now reads the scrubber, which is the
   engine's `currentTime` and also the number a person can see: 0 → 4.7s at
   1280, 0 → 5.0s at 375.

So the answer to open question 4 — is the type checker plus 1043 existing tests
enough evidence that phase 1 changed no behaviour — is now better than it was.
The 27 moved query hooks are exercised end to end: the library loads, searches
and sorts, a love survives a reload, playlists and settings load, a song plays
from a stream URL built by `packages/client`, and Next moves the queue.

### The dev library, and one failure that was not a fault

`reversing the sort changes which song is first` failed at both widths on the
first run and then passed, without the test changing. Worth writing down,
because the difference was the library and not the app.

The thirteen songs live in the main checkout (`library/` and `data/`, the
legacy in-repo location), not at the `~/Music/selfmp3-dev` that
`SELFMP3_PROFILE=dev` points at — and a git worktree has no `library/` of its
own, so `npm run dev` from here came up empty. Copying the audio across and
letting the server rescan produced thirteen songs whose `addedAt` are all
*one* value, since they were scanned in a single 225 ms batch. The default
sort is `addedAt`, and reversing a stable sort whose keys are all equal
cannot change which song is first.

Copying `data/selfmp3.db` into the profile's data directory as well fixed it:
the real dev library has twelve distinct timestamps across its thirteen songs,
and song paths are stored relative to the library folder, so the database
works unchanged against the copy. The original checkout's `library/` and
`data/` were not modified — the flows love songs and edit playlists, which is
exactly what the profile mechanism exists to keep away from real data.

**Setup for the next session**, since this is not in the repository and cannot
be:

```
~/Music/selfmp3-dev                             the thirteen songs (+ .lrc)
~/Library/Application Support/selfmp3-dev/      selfmp3.db, covers/, lyrics/
```

Both are copies of the main checkout's `library/` and `data/`. With them in
place `npm run dev` works from any worktree, and `npm run verify:flows` is
green.

One thing to know when running these by hand: a server was already listening
on 4600 when this started — `npm run start` from the main checkout, on the
real library — and the dev server lost the bind race silently, so the flows
would have run against the real collection. Xiao confirmed it could be
stopped. Check what owns 4600 before trusting a green run.

---

## Phase 2 — `apps/app` — branch `universal/phase-2`

One commit, `1ba3d2c` at 07:17. **Scaffolding only — no screens ported.**

`apps/app` is today's `apps/mobile` copied whole, with the web target the spike
proved. Copied from `apps/mobile` as it stands on phase 1, not from the spike's
own copy: the spike copied the phone app before `packages/client` existed, so
its `apps/app` is a phase behind.

### Gates

| Command | Result |
|---|---|
| `npm run check:app` | **pass** |
| `npx expo export -p web` | **pass** — 1.7MB bundle, and again under `/selfmp3/` |
| `verify/boot.spec.ts` | **pass** at 1280 and 375 |
| `npx expo run:ios` / `run:android` | **not run** — needs Xcode and the Android SDK |
| `maestro test .maestro/smoke.yaml` | **not run** — needs a simulator |
| `npx playwright test verify/flows --project=phone` | **not run** — needs a library |

**The phone app now runs in a browser.** Not a spike route: the real app, on
the shared client, booting at both widths with no uncaught errors and landing
on the sign-in screen because nothing has told it where a Mac is.

`verify/boot.spec.ts` is new. A successful export proves the bundle was built,
not that it runs — a module that throws at import time exports perfectly and
then paints a white screen, and that failure otherwise waits for somebody to
open a browser by hand.

Two pieces of the spike's Metro config are gone, because they existed only so
the spike could import `apps/web` source directly: the `.js`-to-`.ts` specifier
retry and the stub for the one module reading Vite's `import.meta.env`.
`apps/app` imports neither. What remains is two stubs —
`react-native-track-player` and `expo-file-system` — and those are exactly what
phase 3's two ports replace. That the list is only two is the finding.

**Not done:** the primitives, `src/features/*`, `src/shell`. That is where to
pick up, after the reference captures.

---

## Phase 3 — the ports — branch `universal/phase-3`

Two commits, `37d64e4` and `82ff1b9`, 07:18 to 07:24. **Interfaces and the web
half of one port. No native implementation, no providers.**

Both ports are written in `packages/client`, and the engine one is proved:

```
const _conforms: PlaybackEngine = new AudioEngine()
```

`apps/web/src/player/engine.ts` is now also `apps/app/src/ports/engine.web.ts`,
changed as little as possible — the `mediaUrl` import gone, `capabilities`
added, nothing else. That line compiles, so the interface derived from the
engine has not drifted from it. The assertion was checked to bite by adding a
method to the port and watching it fail.

`OfflineStore` is proved the same way, by the web offline code moved to
`apps/app/src/ports/offline.web.ts`. It names only the storage, not the
downloading. The two apps look
very different here, but that difference is not platform — the queue simply got
written twice. Ordering, progress and failure handling are policy and belong in
the one `OfflineProvider` above the port.

### Where this stopped, and why

**The native half of the engine port is the wall, and it is a real one.**

The web half was a move: `engine.ts` was already a self-contained class with
exactly the right shape, which is why the port was derived from it. The phone
has no such class — its track-player code is spread across `PlayerProvider`,
`service.ts`, `setup.ts` and `tracks.ts`. Wrapping it is invention, not a move.

And the invention turns on a design question that needs a device to answer:
track-player **owns the queue** (`capabilities.nativeQueue`), while the port
hands an engine one song at a time plus a hint about the next. Reconciling
those two models is the hard part of phase 3, getting it wrong breaks playback
on the phone specifically, and nothing here can tell which way is right. That
is a simulator's answer, not a type checker's.

So: both interfaces and both web halves, proved as far as they can be proved;
the native halves left for the Mac with the question written down.

One thing the offline move settled in passing. `audioCache.ts` had a single
import from the web app — `appPath`, from the one module in `apps/web` that
reads Vite's `import.meta.env`, which is exactly the module the spike had to
stub because Metro cannot evaluate it. It was used in one place, to build a
stream URL, so it became injected wiring in the same shape the engine already
uses. The spike's stub is unnecessary here for the same reason the engine's
was: the tie to the web app was one function, and naming it made it go away.

---

## The reference set — on the Mac, 2026-09-12

Commit `6d187ed`, on `main`. 58 captures of the old web app under
`docs/reference/fb882e0/`: 30 at 1280, 28 at 375. Reproduce with
`npm run dev` and then `npm run verify:reference`.

This was the other thing a container could not do, and phases 2 to 4 are
checked against it. It is a script — `verify/reference.spec.ts` — rather than a
session with a screenshot key, so a single state can be recaptured later
without redoing the set by hand.

### Three things that had to be pinned

Each was found by getting it wrong and looking at the result.

1. **The accent is a server setting.** The capture that demonstrates changing it
   left the library on the new colour, so the second width was photographed on
   that instead — 1280 came out pink and 375 blue. It is now fixed for the run
   and restored afterwards. The set is at hue **330**, which is what the dev
   library is actually set to; the plan's token test resolves at 268, which is a
   different question.
2. **Rows reveal their controls on hover**, and dismissing the resume toast
   leaves the pointer exactly on the bottom row — so "at rest" was captured with
   one row hovered. The pointer is parked on the header before every shot.
3. **`lyricsRomanization` is stored, and this library has it on**, so the lyrics
   capture and the romanisation capture were the same image under two names.
   They are now taken as off and then on, whichever way the library is set.

Settings scrolls an inner container rather than the window, so `settings-top`
and `settings-bottom` were also the same image until that was fixed.

### The seeded library

`verify/reference/seed.ts` adds what the plan's table needs and a thirteen-song
library with no playlists cannot show: a manual list, a smart list whose rules
can be opened, an empty list, and a second tag so that "one tag filtered, one
excluded" is a real state rather than a filter and an empty result. It is
idempotent and everything it creates is named `Reference — …`.

### Not captured, and why

- **Sign-in and onboarding.** Only in the cloud build (`VITE_CLOUD=1`), and
  "waiting" and "code entry" mean signing in to Google. Credentials are a
  stop-and-ask in the runbook, so these are left for Xiao.
- **The remote device chip.** Needs a second device actually playing; one
  machine cannot produce it honestly. The devices popover and the resume toast,
  the rest of that row, are both captured.
- **Volume (compact).** There is no such surface: the desktop has an inline
  slider, and the phone has no volume control because a phone's volume is its
  own.
- **A truly empty Playlists screen.** Faked by removing the three seeded
  playlists and putting them straight back; it only ever removes those three.

### The dev library after all this

Left exactly as it was found — accent 330, theme dark, romanisation on — plus
the seeded playlists and the `reference` tag, which are meant to stay so the
set stays reproducible. The real `library/` and `data/` in the main checkout
were never written to.

---

## Phase 2, on the Mac — 2026-09-12

Four commits on `universal/phase-2`, `48695a5` through `bde1f5f`, on top of a
merge of `main`. **Not finished.** What is done is green; what is left is
listed at the end.

### Gates

| Command | Result |
|---|---|
| `npm run check:app` | **pass** |
| `npm run test` | **pass** — 96 files, 1105 passed, 1 skipped |
| token parity (`packages/client` theme) | **pass** — 23 tests |
| `npx expo export -p web` | **pass** — 1.7MB |
| `npx expo run:ios` | **pass** — Build Succeeded, 0 errors |
| `maestro test .maestro/smoke.yaml` | **pass** — iPhone 17 Pro, iOS 26.5 |
| `verify/flows --project=phone` vs `apps/app` | **6 passed, 3 skipped** (reasons below) |
| `verify/flows` vs `apps/web` | **pass** — 18, unchanged |
| `npx expo run:android` | **not run** — no Android SDK on this Mac; Xiao chose not to install one |

The iOS build is also the device half of spike check 2: Unistyles,
`react-native-nitro-modules` and track-player compile into one dev client.

### What was built

- **`src/shell`** — the one place that reads a width. Under 820 the screen
  fills the display with a mini player and a tab bar; at 820 and above a
  sidebar runs down the left and a player bar across the foot. The screen is
  `children` either way, so dragging a browser window across the breakpoint
  swaps the chrome without remounting it. `BREAKPOINT` is a token in
  `packages/client` beside the colours.
- **`src/ports`** — `secrets`, `prefs`, `keyboard`, plus `cloudPlatform` and
  `car/` moved in from where they were.
- **`src/features/library`** — the screen, and `library.model.ts` behind it
  with its own vitest test.
- **The foundations as lint rules**, which is how three of the ports were
  found.

### Four bugs the Mac found, which a container could not

1. **A sheet made the app invisible.** Every sheet was its own `Modal`, and a
   `Modal` on iOS is its own window. Presenting a second one after a first had
   been dismissed took the app's whole view tree out of the accessibility
   hierarchy: the list, the tab bar and the mini player stayed on screen and
   became unreachable to VoiceOver and to anything driving the app. Opening
   the sort sheet and then a song's menu is exactly that sequence —
   `maestro hierarchy` showed six nodes, all of them the status bar. Sheets are
   now drawn by one host at the root of the shell, with no windows at all,
   which is also the host the web needs for `Popover` in phase 4.
2. **`expo-secure-store` throws on web.** It resolves and then fails on use, so
   the app accepted a server address, said it had found thirteen songs, and
   forgot on reload. Now the `secrets` port.
3. **The accent could not be read or saved on web.** It is a device-local
   preference in a file, and `expo-file-system` is stubbed out of the web
   bundle, so the picker appeared to work and forgot. Now the `prefs` port; the
   web comes up in the same colour as the phone.
4. **`SongRow` was a button containing buttons.** `react-native-web` renders
   `accessibilityRole="button"` as a real `<button>`, so every row wrapped its
   love and ⋯ controls in one — invalid HTML, two hydration errors per row. The
   row is a container now, as the web app has always drawn it.

### The three skipped flows, and why

- **Playback, twice.** `react-native-track-player` has no web implementation
  this repo will take, so the web bundle stubs it. The web engine is phase 3's
  `PlaybackEngine` port. These are phase 3's gate.
- **The Mac's settings.** The phone's Settings carries server, downloads,
  appearance and about; crossfade and what counts as a play arrive with phase 4.

### What phase 2 still owes

- `src/features/*` for the rest: playlists, playlist detail, now playing,
  settings, sign-in, onboarding. Only library has moved.
- The primitives the plan adds: `Popover` (a `Sheet` below the breakpoint),
  `Select`, `Tooltip`. The overlay host they need now exists.
- `SongList` on FlashList; the library is still a `FlatList`.
- jest-expo against the primitives. Model tests run under vitest; components
  have none yet.
- `expo run:android`.

### Running it

```
npm run dev                                   # 4600 / 4601
cd apps/app && npx expo start --dev-client --port 8095
xcrun simctl openurl booted \
  "selfmp3://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8095"
maestro test .maestro/smoke.yaml
```

For the web target and its flows, the server needs to allow the origin and the
app needs to be told where the Mac is:

```
SELFMP3_CORS_ORIGINS=http://localhost:8090 npm run dev
cd apps/app && npx expo start --web --port 8090
SELFMP3_WEB_URL=http://localhost:8090 SELFMP3_APP_API=http://localhost:4600 \
  npx playwright test -c verify/playwright.config.ts flows --project=phone
```

Ports 8081 and 8082 are taken by other worktrees' Metro instances on this Mac,
which is why these are 8090 and 8095.

---

## Open questions for the morning

1. **Should the phone record skips?** The web does: a manual skip past the
   halfway point is written to the outbox, and that is what makes "songs I
   always skip" work. The phone never has, so that feature is blind to
   everything listened to on the phone. Phase 1 gave the phone the function it
   would need, without calling it — wiring it up changes what shows up in your
   stats, which is your call, not a refactor's.

2. **An expired token now shows a stale library rather than an error.**
   Falling back on any failure includes 401. You would see your library and the
   songs would not stream, which is harder to diagnose than an error screen.
   The proper fix is the app noticing 401 and asking you to sign in again,
   which is a real change rather than part of this one. Worth doing?

3. **Where should `verify/` finally live?** It is at the repository root now.
   The plan says `apps/app/verify/`. Phase 2 can move it or leave it; leaving
   it at the root means one copy runs against both apps, which is what the
   phase 4 comparison wants anyway.

4. **Is 1085 tests covering `packages/client` enough for the exit criterion?**
   The plan's phase 1 exit says "`npm run check` covers the package". It does —
   42 new tests, on the connection parsing, the token parity and the play
   counting, all of which had none. But the 27 query hooks moved with no tests
   of their own, on either side, and `verify/flows` is what would cover them.
   Until that runs on the Mac, the evidence that phase 1 changed no behaviour
   is the type checker, the existing 1043 tests, and reading the diff.

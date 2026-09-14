# Universal migration — progress

A log of the overnight run against `docs/UNIVERSAL.md`, written for whoever
reads it in the morning. Newest phase last. Times are UTC on 2026-09-12.

Phases 1, 2 and 3 are on `main`, each as a fast-forward of its branch once its
gates were green. Each branch is based on the one before it: spike, then
phase-1, then phase-2 from phase-1, then phase-3 from phase-2. The sections
below were written as each phase went, so an early one saying something has
not been merged was true when it was written.

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

Nine commits on `universal/phase-2`, `48695a5` through `66b7776`, on top of a
merge of `main`. **Done, bar `expo run:android`** — this Mac has no Android SDK
and Xiao chose not to install one.

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
| `npm run check:app` (jest-expo) | **pass** — 7 component tests, now part of the same command |
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

### Finished after that was written

- **Every screen has a folder.** Playlists, playlist detail, now playing,
  settings, sign-in and onboarding joined library in `src/features/*`; each
  route file is one line. `playlists.model.ts` came with the move, carrying the
  one rule that screen has — pinned lists above the alphabet rather than into
  it, and names compared by locale rather than by code point, which is not a
  subtlety in a library that is mostly Japanese.
- **The three primitives.** `Popover` is one component with two shapes, anchored
  above the breakpoint and a `Sheet` below it, and the caller does not know
  which it got. `Select` is built on it and the library's sort control is the
  first user — checked at both widths, a sheet at 375 and a panel anchored under
  the control at 1280. `Tooltip` is a `.web.tsx` pair that draws nothing on a
  phone.
- **`SongList`, with a `FlatList` inside it.** See below: FlashList was tried
  and is not usable yet.
- **jest-expo**, folded into `npm run check:app`.

### FlashList was tried, and is not in

The Stack table picks FlashList v2, so it went in first. It draws correctly and
scrolls well on RN 0.86 — and on the phone it breaks recycled rows. After a
data change (filtering by a tag and clearing it is enough) the cells keep their
positions and their testIDs and stop exposing any accessible content at all:
`maestro hierarchy` shows thirteen rows, correctly placed, every one empty. A
long press stops opening a song's menu, and VoiceOver reads an empty row where
a song is plainly drawn. The smoke flow passes with `FlatList` and fails at
exactly that step with FlashList.

The plan allowed for this the other way round — "if it falls short on web,
`SongList.web.tsx` uses `FlatList` and nothing else changes" — so the answer
has the same shape: the component stays, the list inside it is a `FlatList`,
and revisiting is a one-file change once FlashList fixes recycled-cell
accessibility on the New Architecture. **This is one for Xiao to know about
rather than decide**: nothing is blocked by it.

### What phase 2 still owes

- `expo run:android`, which needs an SDK this Mac does not have.
- Model files for the five screens that moved without one. Now playing above
  all deserves one, and it is being rewritten in phase 4 anyway, which is the
  moment to write it rather than now.

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

## Phase 3, on the Mac — 2026-09-12

Two commits on `universal/phase-3`, `6b7fe9b` and `4d69bd3`, on top of a merge
of `main`. **The exit criterion is met**: at 1280 in a browser the new app
plays and keeps songs on the device, and the phone does not regress. What is
not done is at the end.

| Command | Result |
|---|---|
| `npm run check:app` | **pass** |
| `npm run check` | **pass** — 1108 passed, 1 skipped |
| `maestro test .maestro/smoke.yaml` | **pass** — the phone does not regress |
| `verify/flows --project=desktop` vs `apps/app` | **8 passed, 1 skipped** |
| `verify/flows --project=phone` vs `apps/app` | **8 passed, 1 skipped** |
| `verify/flows` vs `apps/web` | **pass** — 18, unchanged |

The one skip is the Mac's settings, which phase 4 brings to the phone. **Both
playback flows now pass against `apps/app`** — they were phase 2's two skips,
waiting on exactly this.

### The question the container could not answer

It left the native engine unwritten because of a real design question: the port
hands an engine one song at a time and a hint about what follows, while
track-player owns a queue and advances through it by itself.

**The answer: neither owns it outright. The provider owns the order, and the
player is lent a window onto it** — the song that is sounding and the one after
it, and nothing further. That window is not a detail. It is what keeps the
handover gapless, because the next file is already open when the first ends,
and it is what gives the lock screen a Next to offer at all. `load()`
recognises a song that is already playing and leaves it alone, which is the
difference between a gapless join and a stutter at the end of every track.

`PlayerProvider` is written against the port now and got *shorter*. It used to
hand the player the whole queue and then spend half its length keeping two
ideas of "which song is playing" in step, and reconciling events that arrived
mid-load. That is gone rather than moved: `QueueState` is the only source of
truth and the lookahead is the engine's business. It is now the same shape as
the web app's provider, because both are written against the same port.

One change to the port itself: the wiring is a `connect()` rather than four
assignable properties. A provider assigning to an engine it made during render
is mutating render-owned state, which the React Compiler stops — rightly. And
`trackMetadata` is new, because a phone's lock screen is drawn by the operating
system from metadata handed over with the URL, and an engine that only knows a
song id would put a blank card on it.

### Four bugs found by making it actually play

1. **The server refused the audio.** The web engine asks with credentials —
   `crossOrigin = 'use-credentials'`, which it needs for the Media Session API
   — and a browser throws that response away unless the server says credentials
   are allowed. An allowed origin got its library and then silence.
2. **Keeping a song failed with "Failed to fetch".** The offline cache asks for
   the bytes rather than the copy with `x-selfmp3-refresh`; a custom header
   makes the request preflight, and the preflight did not name the header.
3. **The scrubber announced nothing.** `react-native-web` renders
   `accessibilityRole="adjustable"` as `role="slider"` and then drops
   `accessibilityValue`, so the control said "slider" and never where the song
   had got to — to a screen reader as much as to a flow.
4. FlashList's recycled rows, from phase 2, which is why the list is a
   `FlatList`.

Both server fixes only ever apply to an origin somebody put on the list on
purpose (`SELFMP3_CORS_ORIGINS`). The app the server serves itself is
same-origin and reaches none of it.

### What phase 3 still owes

- **One `OfflineProvider`.** There are two download queues — the phone's and
  `downloads.web.ts` — with the same class shape over the same port. The port
  deliberately names only storage, because ordering, progress and pausing are
  policy that belongs above it; writing that policy once means splitting the
  phone's queue, which is what makes the phone play with no signal, and that
  wants airplane-mode testing rather than a green type check.
- **The phone's stream reader against a real Mac.** Devices and handoff are
  in (see below), and the reader's framing is tested, but it has not run on a
  phone connected to a Mac.
- **`.maestro/offline.yaml` and `.maestro/devices.yaml`**, which are still the
  skeletons the spike wrote and assert against screens that do not exist yet.
- Moving `PlayerProvider` into `packages/client`. It is one provider now, and
  it lives in `apps/app`; the move matters when `apps/web` is deleted in phase
  5 and cannot matter before.

---

## Phase 3, continued — devices, and two gates that were not green

Commits on `universal/phase-3`: `2df5771` devices and handoff, `9c439eb` and
`482b352` the two gate fixes, `47effb3` the `data/` anchor, `1344b48` the merge
of main, `3596eb9` the event-stream test. On `main`: `d26d507`.

### Devices and handoff, on the phone for the first time

`handoff.ts` moved to `packages/client`, since it was already pure. The
heartbeat is HTTP and a clock. The only part that was ever a browser is the
live stream, which is now the `ServerEvents` port. React Native has no
`EventSource`, so the phone's half opens the same stream over `XMLHttpRequest`
and does the framing itself, with reconnect backoff from one second to thirty.
Without it the phone could appear in the device list — polling covers that —
but could never be driven, because commands only arrive on the stream.

What is established, and where:

| Claim | Evidence |
|---|---|
| The devices sheet lists the other devices by name | a Playwright probe against the web build at 375: another tab "Playing now", and the Mac's browser, shortened from "Mac · Chrome" to "Mac" |
| Nothing else regressed | every flow suite at both widths, and the phone smoke flow |
| The phone's reader frames and reconnects correctly | `apps/app/src/ports/events.test.ts`, 7 tests against a fake XHR |
| The phone's reader works against a real Mac | **not established** |

The last row is owed for two reasons. The simulator the app was built on is
signed in to the cloud, where devices do nothing by design — presence travels
through the Mac, the same as the web app's cloud build — and it was not signed
out, because signing back in needs Xiao's Google account (question 5). A second
simulator set up for the test wedged: its CoreSimulator service crashed
(`Mach error -308 — (ipc/mig) server died`), every `simctl` call against it
hung, and it was shut down rather than retried a fourth time.

### Two gates that were red, and reported green

Both were introduced in phase 2 and merged to main. Both are fixed, on main and
on this branch.

1. **vitest was collecting the jest component tests.** Its include pattern
   matched `Button.test.tsx` and `Chip.test.tsx`, which render React Native and
   cannot be parsed by vitest. They failed to load, but every individual test
   still passed. So the summary read "1108 passed" beneath "2 failed" files.
   vitest now excludes `apps/app/**/*.test.tsx`, which jest-expo runs.
2. **The library model was never committed.** The root `.gitignore` said
   `library/`, meant for the music folder, and unanchored it matched
   `apps/app/src/features/library/` too. `library.model.ts` and its test
   existed only in this worktree, so every pushed branch failed to typecheck
   from a clean checkout. This was found by running the gate in a fresh
   worktree of main — the only place it could show. The rule is now
   `/library/`, and `data/` had the same latent fault and is anchored too. The
   extension rules beneath them still catch a stray database or song anywhere,
   which is what "wherever it ends up" was relying on.

**The records these contradict.** The phase 2 gate table above, and the
messages of `66b7776`, `6b7fe9b`, `4d69bd3` and `2df5771`, report
`npm run check` or `check:app` as passing. The first fault made `npm run check`
red at the time. The second made `check:app` pass only in a worktree that had
untracked files. In `2df5771` the check ran through a `grep` that succeeded
whatever the result, so the commit went ahead on a red gate. Pushed history is
left as it is; this is the correction. Gates are now decided by exit code, not
by reading a summary line, and `main` was re-verified from a clean worktree:
`npm run check` exit 0, `npm run check:app` exit 0.

---

## Phase 3, finished — one download queue, and the phone flows run

Commits on `universal/phase-3`: `f3e7f54` the shared download queue,
`e79c86e` and `a92ce50` both apps onto it, `75f259e` the sync line's buttons,
`f30363f` handoff position and the devices flow, `b9d7332` the offline flow.

### One download queue

There were two: the phone's class over `expo-file-system` and
`downloads.web.ts` over the Cache API, the same shape written twice. Now
`DownloadQueue` in `packages/client` owns ordering, pausing, progress and what
a failure means, over a `DownloadStorage` port. `src/ports/downloadStorage.ts`
writes files and continues a paused song mid-file. `downloadStorage.web.ts`
writes Cache API responses, which cannot be continued, so pausing lets the song
in flight finish and stops after it. The storage says which with `resumable`.
There is one `DownloadsProvider` over one queue on both platforms. The queue has
17 tests against a fake storage, written before the swap.

Writing it once found two bugs in the phone's queue, both fixed in the shared
one and covered by those tests:

1. **Cancel swallowed the next real failure.** `cancelAll` marked "a cancel is
   in progress" whether or not a transfer was running. A paused transfer has
   already resolved and nothing idle rejects, so the mark stayed set, and the
   next download that genuinely failed was treated as the cancel and said
   nothing. It is now set only for a transfer in flight.
2. **A download with nowhere to come from failed silently.** Finding the
   source — the Mac, or the doorman for a cloud session — happened before the
   `try`. With neither, its error escaped the download loop unreported, and
   the sync line went on saying it was adding songs while nothing downloaded.
   Starting the transfer is now inside the `try`, and the error is shown.

One hazard, caught before it shipped. The browser's cache knows which songs it
holds, but not the `etag` each was downloaded at. Settings compares those
etags with the server's to count files that have changed, and offers to remove
them. With no etags, every kept song would count as changed, and that button
would delete the lot. The web storage keeps the etags in `localStorage` beside
the cache. Checked in a fresh browser: 13 songs kept, 13 etags, all 13 still
there after a reload, and no out-of-date row.

### A commit that held only a deletion

`e79c86e` says it moves both apps onto the queue. It contains only the deletion
of `downloads.web.ts`. Its `git add` named that file after it was already gone.
Git refused the whole command over that one path, the refusal was sent to
`/dev/null`, and the commit went ahead with what had been staged earlier. On
`e79c86e` alone the web build imports the phone's file-system queue. `a92ce50`
is the rest of it, and says so. Commits since have been made from a script
that stops unless the staged files are exactly the expected ones. That script
also decides the gates by exit code.

### The phone flows, run for the first time

`smoke.yaml` had run before. `devices.yaml` and `offline.yaml` were still the
spike's skeletons, and had never run. They needed a phone connected to the Mac
by address, which the phone in use was not, because it was signed in to the
cloud (question 5). So a second simulator was set up: an iPhone 17 Pro Max with
the same dev client, connected to the Mac through `selfmp3://onboarding`. The
cloud-signed iPhone 17 Pro was left as it was.

| Check | Result |
|---|---|
| `maestro test .maestro/smoke.yaml` | 19 completed, 0 failed |
| `maestro test .maestro/devices.yaml`, the web app playing in a browser as the other device | passed |
| `.maestro/offline-run.sh` | passed; the server resumed and answered afterwards |
| Handoff position, read from `GET /api/devices` | the web tab paused at 106 s; the phone was playing the same song at 109 s |
| The phone's event-stream reader against a real Mac | a `pause` posted to the server for the phone reported one delivery, and the phone paused |

**A handoff started the song from the top.** Found on the first run of
`devices.yaml`. "Play here" took the other device's queue and paused it there,
but the phone began at 0:00. `DevicesProvider` called `playFrom` and then
`seekTo`. `playFrom` only starts an asynchronous load, so the seek reached
track-player before the track existed and was lost. The web app never had this,
because its `playQueue` takes the position in the same call. `playFrom` now
takes a start position and hands it to the engine as `startAt` (`f30363f`). The
`playSong` and `transfer` commands another device can send use the same path,
but were not driven separately.

**The first passing run proved nothing.** It checked that the phone was
playing, and the phone was — its own song, resumed. A tap had landed wrong
during a reload, while the web tab carried on. The flow now records what the
phone had and fails unless the song changes.

**Offline is a frozen server, not airplane mode.** The simulator has no
airplane mode. A test-only switch in the app would prove the switch, not the
player, because track-player fetches its own URLs. `offline-run.sh` sends the
Mac's server SIGSTOP for the run and SIGCONT after, whatever happens. To the
phone that is a sleeping Mac.

What the phone does with the Mac out of reach, checked by hand and then by the
flow:

- A downloaded song plays from the file and keeps playing.
- The library appears from the cached copy, but after about 40 seconds counting
  launch. Every request waits out the 15-second timeout, and `retry: 1` makes
  it wait twice. Not changed; it belongs with question 2.
- A song that is not downloaded loads into the mini player and sits there
  paused, with no message. The plan's check says it should "say so instead of
  failing". The web app refuses to start it and shows a toast; apps/mobile never
  said anything either. Saying so on the phone would look different, so it is
  question 6. Until then `offline.yaml` does not assert it. The web build of
  `apps/app` also lost the web app's toast. The phase 4 comparison would show
  that as a regression, not a choice.

### Corrections to "Phase 3, continued" above

- "The phone's reader works against a real Mac — **not established**." It is
  now; see the table above.
- "A second simulator set up for the test wedged … every `simctl` call against
  it hung." The CoreSimulator crash (`Mach error -308`) was real. The hung calls
  were most likely something else. A fresh simulator's first deep link raises
  "Open in self.mp3?", and `simctl openurl` does not return until it is
  answered. The Pro Max did exactly the same, and answering the prompt cleared
  it. The Maestro README now says so.

### Gates

| Gate (docs/UNIVERSAL.md, phase 3) | Result |
|---|---|
| `npm run check:app` | exit 0 |
| `npm run check` | exit 0, 99 test files |
| `npx playwright test verify/flows --project=desktop`, against `apps/app` on 8090, with `--project=phone` as well | exit 0: 16 passed, 2 skipped — the settings-page flow at each width, skipped by its own condition |
| `maestro test .maestro/smoke.yaml .maestro/offline.yaml .maestro/devices.yaml` | all three pass on the Mac-connected simulator (offline through its runner) |

### What phase 3 leaves

- Question 6, and with it the "says so" half of the offline check.
- On the web, a handoff also carries shuffle and repeat. On the phone it
  carries the queue and position only. This predates the move, and is left for
  the phase 4 comparison.
- `PlayerProvider` moving into `packages/client`, which matters only once
  `apps/web` is deleted in phase 5.
- The dev server's device list has several hundred entries from test runs.
  Only online devices are shown, but the whole list is returned on every
  heartbeat. It is dev data, not a code change.

---

## Phase 4 — the shared surfaces — branch `universal/phase-4`

Started from `main` at `c54cae0`, with phases 1–3 merged.

### Tooling first

- `reference.spec.ts` takes `SELFMP3_CAPTURE_DIR`. It photographs the new app
  in exactly the reference states and never writes to `docs/reference/`.
  `verify/captures/` is ignored (`90bcccb`).
- `verify/side-by-side.mjs`, which the phase 4 gate names, builds one HTML
  sheet with each state's reference and new capture in a row. It counts the
  states with no new capture, because a missing screen is easy to overlook
  when you only look at the ones that are there (`90bcccb`).
- Two API calls in the reference script used the page's origin, which only
  works when the server serves the app. They now use the server's address
  (`f5dd9a7`).

### Where the new app stood at the start

The first capture reached 19 of the reference's 58 states. The other 39,
missing at one width or both, are the phase's work list:

| Surface | Missing |
|---|---|
| Library | playing · row menu · selection with two rows · sort open · one tag filtered and one excluded |
| Playlists | smart list with its rules open · empty playlist |
| Now playing | about · focus · queue (desktop) · romanisation |
| Player bar | progress at 40% |
| Settings | accent changed · light theme |
| Sheets | sleep timer · speed · practice (phone) |
| Devices | the popover · the resume toast |

That list comes from the capture script failing or skipping a state, not
from review. The captured states still have to pass check 2 by eye.

### Done

- **Multi-select** (`81b103a` rules, `65efb91` the feature). The shared
  selection functions have 16 tests. In the library:
  - a Select button, a "Select" item in a song's menu, and Shift or Cmd on
    the web;
  - the web's selection bar;
  - the web's two-faced removal confirmation.

  Checked at 375 and 1280 against `library-selection-two`.
  `verify/flows/selection.spec.ts` passes against both apps at both widths,
  and checks the library still has every song afterwards. The commit message
  lists six deliberate differences. Two are worth knowing about here: the app
  has no toasts, so batch actions finish silently (question 6), and the
  desktop bar's buttons are the app's 44-point size, not the web's small ones.
- **Tag filtering both ways** (`87e1f46`). The shared filter holds the web's
  two lists, included (AND) and excluded, with the web's rule that a tag is
  never both. There are 10 tests. On a phone, a chip is held to open the tag
  editor. `verify/flows/tags.spec.ts` passes on both apps at both widths.
- **Escape and the sort control** (`60d33d3`). Sheets and popovers never
  closed on Escape, which stopped the reference capture at its second state.
  Escape now closes the topmost layer only. Select is the web's combobox.
- **A song's ⋯ menu** (`f5ae03c`) in the web's order, with Song details, the
  tag picker, similar songs, instrumental and the inline removal choice. The
  pure helpers behind the details have 7 tests.
  `verify/flows/songMenu.spec.ts` passes on both apps. Fix metadata stays out
  (phase 5).
- **The desktop sidebar and header** (`e894425`). The web's tag
  list, with hide and edit on hover, the new-tag form and the footer. The
  filter moved into a provider both share. The library header is one row at
  desktop width.

- **The desktop player bar** (`4fb5578`). The web's three-part bar: cover,
  title, love and tags on the left; transport and an inline seek bar in the
  middle; lyrics, queue, speed, sleep, devices and volume on the right, in
  groups. Speed, sleep and devices open as popovers above the bar at desktop
  width, and volume folds into a popover below 1160.
- **Playlists** (`7c1ab55`). The web's card grid, with play and pin revealed on
  hover where there is a mouse, and the New playlist and New smart playlist
  forms. Creating one opens it. Routes moved to `/playlists/:id` to match the
  web; the old `/playlist/:id` redirects.
- **Playlist detail** (`9c6af69`). Rename in place, delete behind a confirm,
  select and remove, and reorder by dragging the handles. A drag is saved
  optimistically, then sent. `moveItem` and `dropIndex` have 5 tests. The phone
  smoke run still passes (19 of 19).
- **The smart rule builder.** "Edit rules" opens the web's builder. The
  count is previewed against the real library 350 ms after an edit, and the
  rules are saved at the same pace. Closing within that pause still saves.
  At desktop width each rule is a line with the web's columns; on a phone,
  a card. `Select` gained grouped options, number values, and the web's `small`
  and `inline` sizes. The field lists, starting rules and count wording
  live in `rules.model.ts`, with 8 tests; one checks every starting rule
  against the shared schema. `verify/flows/smartRules.spec.ts` creates its own
  smart playlist, edits it, checks the count and the saved rules, then
  deletes it. It passes against both apps at both widths.

- **Now Playing on a computer.** The web's page:
  - the cover and the song's facts on the left; Lyrics, Up next and About as
    tabs on the right;
  - a glow from the cover's own colours;
  - Focus, where the cover glides into the header and the lyrics grow, and
    the controls step aside after three still seconds;
  - "Next · in 12 s" for a song's last fifteen seconds.

  The page covers the sidebar and keeps the player bar. In the bar, the
  cover button toggles the page, the mic toggles Focus, and Queue switches
  to the Up next tab and back, as on the web. The tab and mode live in the
  address (`/now-playing?tab=queue`), which is how the bar changes them.

  Romaji and pinyin are the synced setting and the Mac's romanizer, shown
  under each line when they line up exactly. The cover palette moved to
  `packages/client/src/art/palette.ts` (5 tests), and a port reads the
  pixels: a canvas on the web, nothing yet on a phone. The page's rules are
  in `nowPlaying.model.ts` (9 tests): its geometry, which words a song has,
  and when "Next" shows. The player gained `clearQueue`.
  `verify/flows/nowPlaying.spec.ts` passes against both apps. A phone keeps
  its own full-screen player, unchanged.

- **Settings.** The web's page. Its index is a column beside the panels
  from 1080 up, and below that a sticky row of chips that scrolls to follow
  the section being read. Every setting has the web's one-row anatomy, and on
  a phone the control drops under the words.
  - **Server settings:** Playback (crossfade, what counts as a play, lyric
    lookup), Importing (downloads at once, rescan, watching the folder,
    YouTube cookies) and Lyrics (romaji and pinyin). Sliders save once, where
    the drag ends.
  - **Library:** rescan, audio analysis with Redo all, and forgetting missing
    songs. These three and the destructive offline actions ask first through
    `ConfirmDialog`: the old screen's `Alert.alert` does nothing in a
    browser.
  - **Devices:** rename this one, forget others.
  - **Appearance:** Theme and the accent, as swatches plus a hue slider.
  - **Also:** Offline music (this device's downloads), Keyboard shortcuts,
    Connection (the server or the Google sign-in) and About.

  New controls: `Toggle`, a `switch` to assistive technology, and `Slider`, a
  real `<input type="range">` on the web and a touch track on a phone. The
  arithmetic is in `slider.model.ts` (3 tests). Select's choices are now
  `option`s, as on the web. The section list, the rule for which section is
  being read, and the row wording are in `settings.model.ts` (5 tests). The
  navigation flow's Settings check no longer skips the new app, and passes
  against both.

- **Downloading and streaming, as decided.** The design above, built.
  - **Policy:** `packages/client/src/downloads/syncPolicy.ts` (14 tests) decides
    when to download by itself, what the header says, when a download
    someone asked for needs a question first, and why a song cannot play.
    `DownloadsProvider` carries it out, and a new `ports/install` port says
    whether this is an installed app (downloads) or a browser (streams).
  - **On a phone:** "Download automatically on Wi-Fi" and "Play songs that
    aren't downloaded" are in Settings, on by default, kept on this device.
    On Wi-Fi the library downloads by itself. The header reads "Downloading
    12 of 40", "40 not downloaded · on data · Download", "40 not downloaded ·
    offline", or "40 not downloaded · 1.2 GB · Download" once it is over
    500 MB.
  - **Asking:** "Download on mobile data?" is asked once and holds until
    Wi-Fi. Over 500 MB it asks on any connection.
  - **Hand actions:** a song removed by hand stays removed, and a song or
    playlist downloaded by hand is always allowed. Remove all downloads
    turns automatic downloading off too, or they would come back.
  - **Rows:** every song not on the phone carries an outline counterpart of
    the downloaded disc.
  - **A song that cannot play** says why instead of loading and sitting
    paused: offline, streaming off, a cloud library, or "Stream on mobile
    data?", which starts it once answered.
  - **In a browser** the header only appears while a download someone
    started is running, and Settings says a browser always streams.
  - `.maestro/downloads.yaml` turns both settings off, removes a song's
    download, taps the song, sees the explanation, and puts the settings
    back. It passes on the Pro Max.

- **The resume toast.** "Continue もう少しだけ — YOASOBI from iPhone", offered
  once per launch when another device has somewhere to carry on from and
  nothing is playing here. It sits at the foot of the content column, above
  the player bar or the mini player, as the web's toast row does. Taking it
  loads the song paused: `playFrom` gained an `autoplay` argument for exactly
  this. The devices capture now finds its Dismiss button at both widths.
- **The player bar at 40%.** The reference capture set the web's range-input
  scrubber with `fill`. The new app's scrubber is a slider role on a view, so
  the capture now presses it 40% of the way along, and the state is taken at
  both widths.

- **The ⌘K palette.** The web's command palette, opened with ⌘K or Ctrl+K
  anywhere. One box searches songs, playlists, tags and lyrics, and runs
  commands. Arrow keys move through every group as one list, Enter takes
  the highlighted row, and Escape closes it.
  - `shell/useHotkeys` listens on the window in a browser and does nothing
    on a phone. Like the web's, it ignores keys while someone is typing or
    a menu has the keyboard.
  - Ranking, the commands and when lyrics are worth searching are in
    `palette.model.ts` (4 tests).
  - `verify/flows/palette.spec.ts` finds a song by its title and plays it,
    then runs Settings, against both apps.

- **The light theme.** Choosing Light (or System, with the device in light
  mode) now draws the app from the web's `:root[data-theme='light']` tokens.
  - `packages/client/src/theme/tokens.ts` gained `lightPalette(hue)` and
    `applyColorScheme(scheme, hue)`. `buildAccent` and `tagColors` follow the
    applied scheme; tag chips turn round to a pale ground with dark ink.
  - `scheme.test.ts` (15 tests) checks every light token against the
    stylesheet, as the dark ones already are.
  - The app has a new entry file, `apps/app/index.ts`. It configures the
    themes before expo-router loads a screen.
  - Superseded the same day by the Unistyles rewrite below: the theme now
    switches in place, with no restart.

- **Forgotten gems, and the phone's Now Playing toolbar.**
  - The library gets the web's gems row above an unfiltered, unsearched
    library: collapsible, "Play all" and "Add to queue", poster cards, which
    lie down and share the width when there are three or fewer. It hides
    itself when there is nothing to show or the server cannot be reached.
  - On a phone, Now Playing's toolbar gains Sleep and Devices beside Lyrics,
    Keep and Queue.
  - The lyrics face gets the web's Romaji or Pinyin pill, and draws its
    lines with the same lyric view as the computer's page, so romanised lines
    show there too.
  - The sleep timer's menu moved out of the player bar into a shared
    `SleepMenu`: anchored above the button on a computer, a sheet on a
    phone.
  - The playlists grid starts with the web's built-in Forgotten gems card.
    Pressing it plays the list; it is not a playlist, so there is nothing to
    rename or delete, and it hides itself when there are no gems.

- **Toasts.** The web's toast row now carries its messages as well as the
  resume offer:
  - `ui/toast.ts` is a store that outlives whatever raised the message, and
    `ToastHost` draws each message as the web's pill. Errors stay until
    dismissed; everything else leaves after five seconds.
  - The selection bar says what it did, in the web's words: "Tagged 3 songs
    “chill”", "Added 3 songs to Evening", "Removed 3 songs, deleted 3 files",
    and the rest.
  - This closes the gap noted above, where batch actions finished silently.
    Creation errors in the tag picker and the new-playlist form still show
    under their fields, as they already did.

- **Two differences closed.** In Focus, the player bar now folds away with
  the page's own controls once the mouse is still, and comes back when
  anything moves; `nowPlaying.spec.ts` checks it against this app. In the
  palette, the arrow keys keep the highlighted row in view.

- **Cloud settings** (Xiao, 2026-09-13: "yes, let's do it, I'm around"). The
  web's section, in `features/settings/CloudPanel.tsx`:
  - the connected view: where it publishes, how much is up, Publish now,
    Change bucket, Sign out behind a confirmation;
  - sign-in with Google through the doorman, with the code step. A browser
    comes back to Settings with the code in the address (`ports/signInReturn`);
    a phone types the code the doorman shows;
  - the bucket form, with the region only for an address it cannot read.
  Checked live against this Mac: signed in as Xiao, 13 of 13 songs in
  `selfmp3-xiao215`. Signing in was not exercised, because the Mac is already
  signed in and signing it out to test would be Xiao's call.
- **Desktop users moved to the new app** (Xiao, 2026-09-13: "switch it").
  - The server's `webDir` now defaults to `apps/app/dist`. The old web app
    is served at `/classic` (`classicWebDir`, built with `VITE_BASE=/classic/`)
    until phase 5 moves its last tools.
  - `npm run build` builds both.
  - The old app puts its base in front of every request
    (`/classic/api/library`), so the server rewrites those to `/api` before
    anything else sees the path. Without that the old app at `/classic`
    thought the server was offline.
  - A browser loaded from a Mac finds it by asking the page's own origin for
    `/api/health` (`ports/servedBy`), as the old app assumed. The phone
    build never asks.
  - GitHub Pages now publishes `apps/app` (`EXPO_PUBLIC_BASE` for the path,
    `SELFMP3_DOORMAN_URL` for the doorman).
  - The Dockerfile still builds `apps/web`; the plan moves it at phase 5's
    exit.

The reference library capture now runs to the end at 1280 and at 375: all
seven library states at each width. The playlists capture does too, with all
five playlist states at each width. So does the now playing capture: all
seven states at 1280, and the phone's five.

### Notes for whoever reviews phase 4

- **The plan lists tag editing later than it arrived.** Phase 5 names "the tag
  editor", and phase 6 "tag editing on the phone". But the 375 reference
  reaches "one tag excluded" through the editor a held chip opens, and the
  parity matrix puts tag exclude in phase 4. The per-tag editor and the song
  tag picker therefore came across with the library. The tag inbox, which is
  probably what phase 5 means, has not.
- **Desktop density, mostly settled.** It was the difference a reviewer
  would notice first at 1280. It is now `useLayout().dense`: desktop width
  and a fine pointer, from a pointer port. Buttons, icon buttons, the select
  trigger, the library search and anchored popover rows take the web's
  desktop sizes. A tablet at desktop width stays finger-sized. Still at touch
  size: the song row's heart and ⋯, which arrive with the desktop row.
- **Desktop rows arrived** with the player bar work: the index, tempo and energy,
  an album column from 1160, and tag chips, with the heart and ⋯ revealed on
  hover. The phone keeps its own row.
- **The rule builder saves only rules the server accepts.** The web saves
  whatever is on screen, so a text rule still waiting for its text is sent
  and refused. Here that rule waits until something is typed. The count shows
  "Checking…" in the meantime, as on the web.
- **Now Playing, what the web has and this does not yet.**
  - In Focus the sung line lights all at once; the web fills it in word by
    word, estimated between timestamps, every frame.
  - The lyrics have no fade at the top and bottom. An SVG gradient over them
    darkened the whole column instead, so it came out.
  - A song with no words shows a quiet line ("Instrumental", or "No lyrics
    found · It's instrumental") rather than the web's drawn visual, and the
    tab is always "Lyrics", never "Visual".
  - Up next has no Auto-mix row, and a lyric line cannot be looped by
    right-clicking it: the app's player has neither auto-mix nor the practice
    loop yet.
  - With the page closed, Queue opens the page on Up next. The web opens a
    side panel, which the app doesn't have.
  - The tag picker is a sheet, not anchored to "Edit tags".
  - Escape leaves Focus, then closes the page. The web's page ignores
    Escape.
- **About offers "Download now" on the web.** Song details say what is on
  this device, and in a browser that still offers a download, although the
  web always streams (decided above). It goes with the download settings.
- **Settings, where this app differs.**
  - The accent and the theme are this device's, kept on this device; the
    web shares them across devices. The accent already worked this way
    (`ui/accent.tsx`), and the theme follows it for the same reason: how a
    screen looks belongs to the screen.
  - Cloud (the Mac's connection to the bucket, and uploads) is not here yet.
    Its place is taken by Connection, which shows what this device talks to.
  - Fix covers is not here yet.
  - Offline music is this device's download queue. The two new settings
    ("Download automatically on Wi-Fi", "Play songs that aren't downloaded")
    come with the downloading work that follows.
- **Downloading and streaming, what is still short of the design.**
  - When the queue moves on, by itself or from Next, it skips songs that
    cannot play here, and stops if none of the rest can
    (`packages/client/src/queue/playable.ts`, 7 tests). A song that would
    need the mobile data question is skipped rather than asked about
    mid-play; only a song started by hand asks.
  - "Offline" means the phone has no connection at all. A phone online
    with the Mac asleep still tries to stream.
  - Downloads run only while the app is open. Background transfers are
    still the thing to retry (see `src/ports/downloadStorage.ts`).
- **The palette, where this app differs.**
  - It offers Go to Library, Go to Playlists, Settings and Shuffle
    everything. The web's Import music, Listening stats and Tag untagged
    songs wait for those screens.
  - A tag result sets the library's filter to that tag, where the web
    navigates to `/?tag=`.
- **The theme, on Unistyles (Xiao chose the rewrite).** Dark, Light and
  System switch in place, on the web and on the phone, with no restart and
  without cutting off the song playing.
  - `src/ui/theme/unistyles.ts` holds the two themes, built from the same
    tokens at this device's accent hue. Every stylesheet is
    `StyleSheet.create(theme => …)`, and components that draw colour in
    JavaScript read `useUnistyles()`. The launch-time pieces are gone
    (`themeAtLaunch`, the reload port, `SystemThemeWatcher`).
  - "System" is resolved by the app from `Appearance`, never by Unistyles'
    adaptive mode: chosen after launch, adaptive mode did not follow the
    device, and the accent (worked out in JavaScript) never did.
  - Icons take their default colour from the theme on each render; the web
    slider's stylesheet reads CSS variables; the status bar follows the
    theme.
  - Two things Unistyles does not restyle on a phone, fixed: the safe-area
    view (a third-party component, wrapped with `withUnistyles`) and a
    sticky header (re-parented by ScrollView, so Settings' section strip
    takes its colours inline).
  - In a browser the safe-area view stays unwrapped. `withUnistyles` styles
    its child (`.hash > *`), and Unistyles names a style by its content, so
    the wrapper gave the shell's root, which has the same style, a rule that
    stretched the bottom tabs over half a phone-sized screen.
  - Checked by hand on both: Light, Dark and System (following the
    device both ways, accent included), a reload keeps the choice, and
    another screen reached without a reload is drawn in the new theme.
  - On a phone, "System" still stays dark until the next native build:
    `app.config.js` forces `userInterfaceStyle: 'dark'`.
- **Library and Now Playing, still to come.**
  - The tag inbox link on a phone goes to `/inbox`, the tag inbox, which is
    phase 5's.
  - The phone toolbar has no Practice, and the web's similar-songs shelf
    under the art is not there: both belong to later phases.
- **Saved rules update the song list.** The web leaves the old list under
  the builder until the page reloads: after tightening the rules to match
  nothing, it still shows 13 songs. Here the list is fetched again after each
  save. The flow checks only what both apps do.

---

## Phase 4 — where it stands, 2026-09-12 night

Worked through overnight on `universal/phase-4`, one commit per piece, each on
green gates. The phase is not merged: two of its steps need Xiao.

**Built.** Every surface the phase names now has the web's shape at 1280 and
375:
- **Library:** search, sort, tag filter and exclude, multi-select, row menu,
  gems row.
- **Playlists and playlist detail:** create, rename, pin, reorder, delete,
  select, smart rules.
- **Now Playing:** the desktop stage and Focus, the phone screen with
  romanised lyrics, Sleep and Devices, Up next, About.
- **Settings:** every section except Cloud, plus the light theme.
- **Downloading and streaming,** as Xiao decided.
- **Also:** the resume toast, the playing-row wash, and the ⌘K palette with
  its hotkeys.

The app is captured in every reference state at 1280, and in every state at
375 except the practice sheet (phase 5). The Playwright flows pass against
the app (28 passed; 2 skip by design on phone), and each new flow also
passes against the old web app. Phone smoke passes on the Pro Max.

**Waiting for Xiao.**
1. **Cloud settings** (the Mac's connection to the bucket: sign in with
   Google, storage fields, sync, disconnect). About 600 lines on the web. It
   needs a real Google sign-in to test, which the ground rules say to ask
   for, and a half-tested version could break the Mac's cloud link. Not
   started.
2. **Moving desktop users.** The plan's last step for this phase: point the
   server's `webDir` at `apps/app/dist` and change the Pages workflow.
   Outward-facing, so left for review.
3. **The light theme's approach.** Answered: Unistyles, done. See "The
   theme, on Unistyles" in "Notes for whoever reviews phase 4".
4. **Android.** "Both phones" in the exit criteria: there is no Android SDK
   here, so the phone checks are iOS only (Maestro).

**Noticed, not changed.**
- The server's device list holds dozens of stale test tabs, which makes the
  devices popover and sheet long. Clearing it was left alone, as asked.
- Phone smoke's first check did not wait for the app to load; after a Metro
  restart the cold bundle takes about 13 seconds. It now waits up to a minute.

## Downloading and streaming — decided by Xiao, 2026-09-12

Asked in conversation, after question 6. This is the design the downloading
and streaming work builds to. Recorded here so it is not re-litigated.

**Where each kind of client stands**

- **Web** (a browser, at any width) always streams. Keeping songs offline stays
  optional.
- **Phone, and a desktop app** download by default and play from the files.
  "Desktop" means an app installed on a computer — macOS first — not the web app
  in a wide window. There is no such app yet: the plan's phase 6 names "a
  desktop shell if one is ever wanted". **Toolkit: Electron** (Xiao,
  2026-09-12), wrapping the universal app's web export, with disk, keychain
  and updates supplied behind the ports. It gets its line in the Stack table
  when the work starts. Also settled the same day:
  - Not for the Mac App Store, so the sandbox is not a constraint.
  - Windows is a possible future, with no plan for it. Nothing should close
    that door, and nothing is built for it.
  - On a Mac every connection counts as Wi-Fi. A browser cannot tell a hotspot
    apart, native detection is not worth the code yet, and the 500 MB rule is
    the guardrail. (Xiao left this to Claude.)

**Downloading**

- On Wi-Fi, a device whose downloads are out of date downloads automatically.
  The header line says "Downloading 12 of 40".
- On mobile data it does not. The header says "40 not downloaded · on data ·
  Download" (Xiao: "on data", not "on mobile data"). Tapping Download asks once — "Download on mobile data?",
  Download / Not now — and the answer holds until the device is back on Wi-Fi.
- Offline, the header says "40 not downloaded · offline".
- **Any sync over 500 MB waits for a tap, on any connection.** It is never
  automatic.
- An iPhone on a personal hotspot reports Wi-Fi, and is treated as Wi-Fi.
  Accepted.
- Downloading in the background is preferred. If it cannot be made to work,
  downloading only while the app is open is acceptable. Today it is
  foreground-only: iOS's background session failed every transfer with
  `UnableToDownloadException` (see `src/ports/downloadStorage.ts`), so that
  is the thing to retry.

**Streaming**

- Two separate settings, not one tied to the other: "Download automatically on
  Wi-Fi" and "Play songs that aren't downloaded". With both on, a song tapped
  before it has synced still plays at once.
- Streaming over mobile data asks the same once-until-Wi-Fi question as
  downloading.
- Songs, one or a selection, can always be downloaded by hand, whatever the
  settings.
- A phone signed in only to the cloud cannot stream: the player cannot send the
  doorman's sign-in. That waits for the dedicated server (signed links, most
  likely), and until then such a phone plays downloads only.

**What a song that cannot play looks like**

- A small "not downloaded" mark, the counterpart of the downloaded one, on
  every song that is not on the device.
- Where such a song cannot play — offline, or with streaming off — tapping it
  says why instead of loading it and sitting paused. That answers question 6.

---

## Open questions for the morning

### Answers, 2026-09-12

Xiao accepted Claude's proposed defaults for the questions below:

- **1. Phone records skips:** yes, as the web does.
- **2. Expired token:** the app notices the 401 and asks to sign in again,
  instead of showing a stale library that will not play.
- **5. Cloud-only phone and other devices:** not now. Revisit with the
  dedicated server, since it needs presence relayed through the doorman.

On the desktop app, Xiao raised no objection to either recommendation:
Electron despite its size, and the web audio engine rather than a native one
for bit-perfect output.



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

5. **Should a phone signed in only to the cloud see your other devices?**
   Found while bringing devices and handoff to the phone in phase 3. Presence,
   handoff and remote control all travel through the Mac's event stream, so a
   phone signed in with Google and pointed at no Mac is alone: it sends no
   heartbeat, opens no stream, and its devices sheet says it is looking. That is
   the same trade the web app makes in its cloud build (`LoneDevicesProvider`),
   and it is what the code does now. The alternative is presence relayed
   through the doorman, which is a server change and a real feature rather than
   part of the move. The simulator this was built on is signed in that way,
   which is how it came up; it was not signed out to test around it, because
   signing back in needs your Google account. The sheet itself was checked in the web build, where it lists the other
   devices by name. The phone's own half — its hand-written stream reader — has
   its framing and reconnect tested under vitest, but has not run against a
   Mac: a second simulator set up for that wedged and was shut down.

6. **Answered 2026-09-12 — yes; see "Downloading and streaming" above.**
   **Should the phone say so when a song cannot play?** Found running the
   offline check in phase 3. With the Mac out of reach, tapping a song that is
   not downloaded loads it into the mini player, where it sits paused with no
   message. The plan's offline check asks for the web app's behaviour:
   refuse to start it, and show "“<title>” isn't downloaded — it plays once
   your Mac is reachable." The phone has no toast to show that in, so doing
   it means adding one, or marking such rows the way the web greys them —
   either looks different, which is why it is a question and not a fix.
   The web build of `apps/app` has lost the toast too, so on the web it would
   be restoring the reference rather than a new design.

## Phase 5 — the desktop tools — branch `universal/phase-5`

Started 2026-09-13, stacked on `universal/phase-4` at `f0ced51` (the theme
rewrite). Phase 4 is not merged into main yet: a push to main runs the Pages
workflow, which publishes the new app, and publishing is a stop-and-ask. That
merge waits for Xiao.

Each tool moves on its own, in the plan's order. Until one has moved, the old
app still serves it, now under `/classic` on the Mac.

### Import

The web's `ImportView`, with the YouTube library panel under it.

- `features/import/import.model.ts` holds the screen's rules with nothing
  drawn: what each queue state is called, telling an upload still to come from
  a failure, pre-ticking all but what the library already has, the headings,
  what a job row offers, the request `/api/import/enqueue` gets (a chosen
  playlist wins over "also create playlist"), and reading shared links
  (14 tests).
- `ImportScreen.tsx`: the tools notices, the links box, the review (a table at
  desktop width; on a phone each track stacks its title and length, then artist
  and album, as the web does), tags, playlist, and the queue, which takes the
  review's place once it is sent. `YouTubeLibraryPanel.tsx`: signed-in status
  with Test, Liked Music, and a playlist of yours.
- Links shared to the app arrive as `/import?url=…&text=…`, the web's Web Share
  Target, and are fetched at once and cleared from the URL.
- `ui/components/TagChooser.tsx`: tags for songs not yet in the library. The
  song tag picker's list became `TagSearchList`, which both use.
- Import is in the sidebar and the ⌘K palette ("Import music"), and in neither
  for a cloud library, as on the web.
- Checked: `verify/flows/import.spec.ts` fetches a link, unticks and reticks
  it, corrects a title and cancels, at both widths against both apps. The
  reference set gains `import-top` and `import-review` at both widths, taken
  from the old app (`docs/reference/README.md` says why under `fb882e0`), and
  the new app is captured in the same states. On the iPhone simulator the same
  fetch, review and cancel ran under Maestro.

Where it differs from the web, on purpose for now:

- **No listening before importing.** The web plays a preview in an audio
  element of its own. The phone's player has one queue, so a preview needs a
  port and probably `expo-audio`, which is a new dependency; it comes with its
  own Stack line.
- **No "Migrate a playlist" card.** It comes back with the migration screen,
  the next tool.
- **A cloud library gets a notice**, not the web's cloud import screen.
- The links box is not in a monospace face, the phone's review thumbnail is the
  desktop's size, and the phone still has no Import tab (see `BottomNav`).

Noticed, not changed: on every route the web build's root is 8 px taller than
the window. `body` hides the overflow, so nobody can scroll it, but a test that
forces an element into view scrolls the whole frame.

### Migrate a playlist

The web's `MigrateView`, at `/import/migrate`, reached from the card on Import
as before.

- `features/migrate/migrate.model.ts` holds the rules with nothing drawn: which
  stage a match job is in, ticking only confident matches the library does not
  already have (once per job, so a late poll does not re-tick what was
  unticked), the upload chosen for each song, confidence as a tone, a word and
  a mark, the headings, the lines the parser could not read, and the request
  `/api/migrate/enqueue` gets: the source's names with the upload's audio, and
  no playlist when the name is left empty (9 tests).
- `MigrateScreen.tsx`: paste, then a polled match with a progress bar and
  "stop", then the review — a table at desktop width; on a phone each song
  stacks its source and confidence over the upload picker, with no thumbnail,
  as the web does — with tags, "Create playlist named", and a notice when the
  songs are queued that links to Import and to the new playlist.
- `Select` options can carry a hint, drawn as the item's detail: each upload's
  confidence in the picker.
- The route moved: `app/import.tsx` is now `app/import/index.tsx`, beside
  `app/import/migrate.tsx`.
- Checked: `verify/flows/migrate.spec.ts` matches two songs, selects them and
  starts over, at both widths against both apps. The reference set gains
  `migrate-top` and `migrate-review` from the old app, and the new app is
  captured in the same states. On the iPhone simulator a match ran to its
  review and back under Maestro.

Where it differs: a cloud library gets a notice rather than the screen, as with
Import.

### A layout regression from the theme rewrite, found and fixed

Found writing the migration flow: at phone width in a browser, "Start over" sat
under the tab bar and could not be reached. Since the Unistyles rewrite
(`f0ced51`) every screen's safe-area style is a Unistyles sheet, and on the web
Unistyles applies a sheet as a CSS class that only the views its Babel plugin
rewrites carry. The library's safe-area view is not one, so each screen lost
its `flex: 1`, grew to the height of its content, slid under the tab bar and
stopped scrolling; the shell's matching background hid it. The flows passed
because none of them clicked near the bottom of a long page.

In a browser `SafeAreaView` is now a plain `View`, which does carry the class
(safe-area insets there are all but always zero). The phone keeps the
`withUnistyles` wrapper. Measured after: the library, Import and migration
screens are the height of the space above the tabs and scroll inside it.

### Stats and Wrapped

The web's `StatsView` and `WrappedView`, at `/stats` and `/stats/wrapped`.
Stats is in the sidebar and the ⌘K palette ("Listening stats"), and in neither
for a cloud library, as on the web.

- `features/stats/stats.model.ts` (11 tests) and
  `features/wrapped/wrapped.model.ts` (7 tests) hold the rules with nothing
  drawn: the ranges, a column a day and an hour with their tooltip labels, the
  busiest hour, each song once in "Recently played", round axis numbers, the
  hero figure and its unit, the six facts, the empty window's way out (longer
  ranges, then the library), chapter numbering, and the shared image's name.
- `ui/components/charts.tsx` is the web's charts in react-native-svg: a column
  chart that measures its plot and draws in real pixels (a rounded data-end, a
  square baseline, bars capped at 24px, hairline gridlines at round numbers,
  pointing or touching a column shows its value), a bar list labelled at the
  tip, and stat tiles. `ui/components/Segmented.tsx` is the range switcher.
- The charts' two colours are theme tokens now, `chartSeries` and `chartGrid`
  in `packages/client`, checked against both of the web stylesheet's themes.
- Wrapped's hero lays the top song's artwork, blurred, under the web's washes;
  its chapters sit two to a row at desktop width.
- "Share as image" draws the web's 1080×1080 card on a canvas and downloads it
  (`ports/shareCard.web.ts`).
- Checked: `verify/flows/stats.spec.ts` switches Stats' range, opens Wrapped and
  switches its range, at both widths against both apps. The reference set gains
  `stats-top`, `stats-bottom`, `wrapped-top` and `wrapped-bottom`, and the new
  app is captured in the same states.

Where it differs, on purpose for now:

- **No "Share as image" on a phone.** The card is a canvas drawing; the plan's
  route for canvas work on a phone is an Expo DOM component, which needs a
  webview module and a native build (`ports/shareCard.ts` says so).
- **A chart's values are not read out one by one from the keyboard.** The web
  walks its columns with the arrow keys; here a chart is one image to a screen
  reader, named with its highest value.
- **Wrapped's big number is plain text**, not the web's gradient-filled type.

### Practice

The web's `PracticePanel`: an A–B loop with a count-in, speed with pitch lock,
and the key transposed, in collapsible groups.

- The practice helpers (`tapLoop`, `loopRegionPercent`, `countInMs`,
  `PRACTICE_SPEEDS`) moved from `apps/web/src/player/practice.ts` into
  `packages/client`, with their 8 tests, so both apps use the same ones.
- The player gains the loop points, the count-in, pitch lock and their
  setters. Pitch lock and the count-in are kept on this device as the web keeps
  them, and the count-in is one beat of whatever song is playing.
- The engine port declares a new capability, `loop`: the web engine loops to
  within a frame; track-player reports progress once a second, so the phone's
  engine says no rather than land up to a second past B.
- At desktop width the panel opens beside the page from the player bar's
  metronome ("Practice tools"), as on the web. On a phone it opens as a sheet
  from Practice in Now Playing's foot.
- The seek bars draw the loop region behind the track, in the player bar and on
  the phone's Now Playing.
- Checked: `verify/flows/practice.spec.ts` plays a song, sets and clears a loop,
  changes the speed and puts it back, against both apps at desktop width. The
  reference set gains `practice-panel` (desktop; the phone sheet was already
  there as `sheet-practice`), and the new app is captured in the same state.

Where it differs, on purpose for now:

- **A phone has no A–B loop and no pitch-lock switch.** Its panel offers speed
  and transpose, and says the loop waits for the desktop app. A loop needs the
  playhead finer than track-player reports it.
- **Practice sits in Now Playing's foot beside Keep**, where the web's phone
  toolbar has no Keep: six actions rather than five.

Two things found while bringing Practice across, both older than it:

- **Sheets opened from a phone's Now Playing never showed.** Sleep, Devices and
  Practice all draw through the shell's overlay host, and a phone presents Now
  Playing as a native modal above the whole app, host included, so the sheet
  sat under the page. The phone's Now Playing now has an overlay host of its
  own, inside the modal. Checked on the iPhone simulator: Practice opens with
  Speed and Transpose, and Sleep opens over the page.
- **Library rows chose their columns from the window.** With the practice panel
  open the page is 340 narrower, and the album column was drawn into a page too
  narrow for it, over the tempo. The shell now measures the page column
  (`shell/contentWidth.tsx`) and a row decides by that.

### Fix metadata, and finding missing cover art

The web's `MetadataDialog`, opened from a song's menu ("Fix metadata…"), and its
`FixCoversPanel`, a row of Settings → Library.

- `features/metadata/metadata.model.ts` holds the rules with nothing drawn
  (8 tests): which fields a suggestion would change, the cover included; what
  starts ticked (every text correction, and a cover only when the song has
  none, since replacing one is a choice to make by looking); the request
  `/api/songs/:id/apply-metadata` gets, numbers as numbers; the button and the
  change rows in words; and the cover-art pass's hint, progress and result.
- `ui/components/MetadataDialog.tsx`: the song as the library has it beside the
  suggestions from iTunes and MusicBrainz, with their source and score, and the
  changes the picked one would make. Centred at desktop width; the whole screen
  on a phone, clear of the status bar and the home bar.
- "Fix metadata…" is in the song menu, and not for a cloud library: the lookup
  runs on the Mac. The cover-art row starts and stops the pass on the Mac and
  refetches the library as covers land.
- Checked: `verify/flows/metadata.spec.ts` opens the dialog from a row's menu,
  unticks the changes and cancels, against both apps at desktop width; nothing
  is applied. The reference set gains `metadata-dialog`, and the new app is
  captured in the same state. On the iPhone simulator a long press opens it and
  Cancel closes it.

### The tag inbox

The web's `TriageView`: the songs without a tag, and a pass through them one at
a time, playing each while you tap its tags.

- `features/inbox/inbox.model.ts` holds the rules with nothing drawn (7 tests):
  which songs count as untagged (not missing, no tags), newest first; the
  subtitle; the tag order the chips keep through a session; the number keys;
  the next button's word (Next, Skip, Finish); and the summary at the end.
- `features/inbox/InboxScreen.tsx` at `/inbox`: the list with Start tagging,
  then the pass. Its head has Done, how far through you are and Play along;
  below them the song's card, the tag chips with a new tag field, Back and
  Next. The keys 1–9, → and Enter, ←, n and / work at desktop width, and Escape
  leaves. Play along is remembered under the web's own key.
- It is reached from an Untagged row at the top of the sidebar's tags and from
  the palette ("Tag untagged songs"), both only when a song has no tag and the
  library is not a cloud one: tagging writes to the Mac.
- Checked: `verify/flows/inbox.spec.ts` untags one song, tags it back through
  the pass and restores it whatever happens, against both apps at both widths.
  The reference set gains `inbox-list` and `inbox-triage`, and the new app is
  captured in the same state. On the iPhone simulator the same pass runs: a
  chip tap, Finish, "Tagged 1 of 1", Done. The chips carry a `triage-tag-<id>`
  test id, because Maestro's text match ignores case and "yoasobi" also finds
  the artist line.

### Importing into a cloud library

The web's `CloudImportView`, which its cloud build showed at `/import` in place
of the Mac's screen. The new app had a notice there instead ("done on the Mac
for now").

- `features/import/cloudImport.model.ts` holds the rules with nothing drawn
  (7 tests): each request's line in the web's words (waiting and for how long,
  downloading, what a finished one added, why one failed), which requests can
  still be cancelled, and how many have finished, so the library is fetched
  again when one brings songs.
- `features/import/CloudImportScreen.tsx`: one link box and Import, then the
  requests with Cancel on those the Mac has not finished. The route picks it
  when the library is the bucket's. A link shared to the app lands in the box,
  as on the web, rather than being sent on arrival.
- Import is back in the sidebar and the ⌘K palette for a cloud library, as the
  web's cloud build had it. Stats and the tag inbox still are not: both need
  the Mac.
- The queries and the routes (`useCloudImports`, `/api/cloud/imports`) were
  already in `packages/client` and `packages/cloud`; nothing there changed.
- Checked on the cloud-signed iPhone 17 Pro, which was left signed in: Import
  opens this screen with "Nothing asked for yet". No request was sent, because
  one would have the Mac download a real song into the library.
- A shared link fills the box, checked the same way with a link inside other
  text, as a share sheet sends it. The first try failed with the screen
  already open: the box read the link only when the screen was created, so a
  share that arrived while Import was showing was dropped. It now follows each
  new share.

### Listening before importing

The web's `ImportListen`: a play button over each YouTube track's thumbnail
on the review, and a bar with what is playing, a playhead and Stop.

- `ports/listen.web.ts` is an audio element of its own, never the player's,
  so a preview does not touch the queue. `ports/listen.ts` says no on a phone:
  track-player has one queue, and a second player there is `expo-audio`, a new
  dependency that needs its own Stack line. The phone's review keeps plain
  thumbnails.
- `features/import/listen.model.ts` holds the rules with nothing drawn
  (6 tests): what can be played (YouTube links), the length known before the
  audio has one, when a preview stops because its track left the review, and
  the button's and bar's words.
- `features/import/ImportListen.tsx`: the hook, which pauses what was playing
  and resumes it on Stop unless you went back to it yourself, the row button
  and the bar.
- Checked: `verify/flows/import.spec.ts` now plays the review's track and
  stops it, against both apps at both widths. A probe of the new app in
  Chromium waited for the bar to say Pause: the server answered 206 with
  `audio/mp4`, playback began after 0.8 s, and the playhead read 0:03 of 4:08
  before Stop. On the iPhone simulator Import still opens, with plain
  thumbnails.

### The cloud in a browser

Found while checking what `apps/web` still does that the new app does not,
before deleting it. The new app's web build used the phone's cloud platform,
whose store writes JSON files through `expo-file-system`. In a browser that
module is the spike's stub, and its `write` throws, so signing in to the cloud
failed at its first write: starting a sign-in never left for Google, and a
session could not have been kept. GitHub Pages serves this build.

- `ports/cloudPlatform.web.ts` is the web app's `lib/cloud/webPlatform.ts`:
  IndexedDB for the store, the Cache API for lyrics, gzip undone by hand, and
  `online` and `visibilitychange` as the wake-up. The phone's file keeps its
  shape; the export is `cloudPlatform` in both now, not `nativePlatform`.
- `ports/idbStore.web.ts` is the key-value half of the web app's
  `offline/mirror.ts`, with its database, version and store (`selfmp3`, 1,
  `kv`), so a browser that used the old app keeps what it had, and the service
  worker can read the session and the song files as it did.
- `ports/appPath.ts` puts an address under the build's base
  (`process.env.EXPO_BASE_URL`: empty on the Mac, `/selfmp3` on Pages). The
  sign-in return uses it, to the sign-in screen, which already reads the code
  from the address; so does the Mac's settings return, which dropped the base.
- The doorman keeps a return address's path when its origin is allowed
  (`safeReturn` in `apps/doorman/src/auth.ts`), and Expo keeps `extra` in the
  web manifest, so the doorman address set at build time reaches the browser.
- Checked: a Chromium probe of the new app pressed "Sign in with Google" with
  the doorman's start page stood in for, so nothing reached Google. The
  request carried an attempt and `return=http://localhost:8090/sign-in`, and
  the pending sign-in (attempt and expiry) was in IndexedDB `selfmp3`/`kv`,
  with no storage errors. The cloud-signed iPhone 17 Pro relaunched to its
  library, still signed in.
- Not checked: a whole sign-in in a browser, which needs Xiao's Google
  account.

### The installable web app: manifest and service worker

Also found before deleting `apps/web`: the new app's web build had neither.
The Mac and Pages served it, but it could not be installed, could not take a
shared link from a phone's share sheet (the manifest's `share_target`), and did
not open, or play a downloaded song, without a network. `/sw.js` and
`/manifest.webmanifest` answered with the page's HTML.

- `apps/app/sw/sw.ts` is the web app's `sw.ts`, bundled by `npm run build:sw`
  to `public/sw.js`, which `export:web` now runs first; Expo copies `public/`
  as it is. It is type-checked on its own (`tsconfig.sw.json`, part of the
  app's `typecheck`). esbuild moves with it into `apps/app`'s dev dependencies
  at the version already installed, with a Stack line.
- Two changes to the worker. The new app keeps a download under its whole
  stream address, `?v=` and any token included, where the web app kept a bare
  path, so the worker matches audio on the path (`ignoreSearch`); without that
  a downloaded song would never have played offline. And Expo's bundles live
  under `_expo/`, which joins `assets/` and `icons/` as the build's own files.
- `public/manifest.webmanifest` and `public/icons/` are the web app's. The
  manifest's paths are relative to itself, so one file serves `/` and
  `/selfmp3/`.
- `ports/serviceWorker.web.ts` registers the worker from the shell once the
  connection is known (`sw.js?cloud=1` signed in to the cloud, so it fetches
  missing songs from the bucket), production only, and adds the manifest and
  touch-icon links under the base, since Expo's template has no base
  placeholder. `ports/serviceWorker.ts` does nothing on a phone.
- Checked against the build the Mac serves on 4600, after `export:web`:
  `verify/flows/pwa.spec.ts` reads the manifest and its share target, waits
  for the worker to control the page and fill its shell cache, and reloads
  offline; it passes at both widths. A probe went further: offline, the reload
  came from the service worker, and a song kept under
  `/api/stream/…?v=stored-rev&token=t` answered a request for
  `?v=player-rev` with `Range: bytes=2-5` as a 206 with `bytes 2-5/10` and the
  right bytes; a song not downloaded answered 503.
- The flow skips on a build with no manifest or worker, such as the dev server.

### Auto-mix, and crossfade reaching the player

Two more found before deleting `apps/web`, and the second was older than the
first.

**Crossfade and gapless never reached the web engine.** The Mac's settings hold
both, Settings saves them, and the web app's player passed them to its engine
with `engine.configure`. Nothing in the new app called `configure`, so a browser
played gapless with no crossfade whatever the setting said. The player now tells
the engine the next fade and gapless whenever either changes. A phone's engine
ignores both, as it did: it is gapless within its own queue and cannot fade.

**Auto-mix was missing.** The web app's Up next had a switch that keeps the
upcoming songs in a smooth order by tempo, key and energy, and picks each
crossfade from the two songs, bounded by the setting (4 s when crossfade is
off).

- `packages/client/src/queue/autoMix.ts` is the web app's `player/autoMix.ts`,
  with its 11 tests: the greedy nearest-neighbour path, only what follows the
  playing song reordered, un-analysed songs kept at the end in order, and the
  fade for each handover.
- The player keeps the switch (`automix` in prefs) and, as on the web,
  re-smooths when a list starts playing and when songs are added; Play next,
  reordering and shuffle leave the order alone. Turning it on smooths what is
  queued; turning it off keeps it.
- Up next has the switch on its own row, at both widths, with what the next
  handover will be (`autoMixLine`, 3 tests): the fade in seconds where the
  player can fade, "ordered by tempo, key and energy" on a phone.
- Checked: `verify/flows/nowPlaying.spec.ts` now switches auto-mix on and off
  in Up next, against both apps. On the iPhone simulator the switch is in Up
  next, its line changes, and it was left off. A Chromium probe of the new app
  recorded the engine's audio elements (it never adds them to the document)
  and sought the first song to three seconds before its end: with the Mac's
  crossfade set to 6 s the next song was already sounding at volume 0.03 beside
  the first; with it at 0, as a control, nothing overlapped. The setting was
  put back to 0.
- The gate failed twice on `verify/flows/navigation.spec.ts`'s Settings check,
  in full runs only. The trace showed `/api/settings` answered in 18 ms about a
  second after the page loaded, and a probe found the page's controls in
  order; the dev build simply draws Settings in about 3 s alone and 5 to 7 s
  mid-run, and the check waited Playwright's default 5 s. Asked, Xiao chose to
  give that one expect 30 s, the same as the heading above it.

### Signing out of the cloud, the saved library in a browser, and songs kept for being played

Three more found before deleting `apps/web`. They go together because signing
out has to forget the other two.

**No way to sign out.** The web app's cloud build had Sign out in Settings →
Cloud; the new app showed "Signed in" and nothing else, on the web and on a
phone, and the phone app never had one.

- Settings → Connection, for a cloud library, has Sign out, behind a
  confirmation in the web app's words, which also counts the changes made here
  that have not reached the bucket yet.
- `features/settings/signOut.ts` holds the order with nothing drawn (5 tests):
  one last try at sending those changes (signing out goes on if it fails), end
  the session at the doorman, then forget the library's replica, the songs kept
  on this device and the saved library, and ask to sign in again. Songs are kept
  under this account's ids, and another account's library would hand the same
  ids to other songs, so nothing kept outlives the account.
- `ConnectionProvider` gains `signedOutOfCloud`, the way back to asking.

**The saved library never saved in a browser.** `offline/libraryCache.ts`
writes a file through expo-file-system, which is the spike's stub on the web,
so the web build kept no library to open with. `libraryCache.web.ts` is the web
app's snapshot, in IndexedDB under `library-snapshot`.

**Songs kept because they were played were missing.** A browser on a cloud
library streams from the bucket and keeps nothing by default; the web app kept
each song that counted as a play, up to 2 GB or a quarter of the browser's
quota, letting the least recently played go first.

- `packages/client/src/downloads/recentCopies.ts` is its budget, with the web
  app's tests and two for the stored list (9 tests).
- `ports/recentCopies.web.ts` keeps, trims and lists copies in the same audio
  cache downloads use, so the service worker serves them the same way;
  `ports/recentCopies.ts` does nothing on a phone, which downloads on purpose.
- The downloads provider decides when: only for a cloud library, never for a
  song removed by hand, and not where everything downloads anyway. The player
  hands it each counted play. Asking for a song by hand turns its copy into a
  download; removing it, removing everything, or signing out forgets it.
- The download list leaves these copies out, as the web app's marks did: a
  mark that can vanish on its own is worse than none.

Checked:

- On the web build, a song cached and on the kept list left Settings at
  "0 of 13 songs downloaded"; the same copy without the entry read "1 of 13".
- IndexedDB held the saved library, 13 songs, after the library loaded. Metro
  had to be nudged (touching the importers) to pick up the new `.web.ts` files
  beside existing native ones, as with the cloud import screen.
- On the cloud-signed iPhone 17 Pro, Settings showed Sign out, and its
  confirmation said the music stays in the bucket; it was cancelled, and the
  phone stayed signed in.

Not checked: a sign-out carried through against the doorman, and a play kept in
a browser signed in to the cloud. Both need a Google account signed in on a
device that may be signed out, which this run does not have; the orders and
rules are covered by the tests above.

### A browser's name, and the old app's tests

Before deleting `apps/web`, its test files were checked one by one against the
new app, since `npm run check` runs them and deleting the folder would drop
them silently.

| `apps/web` test | Where it is now |
|---|---|
| `player/autoMix.test.ts` | `packages/client/src/queue/autoMix.test.ts` |
| `player/practice.test.ts` | `packages/client/src/practice/practice.test.ts` |
| `offline/recentCache.test.ts` | `packages/client/src/downloads/recentCopies.test.ts` |
| `lib/energyWave.test.ts` | `packages/client/src/songs/facts.test.ts`, which lacked "stays inside the drawing"; added |
| `lib/shareTarget.test.ts` | `apps/app/src/features/import/import.model.test.ts`, which lacked a link in both `url` and `text`; added |
| `lib/coverColor.test.ts` | nowhere: the new app's cover colour is `packages/client/src/art/palette.ts`, a different method with its own tests, and nothing uses the old one |
| `lib/visuals.test.ts` | nowhere: the drawn song visual did not come across (a deliberate difference recorded in phase 4) |
| `lib/device.test.ts` | `packages/client/src/devices/userAgent.test.ts`, see below |

`apps/mobile`'s one test file, `car/browseTree.test.ts`, is already
`apps/app/src/ports/car/browseTree.test.ts`.

**A browser called itself "self.mp3".** `ports/device.ts` names a phone from
`Platform.OS`, and had no web counterpart, so in a browser every tab of the new
app appeared in other devices' lists as "self.mp3", and a phone's browser
counted as a desktop. The web app read the user agent.

- `packages/client/src/devices/userAgent.ts` is its `describeUserAgent`
  ("iPhone · Safari", "Mac · Chrome", an iPad told from a Mac by touch), with its
  4 tests.
- `ports/device.web.ts` names and classifies a browser with it; the id and a
  name set in Settings are kept as on a phone.
- Checked: a fresh Chromium tab on the web build appeared in the server's
  `/api/devices` as "Mac · Chrome", a desktop.

### Deleting `apps/web` and `apps/mobile`

Phase 5's exit: the last tool has moved, so both are deleted, the Dockerfile
copies `apps/app/dist`, and CI runs one check.

Looked at first: `apps/web` held 145 tracked files and nothing untracked but its
build output (`dist`, `dist-types`, `node_modules`); `apps/mobile` 56 tracked
files and its `node_modules`. The old web app's Vite server on 4601, started from
this worktree as the reference, was stopped. The two Metro servers on 8081 and
8082 belong to other worktrees and were left alone.

What changed with them:

- **Scripts.** `npm run build` builds the packages, the server and the app's web
  export; `npm run dev` runs the server and the app's web dev server on 4601;
  `npm run check` runs `check:app` too. The `*:mobile` scripts and `dev:cloud`
  are gone.
- **CI** runs `npm run check` and `check:app`, no longer `check:mobile`.
- **The server** no longer serves the old app at `/classic`: its mount, its
  `/classic/api` rewrite and `classicWebDir` (`SELFMP3_CLASSIC_WEB_DIR`) are
  removed.
- **The Dockerfile** copies `packages/client` and `apps/app` into the build stage
  and `apps/app/dist` into the image; `.dockerignore` leaves out a prebuilt
  `apps/app/ios` or `android`.
- **The root TypeScript project and ESLint config** lose `apps/web`, and their
  comments say why `apps/app` checks itself.
- **Theme parity.** Two tests in `packages/client` compared the tokens with
  `apps/web`'s stylesheet; it is kept beside them as
  `packages/client/src/theme/tokens.reference.css`.
- **The flows** default to the build the Mac serves on 4600; the old-app branch
  in `nowPlaying.spec.ts` and `againstUniversalApp` are gone, and
  `verify/README.md` says how to run them against the build or a dev server.
- **Docs.** `docs/MOBILE.md`, `docs/features/native-app.md`,
  `docs/ARCHITECTURE.md`, `docs/SYNC.md` and the README describe `apps/app`.
  Feature pages written earlier still name old files; the README says so and
  points here. `docs/reference/` stays, as the plan asks.
- **The lockfile** was updated in place: 66 entries removed (the two workspaces
  and what only they used), none added, no version changed.

Checked: `npm run check` (116 test files, 1285 tests and 1 skipped, then the
app's typecheck, lint and 7 component tests) and `npm run build` (the export
includes `sw.js` and the manifest), then the gates below.

Not checked: building the Docker image, which needs its base images pulled;
that waits for Xiao.

## Phase 6

On `universal/phase-6`, from `universal/phase-5`.

### Similar songs on a phone, and tag editing already there

**The shelf.** The web's Now Playing had a "Similar songs" strip under the art;
the phone page did not (noted in phase 4 as later work). It is now under the
controls, while the art is showing.

- `features/nowPlaying/SimilarShelf.tsx`: the song's nearest neighbours by tempo,
  key and energy (`useSimilar`, the server's `/api/songs/:id/similar`). A card
  plays its song with the rest of the shelf after it; "Queue all" adds them
  behind what is queued, skipping any already there.
- `similarShelfLayout` (4 tests) decides whether it fits. The phone's cover is
  sized from the height; with the shelf it gives up the shelf's 132 points, and
  if that would take it under its 180-point floor the shelf stays out and the
  page is as it was. On the iPhone 17 Pro Max the cover goes from 340 to 324;
  at 375×812 it is at the floor with the shelf; a 667-point phone gets none.
- Checked: on the iPhone 17 Pro Max the shelf shows three cards and a slice of
  the fourth under the controls, and "Queue all" then Queue opens Up next. A new
  phone test in `verify/flows/nowPlaying.spec.ts` taps a card: the queue becomes
  as long as the shelf was, and the new shelf has no card for the song now
  playing.
- Two things the first versions of that test got wrong, both about the test:
  "Queue all" adds nothing when the dev library's 13 songs are already queued
  (`enqueue` skips queued songs), and an exact text match finds nothing on the
  web build, where the title, artist and album are one text node.

**Tag editing on a phone** was already there: a long press on a tag chip in the
library opens the tag editor as a sheet. Checked on the iPhone 17 Pro Max: it
shows the tag and its song count, Show only these and Hide these, Name with
Rename, the colours and Delete tag, and a tap outside closes it untouched.

### The iPad as a width of its own

The dev client was installed on an iPad Pro 11-inch simulator (834 × 1194
points, iOS 26.5), connected to the Mac through onboarding. At 834 it gets the
desktop layout with a finger, and three things were wrong in portrait:

- **The sidebar ran under the status bar.** No part of the wide frame used the
  safe area; the screens pad their own top, the sidebar did not. It now adds
  the top inset. A browser's inset is 0, so the web is unchanged.
- **The player bar was cut off on the right.** Its song and transport keep 200
  and 300 points, and the tools do not shrink: at 834 the volume and devices
  went past the edge. Below 900 points the song and transport give up width
  (150 and 250). The bar also clears the home indicator.
- **The library's header clipped its sort.** One row needs about 760 points
  and the column beside the sidebar is 590. Below 760 it stacks as a phone's
  does; before the column is measured the row is kept, so a desktop does not
  flash.

Checked: on the iPad simulator the rail starts under the status bar, the
header stacks and the whole bar fits above the home indicator; the web build at
834 × 1194 in Chromium has no control past the right edge; the library,
navigation and playback flows pass at 1280 and 375.

Not checked: landscape (1194 wide), which needs the Simulator rotated; Xiao
declined control of the Simulator app, and `simctl` cannot rotate.

**Keyboard shortcuts on an iPad** need native key commands. No installed module
provides them (React Native uses `UIKeyCommand` only in its dev menu), so this
needs a new native dependency and a dev client rebuild: a Stack line and
Xiao's call.

### A server image for the Raspberry Pi

On `universal/docker`. The server is to move from the Mac to a Raspberry Pi;
the Dockerfile rewritten at phase 5's exit had never been built.

- **Three stages.** `web` builds the app's web export on Debian, on the builder's
  own CPU (`--platform=$BUILDPLATFORM`), since it only makes static files.
  `server` installs only `@selfmp3/shared` and `@selfmp3/server` with the root's
  TypeScript on Alpine, builds them, and reinstalls production dependencies, so
  Expo and React Native never reach the image and better-sqlite3 is compiled for
  musl. The runtime is those plus ffmpeg, yt-dlp and tini.
- **Published, not built on the Pi.** `.github/workflows/docker.yml` builds
  `linux/arm64` and `linux/amd64` on pushes to main and pushes
  `ghcr.io/xiao215/selfmp3:latest` and the commit hash. `docker-compose.yml`
  pulls that image; `docker compose build` still builds locally.
- **Docs.** `docs/INSTALL.md` gains "On a Raspberry Pi" (64-bit OS, SSD, Docker,
  compose, moving the two folders from the Mac) and updates by pulling.
- Checked on this Mac (arm64, so natively): the build finished in 328 s, 532 MB.
  A container on port 4700 with empty folders answered `/api/health`, `/`,
  `/sw.js`, `/manifest.webmanifest` and `/api/library` with 200 and the right
  types; yt-dlp 2026.08.19 and ffmpeg 8.1.2 run inside and better-sqlite3 loads.
  The container was removed.
- Not checked: the workflow itself, which runs once this is on main, and the
  amd64 image. The published package may start private on GHCR; making it public
  lets a Pi pull without logging in.

### Import from any device, and "your server" rather than "your Mac"

On `universal/cloud-import`. The server is to move to a Raspberry Pi, and the
app said "your Mac" wherever it meant the server.

- **Import on a phone.** The tab bar gains Import. Connected to the server, it
  looks a link up and offers its tracks; signed in to the cloud, it asks the
  server to fetch the link the next time it is on, as the web's cloud build
  did. Only the server runs yt-dlp, so no device needs to do more.
- **Songs on their way.** A cloud library now shows this device's requests at
  the top of the library, drawn as a missing file is and not playable: the title
  once the server has looked the link up (the link until then), a YouTube video's
  thumbnail worked out from its link, and where it is (waiting, downloading,
  almost ready, or why it failed). A finished request stays until every song it
  brought is in the library, since the server publishes a song only once its
  audio is in the bucket. `pendingImports.model.ts` (3 tests) and a component
  test (2) hold the rules.
- **Wording.** Every user-facing "Mac" in the app now says "server" (about 28
  strings in 14 files); the flows' comments, which describe the dev setup, are
  unchanged.
- Checked: on the cloud-signed iPhone 17 Pro the Import tab opens the cloud
  import screen, which says "Your server downloads it". No request was sent,
  because one would download a real song into the library; the pending rows are
  checked by the component test.

### No more connecting by address

Every device starts with Google sign-in; the library is the bucket's, and the
server does not have to be running. Typing a server's address was the older way
in and no longer matched how the app works.

- `app/onboarding.tsx` renders the address screen in development builds only,
  where the simulator tests use it (they cannot sign in to a Google account); a
  normal build redirects it to sign-in.
- Settings loses "Change server" and its confirmation.
- The server's own page still connects to itself with nothing typed, so the
  things that need the server (its settings, Stats, the tag inbox, metadata,
  importing with track picking) stay one browser tab away.
- `docs/MOBILE.md` and `docs/features/native-app.md` say so.
- Checked: in the exported (production) build served on 4600, Settings has no
  "Change server", and `/onboarding` ends at `/sign-in` with no address field.
  Navigation and Settings flows pass against the dev server.

Later: once the server is on the Pi, a signed-in device could use a live
connection to it automatically when it can reach it, so those features come back
to phones without anyone typing an address.

### What is playing wears its cover's colour — branch `universal/artwork-tint`

The playing row and both player bars had fallen back to the accent: the web
app took their colour from the cover (`useCoverColor`), and that did not come
across. Now it does, on every platform.

- **Where the colour comes from.** The server picks it once per cover:
  `CoverToneService` has ffmpeg draw the cover at 24×24 and runs the shared
  `pickCoverTone` (moved from the web app, unchanged). It is stored per song
  against the cover's revision (migration "songs: the colour of each cover"),
  read in the background for covers already there and again whenever one is
  saved, and sent as `coverTone` in the API and the snapshot. Decided by Xiao:
  a field on the song rather than each device reading the image.
- **Why not on the device.** A phone has no canvas. Decoding a cover in
  JavaScript was measured with the JIT off, as on the phone's interpreter:
  0.36 s for a 600×600 JPEG, 0.6–0.75 s for the 1280×720 PNGs most covers
  are, all on the JS thread at every change of song. ffmpeg does it in about
  60 ms on the Mac.
- **Schema.** `CoverToneSchema` (hue, chroma); `coverTone` is optional on
  `SongSchema` and `CloudSongSchema`, so older servers and snapshots still
  parse, and older clients ignore it.
- **Drawing.** `songColors` (packages/client) turns a tone into a wash colour
  and a text tint, for the dark theme and the light one. `useSongColor` uses
  the song's `coverTone`; in a browser talking to a server that has not sent
  one it reads the cover with a canvas; a song with no cover takes its letter
  tile's colour; otherwise the accent.
- **Where it shows.** The playing song row's wash, title and equaliser (phone
  and desktop), a playlist row's title, the current row's edge in both queues,
  and the progress wash in the mini player and the player bar.
- **The progress wash** fades out over its last 24 points (mini player) or 40
  (player bar) instead of stopping at a hard edge, as the web's mask did;
  `ProgressWash` draws it.
- Checked: `/api/library` on the dev server carries a tone for 12 of 13 songs
  (祝福's cover has no colour in it, so it keeps the accent); on the iPhone
  17 Pro Max the playing 三原色 row and mini player are green like its cover;
  in the browser at desktop width 夜に駆ける's row and bar are red.

### A shorter device list, and a browser that streams — branch `universal/devices-tidy`

Decided by Xiao after looking at the dev server's Settings: the device list was
thousands of rows long, and a browser offering to download songs was pointless.

**Devices.**

- **Why it was long.** A browser's device id lives in its storage for one
  address, so each Playwright context registered a new device: the dev server
  had 2,347, of them 1,473 "self.mp3" (from before browsers named themselves)
  and 839 "Windows PC · Chrome" (Playwright's desktop Chrome says Windows).
- **Show less.** `deviceListView` (packages/client) folds offline devices that
  share a name into one row, led by the one seen last, with a ×N tag; forgetting
  the row forgets all of them. This device and online devices are never folded
  and always shown; with them, what was seen in the last day, up to five rows.
  The rest wait behind "Show N older devices". Four tests.
- **Forget sooner.** The server forgets a device a week after it was last seen
  (was 30 days), at boot and every hour. A device that comes back heartbeats in
  again; a state that old is past offering to resume anyway. One test.
- **No more test devices.** The Playwright projects run as `playwright-desktop`
  and `playwright-phone` on every run (a fixed `selfmp3.device.id` in their
  storage state), and `verify/flows/teardown.ts` forgets both when the run ends.
- The dev server's list was cleared once, with Xiao's OK: 2,388 offline devices
  forgotten, the three open browser tabs left.

**No downloads in a browser.** A browser's storage can be cleared by the
browser itself (Safari evicts a site's data after about a week unused), so a
song "downloaded" there was never dependably offline. An installed app keeps
songs; a browser streams.

- Hidden where `installedApp` is false: Settings' Offline music section and its
  index entry (`sectionsFor(fromCloud, installed)`), the song menu's Download /
  Remove download, the song page's "On this device" group, the playlist's
  download button, the library's "On this phone" chip, and Now Playing's Keep.
- A cloud library in a browser now streams: `playBlock` only holds back a song
  that is not downloaded for an installed app, and the service worker already
  streams a song from the bucket a range at a time, keeping nothing. Offline, a
  browser says so as before. Not checked end to end: that needs a signed-in
  browser against the production build.
- A browser no longer keeps copies of songs it played (`keepPlayed`).
- The Electron shell, if it is ever built, sets `installedApp` and gets
  downloads back.

### The stage's lyrics follow a seek — branch `universal/lyrics-seek`

Found by Xiao: in the stage view, dragging the progress bar left the lyrics
behind. Two causes, found with a Playwright probe in Chrome at 1280 on
夜に駆ける that grabs the thumb where it is, drags it, and reads the song
position and where the sung line sits in the lyrics box.

1. **The glide, and then a pause.** A seek smooth-scrolled the words for about
   1.2 s, and the end of that scroll arrived after the 700 ms `StageLyrics`
   allowed for a scroll it began, so it counted as a hand scroll and the words
   stopped following for `MANUAL_SCROLL_MS` (4 s). Now (`lyricFollow.model.ts`,
   two tests) a move of more than one line jumps and is followed even while
   reading ahead by hand, and scroll events count as the page's own for as long
   as they keep coming (each extends the window by 250 ms).
2. **Where the line was.** That fixed some seeks and not others — Xiao found
   backwards ones still failing. Logging the effect showed why: the scroll
   target came from each line's `onLayout`, and on the web a line that moves
   without changing size reports no new layout. A ♪ break below lines whose
   font arrived late kept its first position (line 35 recorded at 1864 px, laid
   out at about 3220), so a seek landing on it scrolled to the wrong place and
   the sung line stayed off screen until the next line. Whether it failed
   depended on the line landed on, not the direction. Now the sung line is
   measured against the lines' container with `measureLayout` when it is
   scrolled to, and the container changing size re-centres it.

Checked with the probe, five drags from the thumb (2→60, 62→30, 32→25, 27→50,
52→10, two of them landing on ♪ breaks): 150 ms after letting go the sung
line is at 40% of the box every time, and the words keep following the song.

Later the same day Xiao, testing on 4600, found the words stopped following
after switching the bar around many times. 4600 was still serving the build
exported before either fix; rebuilt, a rapid probe (24 drags from the thumb,
120–800 ms apart, forwards and back) kept the sung line at 40% after every one
and for 12 s after the last, and a mixed one (drags, clicks on the bar, clicked
lines, Up next and back) did too. The words stand still only after a scroll
by hand — the mouse wheel or a trackpad over the lyrics — for
`MANUAL_SCROLL_MS`, as designed, and the next seek brings them back.

### A refresh comes back to the song — branch `universal/lyrics-seek`

Also from Xiao: playing on the web showed only `/` or `/now-playing` in the
address, and a refresh lost the song ("Nothing playing"). The player kept
nothing about what this device was playing; the resume toast only offers
other devices.

- `player/session.model.ts` (six tests): the queue, the song and the position,
  and `launchPlayback`, which decides what to load when the app opens: the
  saved session trimmed to songs still in the library, or, when the address
  names another song, that song alone.
- `player/usePlaybackMemory.ts`, in the root layout: once the library is
  known and nothing is loaded, it loads that paused where it was (opening a
  page never starts audio), skipping a song that could not start without a
  question. It writes the session down when the queue, the song or play/pause
  changes, every 5 s while playing, and as a browser tab closes. Kept through
  the prefs port: `localStorage` in a browser, a file on a phone, so the phone
  app comes back to its song too.
- Now Playing keeps the song in its address (`/now-playing?song=13`), so a
  copied link opens on it.
- `verify/flows/restore.spec.ts`, at both widths: play, open Now Playing and
  see `song=` in the address, reload and see the song, then clear what was
  remembered and open the address alone. A probe on 4600 also checked the
  position (a seek to 91 s came back at 92 s, within a second) and that it
  came back paused.

### The phone's seek bar holds still under a finger — branch `universal/lyrics-seek`

Found by Xiao on the simulator: holding the progress bar on the phone and
dragging it made the thumb act strangely. Not a simulator quirk. Logged from
the seek bar during Maestro drags (each touch sent to the server as a request,
since this React Native no longer prints `console.log` to Metro):

- A drag that began on the track read positions smoothly: `locationX` was the
  finger's `pageX` minus the bar's left edge, 16.
- A drag that began on the thumb did not. On iOS `locationX` is measured from
  the innermost view under the finger, so the press read 7 (the thumb's own
  edge, 4 s into the song), and as the finger moved smoothly from 330 to 88 the
  readings alternated between the two views: 262, 49, 226, 78, 200, 96… — the
  thumb flickering between two places. No drag was ever terminated, so the
  sheet's own gesture was not involved.

Now the track, fill and thumb have `pointerEvents="none"`, so the touch is
always on the bar itself. Checked the same way: a drag from the thumb at 330
back to 88 read `pageX − 16` at every one of 160 moves. The web was never
affected, since react-native-web measures from the responder.

The Maestro smoke also failed twice today right after the Playwright flows
had run against the same server, both times on a screen nothing had tapped
(the Import tab; Now Playing after a tag chip), and passed when run on its
own. Device commands do not navigate, so the cause is not found; the gate now
runs the smoke before the flows.

### The newest song load wins — branch `universal/lyrics-seek`

The smoke failed three more times while the refresh work was on the branch,
each time with the wrong song or state after a tap. Logged from the app (taps
and restores sent to the server as requests): the app restored the saved song
at 12:40:54.0, a moment after the flow tapped song 1 at 12:40:53.8, and both
loads ran at once. A load awaits at every step — reset, add the track, seek,
play — and one that carried on past a newer one put its own song back, paused,
or its start position on the song just picked (もう少しだけ opened at 3:23, the
restored 三原色's position). Two Now Playing opens seen in the logs at 12:42
were real taps on the mini player, from someone using the simulator by hand.

Both engines now count loads and stop a load at its next await once a newer
one has started, so the last request wins. Checked: the smoke passed three
times in a row on the simulator.

### Six things from Xiao's first look — branch `universal/app-polish`

Asked for after using the web app and the simulator, with three choices made
by Xiao (tag chips go on the phone too; holding a row selects and the menu is
on ⋯; a play is a fixed minute):

1. **The bars in the song's colour.** `SeekBar` takes a `color`; the player
   bar and the phone's Now Playing pass the playing song's, and the player
   bar's volume slider fills with it too. The loop region follows.
2. **The phone's Now Playing on its cover.** The cover, blurred
   (`Image blurRadius`), fills the page behind everything under a shade, as
   the computer's stage glows; a song with no cover is washed in its tile's
   colour. A phone cannot draw the stage's CSS blur.
3. **No Select button.** Gone from the library and the playlist page. On a
   computer the row's checkbox is the way in. On a phone, holding a library
   row selects it (`SongRow`'s `onLongPress`), and the song menu is on the ⋯;
   a playlist row has no ⋯, so holding it still opens the menu, whose Select
   is wired there now.
4. **A quieter library.** "13 songs · 48 min" shows only for a view narrowed
   to a tag. On a phone the head is the title and the search, with "On this
   phone" in the installed app; sort, direction, Play, Shuffle and the tag
   chips (and the tag editor they opened) are a computer's.
5. **A play is a minute.** `secondsToCount` is `min(60, duration)`, and a song
   that plays to its end counts as before; the fraction, its four-minute cap,
   the player's threshold and the Settings slider are gone. The server still
   stores `playThreshold`, unused.
6. **Now Playing fills a phone.** `fullScreenModal` instead of a sheet with a
   gap at the top, and the close and love buttons are round.

Flows: the selection flow enters by the checkbox on a computer and by holding a
row on a phone, and checks there is no Select button; the Maestro smoke drops
sort and tags and holds a row to select, then opens the menu from ⋯, as the
downloads flow now does.

Checked in Chrome against the dev server: no Select button and no count at
either width, sort and Play kept on a computer and gone on a phone, no "Count
a play after" in Settings, the volume slider red under 夜に駆ける, and the
phone's Now Playing on its blurred cover with a round close button.

### The phone's selection bar, and leaving selection — branch `universal/selection-bar`

Found by Xiao on the simulator right after the Select button went: holding a
row showed the bar with Play, Queue and More hanging out of its bottom edge
over the first song, More taller than the others; and unticking the one
selected song left the bar up until its ✕ was pressed.

- **The bar.** At phone width it was one row that wraps, with the buttons'
  row forced to full width (`flexBasis: '100%'`). On iOS that measured the bar
  too short. Chrome laid the same bar out correctly, so only the simulator
  showed it. More sat in a wrapper, and its `grow` (`flex: 1`) stretched it
  down the wrapper instead of across. Now the phone's bar is a column of two
  rows — the count and ✕, then Play, Queue and More sharing a line — and More
  takes its width from the wrapper.
- **Leaving selection.** `toggleSelected` ends selection mode when it unticks
  the last selected row. Emptying the selection from the bar's own checkbox
  (`deselectAll`) still stays in the mode. Two tests.
- Checked on the iPhone 17 simulator with Maestro: hold a row, the bar is two
  rows inside its border; tap the row again, and the bar and checkboxes go.

### No white flash on a pressed row — branch `universal/row-press`

Found by Xiao in the light theme: tapping a song row flashed a white box over
its cover and title for about half a second. The row's main press area took
`surface1` as its pressed background, which is near-white in the light theme,
over only part of a row that may be washed in a song's colour or tinted as
selected. The background is gone; the row still scales under the finger, and
the ⋯ and heart keep their own pressed shading.

### The phone's Now Playing in the song's colour — branch `universal/np-song-colour`

Asked for by Xiao: on the phone's Now Playing the play button, a lit shuffle
or repeat, and the lit labels in the foot row (Lyrics, Practice, On this
phone, Sleep, Queue) were the app's blue accent, over a page already washed in
the cover. They now take the playing song's colour (`useSongColor`), the play
button pressing to its tint; the icon on the play button stays the theme's.

### Lyrics-only follows the song at once, and drag handles look draggable

Found by Xiao on 4600: after dragging the bar on the stage and opening
lyrics-only straight away, the words sometimes caught up only after three or
four seconds.

- Probed in Chrome: 200 ms after the switch the sung line was at 318% of the
  box, 89% at 600 ms, in place at 1.2 s. Lyrics-only's larger type moves every
  line; the re-centre that followed was a glide (the same line, so "the song
  moving on"), and its scroll events, arriving outside the window the page
  allowed its own scrolls, could be taken for a hand and hold the centring off
  for `MANUAL_SCROLL_MS`.
- Now a change of layout re-centres with a jump, and only real reading ahead
  holds the centring off: the wheel or a finger in a browser, a drag on a
  phone (`onScrollBeginDrag`). A scroll event alone no longer counts, and the
  700 ms window and `AUTO_SCROLL_GAP_MS` are gone.
- The same probe after the change, three switches: the sung line at 40% by
  200 ms each time, then following.
- The queue's and a playlist's drag handles show a grab cursor in a browser,
  and a grabbing one while held (`ports/dragCursor`).

### Hover captions are back — branch `universal/hover-captions`

Noticed by Xiao on 4600: hovering an icon, or a song's tempo and energy, no
longer said what it was. The web app had a `TooltipHost` reading `data-tip`
from 77 places in 29 files, and it did not come across; the new app kept
screen-reader labels, which a browser does not show.

- `shell/TooltipHost.web.tsx` is the web app's host, moved as it was — the
  pointer rests 300 ms, the next caption along a row opens at once, keyboard
  focus shows it, a touch never does, a trailing `(key)` becomes a key cap —
  drawn in the theme's colours. `TooltipHost.tsx` renders nothing on a phone.
  Mounted once in the shell.
- `ui/tip.ts` sets `data-tip` through `dataSet`, which React Native for web
  turns into the attribute.
- Captions: every `IconButton` (its label) and icon-only `Button`; a song's
  badges ("100 beats a minute · energy 88 of 100", `describeFeatures` in
  packages/client, with a test); the row's ⋯, heart, + and play; the player
  bar's song and play; the sidebar's clear, new tag, hide and edit; the stage's
  lyrics-only; drag handles; the volume; a forgotten gem. A caption that only
  repeats text already on screen is not shown, as before.
- Checked by hovering in Chrome against the dev server: the badges, the row's
  ⋯ ("More actions") and heart ("Love this song"), the bar's Next, the sidebar's
  New tag, and no caption on the worded Shuffle button.

### Captions, the queue head and Settings, from a second look — branch `universal/caption-polish`

From Xiao on 4600, after the captions came back:

- The caption portals into `document.body`, outside React Native for web's
  root, so it inherited the browser's serif. It now names the same stack RNW
  uses for `System`, in `textSecondary` rather than `textPrimary`.
- An icon button's caption is placed from its `svg`, not its 34px box: the
  queue's Close caption sat nearer the Lyrics / Up next / About tabs than the ✕.
- Tempo and energy have separate captions ("100 beats a minute", "Energy 88 of
  100"); `describeFeatures` became `describeTempo` and `describeEnergy`.
- Words: every heart says Like / Unlike (row caption, player bar, phone Now
  Playing); ⋯ says More; the player bar's tags say Edit tags, the queue's
  buttons Clear and Close. `IconButton` takes a `caption` for these, so the
  screen-reader labels the flows and Maestro use ("More actions for …",
  "Close queue", "Tags for …") are unchanged.
- The queue head's subtitle gets a 3px gap under "Up next".
- Settings: Rescan automatically and YouTube login cookies are gone (the
  watcher row stays). The stored values were already Never and Off; the schema
  is untouched. `YouTubeLibraryPanel` drops its signed-in status, Test and Liked
  Music, which only work with cookies, and keeps the public playlist link.
- Checked by hovering in Chrome against the dev server: tempo, energy, row ⋯
  and heart, bar tags and heart, queue Clear and Close, all in -apple-system at
  rgb(174, 177, 185).

### Real keys, the row wash back, song-coloured controls — branch `universal/song-colour-controls`

From Xiao on 4600:

- **Every song was 8A.** Not hard-coded: `chroma()` in `services/dsp.ts` summed
  FFT bins per pitch class, and at 22050 Hz / 4096 the bins between C2 and C7
  fall 20 (C♯) to 40 (B) per class. The tilt alone made white noise A minor
  with 0.46 confidence, so every real song was too. Now a mean per bin, with
  tests that noise gives a flat chroma and a D major chord reads D major.
  `FEATURES_VERSION` 1 → 2, so the analyser redid the library on its own:
  13 × A minor became ten keys.
- **The playing row's wash was gone.** `RowWash` used the id `song-row-wash`.
  After a playlist visit the router keeps that screen hidden with its own
  wash, earlier in the DOM; the visible row's `url(#song-row-wash)` resolved to
  that 0×0 gradient. Each wash now takes `useId()`, like `ProgressWash`.
  Checked in Chrome: after Library → Playlists → a playlist → Library, two
  gradients, each used once, the visible one 1020×54.
- **Lit controls in the song's colour**: shuffle, repeat, the tag count and
  the tags icon, and the bar's lyrics, queue, practice, speed, sleep and mute
  toggles, through a small `usePlayingColor()` in `PlayerBar`. Checked: with
  三原色 playing, shuffle, the tag badge and the wash are all #56af64.
- **The tab icon follows the accent**: `ports/appIcon.web.ts` redraws
  `public/icons/icon.svg` at the chosen hue as a data URL and replaces the
  build's favicon link; `AccentProvider` calls it when the hue changes. The
  installed PWA and iOS home-screen icons are build-time files and keep their
  colour (iOS would need alternate app icons, a native rebuild).
- Energy's caption: "Energy 86%".

### The stage's key and energy in the song's colour — branch `universal/stage-song-colour`

From Xiao: on the stage, 群青's "7A" was a pale olive and its energy wave
another colour, neither the song's. The key was `oklchToHex(0.8, 0.1, accent.hue)`
(+120° for a B key) and the wave the accent. Both are now `useSongColor(song,
uri).color`, as the player bar's seek bar and lit toggles are.

On the phone's home-screen icon following the accent: iOS has no way to draw an
app icon at runtime, only `setAlternateIconName` over icons bundled at build
time, with a system alert each change. A free hue could at best snap to the
nearest of the seven presets. Xiao's call: the phone keeps the one default icon
and does not follow the accent; only the browser tab does.

Checked on the dev server: 群青's 7A reads rgb(216, 120, 123) and its wave is
drawn the same pink, the cover's colour.

### The phone's Now Playing, from a first real use — branch `universal/phone-np-nits`

Six things Xiao found on the Pro Max:

1. **Dark squares.** `IconButton`'s pressed state was `surface3`, a solid box
   over the song-coloured page. It is a 10% veil of the text colour now, and the
   page's shuffle, previous, next and repeat are round. Queue all was a
   full-size secondary `Button`; `SimilarShelf` draws a small pill instead. The
   foot actions and shelf cards press with the same veil.
2. **Pull down to close.** The route is a `fullScreenModal`, which has no
   swipe of its own. A `PanResponder` on the page claims a mostly vertical move
   down past 12px, follows the finger, and past 140px (or a flick) goes back.
   `SeekBar` refuses termination so a scrub that drifts down stays a scrub.
3. **Head under the clock.** `SafeAreaView` (react-native-safe-area-context)
   measures its own frame; the page slides up from below, and a measure taken
   mid-slide saw no status bar. The page pads from `useSafeAreaInsets()`, the
   root provider's window insets.
4. **Times hard to read.** `SeekBar`'s times, inline and under the track, are
   `textPrimary`.
5. **Scrubber jumped back.** After a release the bar showed `player.position`
   at once, and a phone's engine reports the old time for a tick. The released
   position is held until the position is within 2.1 s of it, or for 1 s.
6. **祝福 in the accent.** Its cover is green trees under a blue sky: plenty of
   colour, but the gate was the winning 15° bin's share (0.014 against 0.02).
   `pickCoverTone` now gates on all the colour (0.056 there), with a test. The
   server had stored "none" against the cover's revision, so migration 13 clears
   `cover_tone_rev` where the hue is null and the covers are read again.
   (On the dev server the watcher restarted on the migration before the
   shared package was rebuilt, and read 祝福 with the old rule once more; a real
   server gets both in one restart.)

Then two more:

7. **Keyboard shortcuts on a phone.** Settings now shows that panel, and its
   index entry (`sectionsFor(…, keyboard)`), only with a fine pointer.
8. **The page under Now Playing went back to the top.** `Shell`'s `frame()`
   returned a bare `<View>` while a screen owned the display and the compact
   frame otherwise, so opening Now Playing re-parented the router's `Stack`
   and React remounted every screen in it. One tree now, with the toasts, mini
   player and tab bar rendered or not. That alone left the list ~3 rows short
   on the iPhone 17: the page under the modal grew by the tab bar's height
   while it was hidden, iOS clamped the offset, and it stayed clamped. A phone
   presents Now Playing as a native modal over the chrome anyway, so the
   chrome stays there (`ports/modalCoversScreen`); a browser, where the route
   is a page in the content area, still hides it.

### The shared card, the report's address, the range buttons — branch `universal/stats-report`

From Xiao on 4600:

- **"Share as image" looked nothing like the page.** `ports/shareCard.web.ts`
  drew a 1080 square: the minutes, three facts, two lists whose fifth row ran
  under the personality box, no artwork. It is now 1080×1350 and follows
  `WrappedScreen`: the eyebrow, figure and hours over the number one's cover
  (drawn to 12px and back up, a blur that works in Safari too) under the same
  wash and glow; the traits as pills; `facts()` as a 3×2 grid; the number one
  with its cover; songs 2–4 beside the top artists with `rankShare` bars. The
  page passes the cover's URL; it loads with `crossOrigin`, and a canvas it
  taints is redrawn without it. `CardPalette` gains `border` and `bar`.
- **The address.** `app/stats/report.tsx` renders the report; `wrapped.tsx`
  redirects to it. The Stats button, the flow and the reference shots use it.
- **Range buttons**: `rangeButtonLabel` says 7d, 1m, 3m, 1y, All.
- Checked in Chrome against the dev server: the buttons read
  ["7d","1m","3m","1y","All"], /stats/wrapped lands on /stats/report, and the
  downloaded card was looked at.

### Menus that fit, and a small tag window — branch `universal/menus`

From Xiao on 4600: a song's ⋯ menu near the bottom was a short box with a
white scrollbar, and Edit tags filled the width of the window.

- **`Popover` picks its side.** It used to open below unless told `above`, and
  held its `ScrollView` to the room below the control: for the last rows that
  was a few items and a bar. `placement` now defaults to `auto`: the panel is
  drawn off screen until it has measured its natural height, then opens below
  if that fits, above if that fits, and otherwise on the roomier side,
  scrolling with `showsVerticalScrollIndicator={false}`. A panel for a control
  near the left edge starts at the control instead of being clamped against the
  edge. It has a shadow and a little horizontal padding.
- **`SheetItem`** lights up under the mouse in a panel (`onHoverIn`), in the
  danger colour for Remove.
- **`Sheet` at desktop width is a window**: centred, at most 420 wide and 80% of
  the height, with the panel's dense items. Phones keep the bottom sheet.
- **`TagPicker`** takes an `anchorRef`; the player bar passes its tags button,
  so there it is a 320-wide popover over the button. Opened from a song's menu
  (which closes as it opens) it is the centred window.
- Checked in Chrome at 1280×900: the last row's menu opened above its ⋯
  (240×407, no scroll, no scrollbar); Edit tags from it was 402 wide and
  centred; the bar's picker was 320 wide above the button.

### CI: react-dom's types declared — branch `universal/react-dom-types`

The Pages and Check workflows failed on main from the hover captions onward:
`shell/TooltipHost.web.tsx` imports `createPortal` from `react-dom`, and
`tsc` found no declaration for it. Locally `@types/react-dom` 19.3.0 sat in the
root `node_modules`, left over and absent from the lockfile, so the check
passed here and not after CI's clean install. `@selfmp3/app` now declares
`@types/react-dom ~19.2.7` (matching `@types/react ~19.2.18`); the lockfile
gains only that entry.

### The ⋯ and its windows, and the stage's transition — branch `universal/menu-flow`

From Xiao on 4600:

- **The ⋯ vanished under its menu.** Rows show the ⋯ on hover; the popover's
  backdrop covers the row, the row hears `pointerleave`, and the ⋯ went to
  opacity 0 while still under the backdrop's click. `SongRow` takes
  `menuOpen` (the library passes it for the row whose menu is up) and keeps the
  ⋯ and the row highlight while it is set; a click on the ⋯ lands on the
  backdrop and closes the menu. `Popover` scales in from 0.94 with its
  `transformOrigin` at the corner nearest the control.
- **Tag windows where they were asked for.** `SongMenu` hands its anchor to
  `TagPicker`; the row's + passes itself through `onEditTags(anchor)`; the
  stage's Edit tags button has a ref. All three open the picker as a popover
  over the control. Only a picker opened with nothing to hang off is centred.
- **The stage moves.** `NowPlayingStage` fades and rises in over 260 ms and
  registers a 180 ms exit with `shell/stageExit`; its chevron, Escape and the
  player bar's close go through `leaveStage`, which plays it and then
  navigates. The browser's own back still cuts.
- **"The UI broke after the stage"** did not reproduce on 4600 in Chrome:
  refresh then open and close by the chevron, by browser back, by refreshing
  on the stage and closing, and from a refreshed Stats page all came back with
  the same shell and library geometry and no page errors. Waiting on Xiao for
  the exact steps.
- Checked in Chrome against the dev server: the ⋯ stayed at opacity 1 with its
  menu open and the mouse elsewhere, a second click closed the menu, Edit tags
  opened under the ⋯, and the stage's opacity moved on open and close.

### Styles that stay, a ⋯ that toggles, a tidier tag window — branch `universal/keep-styles`

From Xiao on 4600, with screenshots:

- **The page drew unstyled after closing Now Playing** — sidebar labels, a
  hovered row, then the whole stage on reopening. Not reproduced in Chromium
  by any probe (six cycles of hover, menus and the stage; focus mode with the
  bar idling away; refresh, browser back and Stats), but the mechanism is in
  Unistyles 3.3's web registry: `remove(ref, hash)` waits a microtask and,
  when `document.querySelector('.hash')` finds nothing, deletes the rule and
  forgets the hash. An element that keeps the class but is not in the document
  at that moment is left with a class and no rule, and `add` never runs for it
  again. `ports/keepWebStyles.web.ts`, called once after `StyleSheet.configure`,
  replaces `remove` with one that updates `stylesCounter` and removes nothing
  (so the theme listener stays too). The registry is not exported; it is
  reached through `UnistylesRuntime.services`, and the port does nothing if
  that ever moves. On the dev server the sheet held 177 rules after the stage
  closed (on 4600 before: 147 → 140), with no class missing a rule.
- **The ⋯ went invisible after a second click without moving the mouse.** The
  popover's backdrop covered the ⋯, so the row saw `pointerleave` and nothing
  told it the pointer was back. `Popover` now draws its backdrop as four pieces
  around the anchor. The row keeps its hover; a click on the control reaches
  the control, and the library's ⋯ and +, the player bar's tags and the stage's
  Edit tags toggle. Checked: open, second click closes with the ⋯ at opacity 1,
  third click reopens.
- **The tag window**: `outlineWidth: 0` with the accent as the focused border
  (the browser ring had drawn a white second outline), and in a pop-up
  (`usePanelDense`) a 36-high search box with room above it and 34-high rows.

### No white ring on the tag search — branch `universal/tag-focus`

The tag window's search box still drew a white ring inside its blue focus
border. `outlineWidth: 0` was not enough: the input's outline style is Chrome's
`auto`, and an `auto` ring is drawn at any width. `_web: { outlineStyle: 'none' }`
removes it; the accent border alone shows focus. Checked in Chrome: `outline
none`, border the accent.

### The stylesheet that stopped halfway — branch `universal/alpha-var`

From Xiao on 4600, Chrome, with the console: after opening Now Playing from
the bar and pressing its top-left return, the tag pills drew in black, the
playing row's title went dark, the "Filtered by" chips stacked, and the player
bar lost its slider. The sidebar and the rows stayed right.

- **Half the stylesheet was unparsed.** Unistyles keeps every rule in one
  `<style id="unistyles-web">`. In Xiao's tab it held 375 rule texts and Chrome
  had parsed 191; the 183 dropped were exactly the elements gone wrong. The
  text around the first dropped rule showed why:
  `background-color:var(--c1a;` — an unclosed `var(`, which the CSS parser
  cannot recover from, so every rule after it in the sheet is discarded. That
  is `IconButton`'s `pressed` style, `withAlpha(theme.colors.textPrimary, 0.1)`:
  in a browser a stylesheet's `theme.colors.x` is `var(--colors-x)` (Unistyles
  writes the themes as CSS variables), and `withAlpha` sliced seven characters
  and appended an alpha byte. On a phone the theme is hex, so it was right
  there. `withAlpha` now leaves anything but a `#rrggbb` whole and returns
  `color-mix(in srgb, <colour> N%, transparent)`, which follows the theme as
  the variable does. `Sheet`'s `${theme.colors.danger}1f` had the same shape
  (balanced, so only its own declaration was lost) and uses `withAlpha` too.
  Colours from `useUnistyles().theme` in JSX are real hex and were fine.
- **Why it looked like the styles were "lost after closing Now Playing".** The
  bad rule is written the moment any `IconButton` is pressed — the return
  button is one — and before `universal/keep-styles` it was deleted again a
  microtask after the press ended, so the breakage was a flicker. The
  keep-styles port made every rule permanent, so the bad rule stayed and the
  page stayed broken. The port also let the sheet grow without bound (the
  slider writes a new rule per frame; 4,000 rules and 550 KB after four minutes
  of playing, rewritten in full on every addition, with a listener kept for
  each). Its mechanism — a rule deleted from under a mounted element — was
  never observed and needs an element that is mounted but not in the document,
  which React does not produce. The port is removed.
- Checked: `withAlpha` unit tests for a hex and a `var()`; the app typechecks.

### The bar's volume fader, no lyrics mic, captions over their controls — branch `universal/bar-tweaks`

From Xiao on 4600:

1. **Volume, vertical.** In the compact bar `VolumeControl` opens a 60-wide
   popover holding the percentage, `VolumeSlider vertical`, and mute. Upright,
   the slider measures its height, reads `1 - locationY / height` (its track,
   fill and handle take no touches, as `SeekBar` learned), and draws a 6-wide
   track filling from the bottom with a 14px handle. Checked: 32×128, a drag
   to the middle reads 50%.
2. **The bar's "Close" caption over the cover.** `TooltipHost` places a caption
   over a `[data-tip-target]` inside its control when there is one; the player
   bar's song button marks its cover with `tipTarget()` (ui/tip.ts). Checked:
   caption centre 45, cover centre 45.
3. **"Close"** as the stage chevron's caption (`caption`; the label stays
   "Close now playing" for screen readers and the flows).
4. **"Lyrics"** as the caption of the page's lyrics-only button.
5. **No mic in the player bar**; `toggleLyrics` is gone. The Now Playing flow
   uses the page's "Show only the words" button instead. The phone's Now Playing
   keeps its Lyrics action.
6. **A pointer over the scrubber** (`cursor: 'pointer'` on its hit area) and
   the volume slider. Checked: the seek slider's computed cursor is `pointer`.
- **A second helper had the same flaw.** `hexAlpha` in the Now Playing model
  parsed bytes out of the theme colour and, on the web, wrote
  `rgba(NaN, NaN, NaN, a)` — balanced, so only the veil vanished (the stage's
  tab pill, its pressed states, the queue backdrop). It is gone; the stage and
  the lyrics use `withAlpha`, which also spells out a `#rgb` before adding its
  byte. The seek bar's loop overlay and the chart tracks stopped appending a
  hex byte to a colour too, and the tracks are themed styles rather than a
  string built per row.

### No scrollbars, a Shuffle-only head, value pills, playlist tiles, a status line — branch `claude/scrollbar-uiux-review`

From Xiao's review of the proposals at
https://claude.ai/code/artifact/588c66b3-4155-4099-860d-b75b3e95f44f (B, D, E, F
agreed or amended; C declined; A sent back for more options).

- **No scrollbars in a browser.** `src/ports/scrollbars.web.ts` adds
  `scrollbar-width: none` and the WebKit pseudo-element rule once, before the
  first paint (called from `app/_layout.tsx`); the native twin is a no-op.
  Checked at 1370×760: the library list overflows with no gutter.
- **Library head (B).** The Play button is gone; Shuffle stays. A row click
  already plays the list from there.
- **Value pills (D).** `PlayerBar`'s speed and sleep buttons become a pill in
  the song's colour saying "1.25×" / "32 min" while they differ from normal
  (`ValuePill`, `useSleepMinutesLeft` in `SleepMenu`). The tag button's count
  badge is removed. Phone: Now Playing's Sleep action reads the minutes left.
- **Playlist tiles (E).** `PlaylistsScreen` draws tiles: a 2×2 mosaic of the
  first four songs with art (one cover when fewer, a dashed tile when empty),
  a "Smart"/"Built in" badge, a play button over the covers (on hover with a
  mouse), the pin star beside the name. At least 176 wide at desktop width,
  two across on a phone. Song ids come from `usePlaylistSongIds`, the query the
  playlist page already reads. Descriptions stay on the playlist page.
- **Sidebar status line (F).** The foot is one pressable line — "Connected to
  your Mac" / "Connecting…" / "Can't reach your Mac" with a coloured dot, and
  "13 songs · none saved offline" — opening Settings. Rescan left the sidebar;
  it is in Settings and ⌘K ("Rescan library folder", not for a cloud library).
- Checked: typecheck (only the existing `react-dom` types error), lint,
  palette/playlists vitest, `export:web`, and Chrome at 1370×800 and 375×812
  on a private server with the dev profile.

### Report, not Wrapped; the library search's focus; charts in the accent — same branch

From Xiao on the branch build:

- **"Report".** The Stats button, the report's heading, its range control's
  label and its empty state say Report. The route was already `/stats/report`.
- **Library search focus.** The box's border turns the accent, and the search
  icon with it; the input has `outlineStyle: 'none'` on the web, as the tag
  picker's does, so Chrome no longer draws its own ring inside the box.
- **Charts follow the accent.** `chartSeries` was a fixed blue (`#3987e5` dark,
  `#2a78d6` light), so a green accent kept blue stats bars and a blue wash behind
  the report's ranked rows. It is now `oklch(0.62 0.15 h)` dark and
  `oklch(0.55 0.16 h)` light, in `tokens.ts` and `tokens.reference.css`, with the
  parity tests reading it as an oklch token like the rest.
- The report's hero card is hard to read over a pale cover; options are mocked
  at https://claude.ai/code/artifact/3d96c5a5-b82e-4783-8188-6e1f111a5c49 and
  not built yet.

### What a phone shows when its Mac is gone; the report's hero on solid ground — same branch

Xiao killed and relaunched the phone app and saw grey covers, playlist tiles
saying "5 songs · 19 min" over "No songs yet", and a playlist page with a
spinner and "0 songs". The app was pointed at `http://localhost:4600`, and
nothing was listening there any more (its last successful library fetch was
20:40; the relaunch was 21:04). So the library came from `Documents/library.json`
and everything the library does not carry — covers, a playlist's song ids,
stats — failed. The app told none of this truthfully:

- **`useLibrary` hid the failure.** Its queryFn returned the cached copy as if
  the server had answered, so `isError` was never true with data on screen;
  Settings' "Unreachable — showing the cached copy" could not show and the new
  sidebar status line would have said "Connected". It now puts the copy in the
  cache with `setQueryData` and throws, so a screen has `data` to draw and
  `isError` to explain. Settings' Library row and the status line read it.
- **`Cover` falls back** to its letter tile when the image fails to load (a
  new `radius` prop lets a mosaic square it off).
- **Playlist tiles** with `songCount > 0` but no ids show a plain cover, not
  "No songs yet"; the mosaic is made of `Cover`s. A phone's tile width comes
  from the window, so tiles no longer flash at 176 before the grid is measured.
- **Playlist page** shows "Can't reach your library · N songs are in here, but
  the list lives on your server" with a Try again, instead of a spinner then
  "Nothing here yet"; its count comes from the library while the list loads.
- **Its back control** is one pressable "‹ Playlists", not a 44-point icon
  button with the word tucked under it.
- **Report hero (R1).** No blurred cover behind the text: the figure with an
  accent rule under it, neutral trait chips (accent only in the sparkle), the
  facts in a column with a hairline, and the number one drawn sharp in a
  column of its own (a row across the top on a phone). Chapter 01 lists the
  number one like the rest. Checked with Playwright in a green accent at 1370
  and 390 wide.
- Not an app bug: "Stats need your library" seen in the desktop app's browser
  pane was React Query paused by an `offline` event that pane fires; a real
  Chrome, and `window.dispatchEvent(new Event('online'))`, load it.
- Also not an app bug: the "Refreshing…" banner on the phone was Expo's fast
  refresh, because the phone was loading from this worktree's Metro (8083)
  while files here were being edited.

### A phone keeps its covers and its playlists — same branch

Xiao, on the same relaunch: the thumbnails should be stored the way the song
names are, and a playlist should still list its songs when the Mac is away,
with the ones not on the phone greyed. Done:

- **Covers kept on the device.** `offline/covers.ts` gains a `covers/`
  directory under Documents (beside `songs/`), named `<id>-<rev>.jpg`.
  `useArt` asks `ensureServerCover` for every Mac-served song and draws the
  kept file once there is one; `downloadStorage` fetches the cover the moment a
  song's download finishes. The work starts on a timeout, because it is called
  during a row's render and a cover found on disk announced itself into other
  lists mid-render. A Mac that is away is asked once per launch per song.
- **Playlists kept on the device.** `PlaylistSnapshotStore` in
  `packages/client` (file per playlist on the phone, IndexedDB record in a
  browser), written after every successful `/api/playlists/:id/songs`, read
  when one fails — into the cache with the error still thrown, as the library
  is. `usePlaylistSongs` and `usePlaylistSongIds` share `fetchPlaylistSongs`.
  Signing out forgets them with the library.
- **Greyed rows.** `SongRow` and `PlaylistSongRow` take `unavailable`: the
  server is unreachable (`library.isError`) and the song is not downloaded.
  The library model exposes `unreachable` for it.
- Checked on the Pro Max: a temporary server on 4600 filled `Documents/covers`
  (13) and `Documents/playlists` (2); with it killed and the app relaunched,
  the library and the tiles show art and "Reference — evening" lists its five
  songs. Every song is downloaded there, so no row was greyed.

### Covers from the first frame, a softer pull-down, and lyrics kept — same branch

Xiao, on the phone: covers flashed the letter tile for half a second at
launch; pulling Now Playing down showed a torn white edge above the page; and
lyrics that the web showed said "No lyrics for this one" on the phone.

- **Covers from the first frame.** `offline/covers.ts` reads `Documents/covers`
  once, before the first row asks (`prime()`), so `coversNow()` already holds
  every kept file and `useArt` draws it in the first render. The flash was the
  Mac's address (or the letter tile) being drawn and the file swapped in a
  moment later.
- **The pull-down.** The page no longer follows the finger 1:1; it gives up to
  150 points over a 600-point pull, and past the threshold the modal's own
  slide — the one the chevron plays — puts it away. `Stack.Screen` sets the
  screen's `contentStyle` to the song's colour, so what shows above the page
  during the give is the same colour, not the frame's white.
- **Lyrics kept.** Not a phone bug: the server was down when the screenshot
  was taken, and the phone said "No lyrics" for "could not ask". Now
  `LyricsSnapshotStore` (file per song on the phone, IndexedDB in a browser)
  keeps every successful answer and every downloaded song's words, and
  `useLyrics` reads it only when the server is unreachable — a 404 stays a
  404. The phone's status line says "Lyrics need your library" when it is
  offline with nothing kept, as the web's does.
- Checked on the Pro Max with 4600 up then killed: covers everywhere on a cold
  launch, and もう少しだけ's synced lyrics with romaji from the kept file.

### The catch-up pass — same branch

Xiao: "if we can play the music, the lyrics should exist already". They did
not for songs downloaded before the app kept lyrics, or never scrolled to.
`offline/useKeepAlongside.ts`, mounted in the shell, runs once per library
answer while the server is answering: for every downloaded song it asks for
the cover (Mac or bucket path) and, when no words are kept, the lyrics — one
song at a time, a 404 skipped. Checked on the Pro Max: 13 of 13 covers and
lyrics kept after one launch against 4600; with 4600 killed, a song never
opened before shows its synced lyrics from the kept file.

### What a device keeps, settled — same branch

Xiao's model, agreed with two amendments: covers and playlists are metadata
and are kept for every song and playlist, downloaded or not; words are part
of a download.

- `useKeepAlongside` now keeps every song's cover and every playlist's members
  (not only downloaded songs'), plus the words of every downloaded song, one
  request at a time after each library answer.
- `downloadStorage` fetches a song's words *before* its file, and a download
  is not a download without them: a 404 or `instrumental` is fine, the server
  not answering fails the transfer before any bytes, so the queue retries later.
- Not done: covers ride in their own requests, not in `/api/library` — a
  library of thousands would make that payload tens of megabytes. The server
  serves art at full size; a thumbnail size on `/api/art` would make "keep every
  cover" cheap for a big library and is worth adding.
- Checked on the Pro Max: with kept playlists deleted, one launch against
  4600 brought back 3 of 3 playlists, 13 covers, 13 lyrics.

### Covers at a size — same branch

`GET /api/art/:id?size=N` answers with a square JPEG at the smallest of 160,
320, 640 or 1024 that is not smaller than N (never enlarged), made with
`sharp` once and kept in `data/covers/thumbs/<id>-<size>-<mtime>.jpg`; absent
`size`, the original as before. `createMediaUrl().art` takes the size. The
phone keeps every cover at 640 (`KEPT_COVER_SIZE`): a 600px original came
back as 27 KB against 64 KB, so a library of thousands is a few hundred MB at
most rather than a gigabyte. `sharp` is a native dependency; npm records its
platform packages in the lockfile, but the Docker image (Alpine) has not been
rebuilt with it here.

### The position out of the player context — same branch

Xiao: the phone feels laggy. The one thing in the code that explained it:
`PlayerApi` carried `position` and `duration`, and the engine reports progress
once a second (`progressUpdateEventInterval: 1`), so every `usePlayer()`
consumer — the library screen and, through its `renderSong` closure, every
visible row; the playlist page; the gems row; the song menu — was redrawn
once a second while anything played. `usePlayerProgress()` now carries the
two on a context of their own; `usePlayer()`'s value no longer changes on a
tick. Readers moved: the mini player's wash, the bars' scrubbers, the synced
lyrics, Now Playing's up-next arithmetic, the devices heartbeat and the
playback memory (the last two through refs, so their timers are not remade
each second). Covers arriving from disk are announced once per frame rather
than once each. Checked: typecheck, lint, 159 app tests, a cold launch on the
Pro Max.

Not code: the dev client runs an unminified debug bundle with dev-mode checks
and the Fast Refresh runtime; a release build is the honest measure of feel.
Also seen twice: after a run of Fast Refreshes, the *first* cold relaunch from
Metro can fail at module load with "Unistyles was loaded, but it's not
configured"; the next relaunch is clean. A Metro delta artefact, not a cycle —
`index.ts` configures Unistyles before `expo-router/entry`.

### Romaji travels with the lyrics — same branch

Xiao: romaji on the phone needed a connection. It was a second request,
`/lyrics/romanized`, made every time the words were shown, and kept nowhere.

- `LyricsResponse.romanized: string[] | null` — a romanized line per line of
  `text`, null for words that are not Chinese or Japanese. Made once per text
  (`services/romanizedLines.ts`, cached under the text's hash in the lyrics
  cache as the old route did) when the words are resolved, fetched or saved
  by hand, and for the whole library after boot (`romanizeLibrary`, behind
  the index backfill). The old route still answers.
- `useSongWords` reads `lyrics.data.romanized`; the romanized query is gone.
  The romaji switch only decides whether the line is drawn.
- Because the words are kept on the device with the response, romaji is kept
  with them: on view, on download, in the catch-up pass.
- Checked: a private server answers `/songs/13/lyrics` with 66 romanized
  lines; the Pro Max's 13 kept lyrics files carry them; with 4600 killed,
  もう少しだけ shows romaji under each line.
- The cloud route (`packages/cloud/src/routes.ts`) serves lyrics from the
  bucket without this field; a bucket library still shows no romaji.
- The romaji switch is a synced server setting; away from the server the
  settings query has no answer and the switch read as off, so kept romaji
  went unseen. `romanizationPref.ts`: the shell mirrors the last heard value
  into `prefs` (`lyricsRomanization`) from the first frame, and the words read
  it back when the query is empty. Checked on the Pro Max with 4600 killed:
  三原色 shows romaji under each line.

### The romaji switch belongs to the device — same branch

Xiao: romaji is always downloaded with the lyrics; the switch should only
decide whether it is drawn. So it is a device preference now
(`romanizationPref.ts`: a small external store over `prefs`), flipped at once
by the page's pill or Settings › Lyrics ("on this device"), with no server
round-trip, so it works offline. A device that never chose starts from the
server's old synced `lyricsRomanization` once (`useRomanizationSeed` in the
shell); after that its own choice is the only one. The server setting stays
in the schema for that seed and for older clients.

### The stage in the last song's light — branch `universal/stage-first-frame`

From Xiao on 4600, with a recording: open Now Playing for a song after another
had been on, and for a frame or two the page glows in the wrong colours before
settling into the cover's.

- **The palette was read after the page was up.** `useCoverPalette` samples
  the cover on a canvas, asynchronously, and until the read lands the page
  glowed in `placeholderPalette(song.id)` — a hue from the id, nothing to do
  with the cover. The read takes a frame or two, which is the flash. Two
  changes: the player bar calls `warmCoverPalette` as a song starts, so by the
  time Now Playing opens the palette is usually already known; and while it is
  not, the page glows in `tonePalette(song.coverTone)`, built from the tone the
  server sends with the song, so the first frame is already the cover's hue
  and the sampled colours only move the shades. A song with no tone keeps the
  letter-tile hue as before. One read at a time per cover: the bar's warming
  and the stage's own request share it.
- **The phone's dark frame on relaunch is the dev launcher, not the app.** The
  screenshot is expo-dev-launcher's home ("Development Build", recently opened
  servers), which a development build shows while it fetches the last-opened
  bundle from Metro — its default already is to relaunch the last project. A
  release build embeds the bundle and never shows it. Nothing to change here.

### Playlists: three ways to make one, pinned in the sidebar — branch `claude/playlist-ui-ux-redesign-d378d7`

From Xiao's review of the lettered mocks (A1, B1, C2, D2, E1, F2, G1; H dropped):

1. **Three kinds in one New menu** (`features/playlists/NewPlaylist.tsx`): a
   *playlist* you fill; a *smart playlist*, which is a way of making one — a
   template (`templates.model.ts`: Most played, Forgotten gems, Short ones, Long
   songs, Recently added, Loved, By tag) picks the songs once, you untick any,
   and what is made is a manual playlist whose description says how; and a
   *live playlist*, which follows rules and updates itself. The sidebar's ＋,
   the page's New and the phone's ＋ all open it. "Describe it" (AI) is shown
   as coming later.
2. **`kind` is `'manual' | 'live'`** everywhere: schema, server, bucket, sync
   log, cloud edits. The migration "playlists: live instead of smart, and when
   each was last played" rebuilds the table (SQLite cannot change a CHECK) with
   foreign keys off for the rebuild — the runner's new `rebuildsTable` — and
   checks them before committing. No compatibility for `'smart'` elsewhere:
   nothing had been released. `SmartRules` keeps its name; templates use rule
   sets too.
3. **Recently played.** `playlists.last_played_at`, set by
   `POST /api/playlists/:id/played` (no library version bump) whenever a
   playlist is started by Play, Shuffle, a row or a tile's play
   (`usePlaylistPlayback`). The page sorts by it by default (A–Z and Recently
   added are the others, remembered in prefs); making a playlist counts as its
   first play.
4. **Sidebar.** The Playlists nav item is now a section: pinned playlists
   (cover, name, a live mark), "Show all" (`nav-playlists`), and ＋. Songs
   dragged from library rows at desktop width drop onto a pinned playlist
   (`ports/songDrag.web.ts`, the browser's own drag and drop; nothing on a
   phone); a live one dims during the drag. Pin and unpin are in a playlist's ⋯.
5. **Playlists page.** Tiles wear the covers of their first songs
   (`PlaylistCover`), with a Live badge and a pin mark; pinned playlists stay in
   the grid. On a phone, a row of pinned playlists above "All playlists".
6. **A playlist.** Cover, name (click to rename with a mouse), description,
   length; a round Play, Shuffle, keep offline (installed app), ⋯ (play next,
   add to queue, edit rules and save a copy for a live one, pin, rename,
   description, duplicate, delete), and Add songs — a search that adds without
   closing (`AddSongsSheet`). Rows at desktop width keep grip and number and
   show ⋯ and ✕ on hover; on a phone a row is cover, title, length and ⋯, and
   holding it lifts it to be dragged into place (the song menu, which holding
   used to open, has "Remove from this playlist").
7. **Live rules** read back as a sentence (`RulesSummary`, `describeRule`,
   `describeOrder`) and are edited in a side panel beside the songs, or a sheet
   on a phone (`RulesEditor`). Lengths are typed and shown as m:ss. The raw
   server description (`duration > 210`) is gone.
8. **Selection bar** gets "New playlist with N songs", which opens the new
   playlist with its name ready to type. Every "Add to playlist" list shows
   pinned playlists first and never a live one.
9. **No browser focus ring on text fields.** A focused field wore the
   browser's own ring — on a Mac two-tone, in the system accent (orange and
   white on this dark app), and a second box inside the library's search.
   `shell/FocusStyle.web.tsx`, mounted once in the shell, turns it off for text
   fields and draws focus in the accent instead: a field with a border takes
   the accent as its border; a box that is the visible field around a
   borderless input is marked `focusWithin()` (`ui/focusRing.ts`) and takes it
   while the input has focus. Checked on the library search, the import box,
   renaming a playlist and Add songs: outline `none`, accent border.

---

# Desktop

A second log, against [`docs/DESKTOP.md`](DESKTOP.md): the installed Mac app,
and the iPad finished. Same rules as above — newest phase last, one branch per
phase, a commit only on a green gate. Times are UTC on 2026-09-14.

This run is on Linux in a container, not on the Mac. That decides a great deal
of what follows, so it is worth saying once here rather than in every section:
there is no macOS, no Xcode, no simulator, no Maestro, and no thirteen-song dev
library in `~/Music/selfmp3-dev`. Node 22.22, Chromium and Playwright are here.
So `npm run check` — typecheck, lint, 1000-odd tests, and the app's own
check — is a real gate and was run at every commit; anything that needs a Mac
window, a code-signing identity, a simulator or seeded audio is written down as
a block with exactly what is needed, and the run moves to the next thing.

## Phase 0 — the decisions written down — branch `desktop/phase-0`

Three documents, no code.

- **`docs/UNIVERSAL.md` Stack table** gains six rows: the Electron shell,
  electron-builder, electron-updater, `packages/desktop-bridge`, the media
  session port and the Electron tests. The rule is that a dependency exists
  only once it has a Stack line, so these are the lines phases 2 to 5 spend.
- **`docs/features/desktop-app.md`** is the user-facing note, with the "Where"
  line the plan asks for and the pointer to `DESKTOP.md` for the reasoning.
- **This section**, which each phase below writes into.

**Versions, pinned from `npm view` on 2026-09-14**, since `DESKTOP.md` says the
spike pins what the day offers and the Stack table records it:

| Package | Pinned | `DESKTOP.md` said |
|---|---|---|
| `electron` | 44.3.0 | 44.3.0 — unchanged |
| `electron-builder` | 26.15.3 | 26.16.1 |
| `electron-updater` | 6.8.9 | 6 |
| `esbuild` | 0.28.2 | — (already in the tree for the service worker) |
| `electron-playwright-helpers` | 3.1.2 | 3.1 |

The one difference worth noting is `electron-builder`: the plan was written
against 26.16.1 and the registry's latest on the day is **26.15.3**. A version
the registry has never published is not a version to pin, so 26.15.3 is what
the Stack line and `apps/desktop/package.json` carry. Nothing in the plan
depends on anything between the two.

`zod` needs no line: the repository is already on `^3.24.1` (3.25.76 resolved),
and `packages/desktop-bridge` uses the same one every other package does.

## Phase 1 — the spike — branch `desktop/spike`

All six checks pass. **Checks 1 and 2 are the ones the plan says decide whether
there is a desktop app at all, and both pass**, so the rest is engineering.

Every check is a script under `apps/desktop/verify/spike/` that exits non-zero
on failure; `node apps/desktop/verify/spike/all.mjs` runs the set. They ran
under `xvfb-run` with Electron 44.3.0, on Linux.

| Check | Verdict | What ran, and what could not |
|---|---|---|
| 1 — the export under `app://` | **pass** | The real `apps/app/dist` in a 1280×800 window: 41 nodes mounted, "self.mp3 — Your music, from the bucket…" drawn, a secure context with IndexedDB, no console error. `app://selfmp3/playlist/1` loads and the router takes it — and *redirects to `/sign-in`*, which is the app's own guard, not a routing failure; a reload comes back to the same place. |
| 2 — the engine from `app://` | **pass** | The repository's own `apps/app/src/ports/engine.web.ts`, bundled by esbuild and driven directly — not a copy of it. It imports only types from `@selfmp3/client`, which is what makes that possible, and is why this result is worth something. Plays cold with no gesture, seeks across a range boundary (`bytes=19038208-` answered 206), crossfades into the second file, analyser peak bin 229, rate 1.25 with pitch lock. `canPlayType` answers **"probably"** for both AAC (`mp4a.40.2`) and MP3, so the proprietary-codec worry is retired. |
| 3 — Now Playing | **pass (API half)** | Metadata with two artwork sizes, all six action handlers registered, `setPositionState` accepted, `playbackState` reads back, and Electron leaves `HardwareMediaKeyHandling` on. The half that matters to a person — the Control Center panel, its artwork, a real media key — is macOS and a finger. `node apps/desktop/verify/spike/3-now-playing.mjs --interactive` on the Mac holds the window up for 60 seconds waiting for the key. |
| 4 — the deep link | **pass (the cross-platform half)** | The first launch takes the single-instance lock; a second launch carrying `selfmp3://sign-in#signin-code=TEST-CODE` hands it over and exits rather than opening a second window; a cold launch finds the URL in its own argv. `open-url` — the macOS delivery — is wired and unexercised, and `setAsDefaultProtocolClient` answers false here because Linux claims a scheme through `xdg-settings` and a `.desktop` entry that this container has neither of. macOS registers from the bundle through LaunchServices and needs none of it. |
| 5 — the keychain | **pass (the contract)** | Seal → write `userData/secrets.json` → **quit** → relaunch → open again, which is the part a token surviving a quit depends on. The strength is *not* checked here: with no secret service, `isEncryptionAvailable()` is false until `setUsePlainTextEncryption(true)`, so this container ran a plain-text store. On the Mac that same call is the login keychain. |
| 6 — resume | **pass** | Cut off at 43% of 6 MB, resumed with `Range: bytes=2682087-`, answered `206 bytes 2682087-6291455/6291456`, appended, renamed, and the SHA-256 matches the original byte for byte. It refuses to append to a 200, which is the way this goes wrong quietly. Against a local range server rather than the dev server's `/api/stream/<id>`, there being no dev library here. |

### What check 2 turned up on the way, which is not a desktop problem

**`engine.web.ts` reports `playing: false` after a crossfade, while the music
is audibly playing.** The state trace is
`play/ready@118.60 → pause/ready@120.00`, and the next song went on and kept
going: song 2 at t=1.6 and climbing, with `state.playing` false.

The cause is a race the HTML spec guarantees. When a media element reaches the
end of its resource the user agent *sets `paused` to true and fires `pause`*,
then fires `ended`. The crossfade starts when `timeupdate` says the remaining
time is under the fade length — and `timeupdate` only fires about four times a
second, so the fade reliably finishes a beat *after* the outgoing element has
ended. By then `#onPause` has already set `playing: false`; `#onEnded` is
correctly ignored (the handover is armed), `#swap()` promotes the element that
is already playing, and nothing sets the flag back.

So it fires on nearly every crossfade, and it is invisible today only because
crossfade is off by default. It is a one-line fix in `#swap()` and it is
**deliberately not made on this branch**: the spike is thrown away, and the
first phase that has a reason to own it is phase 4, where this same flag drives
the Now Playing panel's play/pause button. Written down here so it is not
rediscovered.

### Two notes on how the spike ran

- **Electron was installed with `--no-save`**, so this branch's `package.json`
  does not mention it; `apps/desktop/package.json` in phase 2 is where it is
  declared properly. Its own `postinstall` had to be run by hand, because npm
  11 does not run install scripts without approval.
- **Chromium refuses its sandbox as root**, which this container is and a Mac
  is not, so the runner passes `--no-sandbox`. That is a fact about where the
  checks ran and never something the shipped shell asks for.
- `eslint.config.js` ignores `apps/desktop/verify/spike/**`: throwaway `.mjs`
  and `.cjs` outside every tsconfig, which the type-aware parser has no project
  to resolve. The ignore goes away with the branch.

## Phase 2 — the shell, signing in, playing — branch `desktop/phase-2`

`npm run check` green (128 test files, the app's own check too), the shell
packaged, and the smoke run against the packaged app.

### What exists now

**`packages/desktop-bridge`** — the contract, in the root project graph and the
root vitest like any other package.

- `channels.ts`: every name that crosses the preload boundary, one constant
  each, so a rename is a compile error rather than a channel that quietly
  answers nothing.
- `schemas.ts`: zod for each message and reply. Parsed on the *receiving* side,
  both ways: the renderer is a web page, and if it is ever the thing that goes
  wrong, the main process is the half with a filesystem and a keychain.
- `bridge.ts`: `DesktopBridge`, the shape of `window.selfmp3Desktop`.
  **Deliberately smaller than the plan's table**: `files` and `mediaUrl` (phase
  3), `loginItem` and `updates` (phases 4 and 5) are *not* members yet, though
  their channels and schemas are here, because a member of that interface is a
  promise that something answers it. A bridge that declares what it cannot do is
  worse than one that grows.
- `menu.ts`: the application menu as data, with `pageCombinations` translating
  an Electron accelerator into the spelling `useHotkeys` builds from a
  `KeyboardEvent`. Eleven tests: no accelerator twice, no command twice, every
  command in the contract.

**`apps/desktop`** — the shell. `src/main/` is `main.ts` (single instance, the
deep-link paths, lifecycle), `protocol.ts` (`app://selfmp3/`), `window.ts`,
`menu.ts`, `secrets.ts`, `ipc.ts`, `paths.ts` and `deepLinks.ts`;
`src/preload/preload.ts` is the only door. `scripts/build.mjs` bundles main and
preload with esbuild — CommonJS, `electron` the only external — and copies
`apps/app/dist` in beside them. `scripts/dev.mjs` points the window at Metro on
4601.

The pure modules are tested in the root vitest, which is the point of splitting
them out: `paths.ts` (27 assertions about what may be read off disk in answer to
a page's request — `..`, an escaped `..`, a null byte, a sibling directory whose
name starts with the root's), `secrets.ts`'s document shape, `deepLinks.ts`'s
argv picking and its queue.

**`apps/app`** — four ports gained a desktop branch, and only ports did.
`ports/desktop/bridge.web.ts` is the one file that reads
`window.selfmp3Desktop`; `bridge.ts` beside it is the native half and answers
`null`, so a phone bundle never carries the contract package to be told so.

| Port | What changed |
|---|---|
| `secrets.web.ts` | `desktop.secrets` — the keychain — instead of `localStorage` |
| `device.web.ts` | the machine's own name and kind `desktop`, rather than "Mac · Chrome" from a user agent |
| `cloudPlatform.web.ts` | `returnUrl` is `selfmp3://sign-in` and `openSignIn` opens the person's own browser |
| `signInReturn.web.ts` | the code comes from the deep link rather than `location.hash` |
| `serverAddress.ts` / `.web.ts` | **new**: `canConnectByAddress`, the capability Settings asks about |
| `shell/useCommands.ts` / `.web.ts` | **new**: menu items and media keys, as the page's handlers |
| `shell/useHotkeys.web.ts` | stands aside for combinations the menu owns |

**Settings › Connection** gains, on the installed desktop only, "Connect to a
server" with the onboarding screen's own two fields and its own two error
messages (a wrong address and a wrong token are different sentences, which is
what `/api/health` being unauthenticated buys), and "Use the cloud instead"
going the other way. Switching either way **removes what has been downloaded**,
after a confirmation that says why: a song's number belongs to whichever side
answered (`docs/SYNC.md`, "Identity"), so an index carried across would play the
wrong songs.

### Four things worth knowing

**The menu draws only its View section.** The model in the contract holds the
whole menu the plan settled, but Playback's items need a player the page has not
been wired to — that is phase 4, with the media session port. A menu item that
does nothing is worse than one that is not there, so `buildMenu` filters to what
the page answers today: the palette, the three places to go, the practice panel,
and Settings in the app menu.

**`safeStorage` now has the fallback the plan's risk table already specified.**
It was going to be needed anyway, and this container found it early: with no
secret service, `isEncryptionAvailable()` is false and `encryptString` throws, so
the first attempt to keep a token failed outright. Values now carry a tag — `k:`
sealed by the keychain, `p:` base64 and nothing more — and `info.secretsSealed`
tells the page which it got, so Settings can say so. An installed app that
cannot sign in at all is worse than one that makes the browser's promise.

**The page's `process` is not Node's.** The smoke asserts that nothing of Node
reaches the renderer, and the first version of that test failed: Metro's web
bundle defines a `process` shim of its own for `process.env.NODE_ENV`. The
assertion is now `process.versions?.electron` being undefined, which is the
question actually worth asking. `require` and `ipcRenderer` are undefined, as
they should be.

**`app://` needs no change to the export.** The absolute `/_expo/…` asset paths
resolve under the scheme unaltered, `index.html` is the answer for every route,
and the origin is stable across launches — which is what IndexedDB and every
kept preference depend on, and what a loopback server on a random port would
have lost.

### The gates

| Gate | Result |
|---|---|
| `npm run check` | **pass** — typecheck, lint, 128 test files, the app's own check |
| `npm run build:desktop` → a dmg | **blocked**: a dmg is macOS-only. What *did* run is `electron-builder --dir --linux` against the same `electron-builder.yml`, which packaged the app and reported "no node modules returned while searching directories" — the design working: esbuild bundles everything but `electron`, the shell has no runtime `dependencies`, and the workspace-hoisting problem (electron-builder #2205, #9654) has nothing to collect and so cannot bite. Xiao runs `npm run build:desktop` on the Mac for the dmg itself. |
| `npm run verify:desktop -- --grep "connects and plays"` | **skipped, and says so**: it needs a server with the thirteen-song library. Seven other smoke tests run, and — worth noting — **against the packaged app**, not the bundle: `launch.ts` prefers a binary under `release/` when one exists, and there was one. |
| Google sign-in through the system browser | **Xiao's.** An agent cannot sign in to Google. The deep-link half of the path was proved in spike 4 and the `open-url` delivery is wired and unexercised off macOS. |

## Phase 3 — files on disk — branch `desktop/phase-3`

The installed app now keeps music on disk the way the plan asked: the shell owns
the folder, the page asks for a file by name and gets a URL back, and the same
range rule answers both the server and the shell.

### What changed

**The range rule moved to `@selfmp3/shared`, and grew an answer.** `parseRange`
is unchanged, and `apps/server/src/http/range.ts` re-exports it so nothing that
imported it from there had to move. What is new is `answerRange`, which takes the
header and a file's size, mime, etag and date and returns the whole response
short of the bytes: status, the inclusive offsets, the length, and the headers.
The server's `sendRange` is now that plus streaming, the 304 and the
aborted-request handling; the shell's `serveMedia` is that plus a file handle.
Its tests moved with it — `packages/shared/src/range.test.ts`, 20 of them, run
once for both callers, which is what the gate is checking.

`net.fetch('file://…')` is the reason `answerRange` exists at all rather than a
handler leaning on Electron: it ignores `Range:` and answers 200 with the whole
file. A 206 in the shell has to be built by hand.

**`files.*` on the bridge.** `download` with resume, `cancel`, `delete`, `stat`,
`list`, `fetchTo`, `usage`, `reveal`, `clear`, and a `progress` event. Every one
of them goes through `fileNameSchema` — one flat segment, no `..`, no leading dot
— *and* through the `resolveWithinRoot` fence in `paths.ts`, because one check is
a check and two is a rule. The smoke asserts all four of `../secrets.json`,
`a/b.m4a`, `..` and `.hidden` are refused.

**A download is not a file until it is whole.** Bytes land in `<name>.part` and
the rename is the last thing that happens, so "the file exists" means "the file
is complete" everywhere else in the app — which is what the index, the player
and `stat` all quietly assume. A cancel leaves the `.part` and the next attempt
sends `Range: bytes=<what is there>-`. If the server answers 200 to that, it is
sending the whole file again, and appending it is how a download silently becomes
a file that plays for forty seconds and stops; the `.part` is thrown away and the
pass starts over instead.

**`downloadStorage.desktop.ts`** puts the existing download queue over that
bridge — the doorman's bearer token where the library is in the cloud, the Mac's
stream URL where it is not — and `downloadStorage.web.ts` picks it when the
bridge is there and keeps the Cache API when it is not. The index itself is a
JSON file in the same folder, read back through `app://` and written through a
`blob:` URL, so nothing about it depends on the Cache API either.

**Covers, through a `coverFiles` port.** This is the part of the phase that is
not just plumbing. Artwork cannot be fetched the way everything else is: an
`<img>` is handed a URL and given no chance to attach a header, and the doorman
reads the bearer header and nothing else. A phone solves this with
expo-file-system (`offline/covers.ts`); a browser cannot solve it at all, which
is why a cloud library's rows are letter tiles in a tab and always have been. The
installed app can: `files.fetchTo` sends the header, and
`app://selfmp3/_media/covers/…` serves the file back under a URL an `<img>` will
take. `offline/covers.web.ts` is the web twin of the phone's module, with the
same six exports, over that port — and with `coverFiles` null in an ordinary tab
every one of them becomes the nothing a browser already did, so no browser
behaviour changed.

**The rest of the phase's list**: `serviceWorker.web.ts` returns before
registering anything when the bridge is present (the shell is served from disk;
a worker would be a second, staler cache in front of it); `installedApp` is true
because `selfmp3Desktop` is on the window; `connectionKind` answers `'wifi'`
through a `meteredConnections` port rather than by looking at the platform, as
decided on 2026-09-12; Settings › Offline shows the folder, a "Reveal in Finder"
row, and storage numbers from `files.usage()` rather than from the index, because
the two can disagree and the disk is the one that is right. `PlayerProvider`
already preferred `downloadQueue.localUri` (`PlayerProvider.tsx:281`) — that path
needed confirming, not writing.

### Two things worth knowing

**A progress event can arrive after the download it belongs to has finished.**
The first version of the download test asserted that the last event the page had
seen matched the final byte count, and it failed: the page had seen one event of
six by the time `download` resolved. The reply to an `invoke` and the events from
`sender.send` are separate messages and do not queue behind each other. They do
all arrive, so the test waits for the tail rather than asserting on whatever
happened to have landed — and anything drawing a progress bar should expect the
same, which is why the last thing the page is told is also returned by the call.

**Cancelling needs something left to cancel.** The same test's sibling cancelled
on the first progress event and got `done`: three megabytes over loopback are
gone before an event has crossed back to the page. The test server now has a
`/slow/` route that dribbles the body out over about a second, and the cancel is
on a timer. Worth remembering for any later test of a transfer: loopback is not
a network.

### The gates

| Gate | Result |
|---|---|
| `npm run check` | **pass** — typecheck, lint, the full suite, the app's own check. The range rule's tests run once, in `packages/shared`. |
| `grep -rn "range" apps/server/src/http/range.ts \| grep -q "@selfmp3/shared"` | **pass** |
| `npm run verify:desktop -- --grep "downloads\|offline\|reveal"` | **pass** — 3 of them. The whole smoke is 12 passed, 1 skipped, against the packaged binary. |
| The by-hand smoke: 13 songs download themselves, quit, stop the server, relaunch, a song plays from disk, a cover shows | **blocked** — needs `~/Music/selfmp3-dev`, which this container does not have. What stands in for it: a local range server and three megabytes of random bytes, with the offline half done honestly — the server is closed mid-test, the page confirms the network is gone, and the file still comes back whole from `app://selfmp3/_media/…` with a matching SHA-256. The cover test does the same with a route that answers 401 without a bearer token. |
| The same, signed in to the cloud | **Xiao's.** |

## Phase 4 — being a Mac app — branch `desktop/phase-4`

The window stopped being a page in a frame. It has a menu with everything in it,
it tells macOS what is playing, it opens where it was left, it keeps the machine
awake while music is on, and the red button hides it instead of stopping the
music.

### What changed

**The menu draws all of it now**, and one thing about it is worth reading before
anyone changes it. Five of Playback's accelerators are drawn but not
*registered*: Space, ⌘← and ⌘→, ⌥⌘← and ⌥⌘→. A registered Electron accelerator
fires wherever the focus is, text fields included — so registering Space would
have taken the space bar out of the search box and the server-address field, and
⌘← is "go to the start of the line" in every Mac text field there has ever been.
They are in the menu because that is where a person learns their app has them,
and `useHotkeys` handles them as it handles every other key: not while someone is
typing. The model in `packages/desktop-bridge` carries a `pageKeeps` flag,
`menuOwnedCombinations()` excludes those, `pageKeptCombinations()` hands them to
the page, and a test asserts every accelerator belongs to exactly one of the two.

**Now Playing is `navigator.mediaSession`, not a bridge channel.** Chromium turns
the page's media session into macOS's Now Playing card and handles the media keys
itself, so a channel for it would have been a second, worse source of the same
facts — and one the browser would not share. What the shell has that the page has
not is `powerSaveBlocker` and the Dock, so `setPlaybackState` carries the song's
title and artist as well as whether it is playing, and the main process draws the
Dock menu (the song, then Play/Pause, Next, Previous) and holds the blocker.

`prevent-app-suspension`, not `prevent-display-sleep`: a music player that stops
the display sleeping is a laptop that is flat by lunchtime, and closing the lid
should still sleep the Mac, as it does with any player.

**The window remembers where it was**, in `userData/window.json`, debounced
because a drag fires `move` on every frame, and never while full-screen or
maximised — that frame is the display's, not the window's. The part worth the
test it has is the clamp: a window remembered on a monitor that is now unplugged
opens at coordinates no display covers, which on macOS is a window you cannot see
and cannot reach, and which looks exactly like an app that failed to start. A
remembered frame is used only if a strip of its top lands on a display that is
there now.

**`titleBarStyle: 'hiddenInset'`** is the one deliberate visual difference from
the browser, and the plan named it. The sidebar pads its top by
`info.titleBarInset` — a number from the shell, not a platform check, because a
browser tab's is zero — and renders a strip of exactly that height that the
window can be dragged by. `-webkit-app-region` is not a React Native style
property, so the rule is attached by id from the web port.

**Deep links grew a second kind.** `selfmp3://playlist/<id>` and
`selfmp3://now-playing` route inside the app. They needed the queue splitting in
two: the sign-in poller used to `shift()` the only queue there was, so any other
link that arrived while Settings was waiting for a code was taken by the poller
and thrown away. An id that is not a number is refused rather than handed to the
router — these links come from outside the app.

**Launch at login** is a Settings toggle in a new Desktop app section, which
appears only where there is a shell to ask. It reads back what the operating
system has rather than what was last set, because System Settings › General ›
Login Items can turn it off and a toggle that then still says "on" is one nobody
believes again.

### The engine bug from the spike is fixed

Spike 2 found, and recorded rather than hid, that `engine.web.ts` reported
`playing: false` after every crossfade. The outgoing element reaches its own end
and fires `pause` — which the HTML spec requires — a moment before the fade timer
swaps the elements, and nothing put the flag back: the incoming element started
playing *before* it was attached, so its `play` event had already been and gone.
The music was audibly playing and the bar showed a play button over it; pressing
that button paused the song.

Two lines, in the place the spike pointed at. A `pause` from the outgoing element
while a fade is running and the incoming one is playing is not a pause, and the
swap takes the flag from the element it just promoted rather than waiting for an
event that is not coming. The spike's own check now asserts it instead of noting
it, and passes.

### The gates

| Gate | Result |
|---|---|
| `npm run check` | **pass** — the menu model's tests among them: no duplicate accelerator, every command in the contract, and every accelerator owned by the menu or the page but never both. |
| `npm run verify:desktop -- --grep "command\|window bounds"` | **pass** — a real menu item, clicked in the main process, arrives at the page as its command; bounds set in one launch come back in the next. The whole smoke is 16 passed, 1 skipped. |
| By hand, once: media keys, Now Playing in Control Center with artwork, the Dock menu, hide and show, ⌘Q, full screen, the lid | **blocked, and this is the phase where that bites hardest.** None of it exists off macOS: `app.dock` is undefined on Linux, there is no Control Center, and no media keys to press. What did run here is everything underneath them — the menu is built and its items send their commands, the power-save blocker starts and stops with playback, the bounds survive a relaunch, and the page's media session is Chromium's own code path, the same one a browser runs. |

### For Xiao, when this is opened on a Mac

Four things this container could not see, in the order they are quickest to check:

1. Right-click the Dock icon while a song plays: the song's title and artist,
   then Pause, Next, Previous.
2. ⌘← and ⌘→ in the library's search box: the caret should move to the start and
   end of the line, not skip a track. Then the same keys with the list focused:
   they should skip.
3. The red button, then the Dock icon: the window comes back and the song never
   stopped. Then ⌘Q, which should actually quit.
4. Now Playing in Control Center: the title, the artist, and the artwork — the
   artwork is the one most likely to be missing, because a cover only has a URL
   the OS can fetch once it is on disk.

## Phase 5 — shipping — branch `desktop/phase-5`

The app can be built into something a person installs, and it can tell them when
there is a newer one. What it cannot do from here is prove the `.dmg`, because a
`.dmg` is macOS and this is Linux.

### What changed

**Two signing tiers, decided by the environment rather than by a flag.**
`scripts/dist.mjs` looks for `CSC_LINK` and `CSC_KEY_PASSWORD`: with them the
build is signed, and notarised as well when the `APPLE_API_*` variables are
there; without them it is ad-hoc signed (`--config.mac.identity=-`) with the two
extra entitlements V8 needs when the signature is not one macOS validates pages
against. Both are real tiers. The ad-hoc one is what Xiao builds on their own Mac
for their own Mac, and the release notes say the one thing it costs: Privacy &
Security › Open Anyway, once.

The script prints which tier it chose, because a build that looks signed and is
not is the failure worth preventing.

**The tier is baked into the bundle.** There is no API that asks a running
Electron app whether its own signature is one macOS would validate — and the
answer decides whether the updater may do anything at all, since Squirrel refuses
an update it cannot verify (electron #36640). So `dist.mjs` passes it to
`build.mjs`, which defines `__SELFMP3_SIGNED__`, and `canInstall` on the update
status follows from that plus `app.isPackaged`. Settings never draws a button
that would fail: an unsigned build's Updates row offers the release page instead.

**Updates are two code paths behind one channel.** A signed build hands the whole
thing to electron-updater. An unsigned one reads the latest release's tag from
the GitHub API and compares versions. The comparison and the tag parsing are in
`updates.rule.ts` with nothing of Electron in them, so the root vitest runs them:
they are exactly the kind of rule that nags on every launch or never mentions the
version that fixed someone's bug, and neither shows up in a manual test.

**The icon is rendered, not copied.** `scripts/icon.mjs` renders
`apps/app/public/icons/icon.svg` at 1024 with sharp — the version `apps/server`
already pins for cover art, so nothing new entered the repository — and
electron-builder makes the `.icns` and the `.ico` from that. A second copy of the
mark is a mark that drifts from the favicon, and generating the container formats
here would have needed macOS's `iconutil`, which no Linux runner has.

**`.github/workflows/desktop.yml`** runs on `workflow_dispatch` and on
`desktop-v*` tags, on `macos-latest`, and uses the signing secrets when they are
set. A dispatch run leaves its artifact and stops; only a tag makes a release,
and that release is a **draft** so nothing is published by a mistyped tag.
`latest-mac.yml` is attached beside the files, because that is what
electron-updater reads.

**Docs.** `INSTALL.md` gained "The Mac app", including the Open Anyway
instructions in plain words. `README.md` gained the two folders and a line under
"What it does". `ARCHITECTURE.md` gained the shape of both new folders and the
sentence that matters most: the desktop app is a shell, not a fourth client.

### One thing the plan did not foresee

`electron-builder` derives the executable name from the npm package name, and
`@selfmp3/desktop` becomes `@selfmp3desktop`, which an AppImage refuses outright:
"executableName contains characters that cannot be safely used in file paths".
Phase 2's packaging check never hit it because `--dir` skips the target that
cares. `executableName: selfmp3` at the top of the config fixes it. macOS never
sees it — there the binary inside the bundle is named from `productName` — so
this is a Linux-target fix in a config that does not build Linux by default, and
it is here because the one build this container *can* make is the one that found
it.

### The gates

| Gate | Result |
|---|---|
| `npm run check` | **pass** — the update rule's 7 tests among them. |
| `npm run build:desktop` → a dmg | **pass as far as this machine goes, blocked for the dmg itself.** The whole pipeline ran: the icon rendered, the packages and the web export built, `dist.mjs` chose the ad-hoc tier and said so, and electron-builder produced `self.mp3-1.0.0.AppImage` (121 MB) with `latest-linux.yml` beside it. A `.dmg` needs macOS. What this proves is everything up to the target: the config validates, the icon is accepted, the file list is right, and "no node modules returned while searching directories" confirms the no-runtime-dependencies design still holds. |
| `gh workflow run desktop.yml && gh run watch` | **blocked.** Dispatching a workflow is an action on Xiao's repository with their credentials, and the run would be a `macos-latest` runner building a release artifact. Written and not run. |
| A fake newer release on a fork, "Check for updates" says so | **blocked** for the same reason — it needs a fork and a release. What runs instead is a smoke test that an unsigned build answers the check with `canInstall: false`, which is the half that must never be wrong. |
| The signed tier | **Xiao's**, when there is a certificate. |

### For Xiao, on the Mac

1. `npm run build:desktop`. It should print `self.mp3 desktop: ad-hoc build` and
   leave a `.dmg` in `apps/desktop/release/`.
2. Mount it, drag to Applications, and open it — expect the Gatekeeper refusal,
   then Privacy & Security › Open Anyway.
3. To test it the way someone else would receive it, upload the `.dmg` somewhere
   and download it again through a browser first: that is what attaches the
   quarantine flag, and a file copied locally never has it.
4. `gh workflow run desktop.yml` when you want to see the runner do it.

## The run, end to end — 2026-09-14

Everything above was done in one pass, in a Linux container with no macOS, no
Xcode, no simulator and no `~/Music/selfmp3-dev`. That shaped what could be
proved and what could only be built; this is the honest accounting of which is
which.

### The branches

Stacked, each on the one before, so `desktop/phase-5` contains all of them and
reviewing that one branch is reviewing the whole desktop app. `ipad/phase-6` is
off `main` on its own, as the plan said it could be.

| Branch | Commit | What it is |
|---|---|---|
| `desktop/phase-0` | `7a7721d` | The decisions written down: the Stack rows, `docs/features/desktop-app.md`, the Desktop section here |
| `desktop/spike` | `2d98a27` | Six throwaway checks — all six pass |
| `desktop/phase-2` | `838106c` | The shell: window, `app://`, the bridge, the keychain, sign-in |
| `desktop/phase-3` | `df1e6da` | Files on disk, the shared range rule, covers through a port |
| `desktop/phase-4` | `301a012` | The menu, Now Playing, the Dock, window bounds, power, login item, deep links |
| `desktop/phase-5` | `5c36117` | Packaging, the two signing tiers, updates, the icon, the workflow, the docs |
| `ipad/phase-6` | `7fc4ef9` | The iPad's orientations and a width sweep |

Nothing is merged into `main`.

### Which gates passed, and on what

| Phase | Gate | Result |
|---|---|---|
| 0 | `npm run check` | pass |
| 1 | the six spike checks | **6 of 6 pass**, including the two the plan called decisive: `app://` with a working 206, and the real `engine.web.ts` playing and analysing through it |
| 2 | `npm run check`; `npm run build:desktop`; the smoke | check passes; packaging proved on Linux (`--dir`), the dmg is Xiao's; 7 smoke tests against the built shell |
| 3 | `npm run check`; the range-rule grep; `verify:desktop --grep "downloads\|offline\|reveal"` | all three pass |
| 4 | `npm run check`; `verify:desktop --grep "command\|window bounds"` | both pass |
| 5 | `npm run check`; `npm run build:desktop` | check passes; the build produced a signed-tier-aware AppImage with its icon — the dmg and the workflow run are Xiao's |
| 6 | `npm run check:app`; the width sweep; prebuild's Info.plist | pass; Maestro and rotation are Xiao's |

The desktop smoke is **17 passing, 1 skipped** at the end of phase 5. The one
skip is the flow that needs a server with the thirteen songs, and it says so
rather than pretending.

### What was checked, and how

Nothing here was taken on trust that could be run:

- **The range rule** has 20 tests in `packages/shared`, and both callers use it —
  the server's `sendRange` and the shell's `serveMedia`. The 206 the shell
  answers with is observed over `app://` from a real page, with the bytes hashed
  and compared.
- **A download** is proved by downloading three megabytes of random bytes from a
  local range server, cancelling it part-way, resuming from the `.part`, and
  hashing the result. Then the server is **closed** mid-test, the page confirms
  the network is gone, and the file still comes back whole from `app://`.
- **Covers** are proved against a route that answers 401 without a bearer token:
  the page cannot fetch it, the shell can, and the file comes back as an image
  from the app's own origin.
- **The menu** is clicked in the main process, by label, and the command is
  observed arriving at the page.
- **The power-save blocker** starts and stops with playback, read back from the
  main process.
- **The window's bounds** are set in one launch and read in the next.
- **The engine bug the spike found** — `playing: false` after a crossfade — is
  fixed, and the spike's own check now asserts it rather than noting it.
- **The update rule** has 7 tests with nothing of Electron in them.

### What is waiting on Xiao, and exactly what to do

In the order they are quickest:

1. **Build and open the dmg.** `npm run build:desktop` on the Mac. It should
   print `self.mp3 desktop: ad-hoc build` and leave a `.dmg` in
   `apps/desktop/release/`. Mount it, drag to Applications, open it: expect
   Gatekeeper's refusal, then Privacy & Security › Open Anyway. To see what
   someone else would get, upload it and download it again through a browser
   first — that is what attaches the quarantine flag.
2. **Sign in to Google.** Every cloud-mode check depends on it and an agent
   cannot do it. Settings › Cloud › Sign in opens your own browser and comes back
   by `selfmp3://`. The deep-link half of that path was proved in spike 4 and the
   `open-url` delivery is wired and unexercised off macOS.
3. **The Mac-only behaviour of phase 4**, in one sitting: right-click the Dock
   icon while a song plays; ⌘← in the search box (the caret should move, not the
   track); the red button then the Dock icon (the song should not have stopped);
   ⌘Q; full screen; the lid; Now Playing in Control Center, where the artwork is
   the thing most likely to be missing.
4. **Media keys.** Pressing one is yours, not mine.
5. **`gh workflow run desktop.yml`**, and watch it. Dispatching a workflow on
   your repository with your credentials is not something to do unasked.
6. **The signed tier**, when there is a certificate: set `CSC_LINK`,
   `CSC_KEY_PASSWORD` and the three `APPLE_API_*` secrets, and the same commit
   produces a signed, notarised build that can replace itself.
7. **The iPad's rotation and Split View**, with screenshots into the phase 6
   entry, and the Maestro smoke on an iPad Pro 11-inch simulator.
8. **The one question left open on 2026-09-12**: whether a phone signed in only
   to the cloud should see its other devices. Nothing in this run needed an
   answer, and nothing here assumes one.

### Deliberate differences from the plan, and why

- **The Playback menu's accelerators are drawn without being registered** for
  Space and the four ⌘-arrows. The plan listed the accelerators and did not say
  how they would be delivered; registering them would have taken the space bar
  out of every text field in the app. `pageKeeps` in the menu model is the
  mechanism, and a test asserts no key is claimed by both the menu and the page.
- **`covers.desktop.ts` became `offline/covers.web.ts` behind a `coverFiles`
  port.** The plan named a file; what the code needed was a web twin of the
  phone's covers module, because the existing one is expo-file-system from top to
  bottom. The port is what the plan asked for; the file it backs is the whole
  module rather than a desktop-only fragment, and a browser's behaviour is
  unchanged because the port is null there.
- **`answerRange` was added to the moved range helper.** The plan said to move
  the rule; moving `parseRange` alone would have left the shell to build a 206
  from it by hand, which is the duplication the move was for. `answerRange` is
  the response short of the bytes, and both callers use it.
- **`executableName: selfmp3`** is in the packaging config for a target that is
  not built by default. Without it the one build this container could make fails
  outright, and it costs macOS nothing.
- **The spike's files are still in the tree** (`apps/desktop/verify/spike/`),
  because check 2 is the fastest way to run the real audio engine end to end and
  it is what proved the crossfade fix. The plan called the branch throwaway; the
  checks turned out to be worth keeping.
- **A `Desktop app` section was added to Settings.** The plan asked for a
  launch-at-login toggle and for the version and update state to be shown, and
  there was nowhere they belonged. It appears only where there is a shell.

### What a Linux container turned out to be able to do

Worth recording, because the next agent will assume less than this:

- Electron runs under `xvfb-run` with `--no-sandbox` (a fact about running as
  root, never something the shipped app asks for).
- The real `engine.web.ts` bundles standalone and plays audio, which is what made
  the spike meaningful rather than theatrical.
- Playwright drives the built shell, and `app.evaluate` reads the main process —
  so a 206, a menu item, a power blocker and a window frame are all observed
  rather than inferred.
- electron-builder packages the app completely, icon and all.
- `expo prebuild --platform ios` completes with no Xcode, which is how phase 6's
  Info.plist gate ran.

What it could not do is anything with a Mac's name on it: a dmg, a keychain, a
Dock, a media key, Control Center, a simulator, or a Google sign-in.

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

The reference library capture now runs to the end at 1280 and at 375: all
seven library states at each width.

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
- **Desktop rows are owed.** At 1280 the web's row has an index, tempo and
  energy, an album column and tag chips, with the heart and ⋯ revealed on
  hover. The new app still draws the phone's row at every width.

---

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
  when the work starts.

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

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

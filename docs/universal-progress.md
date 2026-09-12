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
| `npx playwright test verify/flows --project=desktop --project=phone` | **not run** — written, 18 tests, collects at both widths; needs a server with a library |

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

**Not started.** Both gates need a Mac: phase 2 requires `expo run:ios`,
`expo run:android` and `maestro test`, and phase 3 requires Maestro for the
offline and devices flows. Starting them here would produce branches that
cannot be shown to be green, against a ground rule that says commit only on
green gates.

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

`OfflineStore` names only the storage, not the downloading. The two apps look
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

So: interfaces and the web half, proved as far as they can be proved; the
native half left for the Mac with the question written down.

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

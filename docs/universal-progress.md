# Universal migration — progress

A log of the overnight run against `docs/UNIVERSAL.md`, written for whoever
reads it in the morning. Newest phase last. Times are UTC on 2026-09-12.

Nothing has been merged to `main`. Every branch is pushed to `origin` and
nothing else.

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

**Not started.** Both gates need a Mac: phase 2 requires `expo run:ios`,
`expo run:android` and `maestro test`, and phase 3 requires Maestro for the
offline and devices flows. Starting them here would produce branches that
cannot be shown to be green, against a ground rule that says commit only on
green gates.

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

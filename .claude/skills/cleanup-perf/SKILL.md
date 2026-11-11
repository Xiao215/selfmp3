---
name: cleanup-perf
description: Find and fix measurable waste in self.mp3, covering bucket reads that run into the daily cap, memory that grows in the web tab, re-renders and long JS-thread stalls on the phone, slow SQL, a blocked server event loop, and work repeated on a hot path. Use when something is slow, janky, leaking or expensive, when a cleanup touches a hot path, or for the PERF label in docs/CODE_TODO.md.
argument-hint: "[path | symptom]"
---

# Performance

Measure first. A change is a performance fix only when a number moved: reads per
play, heap after N clicks, milliseconds the JS thread was blocked, rows scanned.
A guess that "this should be faster" belongs in a report, not a commit.

## Where waste has actually been in this repo

Look here first. Each of these was a real incident.

- **Bucket reads.** Backblaze has charged nothing for API calls since 1 May
  2026, but the daily caps still apply. Past the cap, the whole account stops
  until midnight GMT (`docs/SYNC.md`). A multiplier per play matters more than
  any one read.
  Past causes:
  - a deploy wiping the service worker's file cache,
  - a cover cached under two addresses that evicted each other,
  - a paused load that streamed at once,
  - no backoff after the cap's 502.

  For any code that reads the bucket, ask: how many reads per play, per page
  open, per deploy? `docs/SYNC.md` "Caps" lists the known consumers.
- **Web memory.** A tab grew to 2.4 GB:
  - hidden pages were kept mounted (`shell/keepNearTop.tsx` now bounds them),
  - a ScrollView was held by Unistyles (`apps/app/webFixes/scrollView.js`),
  - a response was cloned and never read.

  Many elements with per-frame inline styles also churn CSS rules on the web
  (draw them in a canvas or with SVG props instead).
- **The phone's JS thread.** A long synchronous pass after a tap was once a
  seven-second stall. A stalled JS thread also breaks native-driven animations
  and makes the app look broken. Watch for whole-library loops in a press
  handler or an effect.
- **Wide subscriptions.** An always-mounted component reading all of
  `usePlayer()` re-renders on every play and pause. Narrow hooks are listed in
  `cleanup-react`.
- **Duplicated streams.** The events stream was once opened six times on a
  phone. Count the connections, not just the code paths.
- **The server's event loop.** A blocked loop reads as "can't reach the server"
  on every device (`cleanup-async`, "Sync code on the server").

## Find

- Read the hot path end to end. Startup, opening a page, playing a song, a tap
  in a long list, a library sync.
- Look for work per item that could be per batch: a query in a loop, a
  `find` inside a `map` over the library (build a `Map` once), re-sorting or
  re-filtering in render, JSON round-trips to copy.
- Look for work per render or per frame that could be per change: derived data
  without `useMemo` in a big list, new objects or arrows passed to memoised rows.
- Long lists render through `SongList` and the `Scroll` lists, which virtualise.
  A `.map` over hundreds of rows inside a `ScrollView` does not.
- SQL: `EXPLAIN QUERY PLAN` on any query that runs per request or per song. A
  `SCAN` of `songs` on a hot path wants an index, unless the query returns every
  row on purpose (`GET /library` does: ARCHITECTURE, "The whole library in one
  response"). Add an index as a new migration in `MIGRATIONS`.
- Caches keyed on the database's change count (`total_changes()`,
  `data_version`) are cleared by every write on that connection, including the
  frequent ones that have nothing to do with the cached data: device heartbeats
  every 10 s, presence, metrics. Check what writes between two reads before
  trusting such a cache. Key it on something narrower if those writes empty it.

## Measure

| What | How |
| --- | --- |
| web heap and DOM growth | Playwright + CDP (`Runtime.getHeapUsage`, heap snapshots, `document.styleSheets` rule count) against a local export |
| bucket reads | count requests in the doorman's log (`npx wrangler tail` in `apps/doorman`) or the service worker, per action |
| phone stalls and dropped frames | simulator recording (`simctl recordVideo`) and per-frame checks with ffmpeg; a temporary busy loop to reproduce reliably |
| server time | timestamps in the logger around the step; `EXPLAIN QUERY PLAN` for SQL |
| re-renders | React DevTools profiler, or a temporary render counter |

Record the before number, change one thing, then record the after number.
Remove any temporary instrumentation before committing.

## Fix

- Do the cheapest thing that moves the number: cache a derived value, build a
  lookup map once, batch the query, narrow the subscription, defer work until
  it is needed (`preload="none"` until play).
- A cache needs an owner, a key that changes when its input does, and a bound.
  An unbounded `Map` that only grows is a leak on a long-lived tab or server.
- Do not trade correctness for speed silently. If a fix skips work in some
  case, say which case in a comment.
- Leave measured, negligible costs alone, and add them to CODE_TODO's kept list
  with the number, so the next pass does not measure them again.

## Report

The number before, the number after, how it was measured, and on what
(simulator, browser, the Pi). Without the numbers, file it under `PERF` in
the report as a suspicion, not a fix.

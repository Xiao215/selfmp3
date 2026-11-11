---
name: cleanup-async
description: Clean up async and sync code in self.mp3, covering floating promises, void and empty catches, sequential awaits that could run together, unbounded concurrency, races and stale results, timers and listeners left running, functions marked async for no reason, and blocking sync I/O on the server. Use when touching promises, effects that fetch, background work, timers or event streams.
argument-hint: "[path]"
---

# Async and sync code

Lint already refuses the worst of it. `@typescript-eslint/no-floating-promises`
and `no-misused-promises` are on for the server, the packages and the app's
`app/` and `src/` ("the #1 source of silent failures", `eslint.base.cjs`). What is
left is what lint cannot judge: whether a promise is right to drop, and whether
an order is right.

## Every promise is awaited, returned or owned

- **`await` it** when the caller needs the result, or needs to know it failed.
- **`return` it** when the caller should decide.
- **`void` it** only when the promise cannot reject, or deals with its own
  failure (logs it, shows it, puts it in state). The app does this in hundreds
  of places. Each one you touch should pass that test.
- **`.catch(() => {})` and `.catch(() => undefined)`** say "failure here is
  fine". Leave one only with a comment saying why. Otherwise send the failure
  somewhere: `console.warn` with `messageOf(error)`, a toast, or state the screen
  shows.
- Never `forEach(async …)`. Nothing waits for it and its failures go nowhere.
  Use `for … of` with `await` for one at a time, or `Promise.all` for together.
- Never silence the lint rule with `eslint-disable`. Fix the call.

## Order and concurrency

- **Independent awaits run together.** Use `await Promise.all([a(), b()])`, not
  `await a(); await b()`, when b does not need a.
  Use `Promise.allSettled` when one failure must not lose the others' results.
- **Dependent steps stay in sequence.** Do not parallelise steps that write the
  same row, file or bucket key.
- **Bound the fan-out.** `Promise.all(items.map(work))` over a library of
  thousands opens thousands of requests at once. Use the server's `Gate`
  (`apps/server/src/util/gate.ts`), chunk the work, or go one at a time. That
  matters for the bucket especially: Backblaze's daily cap stops the whole
  account once it is passed.
- **Throttle repeated work** with `createThrottle` (`packages/shared/src/throttle.ts`)
  rather than a hand-rolled timer flag.

## Async only when it awaits

- A function that awaits nothing should not be `async`. It forces every caller
  to await a value it could have had at once.
- A function that does async work should not hide it behind a sync signature
  by firing a promise and returning. Return the promise.
- Inside `try`, `return await work()`, not `return work()`, so the `catch` and
  `finally` see the failure.
- Do not wrap a promise in `new Promise((resolve, reject) => p.then(resolve, reject))`.
  Return `p`. `new Promise` is for callback APIs and timers only.

## Races and stale results

- **Server state in the app goes through React Query** (`packages/client/src/queries`),
  which handles caching, retries and stale responses. A `useEffect` that
  fetches and sets state is usually a query hook waiting to be written.
- When an effect must start async work itself, ignore the result once the
  inputs have changed or the component has gone: a `cancelled` flag set in the
  cleanup, or an `AbortController` whose signal the fetch takes.
- Last write wins only on purpose. Two quick taps that each start a save must
  not let the older answer land after the newer one.
- A long request on the server stops when its client goes:
  `apps/server/src/http/abortOnClose.ts`.

## Clean up what you start

Every `setTimeout`, `setInterval`, listener, subscription, socket and event
stream has a matching clear, remove or close in a React effect's cleanup, or
on the server's shutdown path. A tab or a process that never lets go is how the
event streams once kept the server from shutting down
(`apps/server/src/services/events.ts`).

## Sync code on the server

The server is one process answering every device. A blocked event loop shows
up on the phone as "can't reach the server".

- No `readFileSync`, `execSync`, `spawnSync` or large `JSON.parse` /
  `JSON.stringify` on a request path or in background work. They are fine in
  the CLI, at startup and in scripts.
- A CPU-heavy loop over the whole library yields between chunks
  (`await new Promise(r => setImmediate(r))`), or moves to a worker.
- better-sqlite3 is synchronous by design. Keep queries indexed and small. Do
  not wrap them in fake async.

## Check

`npm run lint` and `npm run lint:app` for the promise rules, then
`npm run check`. For an ordering change, write a test that fails with the old
order (vitest's fake timers for timer races) before you trust it.

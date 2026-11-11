---
name: cleanup-tests
description: Clean up self.mp3's tests, covering mocks that sit below the behaviour under test, tests tied to internals, skipped or focused tests, copied fixtures, timer races, weak assertions, tests that cannot fail, and tests at the wrong layer. Use when a cleanup touches *.test.ts(x), fixtures or fakes, when a test passed but the feature was broken, or when adding a test to pin behaviour before a refactor.
argument-hint: "[path]"
---

# Tests

A test is worth keeping when it fails for the bug it is there for and passes
through any refactor that keeps behaviour. Most test smells break one of those
two halves.

## Where each test runs

From `docs/ARCHITECTURE.md` "Testing" and Foundation 8:

| Code | Runner | Where the test sits |
| --- | --- | --- |
| packages, the server, the doorman, the app's model files | vitest (`npm test`) | `*.test.ts` beside the code |
| the app's components and screens | jest-expo + React Native Testing Library (`npm run test:app`) | `*.test.tsx` beside the code |
| flows in a browser | Playwright (`npm run verify:flows`) | `verify/flows/` |
| the desktop app, the extension | Playwright | `apps/desktop/verify/`, `apps/extension/verify/` |
| flows on a phone | Maestro | `apps/app/.maestro/` |

Put a test at the lowest layer that can show the behaviour. If a decision is
tested through a rendered screen, move the decision to a model file and test it
there. Keep one screen test to show the wiring.

## Fake the outermost boundary

The rule that came from a real miss: an import feature shipped broken while its
test passed, because the test mocked `ytdlp.download` below the code that
rewrote its error. Mock only at the edge of the system, and let everything
inside run for real.

The repo already has fakes at the right layer. Use them before writing a
`vi.mock`:

- **The server:** `createContainer(loadConfig())` with `SELFMP3_DATA_DIR`
  pointed at a temp folder, so routes, services and repositories all run on a
  real SQLite file (`routes/*.test.ts`). Set `SELFMP3_CLOUD_DIR=bucket` too, or
  every route refuses because no bucket is connected. There is no shared
  harness yet: the env save, temp folder, container and HTTP server are copied
  across the route tests, and one helper would be a good `cleanup-shared-code`
  fix.
- **The server's two doors.** Route tests mount `createApp` (`app.ts`), a
  single-library app. Production runs `createHubApp` (`hub/app.ts`), which picks
  the library by token. Anything about who may reach a library is tested at the
  hub (`hub/hub.test.ts`).
- **yt-dlp and other executables:** a stand-in script on `PATH`
  (`services/importQueue.test.ts`).
- **The doorman, Google, the bucket, KV, Durable Objects:**
  `apps/doorman/src/fakes.ts`. The fake bucket checks request signatures, so a
  passing test sent requests a real bucket would accept. Package tests reach
  for it too (`packages/replica/src/session.test.ts`).
- **Outside HTTP APIs:** recorded answers in `fixtures/` folders
  (`apps/server/src/services/fixtures/`).
- **One contract, several implementations:** a shared behaviour suite that runs
  against each one. `apps/app/src/ports/engine.behaviour.test.ts` runs against
  the phone's and the browser's engines, and
  `packages/client/src/api/contract.test.ts` holds the server and the replica to
  one API.

A `vi.mock` or `jest.mock` of a module you own is the first thing to question.
It is right for a native module jest cannot load, or for a platform port in a
screen test. It is wrong when the code it replaces is the interaction being
tested.

## Smells

- **`.skip`, `.only`, `.todo` left in.** Fix the test or delete it with its
  reason. A `.skip` behind a runtime condition is fine when it says why
  (`room.store.test.ts` skips where Node has no Web Locks).
- **Tied to internals.** Assertions on private state, call counts of internal
  helpers, or the exact order of calls that do not matter. Assert what a caller
  or a person can see instead: the return value, the response, the rendered text,
  the stored row. The exception is when the count is the behaviour: a cache test
  that counts how often `container.songs.all()` runs is testing the cache.
- **Cannot fail.** No assertion. An assertion inside a callback that never runs.
  `expect(x).toBeDefined()` on something always defined. A promise never
  awaited. Check it by breaking the code: the test must go red.
- **Weak assertions.** `toBeTruthy()` where the value is known; snapshot tests
  of large trees nobody reads. Assert the specific value that matters.
- **Copied fixtures.** The same song, library or room built by hand in ten
  files. Use one builder in the test file, or a shared one in a `fixtures/`
  folder or the fakes module, with overrides for what each test cares about.
- **Real time.** Short `setTimeout` waits and tight timing assertions make
  tests flaky under load, which this machine often is. Use vitest's fake timers
  or pass the clock in (`now` options already exist as seams). Where only real
  time will do (a SQLite lock wait), assert a generous upper bound. Never race a
  short real timeout against the work.
- **Order dependence.** A test that passes only after another one ran. Each test
  builds its own state, and `afterEach` puts back what it changed (env vars,
  `PATH`, globals).
- **Unclear names.** The name says the behaviour in a sentence, as the existing
  tests do: "plays a shared playlist's song again as the same song from the same
  person". Not "works" or "test 2".
- **jest-only gaps.** The jest renderer has no hit testing, focus or IME. A test
  that presses a hidden button's testID passes even when a person could not
  press it. That belongs in Playwright or on a simulator.
- **Tests are not type-checked** (vitest transpiles them). A test can drift
  from a changed type and only fail when run, or silently pass on a field that
  no longer exists. Read the types when a test looks too easy.

## Pinning behaviour before a refactor

When the code you are about to reshape has no test, first write one that
records today's behaviour at its public entry. Include the odd cases. Commit it
on its own, then refactor. If the test needs changing during the refactor,
behaviour changed.

## Check

For each test you add or change, break the code it covers and watch it fail,
then restore it. While working, run the one file (`npx vitest run <file>`, or
`npm run test:app -- <file>`). Before committing, run `npm run check`, which
runs both suites.

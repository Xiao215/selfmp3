# Code TODO

The code-level backlog: drift, duplication, dead code, hardcoded values and lag that the
gates cannot see. Feature work that has not been built is in [FEATURE_TODO.md](FEATURE_TODO.md).

Four passes produced the numbered items so far: whole-repo audits on 2026-09-22 (T-001 to
T-245), 2026-09-23 (T-300 to T-375) and 2026-10-07, and the "one copy of each thing" pass of
2026-10-13 (T-376 to T-431, on `main` as 70d5be61). Every numbered item is done, and the
commit messages say what each fix was, and what they left open has been done since. A fifth
pass on 2026-10-24 went over what landed after 70d5be61 (rooms, share links, cover packs, one
read for words, the hub, the admin page) without numbering, one commit per area. What is left
here is what that pass left for the owner, and the choices that look like leftovers but were
made on purpose, so that the next pass does not report them again.

## Rules the passes worked to

- **The project is unreleased.** A branch that keeps "an older server", "an older index" or
  "callers that have not moved" is a deletion, not a keep. Stored data is migrated to the new
  shape rather than accommodated; SQLite schema migrations stay.
- **One primitive per job.** When a shared piece exists, a screen uses it rather than
  building its own beside it, and a phone and a computer surface are one tree with two
  placements, not two trees. Where a raw building block keeps coming back, a lint rule
  refuses it: `apps/app/eslint.config.js` refuses raw `Pressable`, `TextInput` and
  `ActivityIndicator` in `features/` and `shell/`.
- **Two answerers, one set of cases.** The server and the replica answer the same API from
  shared rules, held together by `packages/client/src/api/contract.test.ts` and the parity
  tests in `apps/server/src/services/cloudIngest.test.ts`; the phone's and the browser's
  engines share `packages/client/src/ports/engineCore.ts` and one suite,
  `apps/app/src/ports/engine.behaviour.test.ts`.
- **All of `npm run check`.** Typecheck (with the verify suites), lint, format,
  `check:exports` (which reads the import graph), `check:comments` (every file, member and
  mock board a comment names exists), the unit tests and the app's own checks. Each part has
  at some point been the only one that was red.

## Labels

For new entries.

| Label | Meaning |
| --- | --- |
| `HARDCODE` | a value that belongs in one constant, token, config field or env var |
| `DEAD` | code, exports, props, styles, comments or compat shims nothing uses |
| `PROPER` | works, but duplicated, cast around, or built the long way |
| `PERF` | measurable waste on a hot path |
| `ROBUST` | a real bug or a race, usually at an edge |
| `SECURITY` | trust boundary looser than it should be |
| `TYPES` | a shape the type system could express but does not |
| `HYGIENE` | tooling, CI, repo state |

Severity: **H** = fix soon, user-visible or corrupting; **M** = worth a focused commit;
**L** = pick up when passing.

## Still open

Left by the 2026-10-24 pass because each one drops or rewrites data people already hold, or
is the owner's wording:

- **`picture` defaults "from before faces had pictures"** — `packages/shared/src/schemas/room.ts`
  (a member's and `fromPicture`), `schemas/shared.ts` (a shared playlist's members and its
  summary) and the past-rooms store (`features/room/pastRooms.store.ts`, with its optional
  `shared`). Dropping them loses the shared playlists and remembered rooms kept before; doing
  it properly is a one-off rewrite of those Durable Objects and of the device store. `DEAD` L.
- **`DoormanMeSchema.account` is optional** for sessions devices cached before the doorman
  sent it, which keeps a "doorman too old" branch in `apps/server/src/hub/hub.ts` `join`.
  Required, a cached session fails to read and the device signs in again. `DEAD` L.
- **The privacy policy** (`packages/shared/src/privacy.ts`, the Google sign-in policy page)
  says the bucket key is used only for the owner's own devices; share links, rooms and shared
  playlists read the sender's bucket for others, a link keeps the names of signed-in people
  who opened it, and the doorman keeps daily counts. The words are the owner's. `HYGIENE` M.
- **Sign-in counts** (`DOORMAN_COUNT.signedIn`, `.refused`) are counted by the doorman and
  read by nothing: draw them on the admin page's Data tab, or stop counting them. `DEAD` L.
- **`verify/flows/selection.spec.ts`'s two long-list flows skip below 90 songs**, so they
  never run on a 36-song development library: size the list to the window instead. `ROBUST` L.

## Looked at and kept on purpose

- **`COVER_TOP` in `features/nowPlaying/stageMove.model.ts`** equals the player bar's height
  but is a stage coordinate, and the model file must not import a shell component (T-121).
- **Popover, ToastHost and the stage's move call `Animated.timing` directly**, with their
  lengths passed through `motionMs` so Reduce Motion stills them; the reasons are in each
  file (T-127).
- **The replica's `health()` answers `version: 'web'`** on every platform: a cloud platform
  carries a device kind, not a version (T-196).
- **`packages/shared` compiles with `DOM`**, for the `URL` type (T-241).
- **`noUncheckedIndexedAccess` is off for the verify suites** (`verify/tsconfig.base.json`
  says why: a spec indexes arrays it has just built, under a guard the compiler cannot
  follow) (T-235).
- **`verify/playwright.config.ts` has no `webServer` block**: an unreachable server is a
  failure, and the two addresses can point at another host (T-243, [verify/README.md](../verify/README.md)).
- **4600 and 4601 are literal** only where nothing can import `DEFAULT_SERVER_PORT`: the
  Dockerfile, the compose file, the shell scripts and `package.json`'s `dev:web` and `dev:api`
  (T-410).
- **The phone's and the browser's cover stores stay two adapters**: the phone reads its
  folder synchronously so the first draw already has kept covers; the policy is one
  (`coverStore.ts`) (T-414).
- **`QueueSheet` stays out of the overlay host**, so song menus and the Undo toast land
  above it (T-417).
- **A share link's `visitors` stays optional** (`apps/doorman/src/share.ts`): links made
  before guests were counted have none, and they live 90 days.
- **The unnamed-file sweep skips a round when an old snapshot does not read**
  (`#namedBySnapshots`, `apps/server/src/services/cloudSync.ts`): an old device's snapshot
  from before the snapshot's fields were settled ages out within 30 days, and nothing is
  deleted meanwhile, which is the safe side.
- **Settings keeps `Row` + `Toggle`** rather than `ToggleRow`: its rows put every kind of
  control at the end (T-428).

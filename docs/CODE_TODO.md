# Code TODO

The code-level backlog: drift, duplication, dead code, hardcoded values and lag that the
gates cannot see. Feature work that has not been built is in [FEATURE_TODO.md](FEATURE_TODO.md).

Four passes produced the numbered items so far: whole-repo audits on 2026-09-22 (T-001 to
T-245), 2026-09-23 (T-300 to T-375) and 2026-10-07, and the "one copy of each thing" pass of
2026-10-13 (T-376 to T-431, on `main` as 70d5be61). Every numbered item is done, and the
commit messages say what each fix was. What is left here is what those passes left open, and the choices that look like leftovers but were
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

- [ ] **`PROPER` L — Playlist tiles have no right-click menu.** `GridTile` takes `onMenu`
  (`apps/app/src/ui/components/TileGrid.tsx`), and the Tags page and From friends pass one;
  the Playlists grid does not. The list menus (`MoreMenu`, `useListActions`) could hand it
  one. Left from T-426.
- [ ] **`PROPER` L — The metadata dialog's groups draw their own heads.** "IN YOUR LIBRARY",
  "SUGGESTIONS" and "CHANGES TO APPLY" in `features/metadata/MetadataDialog.tsx` are
  `groupTitle` texts, where every other section head is `SectionHead` (`look="label"` is the
  same quiet uppercase name). Left from T-429.
- [ ] **`PROPER` L — "No server to ask" is built by hand five times.** `new ApiError(0, 'no
  server to ask', 'offline')` in `playlists/NewPlaylist.tsx`, `smart/ChangeIt.tsx`,
  `smart/AnswerScreen.tsx`, `smart/SongsAnswer.tsx` and `metadata/useMetadataSuggestion.ts`.
  One helper beside `useVia` would keep the code and wording in step. Left from T-402.
- [ ] **`PROPER` L — The desktop window's link check is written twice.**
  `apps/desktop/src/main/window.ts` tests `https://`/`http://` in both the window-open
  handler and `will-navigate`; an `openOutside(url)` would hold it once. Left from T-206.
- [ ] **`PROPER` L — The Stats away notice describes plays as the server's alone.**
  `SERVER_NEEDS.stats` in `packages/client/src/connection/reach.ts` says the computer "keeps
  every play any of your devices has ever recorded, and your storage holds only the songs".
  Plays are in the bucket now (`lyrics/<sha256>.plays`, one file a month, named in the
  snapshot); the server still works the numbers out, so the notice should say that instead.

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
- **Settings keeps `Row` + `Toggle`** rather than `ToggleRow`: its rows put every kind of
  control at the end (T-428).

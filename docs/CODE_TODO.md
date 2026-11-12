# Code TODO

The code-level backlog: drift, duplication, dead code, hardcoded values and lag that the
gates cannot see. Feature work that has not been built is in [FEATURE_TODO.md](FEATURE_TODO.md).

Four passes produced the numbered items so far: whole-repo audits on 2026-09-22 (T-001 to
T-245), 2026-09-23 (T-300 to T-375) and 2026-10-07, and the "one copy of each thing" pass of
2026-10-13 (T-376 to T-431, on `main` as 70d5be61). Every numbered item is done, and the
commit messages say what each fix was, and what they left open has been done since. A fifth
pass on 2026-10-24 went over what landed after 70d5be61 (rooms, share links, cover packs, one
read for words, the hub, the admin page) without numbering, one commit per area. What is left
here is the choices that look like leftovers but were made on purpose, so that the next pass
does not report them again.

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

Nothing. What the 2026-10-24 pass first left for the owner (old pictures, the optional
`/v1/me` account, the sign-in counts, the privacy policy) was done the same day: data is
migrated rather than accommodated, even when that means rewriting stored objects or a
device's store, because the only data there is is the owner's.

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
- **Stored objects are upgraded as they are read, and written back**: a phone's kept
  library (`upgradeKeptBase`, packages/replica), its remembered rooms (`upgradePastRooms`,
  `features/room/room.model.ts`), and the doorman's shared playlists (`upgradeDoc`) and share
  links (`upgradeSecrets`, and a link kept whole before its songs were kept in parts, in
  `Share#read`). Durable Objects and device stores cannot all be walked at once,
  so each is migrated the first time it is opened; the schemas themselves keep no defaults.
- **The unnamed-file sweep skips a round when an old snapshot does not read**
  (`#namedBySnapshots`, `apps/server/src/services/cloudSync.ts`): an old device's snapshot
  from before the snapshot's fields were settled ages out within 30 days, and nothing is
  deleted meanwhile, which is the safe side.
- **Settings keeps `Row` + `Toggle`** rather than `ToggleRow`: its rows put every kind of
  control at the end (T-428).
- **Import's review keeps a phone row and a computer row** (`PhoneRow`, `GridRow` in
  `features/import/ReviewRows.tsx`): a phone's opens into a card and a computer's into
  fields on the one grid every row shares; the box, the title, the name fields, the bar
  and the words at the end are already the same parts.
- **`features/lists/lists.model.ts` keeps Recently played with the sources**: a recent
  list is keyed by its source (`sourceKey`), and the module's tests read both together.
- **The desktop shell's IPC handlers do not check `event.senderFrame`**
  (`apps/desktop/src/main/ipc.ts`): the preload runs only in the window's top frame, and
  `window.ts` keeps that frame on the app's own origin (`will-navigate`, and every new
  window denied), so a sender check would ask again what the navigation guard has
  decided. Every argument is still parsed with its schema.
- **SQL in the eval scripts** (`apps/server/src/ai/eval/`, `apps/server/src/sound/eval.ts`):
  each builds its own in-memory library and reads it back, and a case's expectation is
  written as a SQL condition over `songs` on purpose, so an answer is checked against the
  database rather than against the code under test. They are scripts, not services.
- **The account's doorman session and the reading of other devices' logs stay in
  `cloudSync.ts`**: each reads and writes the pass's own state (the session and the bucket
  in use; the newest snapshot of its own and how far its plays reach), so a module of its
  own would call back into the sync for most of what it does. The sound vectors, the sound
  map and the plays (`cloudLibraryFiles.ts`) and the pictures (`cloudPictures.ts`) did not,
  and moved.
- **`CloudSyncService.syncNow` stays, though only tests call it** since *Publish now* and
  its route went (2026-11-11). The real entries are `kick`, which waits out a debounce, and
  `start`; the sync's and the hub's tests drive passes one at a time through `syncNow`, and
  `verify` starts a pass over against the bucket the way a restart does, without making a
  second service on the same database.
- **`PlayerProvider.tsx`, `SongRow.tsx` and `Sidebar.tsx` stay long, one file each**. The
  provider's engine wiring, its commands and its recovery from a failed song share a dozen
  refs (the comment above `useVolumeControls` there); a song row's phone and computer shapes
  are placed from one set of parts, so a fix reaches both (the comment above `target` in
  `SongRow.tsx`); the rail's sections share one stylesheet and its group heads. What had a
  seam of its own has moved out: the volume, the sleep timer, play reporting and what the
  operating system shows (`useNowPlaying`), and the worker's audio and bucket
  (`sw/audio.ts`, `sw/bucket.ts`).
- **`usePlayerProgress` reads `usePlayer()` for the song's own length**, so the scrubbers
  and the synced lyrics render again for a queue edit. The playback store is told after the
  commit, so taking the length from there would draw the last song's length under the new
  one for a frame.
- **`packages/replica/src/library.ts` stays one file**: its closures share the replica, the
  sign-out `generation`, the outbox's `exclusive` lock and what has been written, so a split
  would hand all of that across. What the library points at in the bucket (words, covers,
  the sound map) needed none of it and is already `libraryFiles.ts`.
  `packages/shared/src/sync.ts` stays one file too: `applyChange` is one case per kind of
  change, and a list reads best whole.
- **`parseDoormanRefusal` reads without zod** (`packages/shared/src/doormanWire.ts`): the
  service worker imports `@selfmp3/shared/wire`, which stays free of zod to keep it small.
- **`repositories/cloud.ts` stays one repository**, though long: saving any bucket file's
  state trashes the file it replaces, and `reconcileFiles` resets every kind in one
  transaction, so split repositories would each need the others' tables.
- **The hub lets a library go with `fs.rmSync`** (`#leave`, `apps/server/src/hub/hub.ts`):
  it runs once per grant taken back, and the hub's tests read the folders as gone the moment
  it returns.
- **The scrapers read their pages through casts, not schemas** (`services/netease.ts`,
  `services/youtubeMusic*.ts`, `services/spotify.ts`): each shape is someone else's and changes
  without notice, so a field is read where it is found and a missing one is skipped,
  where a schema would refuse the whole page.
- **The song and list menus reach into features from `ui/components`** (`SongActionItems`,
  `useListActions`, `SelectionBar`, `SongMenu`): they are the one menu every screen opens, so
  what a menu item does (queue, share, add to a room, open a tag) is imported from the
  feature that owns it. The app states no layer rule between `ui` and `features`, and
  moving the menus into a feature would only move the same imports.
- **`DeviceStore.update` returns `unknown`** (packages/replica's `platform.ts`): a generic
  `update<T>` would move the outbox's one cast into each of the three stores (the phone's,
  the browser's IndexedDB and the extension's), each of which writes whatever `change` gave.

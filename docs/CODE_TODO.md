# Code TODO — audit of 2026-09-22

A whole-repo pass for hardcoded values, dead code, things done less properly than they could be, and performance. Six reviewers read the code by area (server; app shell/player/ports/offline; app features/ui; packages; desktop/doorman/extension; tooling/CI/verify) and every "unused" claim was grep-checked across `apps/` and `packages/`. The items in **Do first** were re-verified by hand.

The repo's own gates all pass at this commit: `typecheck`, `lint`, `check:exports`, and `--noUnusedLocals --noUnusedParameters` on every project (two hits in `apps/app`, listed below). So nothing here is a compile or lint error; it is drift, duplication, leftovers and a handful of real bugs the gates cannot see.

**Labels**

| Label | Meaning |
| --- | --- |
| `HARDCODE` | a value that belongs in one constant, token, config field or env var |
| `DEAD` | code, exports, props, styles, comments or compat shims nothing uses |
| `PROPER` | works, but duplicated, cast around, or built the long way |
| `PERF` | measurable waste on a hot path |
| `ROBUST` | a real bug or a race, usually at an edge |
| `SECURITY` | trust boundary looser than it should be |
| `HYGIENE` | tooling, CI, repo state |

Severity: **H** = fix soon, user-visible or corrupting; **M** = worth a focused commit; **L** = pick up when passing.

Rule reminder from the owner: the project is unreleased, so every "older server / older index / kept so callers need not change" branch is a deletion, not a keep. SQLite schema migrations stay.

## Progress (2026-09-22, same day)

Two fix waves ran against this list; `npm run check` passes after them. Ticked items are done. Where an item was done only in part, the remainder is:

- **T-121** `COVER_TOP = 84` in `stageMove.model.ts` left as is: it is a stage coordinate, not the bar height, and the model file must not import a shell component.
- **T-124** `QueueRail`'s rail shadow uses `theme.colors.floatShadow` (its geometry is sideways; `artShadow` would have made it a drop shadow).
- **T-127** easing curves now come from `ease.*`; the four sites still call `Animated.timing` directly because they need `motionMs()`'s interrupt-safe end, as `motionMs`'s own comment explains.
- **T-153** `edit`/`editTag` collapsed; `ImportTags.TagSheet` kept, `TagChooser`'s sheet is not a drop-in.
- **T-174** `ToolStatusSchema` / `PlayRecordedSchema` are left for T-173, which moves the inline client schemas with them.
- **T-182** `CoverToneSchema.palette` stays optional: the server genuinely omits it when `cover_palette` is null.
- **T-196** `health()` still answers `version: 'web'`; `CloudPlatform` carries no version, only a device kind, and the doctor prints this as a version.
- **T-206** `openOutside(url)` in `window.ts` not extracted (the two guards are four lines apart; left for whoever next touches the file).
- **T-235** `noUncheckedIndexedAccess` is off for the verify suites because of one guarded index in `apps/desktop/verify/smoke.spec.ts:~330`; turn it back on by rewriting that line.
- **T-241** claim was wrong: `packages/shared` needs `DOM` for the `URL` type (six uses in `links.ts`, two in `cloud.ts`); the `client` tsconfig comment now says so.
- **T-243** no `webServer` block: `verify/README.md` deliberately treats an unreachable server as a failure and lets the two addresses point at another host.

Found on the way, also fixed: `apps/server/src/services/lookup.ts` held a raw NUL byte inside a string (grep treated the file as binary and skipped it; it is now the `\0` escape); the old `.prettierignore` entry `library` (no leading slash) had been hiding every `library/` path segment, so ten files under `apps/app/src/features/library` and `packages/client/src/library` had never been formatted. `apps/extension/src/ui/theme.css` is a build output that is also tracked; the badge-colour change regenerated it.

---

## Do first (verified by hand)

- [x] **T-001 `ROBUST` H — The CLI still points at the deleted in-repo `library/` and `data/`.** `apps/server/src/cli.ts:24-28` builds `dirs` from `REPO_ROOT` (exported only for this at `config.ts:245`) while `config.ts` moved to `defaultDirs()` under `~/Music` and `~/Library/Application Support`, profile-aware. `selfmp3 backup` copies two non-existent folders and `doctor` says "library — missing" unless both env vars are exported; `SELFMP3_PROFILE` is ignored. Fix: `defaultDirs()` overlaid with the two env vars, delete the `REPO_ROOT` export, reword the `backup` usage line.
- [x] **T-002 `PROPER` H — Song removal is copy-pasted four times and each copy forgets something.** `routes/songs.ts:86-116` (bulk), `routes/songs.ts:440-455` (single), `container.ts:384-403` (cloud `onIngested`), `services/scanner.ts:232-241` (`purgeMissing`). Bulk delete never calls `tags.pruneEmpty()`; `purgeMissing` never deletes the `lyricsCache` folder. Fix: one `removeSongs(ids, { deleteFile })` service returning `{ removed, failed }`, used by all four.
- [x] **T-003 `PERF` M — Every scan counts already-missing songs as "removed" and bumps the library version.** `services/scanner.ts:189-195` iterates `known` (which includes rows already `missing = 1`) and calls `markMissing` + `removed++` for each. Any library with one missing song returns `removed > 0` from every boot/watcher/auto scan, so every device refetches the whole library for nothing. Fix: `allPaths()` returns `missing`; only mark and count rows whose `missing` is 0. Same change removes the one `UPDATE` per unchanged file at `:170-172`.
- [x] **T-004 `ROBUST` H — Song and tag mutations never invalidate live-playlist member lists.** `packages/client/src/queries/queries.ts:304-346` (`useLibraryMutation`), `:357-374` (`putInLibrary`), `:426-461`, `:527-564`. Only `['library']` is invalidated; the open playlist page and its mosaic keep the old member list for the 30 s / 5 min stale window. The comment at `:684-689` claiming "the mutations invalidate `['playlist']` themselves" is false. Fix: invalidate `['playlist']` when `hasLivePlaylists(current)` (and always for deletes/bulk tag); add `queryKeys.playlists`.
- [x] **T-005 `DEAD` H — ~200 lines of a web offline store nothing calls.** `apps/app/src/ports/offline.web.ts:249-451` (`syncLibrary`, `storageUsage`, `requestPersistentStorage`, `createWebOfflineStore`, two `_conforms` assertions) and the `OfflineStore` / `StorageUsage` / `SaveOptions` port in `packages/client/src/ports/offline.ts:21-90`. The live port is `DownloadStorage`. Fix: delete both halves; if persistent storage is wanted, call `navigator.storage.persist()` once from `downloadStorage.web.ts`.
- [x] **T-006 `ROBUST` M — Escape can close the wrong layer.** `apps/app/src/shell/useEscape.web.ts:30-47` re-runs its effect whenever `onEscape` changes (callers pass inline arrows), so a re-render of a lower layer's parent splices it out and pushes it back on top of the stack. Fix: keep `onEscape` in a ref (as `useHotkeys.web.ts` already does) and register the layer only on `[active, layer, id]`.
- [x] **T-007 `ROBUST` H — Desktop download sink has no `error` listener.** `apps/desktop/src/main/files.ts:117-143`: the only listener exists transiently inside `await once(sink, 'drain')`. A disk error while `write()` returns `true` is an uncaught exception in the main process. Fix: attach `sink.on('error', …)` up front, or use `stream/promises` `pipeline`.
- [x] **T-008 `ROBUST` M — Web caches are not cleared at sign-out.** `offline/lyricsCache.web.ts:47-49` and `motionCache.web.ts:45-47` empty an in-memory `Set` only; `playlistCache.web.ts:32-36` needs ids the sign-out step (`settings/Confirmations.tsx:70-72`) never passes. `downloads.excluded` in `DownloadsProvider.tsx:139-140` also survives sign-out, so a new account's songs sharing those ids are never auto-downloaded. Fix: `deleteStoredPrefix(KEY_PREFIX)` (already in `ports/idbStore.web.ts:83`) in all three; a `forgetExcluded()` in `SignOutSteps`.
- [x] **T-009 `HARDCODE` H — Flow specs hit Metro instead of the API when `SELFMP3_APP_API` is unset.** `verify/flows/follows.spec.ts:18` and `playlist.spec.ts:77` default to `''`; `pwa.spec.ts:14` defaults to 4600 (the admin page, so it always skips); `teardown.ts:11-14` and the config each have their own default and the device ids are re-typed. Fix: export `baseURL`, `appApi`, `FLOW_DEVICE_IDS` from `verify/playwright.config.ts` and import them everywhere.
- [x] **T-010 `ROBUST` M — The extension watcher clears its own `!` badge and polls forever.** `background/handlers.ts:282-287` calls `watcher.seen()` on every queue read, but the watcher reads the queue through that same handler (`index.ts:49-54`), so each 2 s tick clears `failed`. `watcher.ts:78-85,129-148`: a failing read never prunes batches, so `follow()` reschedules every 2 s while the server is away and each `setBadgeText` keeps the MV3 worker alive. Fix: a queue reader for the watcher that does not call `seen()`; stop following after N failures; prune stale batches regardless of read success.
- [x] **T-011 `SECURITY` M — Migration search bypasses yt-dlp's args, cookies and throttle.** `services/migrate.ts:48-59` runs `yt-dlp` directly without `BASE_ARGS`, `#cookieArgs()`, `#pace()` or `#failure()`; a 50-track migration fires 50 unbudgeted requests. Fix: `YtDlpService.search(query, n, signal)` and have `MigrateService` take it.
- [x] **T-012 `HARDCODE` M — Native background colour is not the theme's.** `apps/app/app.config.js:18,60,74` and `apps/desktop/src/main/window.ts:45` all say `#14121a`; the dark `surface0` is `#0b0d13` (`packages/client/src/theme/tokens.ts:130`), so the splash and window ground shift tone on the first painted frame. Fix: one constant exported from a light package both sides bundle.
- [x] **T-013 `PROPER` M — The package build chain is spelled out five times and drifts.** `package.json:18,20,21,22,29` and `.github/workflows/pages.yml:64-68`. `typecheck:app` omits `desktop-bridge`, which the app imports outside the desktop twin (`ports/menuKeys.ts`, `shell/playbackKeys.ts`, `shell/useCommands.ts`), so `check:app` and `test` fail on a fresh clone until root `typecheck` has run. Fix: one `build:packages` (`tsc -b` on the four), used everywhere; drop `--force` from `typecheck`.
- [x] **T-014 `DEAD` M — Seven empty imports left by the Settings split.** `import {} from '../metadata/metadata.model'` in `SettingsScreen.tsx:53`, `OfflinePanel.tsx:20`, `DesktopPanel.tsx:9`, `Confirmations.tsx:18`, `AppearancePanel.tsx:10`, `ImportingPanel.tsx:7`, `ShortcutsPanel.tsx:8`. Delete.

---

## apps/server

### Config, CLI, boot
- [x] **T-020 `HARDCODE` L** — Default port `4600` in `config.ts:78`, `cli/api.ts:60`, `cli/args.ts:41` (and see T-190). One `DEFAULT_PORT`.
- [x] **T-021 `HARDCODE` L** — `APP_VERSION = '1.0.0'` at `config.ts:243` duplicates `package.json`. Read it once via `createRequire`.
- [ ] **T-022 `HARDCODE` M** — `SELFMP3_PUBLISH_ANYWAY` read straight from `process.env` at `services/cloudSync.ts:931,1198`, outside the "read once, validated once" config contract; a typo silently does nothing. Add `publishAnyway` to `ConfigSchema`.
- [ ] **T-023 `PROPER` M** — `autoScanMinutes` is only honoured at boot (`main.ts:89-103`); `PATCH /settings` re-applies `watchLibrary` and `importConcurrency` but not this, and the timer's `.catch(() => undefined)` drops scan errors. Move it into `LibraryWatcherService.apply()`.
- [x] **T-024 `PROPER` L** — Shutdown stop-list duplicated and inconsistent between `main.ts:110-121` and `container.ts:465-476` (`keepAwake` only in one, `analysis/coverTones/migrate` only in the other). One `container.stop()`.
- [x] **T-025 `PROPER` L** — Device-kind mapping (`darwin → mac`) computed in `container.ts:172` and `cloudSync.ts:1417`. Let `CloudRepository.deviceId()` do it.
- [x] **T-026 `HARDCODE` L** — `'incoming'` staging folder named in `importQueue.ts:349` and `analysis.ts:275`. A `stagingDir(config)` next to `defaultDirs`.
- [x] **T-027 `HARDCODE` L** — Placeholder User-Agent with a stub URL duplicated in `lyrics.ts:20` and `lookup.ts:20`; lrclib and MusicBrainz ask for a real contact URL. One `USER_AGENT` in `config.ts`.

### HTTP layer
- [ ] **T-030 `PROPER` M** — `bearerAuth` (`http/middleware.ts:73-86`) and `isAuthenticated` (`:105-116`) duplicate token extraction and the timing-safe compare. `bearerAuth` should call `isAuthenticated`.
- [ ] **T-031 `DEAD` L** — "No token configured" pass-through branches at `middleware.ts:53-58,101-102` exist only for tests that hand-build a `Config`; `createContainer` guarantees a token. Type it as required and delete.
- [x] **T-032 `DEAD` L** — `HttpError.internal` (`http/errors.ts:53-55`) has no callers.
- [ ] **T-033 `PROPER` L** — `requireSong` and `ParamsWithId` re-declared in `routes/songs.ts`, `metadata.ts`, `lyrics.ts`, `playlists.ts`, `media.ts`, `tags.ts`. One `http/params.ts`.
- [ ] **T-034 `PROPER` L** — Lyrics resolution and the "instrumental" 404 duplicated between `routes/songs.ts:292-343` and `routes/lyrics.ts:37-62`; `/songs/:id/lyrics/romanized` is nearly redundant now that `romanized` is inline. Extract `resolveSongLyrics`; retire the endpoint once the client reads the inline field.
- [ ] **T-035 `PROPER` L** — Art route uses sync `fs.statSync` and a naive `If-None-Match` compare (`routes/media.ts:90,99`) while `http/range.ts:29-46` has the correct `isFresh`. Use `fsp.stat` and reuse `isFresh`.
- [ ] **T-036 `PROPER` L** — `/playlists/preview` fabricates an 11-field fake `Playlist` to call `songIds` (`routes/playlists.ts:216-228`). Add `PlaylistRepository.resolveRules(rules)`.
- [ ] **T-037 `PROPER` M** — `/migrate/enqueue` (`routes/migrate.ts:82-108`) re-implements `enqueueFresh` and `resolveImportPlaylist` without the "already downloaded by video id" dedupe fix that `routes/imports.ts:62-84` got. Move `enqueueFresh` into a service and share it.
- [ ] **T-038 `PERF` L** — N+1 `songs.byId` loops at `routes/system.ts:66-67`, `routes/gems.ts:22-25`, `services/lyricsIndex.ts:54-55`, `routes/playlists.ts:135`; `byIds` already exists.
- [ ] **T-039 `PERF` L** — `/songs/:id/similar` loads the whole library per request (`routes/songs.ts:272`). Acceptable today; cache `all()` on `libraryVersion()` if it shows.

### Services
- [ ] **T-040 `PERF` L** — Every cloud pass does ~5 sequential fs calls per song (`cloudSync.ts:682-695,1011-1023`, `lyrics.ts:90-97`). Run `#signatures` through `inBatches` and have `findSidecar` `readdir` once.
- [ ] **T-041 `PROPER` L** — `sha256`, `message` and the `error instanceof Error ? error.message : String(error)` idiom duplicated (~60 inline sites, `cloudSync.ts:1442-1456`, `cloudAdopt.ts:410-412`). `util/errors.ts`, `util/hash.ts`.
- [ ] **T-042 `PERF` L** — Whole download read into memory to hand to a stream-capable writer (`importQueue.ts:403-404`). `storage.write(key, createReadStream(path))`.
- [ ] **T-043 `PROPER` L** — Three hand-rolled ffmpeg spawn/timeout/stderr scaffolds (`analysis.ts:289-470`, `coverTones.ts:111-155`). One `runFfmpeg(args, { timeoutMs, onStdout })`.
- [x] **T-044 `DEAD` L** — `LyricsService.sidecarPathHint` (`lyrics.ts:294-297`) unused.
- [x] **T-045 `PROPER` L** — Two `cleanArtist` with different rules (`services/metadata.ts:57-62` strips VEVO; `packages/shared/src/titles.ts:35-40` does not). Add the rule to shared, delete the server copy.
- [ ] **T-046 `PROPER` L** — Two `similarity()` implementations (`lookupScore.ts:36-98` Dice bigram; `migrateScore.ts:30-61` edit distance). Document why they differ or converge.
- [ ] **T-047 `PERF` L** — `CoverService.find` probes three files with `existsSync` on every `/api/art/:id` (`covers.ts:133-141`) although `songs.art_ext` records the extension.
- [ ] **T-048 `PERF` L** — `CloudRestore.waiting()` materialises every restore row to count them on every 2–10 s status poll (`cloudRestore.ts:98-100`). `SELECT COUNT(*)`.
- [ ] **T-049 `ROBUST` L** — `S3StorageDriver.stat` swallows every error as "not found" (`storage/s3.ts:104-106`); a credentials hiccup would `markMissing` the whole library. Return null only for 404/`NoSuchKey`.
- [x] **T-050 `HARDCODE` L** — `AUDIO_SUFFIXES` in `storage/s3.ts:57` duplicates shared `AUDIO_EXTENSIONS` (the local driver uses it).
- [x] **T-051 `DEAD` L** — `EventHub.hasSubscriber` (`events.ts:97-102`) used only by its own test.
- [x] **T-052 `DEAD` L** — `bucket/memoryStore.ts` is test-only but ships in `src/`/`dist/`. Move beside the tests.

### Repositories
- [ ] **T-060 `PROPER` L** — `db.prepare` inside hot methods (`songs.ts:289-293,433,441,457,488,504`, `playlists.ts:147,206,260,277,420`, `imports.ts:197-314`, `importRequests.ts`, `lyricsSearch.ts:148`); better-sqlite3 does not cache statements. Prepare fixed-text ones in constructors.
- [ ] **T-061 `PROPER` L** — Stream/manifest ETag formula in `songs.ts:427` and `storage/local.ts:55`; `storage/s3.ts:98` returns the bucket's ETag so the manifest never matches on S3. One `fileEtag(size, mtime)`.
- [ ] **T-062 `PROPER` L** — `stats.ts:211-272` and `wrapped.ts:228-275` duplicate `toMinutes`, `dayGap` and the streak walk.
- [x] **T-063 `DEAD` L** — `DeviceRepository.rename` (`devices.ts:30,46,61-63`) has no callers.
- [x] **T-064 `DEAD` L** — Stale comment on `#nextQueued` at `imports.ts:110` describes a parameter the statement no longer takes.
- [x] **T-065 `PROPER` L** — `SettingsRepository.update` writes N upserts without a transaction (`settings.ts:43-49`).

---

## apps/app — shell, player, ports, offline, routes, config

- [ ] **T-070 `PROPER` M** — `react-native-track-player` still imported at module scope on web (`app/_layout.tsx:18,54`, `player/service.ts:1`, `ports/car/androidAuto.ts:2`), which is the only reason the 100-line throwing Proxy in `webStubs/track-player.js` and the resolver branch in `metro.config.js:37-50` exist; its `useIsPlaying/useProgress/useTrackPlayerEvents` exports have zero importers. Put `registerPlaybackService` behind a port twin, gate `androidAuto.ts` native-only, delete the stub.
- [ ] **T-071 `ROBUST` L** — `offline/listenOutbox.ts` has no `.web.ts` twin, so on web it writes into the throwing `expo-file-system` stub and listens recorded while the server is away are lost on reload; it is also the last reason that stub exists. Add `listenOutbox.web.ts` over `idbStore.web`, delete `webStubs/expo-file-system.js`.
- [x] **T-072 `PROPER` M** — Queue state committed two ways in `player/PlayerProvider.tsx`: `mutateQueue` (`:717-725`) writes `queueRef` synchronously; `play`/`playShuffled`/`jumpTo`/`next`/`previous`/`toggleShuffle` (`:530-705`) call `setQueue` only and wait for the effect at `:269-271`. Two commands in one tick, or `nextTrackId()` right after `next()`, read the old queue. One `commitQueue(next)`.
- [ ] **T-073 `PERF` M** — `CarProvider` (`ports/car/CarProvider.tsx:31-103`, mounted for all platforms in `_layout.tsx:151`) fetches every playlist's songs at launch on iOS and web where Android Auto is a no-op, re-implements `fetchPlaylistSongs` without its snapshot fallback, and is `enabled: connection !== null` so a cloud-only phone gets empty playlists. Make it an Android-only twin; use `queryKeys.playlistSongs` + the client fetcher.
- [ ] **T-074 `PERF` L** — `PlayerBar` computes the song colour / art resolver four times (`shell/PlayerBar.tsx:82,91,373-382,527-529`); `VolumeSlider` calls `usePlayer()`+`useArt()` for a colour it is handed. Compute once, pass `tone` down.
- [ ] **T-075 `PERF` L** — `VolumeSlider` rebuilds its `PanResponder` on every value change (`PlayerBar.tsx:532-547`, `value` in the memo deps). Read `value` through a ref.
- [ ] **T-076 `PERF` L** — Sidebar foot maps every song each render (`shell/Sidebar.tsx:558-559`). `useMemo`.
- [x] **T-077 `DEAD` L** — `PlayerApi.ready` is always `true` and never read (`PlayerProvider.tsx:105,827`).
- [ ] **T-078 `PROPER` L** — Duck-typed casts to reach `refreshNowPlaying`/`refreshLookahead` (`PlayerProvider.tsx:989-997`). Declare them optional on `PlaybackEngine`.
- [x] **T-079 `DEAD` L** — `#rate` in `ports/engine.ts:119` is written by `setRate` (`:296`) and never read. (One of the two `--noUnusedLocals` hits.)
- [x] **T-080 `DEAD` L** — Stale/orphaned comments: `PlayerProvider.tsx:208-209` ("Where this device keeps its volume" above `AUTO_MIX_KEY`), `:954-961` (`refreshLookahead` doc above `mediaSources`), `shell/Shell.tsx:327-333` (phase-4 Playback note above `DeepLinkRoutes`), `jest.setup.js:12-13` ("phase 3 replaces…"), `app/_layout.tsx:89-91` ("Retrying twice" vs `retry: 1`), `ports/car/*` CarPlay references (`CarProvider.tsx:12-24`, `browseTree.ts:4-10,56`, `androidAuto.ts:31`) for an integration that does not exist.
- [x] **T-081 `HARDCODE` L** — Seek step defined three times: `player/useNowPlaying.ts:8`, `shell/Shell.tsx:352`, `ports/mediaSession.web.ts:87-88`.
- [ ] **T-082 `HARDCODE` L** — Sleep-timer fade and poll literals (`player/useSleepTimer.ts:48-65`); the 1 s `setInterval` wakes for up to 90 min when one `setTimeout(endsAt - now)` would do.
- [x] **T-083 `DEAD` L** — `SavedSession.savedAt` written and parsed, never used (`player/session.model.ts:21,40,56-57`).
- [x] **T-084 `DEAD` L** — `loadPendingListens` re-exported from `offline/listenOutbox.ts:55` with no caller; `artworkLoadable` (`ports/inlineArtwork.ts:18`) and `connectionKind` (`offline/connectionKind.ts:41`) exported but only used in-file.
- [x] **T-085 `DEAD` L** — Lazy `require()` shims "for a binary built before the module was added": `offline/connectionKind.ts:5-24` (`expo-network`), `ports/widget.ios.ts:21-43` (`@bacons/apple-targets`). Both are in every prebuild. Static imports.
- [x] **T-086 `DEAD` L** — Redundant guard in `offline/DownloadsProvider.tsx:426-427` (`installedApp &&` after `if (!installedApp) return`).
- [x] **T-087 `HARDCODE` L** — "500 MB" prose in `offline/PlaybackNotices.tsx:57` and `settings/OfflinePanel.tsx:98` while `LARGE_SYNC_BYTES` exists in `packages/client/src/downloads/syncPolicy.ts:19`.
- [x] **T-088 `PROPER` L** — `MutableRefObject` (deprecated in React 19 types) in `player/usePlayReporting.ts` and `useSleepTimer.ts`. `RefObject<T>`.
- [x] **T-089 `PROPER` L** — Query key roots re-declared locally: `usePlayReporting.ts:11` (`['stats']`), `connection/useServerSongIds.ts:22,28` (`['cloud-uids', …]`). Add to `queryKeys`.
- [ ] **T-090 `PROPER` L** — Hidden import-order coupling: `offline/listenOutbox.ts:5` imports `../api/client` for its `configureClient` side effect. Move `configureClient` to the app entry.
- [ ] **T-091 `PROPER` L** — Platform twins repeat code: `offline/covers.ts` vs `covers.web.ts` (`servedName` parser, `PICTURE`, seven re-exports); `ports/device.ts` vs `device.web.ts` (`ID_KEY`, `NAME_KEY`, `getDeviceId`, `generateId`); `ports/cloudPlatform.ts:125-127` vs `.web.ts:86-88` (doorman URL); `ports/engine.web.ts:34-68` re-declares the port's `EngineState`/initial state. Shared `.model.ts` files per twin.
- [x] **T-092 `PROPER` L** — `ports/downloadStorage.web.ts:46-57,125-134` reads `window.localStorage` directly instead of the `prefs` port.
- [ ] **T-093 `HARDCODE` L** — Motion literals inline while `MOVE_MS` exists: `shell/Shell.tsx:183,190,245,301,413,427`. Colour/size literals in shell: `PlayerBar.tsx:143,604,611,642,678`, `Sidebar.tsx:638-800` (`borderRadius: 12` ×4, `fontSize: 13` ×4), `connection/ServerAway.tsx:64-74`.

---

## apps/app — features and ui

### Dead leftovers
- [x] **T-100 `DEAD` M** — Second `BrandMark`: the SVG one in `ui/components/Icons.tsx:678-698` is never imported; both callers use the view-built `ui/components/BrandMark.tsx`, whose "no SVG renderer in this app" header is stale. Keep the SVG, delete the other.
- [x] **T-101 `DEAD` M** — Four glow styles left by the SVG rewrite: `nowPlaying/NowPlayingStage.tsx:814-846` (`glow`, `glowOne/Two/Three`).
- [x] **T-102 `DEAD` L** — `IconButton.round` (`ui/components/IconButton.tsx:43-44`) is a `@deprecated` compat prop with zero callers.
- [x] **T-103 `DEAD` L** — `ui/useReducedMotion.ts` is a pure alias of `useMotionReduced` (three callers).
- [x] **T-104 `DEAD` L** — `Clock` icon (`Icons.tsx:528-536`) has no callers.
- [x] **T-105 `DEAD` L** — Unreferenced styles: `SongRow.tsx:873-879` (`duration`), `SongRow.tsx:853` (`rowTagMore` is a no-op override), `HomeScreen.tsx:607` (`link`), `ImportScreen.tsx:519` (`done`), `SelectionBar.tsx:623` (`floatBottom.bottom` always overridden at `:338`).
- [x] **T-106 `DEAD` L** — `layer` unused in `nowPlaying/SongVisual.tsx:357` (`HILL_LAYERS.map((layer, index)`; `HillLine` re-reads `HILL_LAYERS[index]`). The other `--noUnusedLocals` hit.
- [x] **T-107 `DEAD` L** — Stale section-divider comments from the pre-split Settings file: `SettingsScreen.tsx:442,479,481`, `ShortcutsPanel.tsx:39`, `LibraryPanel.tsx:162`, `AppearancePanel.tsx:72`, `DevicesPanel.tsx:246`, `OfflinePanel.tsx:259`, `ImportingPanel.tsx:46`.
- [x] **T-108 `DEAD` L** — `<ButtonRow>{null}</ButtonRow>` renders an empty row with margin (`settings/CloudPanel.tsx:542`).
- [x] **T-109 `DEAD` L** — Settings section id `connection` kept "because its id is older than its name" (`settings/settings.model.ts:34-36`; one link in `library/CantReach.tsx:46`). Rename to `account`.
- [x] **T-110 `DEAD` L** — `NewPlaylist.anchorRef` prop accepted and ignored (`playlists/NewPlaylist.tsx:48-65`); `Sidebar.tsx:277` still plumbs `plusRef`.
- [x] **T-111 `DEAD` L** — Duplicated doc comment on `dropTarget` (`SongRow.tsx:170-171`).

### Hardcoded values vs theme tokens
- [x] **T-120 `HARDCODE` M** — `SIDEBAR_WIDTH = 244` re-declared in `ui/components/SongRow.tsx:45` while `shell/Sidebar.tsx:98` exports it.
- [x] **T-121 `HARDCODE` M** — `BAR = 84` in `NowPlayingStage.tsx:70` duplicates `PLAYER_BAR_HEIGHT` (`shell/PlayerBar.tsx:63`); `stageMove.model.ts:25` `COVER_TOP = 84` is the same coincidence.
- [ ] **T-122 `HARDCODE` M** — Three different modal backdrops, none from the palette: `Sheet.tsx:248`, `QueueSheet.tsx:540` (`rgba(0,0,0,0.55)`); `ConfirmDialog.tsx:85`, `ConfirmRemoveSongs.tsx:76` (`oklch(… 0.62)`); `CommandPalette.tsx:257`, `MetadataDialog.tsx:276`, `FixMetadata.tsx:101` (`… 0.6`). Add `theme.colors.backdrop`.
- [ ] **T-123 `HARDCODE` M** — Danger/warning/good "wash" colours re-derived in `ConfirmRemoveSongs.tsx:263`, `settings/SettingsParts.tsx:157-159`, `migrate/MigrateScreen.tsx:60-64`, `metadata/MetadataDialog.tsx:36-39`, `SongRow.tsx:771` (`Sheet.tsx:338` does it right with `withAlpha`). Palette tokens `dangerWash`/`warningWash`/`goodWash`.
- [x] **T-124 `HARDCODE` M** — Cover shadows hard-code black: `NowPlayingStage.tsx:889-892`, `NowPlayingScreen.tsx:893-897`, `QueueRail.tsx:550`; `surfaces.ts:151` (`artShadow`) exists for exactly this.
- [ ] **T-125 `HARDCODE` M** — Placeholder tile colour is an `hsl()` literal (`Cover.tsx:60`), the same grey in both themes; every other tile goes through `tileTone`/`tagColors`.
- [ ] **T-126 `HARDCODE` L** — Tag-editor swatches hand-compute OKLCH (`TagEditor.tsx:151-157`) instead of `tagColors(hue)`; `Checkbox.tsx:8` `DANGER_TICK` instead of `onAccent`.
- [x] **T-127 `HARDCODE` L** — Raw `Easing.bezier(...)` re-typed in `Popover.tsx:145`, `ToastHost.tsx:82`, `NowPlayingStage.tsx:286,293` while `ui/motion.ts:90-91` exports `ease.out`/`ease.in`.
- [ ] **T-128 `HARDCODE` L** — Hold durations scattered: `Chip.tsx:81`, `SongRow.tsx:255,390` (450), `TagsScreen.tsx:339` (450), `HoldToReorder.tsx:48` (350). Side margins: `MiniPlayer.tsx:177-178` (12) vs `BottomNav.tsx:108` (16).
- [ ] **T-129 `HARDCODE` L** — `borderRadius: 999` ×6 instead of `radius.pill`; ad-hoc row radii 12/14 in ~15 files; page top padding differs per phone screen (4/6/10/12/16/18). Add `radius.row`, `space.pageTop`.
- [x] **T-130 `HARDCODE` L** — Settings index column width as arithmetic (`SettingsScreen.tsx:524` `32 + 172 + 32` vs `:534`).
- [ ] **T-131 `HARDCODE` M** — `'Unknown artist'` literal 37 times (`SongRow.tsx`, `SongMenu.tsx`, `SelectionBar.tsx`, `MiniPlayer.tsx`, `QueueSheet.tsx`, `QueueRail.tsx`, `NowPlayingScreen.tsx`, `NowPlayingStage.tsx`, `ArtistLinks.tsx`, …); `stats.model.ts:266` defines `UNKNOWN_ARTIST` for itself. It is a protocol constant (the server emits it): `artistName(song)` in shared.

### Duplication across screens
- [ ] **T-140 `PROPER` M** — Hand-rolled playlist creation + "New playlist N" naming in five places (`SelectionBar.tsx:174-193`, `NewPlaylist.tsx:114,133`, `PlaylistDetailScreen.tsx:341-363`, `library/saveTags.ts:57-66`); the client has no `useCreatePlaylist`. Add it (invalidating inside) plus `uniqueName(base, taken)`.
- [ ] **T-141 `PROPER` M** — Four copies of the "song list with ⋯ menu" plumbing (`LibraryScreen.tsx:153-196`, `SearchScreen.tsx:404-478`, `tag/PlacePage.tsx:275-294`, `PlaylistDetailScreen.tsx:184-274`). Promote Search's `useSongRows`.
- [ ] **T-142 `PROPER` M** — Five hand-rolled dialog shells (`ConfirmDialog.tsx:83-113`, `ConfirmRemoveSongs.tsx:74-195`, `MetadataDialog.tsx:271-335`, `FixMetadata.tsx:99-124`, `CommandPalette.tsx:251-505`), each with its own backdrop/escape/role/sizing. One `Dialog` primitive.
- [ ] **T-143 `PROPER` M** — `plural()` from shared bypassed by 6 local helpers (`migrate.model.ts:91`, `stats.model.ts:80`, `tag/AddSheet.tsx:204`, `song.model.ts:45`, `firstSync.model.ts:97`, `looks.model.ts:173`) and ~34 inline ternaries.
- [ ] **T-144 `PROPER` L** — Three `WEEKDAYS`, three `DAY_MS`, two relative-day formatters (`playlists.model.ts:93-122`, `song.model.ts:20-47,119`, `wrapped.model.ts:33`, `looks.model.ts:192`); see also T-172 for the SQLite-stamp parser. One `dates.ts` in shared.
- [ ] **T-145 `PROPER` L** — `useServerDirect → via` derived by hand in 8 screens; `noServer` / `['via-server', …]` keys in 3 sources; devices key built twice. `useVia()` + `viaKey()`.
- [ ] **T-146 `PROPER` L** — `if (router.canGoBack()) router.back(); else router.replace(fallback)` written 9 times. `useGoBack(fallback)`.
- [ ] **T-147 `PROPER` L** — Three copies of `openSearch` (`HomeScreen.tsx:96-99`, `LibraryScreen.tsx:386-390`, `TagsScreen.tsx:113-116`).
- [ ] **T-148 `PROPER` L** — Play / Shuffle / Save-these-tags block written twice in `LibraryScreen.tsx:345-376,456-488`.
- [ ] **T-149 `PROPER` L** — "Nothing playing" empty state duplicated (`NowPlayingScreen.tsx:139-156`, `NowPlayingStage.tsx:134-151`).
- [ ] **T-150 `PROPER` L** — `SeekBar.tsx:105-224` inline and full variants are ~60 duplicated lines.
- [ ] **T-151 `PROPER` L** — `useSleepMinutesLeft` and `useRemaining` are the same hook twice (`SleepMenu.tsx:105-127`).
- [ ] **T-152 `PROPER` L** — Platform twins duplicate constants/types: `Slider.tsx:17-20` vs `Slider.web.tsx:14-16` (`HUE_STOPS`); `SongVisual.tsx:50-59,544` vs `SongVisual.web.tsx:34-43,330` (`SongVisualProps`, `RING_INKS`).
- [x] **T-153 `PROPER` L** — `TagsScreen.tsx:117-124` `edit` and `editTag` do the same thing; `ImportTags.tsx:22-40` `TagSheet` re-implements `TagChooser`'s sheet.
- [ ] **T-154 `PROPER` L** — ~60 icon wrappers in `Icons.tsx` are copy-paste; a `makeIcon(paths, tone)` factory.

### Performance
- [ ] **T-160 `PERF` M** — `tags` array rebuilt per row per render defeats `SongRow`'s memo: `SearchScreen.tsx:462-465` (inline `flatMap`), `queue/useQueueEdits.ts:73-80` (`tagsOf` fresh array, used by `QueueSheet.tsx:205`). Library solved this with `songTagLookup` (`library.model.ts:208`, exported, used nowhere else). Share it.
- [ ] **T-161 `PERF` L** — Every icon subscribes to the theme twice (`Icons.tsx:41-80`: `useInk` in the wrapper and again in `Icon`).
- [ ] **T-162 `PERF` L** — Accent picker rebuilds 7 palettes on every drag frame (`AppearancePanel.tsx:51`).
- [ ] **T-163 `PERF` L** — Wrapped palettes rebuilt per render (`looks.model.ts:721-755` `lookInk`, `ReportScreen.tsx:461-465`, `looks/Paper.tsx:20`, `Calendar.tsx:24`, `FrontPage.tsx:32`, `Words.tsx:62`).
- [ ] **T-164 `PERF` L** — Per-frame object allocation for a debug recorder that is almost always off (`SongVisual.web.tsx:108-118`), with an unsafe `trace` cast.
- [ ] **T-165 `PROPER` L** — `useSongRows` re-keys rows via an `eslint-disable` on `query` (`SearchScreen.tsx:469-471`). Key the list on `query` at the call site.

### Robustness
- [x] **T-170 `ROBUST` L** — `setTimeout` in `onPanResponderRelease` never cleared: `SeekBar.tsx:90`, `QueueSheet.tsx:500-503`.
- [ ] **T-171 `ROBUST` L** — Silent failures where the user pressed something: `SongMenu.tsx:181-186` (`playSimilar`), `playlists/usePlaylistPlayback.ts:86-89` (`playById`). Toast in the catch.

---

## packages (client, shared, replica, desktop-bridge)

### Contract drift
- [ ] **T-172 `PROPER` M** — "SQLite stamp → Date" parsed by hand in eight places (`client/src/import/model.ts:133-135`, `client/src/songs/facts.ts:101`, `shared/src/format.ts:43`, `server/src/repositories/wrapped.ts:234`, `extension/src/popup/popup.model.ts:199`, `app/features/playlists/playlists.model.ts:107,159`, `app/features/song/song.model.ts:28`) while shared owns only `toSqliteTime`. Add `parseSqliteTime`.
- [ ] **T-173 `HARDCODE` M** — Ten response schemas declared inline in `packages/client/src/api/api.ts` (`:87-90, 229, 252-257, 261-262, 272-277, 326-327, 354-355, 380-386, 394-400, 404-413, 432, 525-541`) although shared's rule is "if a value crosses the network, its schema lives here". Shared already has `OkSchema`, `ErrorBodySchema`, `ToolStatusSchema`, `PlayRecordedSchema` unused; `extension/src/bridge.ts:101` is a third `OkSchema`. The server returns these shapes as untyped literals. Move them to `schemas/*.ts` and parse on both sides.
- [x] **T-174 `DEAD` L** — Shared exports referenced nowhere (invisible to `check:exports` because `schemas/` is excluded): `ToolStatusSchema`, `PlayRecordedSchema`, `SaveLyricsSchema` (server inlines the same shape at `routes/songs.ts:390`), `STATS_RANGE_LABELS`, `MOTION_RATE` (server has its own `MOTION_FRAME_RATE = 20` at `dsp.ts:520`), `DoormanHealthSchema` (`replica/routes.ts:578-587` calls `/v1/health` unparsed). Wire or delete; narrow the checker's exclusion to `*Schema` names.
- [x] **T-175 `DEAD` M** — `playThreshold` (`shared/src/schemas/settings.ts:15-17`) is a setting nothing reads; play counting is the flat minute in `client/listens/counting.ts:25`.
- [ ] **T-176 `PROPER` L** — `CloudSmartRulesSchema` (`schemas/cloud.ts:161-167`) re-declares `SmartRulesSchema` without its `.max(20)`/`.max(5000)` bounds; `toCloudRules`/`fromCloudRules` are near-identical mappers. One `smartRulesShape()` factory.
- [x] **T-177 `PROPER` L** — `PlaybackState` exported by both `desktop-bridge/src/schemas.ts:110-116` and `shared/src/schemas/devices.ts:29-42` with unrelated meanings. Rename the bridge's `DockPlaybackState`.

### Compat shims to delete
- [x] **T-180 `DEAD` M** — `migrateCloudSnapshot` (`shared/src/schemas/cloud.ts:254-289`, called from `replica/src/library.ts:365-367`): the `features → audioFeatures` rename shim for snapshots written before 2026-09-14. Republish any dev bucket that still needs it, then delete.
- [x] **T-181 `DEAD` M** — `DownloadEntry.rev` optional "because an index written before this existed has none" (`client/src/downloads/downloadIndex.ts:26-38,102-104`); an old entry silently streams instead of playing its file forever. Make it required; clear Settings → Offline on the two devices.
- [x] **T-182 `DEAD` L** — Defaults kept "for an older server's answer": `schemas/cloud.ts:409-414` (`waiting`), `:420-427` (`restoring`), `schemas/song.ts:213-220` (`romanized`), `song.ts:22-29` (`palette`, keep only if the server can genuinely omit it). Consumers carry `?? null` because of them.
- [x] **T-183 `DEAD` L** — `useServerSettings` is an explicit alias for `useSettings` "kept so existing call sites did not have to move" (`queries.ts:1023-1033`; one caller in `PlayerProvider.tsx:40,235`).
- [x] **T-184 `DEAD` L** — `radius.sm`/`radius.lg` are "the old scale, kept only until the last caller has moved" (`client/src/theme/tokens.ts:249-265`); `md` has two callers in `FirstSyncScreen.tsx:211,255`.
- [x] **T-185 `DEAD` L** — `ClientPlatform` (`client/src/platform.ts:162-166`, `index.ts:12`) exported and implemented by nothing; `ClientRuntime` is what apps use.
- [x] **T-186 `DEAD` L** — `SongFiles.motion` optional though every producer sets it (`replica/src/snapshotLibrary.ts:42,99`); dead `song.rev ?? ''` and `songs[song.uid] ?? 0` fallbacks (`replica/src/library.ts:842`, `snapshotLibrary.ts:194-197`).
- [x] **T-187 `DEAD` L** — Orphaned comments: `shared/src/titles.ts:126-129` (old doc block above `namesChannel`), `desktop-bridge/src/bridge.ts:143-148` (history about a deleted plan doc).

### Queries and queue
- [ ] **T-188 `PROPER` M** — Two hooks for one query key with different `staleTime`, `enabled` and null-key spelling: `usePlaylistSongIds` (`queries.ts:675-692`, 5 min, `['playlist','none']`) and `usePlaylistSongs` (`:930-943`, 30 s, gated on `ready`); `useSimilar` (`:760`) hand-writes `['similar','none']`. One hook with an options bag; derive disabled keys from `queryKeys`.
- [ ] **T-189 `HARDCODE` L** — Page-size defaults in `api.ts` never the ones used (`gems` 20 vs 12, `similar` 20 vs 12, `history(200)` in two files, server max 500). Name them once beside the hooks.
- [ ] **T-190 `PERF` M** — Quadratic work when a whole library is enqueued (`client/src/downloads/queue.ts:168-171` `includes` filter, `:256` rebuild per song, `:281` manifest `find` per song). A `Set` of queued ids, a `Map` for the manifest.
- [x] **T-191 `ROBUST` L** — `DownloadQueue.remove()` commits the index before the file is gone (`queue.ts:226-235`; `DownloadStorage.delete` typed `void`, web/desktop impls swallow the rejection). Make `delete` async and `allSettled`.
- [ ] **T-192 `PROPER` L** — `cloudAnswer` and `request` duplicate parse-and-wrap with different wording (`api.ts:126-141`, `:216-226`).

### Replica
- [x] **T-193 `PERF` M** — `Array.includes` inside a filter over all songs for bulk routes (`replica/src/routes.ts:185-189`, `:316-320`): O(songs × ids) on the UI thread inside the exclusive lock. `new Set(songIds)`.
- [ ] **T-194 `PERF` L** — Linear `find` per answer (`routes.ts:556-573`, `edits.ts:49-60`) while `view.ids`/`view.uids` are already Maps; session read from the store on every cloud request (`routes.ts:510`, `library.ts:676`). Keep `byId` maps; cache the session.
- [ ] **T-195 `ROBUST` L** — Stored replica state cast, not validated (`library.ts:228-246,263-264,885-897`); a corrupt IndexedDB row becomes an uploaded log file. `safeParse` on load.
- [x] **T-196 `HARDCODE` L** — `emptySnapshot()` hardcodes `format: 1` (`library.ts:294-304`; use `CLOUD_FORMAT`); `health()` answers `version: 'web'` on every platform (`routes.ts:577-587`).
- [ ] **T-197 `PERF` L** — Every non-deferred edit rebuilds the whole view (`library.ts:608-633`, `replay.ts:35-67`); `deferView` covers plays only. Only if it shows.
- [ ] **T-198 `PERF` L** — `tagRemoved`/`songRemoved`/`tagNamed` walk the whole library per change in `shared/src/sync.ts:133-146,218-246,393-398`. Only if it shows.

### Small
- [x] **T-199 `PROPER` L** — HSL→RGB written twice (`client/src/art/coverColor.ts:32-41`, `palette.ts:151-156`) and a double cast in `hexToRgb` (`palette.ts:106-108`); two relative-time formatters with different phrasing (`client/src/devices/handoff.ts:46-54` vs `shared/src/format.ts:41-55`).

---

## apps/desktop

- [x] **T-200 `PROPER` M** — Two replies cast instead of parsed in `preload/preload.ts:135,143-144` (`updates.check`, `loginItem.get/set`) and `headers` cast in `main/ipc.ts:106`, against each file's own "every argument is parsed here" rule. Export `headersSchema`, parse with `updateStatusSchema`/`z.boolean()`.
- [x] **T-201 `DEAD` L** — `resumeFrom` never sent by any caller (`main/files.ts:93`, `desktop-bridge/src/schemas.ts:189-190`); if it were and disagreed with the `.part` size it would corrupt the file. Delete; derive from `sizeOf(part)`.
- [x] **T-202 `SECURITY` L** — Media handler echoes any `Origin` with credentials (`main/protocol.ts:137-141`). Echo only `APP_ORIGIN` or the dev URL.
- [x] **T-203 `HARDCODE` L** — `app://selfmp3/_media/` and the `selfmp3` scheme spelled out in `preload.ts:119`, `protocol.ts:26,50`, `main.ts:87,89`, `deepLinks.ts:15`, `desktop-bridge/src/schemas.ts:79`. Constants in `desktop-bridge/src/channels.ts`.
- [ ] **T-204 `HARDCODE` L** — GitHub owner/repo in `updates.ts:25-28`, `menu.ts:96`, `electron-builder.yml:87-88`, `package.json:10`; a fork ships an updater pointed at upstream. Derive from `GITHUB_REPOSITORY` in `desktop.yml`.
- [ ] **T-205 `ROBUST` L** — Bounds save debounced 400 ms past the window's death (`main/bounds.ts:87-104`); on `close`, flush synchronously.
- [x] **T-206 `PROPER` L** — Window creation + `closed` handler duplicated (`main.ts:44-47,95-98`); `http(s)` allow-check duplicated in both navigation guards (`window.ts:77-86`); orphaned "Phase 4" comment (`ipc.ts:131-136`).

---

## apps/doorman

- [ ] **T-210 `PROPER` M** — `checkFormat` (`storage.ts:120-152`) is a verbatim copy of the server's `#checkFormat` (`cloudSync.ts:1330-1360`), messages and `app: 'self.mp3'` literal included. A pure `judgeFormatDocument` + `CLOUD_APP_NAME` in `packages/shared/src/cloud.ts`.
- [ ] **T-211 `HARDCODE` M** — `HASH_NAMED = /^(?:audio|covers|lyrics)\//` (`files.ts:42`) re-spells the folder list `FILE_KEY` in `shared/src/cloud.ts:180` owns. Export `isHashNamedCloudKey()` from shared.
- [ ] **T-212 `HARDCODE` M** — `wrangler.toml:25,31,50-51` re-lists the full origin set in `[env.dev.vars]` and inlines the extension id that `shared/src/origins.ts:18` exports. Keep only the extra dev origins in the dev block.
- [x] **T-213 `HARDCODE` L** — `DOORMAN_VERSION` kept in step with `package.json` by hand (`doorman.ts:29-30`); upload limit and its "100 MB" message drift independently (`files.ts:71,180`); "ten minutes" in copy while `SIGN_IN_TTL_MS` is the source (`auth.ts:208`, `signin.ts:21`).
- [x] **T-214 `PROPER` L** — 405 built twice (`files.ts:96-101`, `doorman.ts:141-146`); cache constants and clear-when-full rule duplicated (`sessions.ts:27-28,90-91`, `accounts.ts:42-43,181-184`); `Sessions.end` hashes the token twice (`sessions.ts:96-101`).
- [ ] **T-215 `ROBUST` L** — Signing-key cache depends on aws4fetch's private cache-key format (`bucket.ts:297-308`). Pin the version or add a cache-hit test.

---

## apps/extension

- [ ] **T-220 `PERF` M** — Every pill query does a fresh `/api/health` and `libraryVersion` round trip (`background/pill.ts:69,72`, `handlers.ts:142-153`, `content/youtube.ts:49-78`): 2–3 network calls per redraw, every 1.5 s while importing, although the route probe is memoised for 60 s. Expose `router.route()`; remember `songCount` in the route memo.
- [x] **T-221 `HARDCODE` M** — Badge colours hand-copied from the theme (`background/index.ts:31`: `#d4503f`, `#7b76e8`) while the worker already bundles `@selfmp3/client/core` and `scripts/theme.mjs` exists because hand copies drifted. `darkPalette(DEFAULT_ACCENT_HUE)`.
- [ ] **T-222 `SECURITY` L** — `servePage` accepts any tab sender (`bridge.ts:245`); also require `siteOf(hostname) !== null`.
- [x] **T-223 `DEAD` L** — `Cloud.forget` never called (`background/cloud.ts:40,111`); `doormanUrl` option never passed (`cloudPlatform.ts:33,57`); stale "review window" comment (`popup/page.ts:10`).
- [x] **T-224 `HARDCODE` L** — Canonical watch URL built by hand four times (`content/youtube.ts:52,71,88`, `background/pill.ts:68`); `http://localhost:4600` in two user-facing strings (`handlers.ts:181`, `options/Options.tsx:216`); icon path repeated and the manifest declares a 192 px PNG as the `"128"` and `"32"` icons (`index.ts:38`, `manifest.json:9,15`, `scripts/build.mjs:104-107`).
- [x] **T-225 `PROPER` L** — Identical `songs()` helper in `jobs.model.ts:74` and `popup.model.ts:457`.

---

## Tooling, CI, verify, repo state

- [x] **T-230 `HYGIENE` M** — `sharp` pinned `^0.34.5` in `apps/server` and `apps/desktop` below the hoisted `0.35.4`, so npm installs it three times and the Dockerfile (`:45-65,112-113`) carries `apps/server/node_modules` into the runtime image to cope. Bump to `^0.35.4`, delete the workaround.
- [x] **T-231 `DEAD` M** — `@playwright/test` in `apps/app/package.json:63` (`^1.56.0`, root is `^1.63.0`) is unused; `apps/app/eslint.config.js:26-28` ignores `test-results/` and `playwright-report/` for a suite that no longer exists.
- [ ] **T-232 `HYGIENE` M** — The hermetic extension e2e suite (`verify:extension`, fake server in-process) and the desktop smoke (`verify:desktop`, mock keychain) never run in CI (`check.yml`, `extension.yml`, `desktop.yml`).
- [ ] **T-233 `HARDCODE` M** — `apps/server/public/admin.html:48` links to `xiao215.github.io/selfmp3/`; every self-hoster's "In a browser → Open" goes to the upstream deployment. Inject from a `SELFMP3_APP_URL` config value.
- [ ] **T-234 `HARDCODE` M** — `scripts/install-service.sh:75,113,121` and `scripts/setup-mac.sh:147` hard-code 4600 while `doctor.sh` and `_dirs.sh` read `SELFMP3_PORT`; a changed port gets a service on the default. Add `PORT` to `_dirs.sh`.
- [x] **T-235 `DEAD` M** — Three byte-identical `verify/tsconfig.json` files (`verify/`, `apps/desktop/verify/`, `apps/extension/verify/`) that nothing runs and that drift from `tsconfig.base.json`. Share one base and add a `typecheck:verify` step, or delete them.
- [x] **T-236 `HYGIENE` L** — `apps/app/package.json:12` names a script `prebuild`, an npm lifecycle hook: the first `build` script added there will run `expo prebuild --clean` (deletes `ios/`, `android/`) before every build. Rename to `native:prebuild`.
- [x] **T-237 `DEAD` L** — Root `clean` misses `apps/*/dist-types`, `apps/app/dist`, `apps/app/public/sw.js`, `.expo`, `apps/desktop/release`, `apps/desktop/resources`, `apps/extension/src/ui/{theme,fonts}.css`, and the untracked leftover folders `apps/mobile`, `apps/web`, `packages/cloud` (node_modules/dist only; zero tracked files, zero references). `npm run clean --workspaces --if-present` plus `rm -rf` of the three.
- [x] **T-238 `DEAD` L** — Ignore patterns for things that no longer exist: `eslint.config.js:10` and `apps/app/.gitignore:14` (`dist-pages`), `eslint.config.js:16-17` and `.prettierignore:3-4` (`library/**`, `data/**`).
- [x] **T-239 `HYGIENE` L** — Node version says three things (`engines >=22`, workflows 24, Dockerfile 22, desktop `target: node24`); GitHub Actions pinned at `v4` in `docker.yml` and `v5–v7` elsewhere; `@types/react` pinned `~19.2.18` in app and `^19.2.18` in extension (two installed copies).
- [ ] **T-240 `PROPER` L** — Cross-workspace deps not declared: desktop imports `@selfmp3/shared` (`main/protocol.ts:7`, tsconfig references it) without listing it; `extension/scripts/theme.mjs` resolves `@expo-google-fonts/*` and `@selfmp3/client/core` unlisted; `build.mjs` copies `apps/app/public/icons/icon-192.png`.
- [x] **T-241 `PROPER` L** — `packages/client/tsconfig.json:6-7` says "No DOM, the same rule shared and replica follow" but `packages/shared/tsconfig.json:6` loads `DOM`; shared is imported by the Workers doorman. Drop `DOM` from shared if it compiles.
- [ ] **T-242 `PERF` L** — Docker builder installs the whole root devDependency set for one `tsc` (`Dockerfile:37-38`); `docker.yml` rebuilds on app-only pushes (`paths-ignore` instead of `paths`); `docker-compose.yml:23-33` duplicates `.env.example` instead of `env_file: .env`.
- [x] **T-243 `PERF` L** — `verify/playwright.config.ts:64-98` has no `webServer` / `reuseExistingServer`; `verify/flows/helpers.ts:34,64` export `songTable`/`unreachable` used only in-file; `verify/README.md:8-14` still describes phase-1 migration state.
- [x] **T-244 `HYGIENE` L** — `verify:extension` duplicated between root and `apps/extension/package.json:10`; README scripts table (`README.md:307-330`) omits `build:extension`, `zip:extension`, `check:exports`, `verify:extension`.
- [ ] **T-245 `HARDCODE` L** — `staleTime: 60_000` spelled ~15 times across `packages/client/src/queries/queries.ts` and `apps/app/src/features/*` with no shared constant.

---

## Suggested order

1. **Bugs first** (a day): T-001, T-002, T-003, T-004, T-006, T-007, T-008, T-009, T-010, T-011, T-072, T-191.
2. **Delete dead code** (an afternoon, mechanical): T-005, T-014, T-070/T-071, T-079, T-100–T-111, T-174, T-175, T-180–T-187, T-201, T-223, T-231, T-235, T-237, T-238.
3. **One-source constants** (a day): T-012, T-020, T-120, T-121, T-122, T-123, T-124, T-131, T-172, T-173, T-203, T-210–T-212, T-221, T-233, T-234.
4. **Tooling** (half a day): T-013, T-230, T-232, T-236, T-239–T-244.
5. **Shared primitives** (as screens are next touched): T-140–T-154, T-030–T-037, T-043, T-060, T-142.
6. **Perf** (when measured): T-040, T-047, T-048, T-073–T-076, T-160–T-164, T-190, T-193, T-194, T-220.

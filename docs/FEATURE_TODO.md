# What is not built yet

The work that was planned, researched or deferred and has not been done. Three finished plans
used to carry these lists (the one-app migration, the desktop app, the browser extension);
the plans are gone now that they are built, and what they left open is here so it is not
re-derived. The research that went with each item is kept, because it was the expensive part.

Two other places hold open work and are not repeated here:

- [UI-MIGRATION.md](UI-MIGRATION.md): moving the app to the redesigned interface. A whole
  plan, with its own phases and open questions.
- [SYNC.md](SYNC.md), "Still to come": adding a file from a device, Android fetching links
  itself, snapshots written from the log, and the rest of what the bucket does not do yet.

Nothing here is scheduled. When something is built, delete its entry and say what it does
in the feature's own document under `docs/features/`.

---

## The iPad

The phone app runs on an iPad today in portrait only, with the layout its width gives it
(834 was checked and fixed: safe area, bar, header). Finishing it is independent of
everything else and can run on its own branch.
The boards are `T01`–`T09` in [ui-mock](ui-mock/index.html#ipad): portrait, landscape,
Split View, Slide Over, and every width where the layout gives way (`T09`).

- **Orientation.** The iPhone stays portrait; the iPad gets all four. In `app.config.js`,
  `orientation: 'portrait'` stays, because Expo's plugin writes only
  `UISupportedInterfaceOrientations` and never the `~ipad` key, and
  `ios.infoPlist['UISupportedInterfaceOrientations~ipad']` lists the four by name.
  `ios.requireFullScreen` stays false: Apple deprecated `UIRequiresFullScreen` in iPadOS 26
  (TN3192), and iPadOS 26 rotates an iPad regardless of the mask when rotation lock is off.
  No `expo-screen-orientation`: a static mask does not need it, and react-native-screens
  4.23+ conflicts with its lock.
- **Widths.** The layout is decided by width, so nothing should change; check that it does
  not at 1194 (landscape), 834 (portrait), 678 and 507 (Split View), 375 and 320 (Slide
  Over, the phone layout narrower than it has ever been drawn). Crossing 820 while resizing
  must not remount the screen; `Shell.tsx` promises this and
  `verify/flows/navigation.spec.ts` checks it in a browser at 1194 → 507 as the stand-in,
  since `simctl` cannot rotate or split. One known hazard: React Native's `Dimensions`
  change event has failed to fire on the first entry into Split View
  (facebook/react-native #28935; its state under Fabric is unconfirmed). If the simulator
  shows it, `useLayout` takes its width from an `onLayout` on the root view as well, and
  the larger of the two wins.
- **Trackpad hover.** `Pressable` on iPadOS reports `onHoverIn`. `finePointer` stays false
  for now, so controls stay finger-sized and always visible, the right default for a tablet.
- **Checks.** `.maestro/smoke.yaml` on an "iPad Pro 11-inch" simulator in portrait;
  landscape and Split View by hand, once. Done when `npm run check:app` is green, the phone
  flows pass in a browser at 1194 and at 507, and the four orientations are in
  `ios/…/Info.plist` after prebuild.
- **Hardware keyboard shortcuts.** Deferred by Xiao on 2026-09-14. React Native core
  delivers no key events on iOS and Expo has no module for it, so the way in is a local Expo
  module (`apps/app/modules/key-commands`, about 60 lines of Swift over `expo-modules-core`)
  that adds `UIKeyCommand`s with a `discoverabilityTitle` to the root view controller and
  emits `{ input, modifiers }` to JS. Then `useHotkeys.ts` and `useEscape.ts` on native
  register the web's set, and Settings shows Shortcuts when a keyboard is attached
  (`sectionsFor` already takes the flag). Two UIKit rules: an unmodified command (Space,
  digits, arrows) beats a focused text field, so those are withdrawn while a `TextInput`
  has focus; arrows need `wantsPriorityOverSystemBehavior`. Packages checked in September
  2026 and passed over: `react-native-key-command` (Expensify, 1.0.16) works but needs an
  `AppDelegate` patch, has no config plugin and no `discoverabilityTitle`;
  `react-native-keyevent` is unmaintained; `react-native-keyboard-controller` is the soft
  keyboard only; `react-native-external-keyboard` is focus-scoped. It needs a dev client
  rebuild and a Stack line in [ARCHITECTURE.md](ARCHITECTURE.md).

## The desktop app

What exists is in [features/desktop-app.md](features/desktop-app.md).

- **Streaming from the bucket.** Signed in to the cloud, the desktop plays only what it has
  downloaded (`playBlock('cloud')`), because an `<audio>` element cannot send the doorman's
  header. The browser streams through its service worker and the phone through its player,
  which takes headers with each track (`apps/app/src/ports/bucketMedia.ts`); the desktop is
  the one platform left without. Its equivalent is a range proxy in the main process at
  `app://selfmp3/_stream/<key>` that adds the header: the service worker's `cloud` branch,
  in Node. Worth doing; not needed for "download by default".
- **Windows and Linux.** `electron-builder --win --linux` on their runners, deep-link
  registration through the NSIS installer, media keys through Chromium's controls, and a
  pass over the menu's accelerators. The targets are in `apps/desktop/electron-builder.yml`
  and are not built or tested. Nothing in the shell prevents it.
- **A signed build.** Signing, the hardened runtime, notarization and auto-update all work
  from the same script when `CSC_LINK` and `CSC_KEY_PASSWORD` exist. They need a Developer
  ID, which needs the paid Apple Developer Program. Until then builds are ad-hoc signed and
  "check for updates" opens the release page. The signed tier has never been run.
- **Embedding the server.** `utilityProcess.fork` of `apps/server/dist/main.js`, with
  better-sqlite3 and sharp rebuilt for Electron's Node ABI, yt-dlp and ffmpeg found on
  `PATH` or bundled, and the library folder chosen in Settings. This is what would let the
  app replace `scripts/setup-mac.sh` on the computer that holds the music. It waits because
  the server is moving to a Pi, and because it is the one thing that would put native
  modules and a rebuild step into a shell that has none.
- **A tray icon or a floating mini player.** Not wanted for now: Now Playing in Control
  Center covers the need on macOS.

## The phone

- **Streaming and downloading from the server when it is reachable**, on a phone that is
  signed in to the cloud. A device would need one identity for a song across both
  answerers, which is `uid`, and the download index keyed by it. A feature of its own, not
  a small change.
- **Android.** No Android binary has ever been built and nothing has run on a physical
  Android device; [MOBILE.md](MOBILE.md) says exactly what has and has not been seen.

## The browser extension

What exists is in [features/browser-extension.md](features/browser-extension.md). Every
phase of its plan is built, the bucket path included. The letters are the ones the options
had when they were reviewed.

Accepted for later:

- **E2: read another site's track list** and hand it to Migrate.
- **H1: YouTube sign-in handoff**, straight to the server only.
- **D1: checks on thumbnails**, built on the link index the extension already keeps.
- **G1: a live-version suggestion**, reusing `migrateScore`.
- **K2: Firefox**, which needs a little of its own. **K3: Safari**, which would ride along
  inside the Mac app.
- **Undo** after a song is in. Today the pill says *Added* and stops; cancelling is
  possible only while the download is running.

Checks that only a person can do, and whether they have been done. Playwright's Chromium
cannot do them: real Chrome ignores `--load-extension`, and nothing automated can sign in
to Google or reach a Tailscale address.

| Check | State |
|---|---|
| Load unpacked in real Chrome | Done 2026-09-16 |
| The pill on a real YouTube watch page | Done 2026-09-16: it lands in YouTube's own button row, left of Like, and reads the library correctly |
| Import a song from YouTube and one from YouTube Music | Not recorded |
| A playlist with "Also create playlist" | Not recorded |
| The pill on three videos in a row without reloading | Not recorded |
| A right-click import from a link on another site | Not recorded |
| The notification after a batch finishes | Not recorded |
| Server asleep → "Waiting for your server" → wake it → added | Not recorded |
| From the worker's DevTools, `GET /api/health` and a `POST` to the server's `100.x` and `ts.net` addresses: no prompt, no address-space error | Not recorded |
| Google sign-in from the options page, with an allowed and a refused account | Not recorded |

## Tooling

- **pnpm and Turborepo.** The 2026 default, deliberately not adopted: MOBILE.md records how
  fragile the lockfile already is around React singletons, and a solo project gains nothing
  from a cached task graph. Revisit only when CI time hurts.

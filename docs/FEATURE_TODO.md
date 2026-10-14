# What is not built yet

The work that was planned, researched or deferred and has not been done. Finished plans do
not stay in `docs/`; what they left open is here so it is not re-derived. The research that
went with each item is kept, because it was the expensive part.

[SYNC.md](SYNC.md), "Still to come", holds the rest of the open work on the bucket (adding a
file from a device, Android fetching links itself, a Google Drive driver) and is not
repeated here.

Nothing here is scheduled. When something is built, delete its entry and say what it does
in the feature's own document under `docs/features/`.

---

## The iPad

Built to the boards `T01`–`T09` in [ui-mock](ui-mock/index.html#ipad) on 2026-09-19: the
iPad turns every way (`UISupportedInterfaceOrientations~ipad` in `app.config.js`; the
iPhone stays portrait), each width in `T09` gives way as drawn, Now Playing stacks in
portrait, a finger gets no select circle or hover play in a row (holding a row selects), and
crossing 820 keeps the page (`Shell.tsx` is one tree at every width;
`verify/flows/navigation.spec.ts` checks 1194 → 507 → 1194 in a browser). Checked on the
iPad Pro 11-inch simulator in portrait (`.maestro/tablet.yaml`) and at 1194, 678, 507 and
320 in a browser. What is left:

- **Split View on the simulator, by hand, once more.** Landscape was checked on the iPad
  Pro 11-inch on 2026-09-19 (Home as `T06`, a tag page, Now Playing). Split View on
  2026-09-20 showed the hazard below for real — at about 600 points the app went on
  drawing the sidebar and the stage — so `useLayout` now prefers the root view's measured
  width (`shell/rootWidth.ts`); that wants confirming in Split View itself, which nothing
  here can enter. Notes for whoever does it: Maestro cannot turn an iPad and its taps land
  in the wrong place while one is turned (relaunch the app afterwards), so drive it by hand
  or by deep link (`xcrun simctl openurl <udid> selfmp3://tag/<name>` — which also pulls
  the app back to full screen), and `simctl io … screenshot` keeps the buffer portrait, so
  rotate the file to read it.
- **Trackpad hover.** `Pressable` on iPadOS reports `onHoverIn`. `finePointer` stays false
  for now, so controls stay finger-sized and always visible, the right default for a tablet.
- **A song list's arrows, Space and Enter with a hardware keyboard.** The menu's keys, Escape
  and a list's ⌘A are key commands on an iPad ([MOBILE.md](MOBILE.md), "A hardware
  keyboard"); moving between rows is not. On the web a row is a focusable button and the
  arrows move focus (`useListKeys.web.ts`); a native row is nowhere the keyboard can be, so
  it would need a row cursor of the list's own — which row, its ring, scrolling it into
  view under a pinned bar — kept in JavaScript and drawn by `SongRow`.

## The desktop app

What exists is in [features/desktop-app.md](features/desktop-app.md).

- **Windows and Linux.** `electron-builder --win --linux` on their runners, deep-link
  registration through the NSIS installer, media keys through Chromium's controls, and a
  pass over the menu's accelerators. The targets are in `apps/desktop/electron-builder.yml`
  and are not built or tested. Nothing in the shell prevents it.
- **A Developer ID build.** `apps/desktop/scripts/dist.mjs` picks one of three tiers from
  the environment: ad-hoc (nothing set), development (`CSC_NAME`, a certificate in this Mac's
  keychain) and signed (`CSC_LINK` and `CSC_KEY_PASSWORD`, notarised when Apple's credentials
  are there too, and the only one that installs its own updates). The signed tier needs a
  Developer ID, which needs the paid Apple Developer Program, and has never been run. Until
  then "check for updates" opens the release page.
- **A tray icon or a floating mini player.** Not wanted for now: Now Playing in Control
  Center covers the need on macOS.

## The phone

- **Android.** No Android binary has ever been built and nothing has run on a physical
  Android device; [MOBILE.md](MOBILE.md) says exactly what has and has not been seen.
- **The widget on a real iPhone.** It builds and runs on the simulator; a signed build needs
  the App Group `group.com.selfmp3.app` registered in a paid Apple Developer account and
  `ios.appleTeamId` in `app.config.js` ([features/widget.md](features/widget.md), "Building
  it"). A play button that plays without opening the app needs an App Intent in the app's
  process and is not built either.

## The browser extension

What exists is in [features/browser-extension.md](features/browser-extension.md). Every
phase of its plan is built, the bucket path included. The letters are the ones the options
had when they were reviewed.

Accepted for later:

- **E2: read another site's track list** and hand it to Import's review, as a Spotify or
  网易云 link is (docs/features/import-sources.md).
- **H1: YouTube sign-in handoff**, straight to the server only.
- **D1: checks on thumbnails**, built on the link index the extension already keeps.
- **G1: a live-version suggestion**, reusing `youtubeMatch`.
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
| A playlist link: its songs reviewed in the popup and imported (no playlist is made) | Not recorded |
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

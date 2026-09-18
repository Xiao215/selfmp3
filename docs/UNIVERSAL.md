# One app for three screens

> **Status: done.** Phases 1 through 5 are on `main`: `apps/web` and
> `apps/mobile` are deleted and `apps/app` is the only UI. This file stays as
> the record of the decisions — the stack, the ports, what does not port
> one-to-one — and everything below about phases, gates, the spike and the
> reference captures is history. The log of the run itself was taken out of the
> tree on 2026-09-18; `git log -- docs/universal-progress.md` finds it.

The plan for folding `apps/web` and `apps/mobile` into a single Expo app that
renders on iOS, Android and in the browser, with the phone treated as a first
surface rather than a companion.

Written for the person doing the work, which is likely to be an AI agent with
this document open and nobody watching. Every phase ends in something that
ships; nothing here requires a big-bang cut-over; every gate is a command
whose exit code decides. The last section is the runbook.

---

## Why

The web app came first, as a PWA. The phone app was added later for the three
things a browser cannot do on iOS: background audio, real offline files, and
Android Auto. That history is why they are two codebases that share logic and
duplicate every screen.

The premise has changed: the phone is at least as important as the desktop. Two
UI codebases only stay in step with discipline, and the gap already shows — the
phone has no devices/handoff, no tag editing, no practice tools, and until
recently drew its icons from a text font. Every desktop feature added from here
is one more thing the phone lacks.

The fix is one component tree. What follows is how to get there without
stopping to rewrite.

## Where things stand

Measured on the current tree, non-test lines:

| Area | Lines | Fate |
|---|---:|---|
| `packages/shared` (schemas, queue, lyrics, sort, sync) | 4,751 | unchanged |
| `packages/replica` (bucket library, session, replay) | 2,419 | unchanged |
| `apps/server` | — | unchanged, serves a different `dist` |
| `apps/web` views | 4,564 | rewritten as universal features |
| `apps/web` components | 10,020 | rewritten as universal components |
| `apps/web` CSS | 10,136 | becomes Unistyles sheets, roughly half the size |
| `apps/web` player | 1,823 | engine kept as the web implementation of a port |
| `apps/web` offline + service worker | 2,410 | kept as the web implementation of a port |
| `apps/web` devices | 1,186 | moved, gains the phone |
| `apps/web` lib (api, queries, hooks) | 2,638 | moved to `packages/client` |
| `apps/mobile` | 7,842 | becomes the seed of the universal app |

What is already universal: the API contract, the queue rules, lyric parsing and
sync, fuzzy search, sort order, smart-playlist rules, the cloud replay, and the
icon drawings (ported to `react-native-svg`, which renders on all three).

What is duplicated today and should never be again: the HTTP client, the
react-query hooks, the theme, every screen.

## The target

One workspace, `apps/app`, built with Expo SDK 57 on React Native 0.86 with the
New Architecture — the phone app's toolchain, extended to the web. It exports:

- an iOS app and an Android app (dev client, EAS or local build, as now);
- a web build the server serves at `/`, installable as a PWA, with the service
  worker and offline cache it has today;
- the same web build under `/selfmp3/` for GitHub Pages, signed in through the
  doorman (`EXPO_PUBLIC_CLOUD=1` replaces `VITE_CLOUD=1`).

The layout is decided by width, not by platform. Below 820 points it is the
phone: tab bar, mini player, full-screen now playing, sheets for menus. At 820
and above it is the desktop: sidebar, player bar, side panels, popovers. A
phone in landscape, an iPad, and a narrow browser window all get the right one
because they are the same code.

`apps/web` and `apps/mobile` are deleted when the last screen has moved. Until
then they keep working; the server can be pointed at either build.

## Foundations

These are the rules that make the app cheap to extend after the migration. They
are worth more than any phase below, and every phase is checked against them.
Where a rule can be enforced by a tool, it is; the runbook says how.

**1. No platform in packages.** `packages/shared` and `packages/replica` already
compile without the DOM library, so a reach for `window` fails at build time.
The new `packages/client` follows the same rule. If a package needs the
platform, it declares an interface and the app supplies it — the pattern
`packages/replica/src/platform.ts` already uses for `CloudFetch` and
`DeviceStore`. *Enforced by:* `"lib": ["ES2023"]` in the package tsconfig.

**2. Every platform difference is a named port.** A port is an interface in a
package and a `.web.ts` / `.native.ts` pair in the app, resolved by Metro's
platform extensions. Screens never read `Platform.OS` for behaviour; they read
the port's declared capabilities. Adding a platform later (a desktop shell, a
TV) means implementing the ports, not touching screens. *Enforced by:* an
ESLint rule forbidding `Platform.OS` outside `src/ports/` and `src/shell/`.

**3. One folder per feature; the model file imports no UI.** A feature lives
in `apps/app/src/features/<name>/`: its screen, its components, and a
`<name>.model.ts` hook that holds every piece of state and behaviour. The
model file imports from `packages/*` and React only — never from
`react-native`, `expo-*` or a component — so vitest runs it with no
simulator, and the screen is a thin renderer of it. Adding a feature is one
folder. *Enforced by:* `no-restricted-imports` on `**/*.model.ts`, and a
vitest project that includes only those files.

**4. One design token source.** Colours are OKLCH lightness/chroma/hue triples
in one file, resolved to hex by the converter that `apps/mobile/src/ui/oklch.ts`
already holds. Spacing, radii, type scale, motion durations and the 820-point
breakpoint live beside them. Unistyles builds the light and dark themes from
that file; the accent hue is a runtime theme change. There is no second copy
in CSS. *Enforced by:* the token-parity test in the verification section.

**5. Layout responds to width.** A component is written once with breakpoint
variants, not as a phone version and a desktop version. Where the two really
are different objects (a popover versus a sheet), the component decides at the
breakpoint and the caller does not know.

**6. Interaction follows the input, not the device.** Hover reveals, right-click
menus and keyboard shortcuts exist wherever there is a pointer or a keyboard;
long-press and swipe exist wherever there is a finger. A `useInput()` hook
reports which are present. An iPad with a keyboard gets both.

**7. Features declare their platforms.** Each note in `docs/features/` gets a
"Where" line: which platforms carry the feature and, when one does not, why
(no server to import on; no pitch shifting on Android). The parity matrix at the
end of this document is the starting point.

**8. Tests at the layer that can run them.** Pure logic and model files:
vitest, as now. Components and screens: `jest-expo` with React Native Testing
Library, which renders them without a device. Smoke flows: Maestro on the
phone, Playwright on the web. Nothing UI-shaped is left with zero coverage the
way both apps are today.

## Stack

| Concern | Choice | Why, and what was rejected |
|---|---|---|
| Framework | Expo SDK 57, React Native 0.86, New Architecture | Already what the phone runs on. Web target is Metro with `react-native-web` 0.21, which Expo bundles for this SDK and which is the mainstream universal path in 2026. |
| Routing | expo-router | Already in place. File routes work on all three platforms and give the web real URLs. `expo-router/unstable-native-tabs` gives the phone a real tab bar (Liquid Glass on iOS 26, Material on Android); `expo-router/ui` headless tabs drive the desktop sidebar from the same route files. Web output stays `single`: `static` would need every `playlist/[id]` pre-rendered, and playlist ids are runtime data. |
| Styling | Unistyles 3 | Closest to what exists: tokens plus `StyleSheet`. On web it emits real CSS classes with media queries and `:hover` / `:focus` / `:active`, and themes switch without re-rendering. Needs the New Architecture, which is on. *Tamagui* rejected: it brings its own component kit and compiler, and the app has its own design system. *NativeWind / Uniwind* rejected: Tailwind's vocabulary would replace the OKLCH tokens rather than express them; if Tailwind is ever wanted, Uniwind (same authors) is the one to evaluate. |
| Lists | FlashList v2 behind a `SongList` component | JS-only, built for the New Architecture, no size estimates. Web support is confirmed in the spike; if it falls short there, `SongList.web.tsx` uses `FlatList` and nothing else changes. |
| Data | `@tanstack/react-query` | Already on both sides; the hooks merge. No other state library: player and offline state live in their providers, as now. |
| Audio, web | the existing two-`<audio>` engine | Moved as-is behind the engine port. Gapless, crossfade, rate, pitch lock, analyser. |
| Audio, native | react-native-track-player 5 | Already in place. Gapless, lock screen, Android Auto, rate; pitch lock on iOS via `pitchAlgorithm`. It is an alpha. **Fallback:** `expo-audio`, which in SDK 57 does background playback and lock-screen controls on both platforms; it lacks a native queue (so gapless) and Android Auto, and it is a second `engine.native.ts`, not a rewrite. |
| Offline, web | Cache API + service worker | Existing code behind the offline port. |
| Service worker build | esbuild, as `apps/web` did | The worker is one file with no imports, bundled to `public/sw.js` before `expo export`, which copies `public/` as it is. Metro cannot emit a separate worker entry. Moved with the worker from `apps/web`, which declared it. |
| Offline, native | files + JSON index | Existing code behind the same port. |
| Icons | `react-native-svg` | Already ported. One file for all three platforms. |
| Canvas work | Expo DOM components (`'use dom'`) on native | The song visual, the wrapped card and the energy wave are canvas drawings. On web they run as they do now; on the phone the same React DOM component renders in a webview. Reserved for genuinely DOM-only pieces — never for ordinary UI. |
| Errors | `@sentry/react-native` with its Expo plugin | A phone away from the server fails silently otherwise. One day of work; opt-in via an env var so the personal build can leave it off. |
| Tests | vitest for packages and model files, jest-expo + RNTL for the app, Maestro and Playwright for flows | See foundation 8. Vitest cannot yet run React Native components; Jest stays for those. |
| Repo tooling | npm workspaces, as now | pnpm + Turborepo is the 2026 default, and it is deliberately not adopted here: `docs/MOBILE.md` records how fragile the lockfile already is around React singletons, and a solo project gains nothing from a cached task graph. Revisit only when CI time hurts. |
| Desktop shell | **Electron 44.3.0** (Chromium 152, Node 24; macOS 13 or newer) | The installed desktop app wraps `apps/app`'s web export rather than drawing a second UI. One rendering engine on every OS, TypeScript end to end, and the four things the shell needs are all first-party: `protocol.handle` for `app://` with `Range`, `safeStorage` for the keychain, `navigator.mediaSession` for macOS Now Playing, `setAsDefaultProtocolClient` for the `selfmp3://` sign-in return. Tauri 2, react-native-macos and Mac Catalyst rejected; the reasoning is in [DESKTOP.md](DESKTOP.md). Pinned exactly: Electron ships a major every eight weeks and an upgrade is a commit of its own. |
| Desktop packaging | **electron-builder 26.15.3** | `dmg` and `zip` for macOS (arm64, x64), with `nsis` and `AppImage` listed and unbuilt. Electron Forge rejected as more than this needs. The shell has no runtime `dependencies` — esbuild bundles everything but `electron` — which is what sidesteps electron-builder's known trouble collecting workspace-hoisted packages (electron-builder #2205, #9654). |
| Desktop updates | **electron-updater 6.8.9**, from GitHub Releases | The only updater that needs no server. Squirrel on macOS refuses to apply an update to an ad-hoc signature (electron #36640), so unsigned builds only check the latest release's tag and open its page. Which tier a build is gets baked in by `apps/desktop/scripts/build.mjs`, because there is no API that asks a running app whether its own signature is one macOS would validate — and `canInstall` on the status is how the page knows never to draw a button that would fail. |
| The desktop contract | **`packages/desktop-bridge`**: zod schemas plus the `DesktopBridge` interface | The repository's rule that a contract is shared code, not documentation. `apps/desktop` implements it and `apps/app` consumes it, so a channel renamed on one side is a compile error on the other. No new dependency of its own: zod is already here. Compiled without the DOM library, like every other package. |
| Media session | **`navigator.mediaSession`**, behind a `MediaSessionPort` | Chromium bridges it to `MPNowPlayingInfoCenter` and the media keys on macOS, SMTC on Windows and MPRIS on Linux, so one web file serves the desktop app and a phone's browser alike. The native file is a no-op: track-player owns the lock screen. `globalShortcut` is not used for media keys — on macOS it registers and never fires while Electron's `HardwareMediaKeyHandling` is on (electron #20788), and turning that off would lose the Now Playing panel. |
| Electron tests | **Playwright `_electron`** (1.63, already here) plus **electron-playwright-helpers 3.1.2** | The smoke flow launches the *built* app, so the product is what is tested. `app.evaluate` reads the main process directly, which is how a 206 from `protocol.handle` is observed rather than inferred. The main process's pure modules — the range answer, the download index, the menu model, the update rule — run in the root vitest. |
| Desktop icon | **sharp**, the version `apps/server` already pins | One PNG at 1024 rendered from `apps/app/public/icons/icon.svg` by `apps/desktop/scripts/icon.mjs`; electron-builder makes the `.icns` and the `.ico` from it. Not a new dependency — the server has used sharp for cover art since before this — and rendering rather than keeping a second copy is what stops the app's mark drifting from the favicon's. Generating the container formats here would have meant macOS's `iconutil`, which CI's Linux runners do not have. |

Version notes: Unistyles 3 requires `react-native-nitro-modules` and a dev
client rebuild, which the project already does for track-player.
`react-native-web` 0.21 supports React 19.2. Both are pinned by Expo's
`bundledNativeModules.json`; run `npx expo-doctor` after adding them.

## Repository layout after

```
packages/shared          the contract and pure rules            (unchanged)
packages/replica         the bucket library and session          (unchanged)
packages/client          NEW — what any client does that is not drawing,
                         compiled without the DOM:
  api/                   one typed client: routes, schemas, cloud answering
  queries/               react-query keys and hooks, mutations with rollback
  connection/            server address + token, cloud session, which one answers
  player/                PlayerProvider glue, the PlaybackEngine interface
  offline/               the OfflineStore interface, the download index (pure)
  devices/               heartbeat, handoff, remote transport
  theme/                 tokens, oklch → hex, theme builder

apps/app                 NEW — the one UI, grown out of apps/mobile
  app/                   expo-router routes: thin files that render a feature
    _layout.tsx          providers + the shell
    (tabs)/…             library, playlists, settings — native tabs < 820
    playlists/[id].tsx  now-playing.tsx  import/…  stats/…  sign-in.tsx
  src/shell/             the responsive frame: tabs + mini player, or sidebar
                         + player bar + side panels; the one place that reads width
  src/features/          one folder per feature:
    library/             LibraryScreen.tsx, SongList.tsx, TagStrip.tsx,
                         library.model.ts, library.model.test.ts
    playlists/  now-playing/  queue/  settings/  devices/  practice/
    import/  stats/  tags/  sign-in/  onboarding/
  src/ui/                primitives: Button, IconButton, Chip, Popover|Sheet,
                         Cover, Equalizer, SeekBar, Select, Tooltip(web)
  src/ports/             platform pairs: engine.{web,native}.ts,
                         offline.{web,native}.ts, keyboard.{web,native}.ts,
                         share.{web,native}.ts, files.{web,native}.ts
  src/dom/               'use dom' components: SongVisual, WrappedCard
  public/                manifest, icons, sw.js (built by esbuild, as now)
  verify/                Playwright reference captures and web flows
  .maestro/              phone flows

apps/server              unchanged; `webDir` defaults to apps/app/dist
apps/doorman             unchanged
apps/web, apps/mobile    deleted at the end of phase 5
```

The root `tsconfig.json` today excludes `apps/mobile` because React Native's
globals collide with the web app's DOM types. Once there is one app that
problem is gone in the other direction: `packages/client` is compiled without
the DOM library, `apps/app` is checked by its own `tsc --noEmit` as the phone
is now, and the root project references the packages and the server.

## The ports

Each is an interface in `packages/client`, implemented twice in `apps/app/src/ports`.

| Port | What it hides | Web | Native |
|---|---|---|---|
| `PlaybackEngine` | load, play, pause, seek, rate, volume, queue-ahead, events | two `<audio>` elements, Web Audio analyser, `preservesPitch`, crossfade | track-player: native queue, lock screen, remote events; `pitchAlgorithm` on iOS. Fallback: expo-audio |
| `OfflineStore` | is it here, fetch it, remove it, usage, progress | Cache API + service worker range slicing | `expo-file-system` + JSON index |
| `DeviceStore` | small persistent values | IndexedDB (exists in `packages/replica`) | files (exists) |
| `Keyboard` | global shortcuts, the command palette trigger | `document` keydown | no-op, or hardware keyboard on iPad later |
| `Share` | receive a shared link, share a wrapped card | Web Share Target, `navigator.share` | `expo-sharing`, an intent filter |
| `Files` | reveal a song's file | server endpoint (on the server itself only) | unavailable, declared |
| `Media session` | lock-screen metadata | `navigator.mediaSession` | track-player metadata |

The engine port declares capabilities — `crossfade`, `analyser`, `pitchLock`,
`lockScreen`, `nativeQueue` — and the practice panel, the visualiser and the
settings page read them. A control for something the platform cannot do is not
rendered, and the settings page says why, the way the phone's About section
does for crossfade today.

## Phases

Each phase leaves the repository shippable and both current apps working until
the moment they are replaced. Each ends with a gate: commands that must exit
zero, listed in the runbook.

### Phase 0 — Decide what v1 carries

Write the parity matrix (below) into `docs/features/*` "Where" lines. Agree the
first universal release carries everything in the *Both* column and the
*Desktop* column at desktop width. Anything marked *Later* is not a blocker.

Exit: matrix committed; no code.

### Phase 1 — `packages/client` (no visible change)

Move the API client, query keys and hooks, connection and cloud-session
handling out of both apps into one package compiled without the DOM. Both
`apps/web` and `apps/mobile` switch to importing it. The phone gains every
mutation the web has (love, tag, playlist membership, settings) for free;
the web loses nothing.

Also move: the pure download index, the queue-to-engine glue that both
`PlayerProvider`s duplicate, the listen outbox, the token file and converter.

Exit: both apps build and behave as before; `npm run check` covers the
package; duplicated route strings are gone. This step pays for itself even
if the rest never happens.

### Phase 2 — Bootstrap `apps/app` from the phone

Copy `apps/mobile` to `apps/app`. Add the web target (`react-native-web`,
`react-dom`, `@expo/metro-runtime`), Unistyles, FlashList, Sentry (off by
default), and the theme built from `packages/client/theme`. Port the
primitives — the phone's `Button`, `IconButton`, `Chip`, `Sheet`, `Cover`,
`Equalizer`, `SeekBar`, `SongRow`, `MiniPlayer`, `BottomNav` were rebuilt to
the web's measurements and are the starting point. Add `Popover` (a `Sheet`
below the breakpoint), `Select`, `Tooltip` (web only). Reshape the phone's
screens into `src/features/*` with model files.

Build `src/shell`: native tabs and the mini player under 820, a sidebar and
player bar above it, using the same route files. Add `expo export -p web` to
CI so the web target cannot rot unnoticed.

Ship it as the phone app: it is the phone app, with a web target it does not
yet advertise.

Exit: `expo run:ios`, `expo run:android` and `expo export -p web` all produce
the phone's current feature set; jest-expo runs against the primitives;
model tests run under vitest; the lint rules from the foundations pass.

### Phase 3 — The ports

Define `PlaybackEngine` and `OfflineStore` in `packages/client`. Move the web
engine and the web offline code (audio cache, mirror, recent cache, service
worker) into `apps/app/src/ports/*.web.ts`; wrap track-player and the
download queue as `*.native.ts`. One `PlayerProvider` and one
`OfflineProvider` in `packages/client` sit over them. Bring devices/handoff
across: the heartbeat and remote transport are HTTP and a clock, so the phone
gets them with the move.

Exit: at desktop width in a browser the new app plays gapless with crossfade
and caches songs offline; on the phone nothing regresses; the devices popover
lists both.

### Phase 4 — The shared surfaces, at desktop width

Library (search, sort, tag filter and exclude, multi-select and the selection
bar, gems row, tag inbox link), Playlists and playlist detail (create, rename,
pin, smart rules), Now Playing (stage and focus on the desktop, the phone
sheet under 820, lyrics with romanisation, up next, about), Settings (server,
offline, appearance, lyrics, cloud), the command palette and hotkeys on web.

When these match `apps/web`, point the server's `webDir` at `apps/app/dist`
and change the Pages workflow. Desktop users move. `apps/web` stays in the
tree for the tools below.

Exit: the four surfaces pass all three verification checks against the old
web app at 1280 and 375 wide; the flow suites pass on web and both phones.

### Phase 5 — The desktop tools

Import and share-to-import, the playlist migration flow, Stats and Wrapped
(wrapped card as a DOM component), the practice panel (loop, speed, transpose;
pitch lock where the engine says so), metadata and cover fixing, the YouTube
library panel, the tag editor. Each is a feature folder that moves on its
own; until it does, the old web app still serves it at its old URL.

Exit: the last tool moves; `apps/web` and `apps/mobile` are deleted; the
Dockerfile copies `apps/app/dist`; CI runs one check.

### Phase 6 — Only after

Things the single tree makes cheap and that were not worth doing twice: iPad
layout as a first-class width, hardware keyboard shortcuts on iPad, the
similar-songs shelf on the phone, tag editing on the phone, a desktop shell if
one is ever wanted, pnpm + Turborepo if CI time ever hurts.

## Verification

The reference is the old web app, served by the server at `http://localhost:4601`
(`npm run dev`). Every screen of the new app is checked against it, at two
widths: **1280** for the desktop layout and **375** for the phone layout — the
phone app was built to the web's phone CSS in the first place, so the browser
at 375 is the phone's reference too, and the simulator is checked against the
same captures.

### The reference set

The old app was photographed at both widths before phase 4 (`docs/reference/`,
made by `verify/reference.spec.ts`) and compared screen by screen with
`verify/side-by-side.mjs`. With the migration finished, all three were deleted;
git history still has them.

### Three checks, in order

**1. Tokens are identical.** A test parses `apps/web/src/styles/parts/tokens.css`,
resolves each `oklch(L C var(--accent-hue))` at hue 268 with the converter in
`packages/client/src/theme`, and asserts the hex the Unistyles theme produces for
the same name. `apps/mobile/src/ui/oklch.test.ts` is the start of this. Once
the CSS is gone the test compares the theme against the committed reference
values instead. Spacing, radii, type sizes and the breakpoint are asserted the
same way. This runs in CI from phase 2 on.

**2. Screens match, side by side.** For each row of the table above, the new
app is captured at the same width and state and laid beside the reference.
The check is a review, not a pixel diff: fonts render differently across
`react-native-web` and the DOM and a diff would fail on every run. What must
match: layout and order of every element, sizes of touch targets, colours,
type weights, which controls are visible at rest versus on hover, and what a
long title does. A screen passes when someone who knows the old one cannot
say which is which without reading the URL bar.

For the phone, the same states are captured from the simulator with
`xcrun simctl io booted screenshot` and compared to the 375 reference, and to
the new app's own 375 web capture — those two must agree with each other
exactly, since they are the same code.

**3. Flows behave the same.** Walked on the old app and the new one, then
automated: Playwright for the web at both widths (`verify/flows/`),
Maestro on the phone (`apps/app/.maestro/`). The flows are the ones that
cross screens or touch the player:

- Tap a row → it plays, the row tints, the mini player and player bar show it.
- Next and previous from the mini player, the player bar, the lock screen and
  the now-playing screen all move the same queue, and every surface updates.
- Play a list, shuffle it, add "play next", remove from the queue, jump in
  the queue → the order shown matches `packages/shared` queue rules.
- Search, then filter a tag, then exclude one, then clear → the same songs in
  the same order as the old app.
- Love from a row, from now playing and from the menu → the heart agrees
  everywhere and survives a reload.
- Download a playlist, go offline (browser: DevTools offline; phone: airplane
  mode), play it → it plays; an undownloaded song says so instead of failing.
- Sign in to the cloud, sign out, connect to a server → the right library loads.
- Handoff: play on the desktop, "play here" on the phone → position carries.
- Resize the browser across 820 → the layout switches without losing state.

### How a session does it

1. `npm run dev` for the reference; open `http://localhost:4601` in the
   browser pane, set the viewport to 375 or 1280, screenshot.
2. Run the new app (`expo start` for the phone, `expo start --web` for the
   browser) and reach the same state; screenshot the same way.
3. Compare, fix, repeat. Note every deliberate difference in the phase's
   commit message; anything not noted is a bug.

A phase's exit criterion "matches the old app" means all three checks pass
for every screen the phase touched, with the captures attached to the PR.

## What does not port one-to-one

Being honest about these up front is what keeps the phases from stalling.

- **Container queries and `min()`-sized artwork.** The now-playing pages size
  the cover from the room left over. React Native has `onLayout`; the shell
  measures once and passes sizes down. The three-column desktop grid of
  `.app-content` becomes a flex row.
- **Tooltips.** Hover-only; web-only. A `Tooltip` that renders its child and
  nothing else on native.
- **Popovers anchored to a button.** React Native has no `position: fixed`. A
  `Popover` primitive measures its anchor with `measureInWindow` and draws in
  a portal (`Modal` on native, a root-level host on web). Below the breakpoint
  it is a `Sheet`, which the web already does with `.popover-sheet`.
- **Range inputs.** The scrubber and volume become the phone's `SeekBar`
  everywhere; keyboard stepping is added on web.
- **The service worker.** Stays a separate esbuild step to `public/sw.js`,
  registered from `_layout.web.tsx`. Expo's web export copies `public/` as-is.
- **Static HTML per route.** Not used: `playlist/[id]` cannot be pre-rendered
  for ids that only exist at runtime. The export stays a single-page app, and
  the Pages workflow keeps its 404 redirect.
- **Crossfade and the analyser.** Web only, declared as engine capabilities.
  The native engine reports `crossfade: false` and the settings page says so,
  as the phone does today.
- **Pitch lock.** Web and iOS. Android's player has no pitch-preserving rate
  change; the practice panel shows speed without the lock there.
- **Reveal in Finder.** On the server itself only. Declared unavailable elsewhere.
- **Canvas drawings.** The song visual, wrapped card and energy wave run as
  `'use dom'` components on native. They are self-contained today, which is
  what makes this cheap; keep them that way.
- **Hover reveals in rows.** `Pressable` on web reports hover; rows show their
  controls on hover where there is a pointer and always where there is not,
  exactly the trade the CSS makes now.

## Risks, and the spike that retires them

Before phase 2 is committed, one throwaway branch must prove six things, each
as a command that passes or fails:

1. `apps/app` exports to web with `react-native-web` 0.21 and React 19.2, and
   the export runs under the server's `express.static` at `/` and under
   `/selfmp3/` with `experiments.baseUrl`.
2. Unistyles 3 builds on RN 0.86 with track-player in the same dev client, and
   a component with a `:hover` variant and an 820-point breakpoint renders
   correctly on web, iOS and Android.
3. Native tabs on the phone and `expo-router/ui` tabs on the desktop share one
   set of route files.
4. The existing web audio engine runs inside the Metro web build unchanged.
5. A `'use dom'` component draws the song visual on iOS.
6. FlashList v2 scrolls a 2,000-row list on web at 1280 and on iOS without
   blank cells; if not on web, `FlatList` behind `SongList.web.tsx`.

If 1 or 4 fails there is no universal app and this plan stops at phase 1,
which is still worth having. If 2 fails, the styling choice changes, not the
plan. If 5 fails, the visual waits for Skia or stays web-only. If 6 fails on
web only, the fallback is already named.

The known standing risk is unchanged: track-player 5 is an alpha. The
fallback is now `expo-audio` as a second native engine, not an SDK downgrade.

## Parity matrix

The starting point for phase 0. *Both* means the feature belongs on every
platform; *Desktop* means it belongs at desktop width on any platform that can
do it; *Server* means it needs the server's own disk or tools.

| Feature | Today: web | Today: phone | Target |
|---|---|---|---|
| Library: search, sort, tag filter | yes | yes | Both |
| Tag exclude, multi-select, selection bar | yes | no | Both |
| Love, tag, add to playlist from a row | yes | love only | Both |
| Gems row, tag inbox | yes | no | Both |
| Playlists: browse, play, download | yes | yes | Both |
| Playlists: create, rename, pin, smart rules | yes | no | Both (rules editor at desktop width first) |
| Now playing: art, lyrics, queue, about | yes | art, lyrics, queue | Both |
| Lyrics romanisation, focus mode | yes | no | Both (focus at desktop width) |
| Playlist reorder | drag by the grip | hold the row and move it | Both (`ui/components/HoldToReorder`) |
| Queue reorder | drag | no | Both (drag with gesture-handler) |
| Devices, handoff, remote control | yes | no | Both |
| Offline library | Cache API | files | Both, one UI |
| Background audio, lock screen | partial | yes | Both where the platform allows |
| Android Auto | no | partial | Native |
| Sleep timer, speed | yes | no | Both |
| Practice: A–B loop, transpose | yes | no | Both |
| Practice: pitch lock | yes | no | Web and iOS |
| Crossfade, visualiser | yes | no | Web |
| Import from a link, share to import | yes | no | Both (the server does the work) |
| Playlist migration | yes | no | Desktop |
| Stats, Wrapped | yes | no | Both (server-backed data) |
| Metadata lookup, fix covers | yes | no | Desktop |
| Rescan library, watched folder | yes | no | Server |
| Reveal file | yes | no | Server |
| Accent colour, light/dark | yes | accent | Both |
| Cloud sign-in, bucket library | yes | yes | Both |

## Sizing

In lines to write, from the measurements above, with what carries over:

| Phase | Roughly | Notes |
|---|---:|---|
| 1 `packages/client` | 3,000 moved, 500 new | mostly moves; the new part is the merged client |
| 2 bootstrap + shell + primitives | 2,500 | 1,500 of it exists in the phone app already |
| 3 ports | 1,000 new, 4,000 moved | engine and offline move nearly verbatim |
| 4 shared surfaces | 7,000 | the largest; half is now-playing and library |
| 5 desktop tools | 6,000 | screen by screen, each independently |

Against that, `apps/web` is 34,000 lines of which 10,000 is CSS that does not
come across as CSS. The universal app should land near 20,000 lines of UI
plus the packages, and every later feature is written once.

## Runbook for an unattended agent

This section is written to be executed, not read. An agent picks it up with
the repository, a Mac with Xcode and a booted simulator, and this file. It
works phase by phase, in order, and never starts a phase whose predecessor's
gate has not passed on `main`.

### Ground rules

- **One phase per branch, one PR per phase.** Branch from `main` as
  `universal/phase-N`. Never rebase `main` onto a phase branch; merge forward.
- **Commit at every green gate, never on red.** A commit message states what
  moved, what was rewritten, and every deliberate difference from the old app
  (see verification). `npm run check` and `npm run check:mobile` (later
  `check:app`) must pass before any commit.
- **The old apps are read-only.** `apps/web` and `apps/mobile` are reference
  material until phase 5 deletes them. Fixing a bug there is out of scope;
  note it in the PR instead.
- **Ports before screens.** No screen is written against `TrackPlayer`,
  `<audio>`, `expo-file-system` or `caches` directly. If a port is missing,
  the port is the task.
- **No new dependencies without a line in the Stack table.** Adding one is a
  documented decision, made in this file first.
- **Stop and ask** at these points, and nowhere else: a spike check fails; a
  gate fails twice in a row on the same cause; a step needs credentials (Apple
  signing, EAS, Google sign-in, Sentry DSN); a deliberate visual difference
  from the old app would be visible to a user. Everything else is the agent's
  call, recorded in the commit.
- **Never** run `expo prebuild --clean` on a branch that has uncommitted
  native changes, or change `packages/shared` schemas — the server owns those.

### Environment

```
node >= 22, Xcode 16+, CocoaPods, a booted iPhone simulator (iOS 26 preferred)
npm install
npm run build --workspace @selfmp3/shared && npm run build --workspace @selfmp3/replica
npm run dev                      # the reference, http://localhost:4601, keep running
cd apps/app && npx expo run:ios  # once per native dependency change
npx expo start --dev-client --port 8082   # then deep-link:
xcrun simctl openurl booted "selfmp3://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082"
```

Screenshots: `xcrun simctl io booted screenshot out.png`. Web at a width: the
Playwright config in `apps/app/verify/` defines the `desktop` (1280) and
`phone` (375) projects.

### Gates

Each phase ends when every command below exits 0. The agent runs them all,
in order, before opening the PR.

**Spike (before phase 2)**

```
npx expo export -p web && test -f dist/index.html                    # 1
EXPO_PUBLIC_BASE=/selfmp3 npx expo export -p web && grep -q '/selfmp3/' dist/index.html
npx expo run:ios --no-install && npx expo run:android --no-install    # 2 (Unistyles + track-player build together)
npx playwright test verify/spike.hover.spec.ts                        # 2 (hover + breakpoint on web)
npx playwright test verify/spike.tabs.spec.ts                         # 3 (sidebar at 1280 from the tab routes)
maestro test .maestro/spike-tabs.yaml                                 # 3 (native tabs on iOS)
npx playwright test verify/spike.engine.spec.ts                       # 4 (gapless + crossfade under Metro web)
maestro test .maestro/spike-dom-visual.yaml                           # 5 (a 'use dom' canvas on iOS)
npx playwright test verify/spike.list.spec.ts && maestro test .maestro/spike-list.yaml   # 6
```

**Phase 1**

```
npm run check                                     # includes packages/client
npm run check:mobile
grep -rn "'/api/" apps/web/src apps/mobile/src | grep -v packages && exit 1 || true   # no route strings left
npx playwright test verify/flows --project=desktop --project=phone   # against apps/web, unchanged behaviour
```

**Phase 2**

```
npm run check:app                                 # tsc + eslint (foundation rules) + jest-expo + vitest models
npx expo export -p web
npm run test --workspace @selfmp3/client -- theme # token parity
maestro test .maestro/smoke.yaml                  # play, next, mini player, sort, tag filter, menu, download
npx playwright test verify/flows --project=phone  # the same flows in the browser at 375
```

**Phase 3**

```
npm run check:app
npx playwright test verify/flows --project=desktop   # gapless, crossfade, offline, devices on web
maestro test .maestro/smoke.yaml .maestro/offline.yaml .maestro/devices.yaml
```

**Phase 4**

```
npm run check:app
npx playwright test verify/flows                                  # all flows, both widths
maestro test .maestro/                                            # all phone flows
SELFMP3_WEB_DIR=apps/app/dist npm run start & curl -sf localhost:4600/ | grep -q '<div id="root"'
```

**Phase 5**

```
npm run check                                     # one project, no apps/web, no apps/mobile
docker build -t selfmp3 . && docker run --rm selfmp3 test -f /app/apps/app/dist/index.html
npx playwright test verify/flows && maestro test .maestro/
```

### Order of work inside a phase

1. Read the phase, the foundations, and the "does not port" list.
2. Write the model file and its vitest test first; make it pass.
3. Write the screen against the model; render it at 375 and 1280.
4. Capture and compare against the reference set; fix until check 2 passes.
5. Add or extend the flow test that covers the change.
6. Run the phase gate. Commit.

### What an overnight run cannot do

Sign in to Google, sign a release build, register a device, or publish to
Pages. Those steps are marked "stop and ask" above. Everything else — the
spike, phases 1 through 3 entirely, and phase 4 and 5 screen by screen — is
within reach of an agent with the simulator and the dev server running.

## What to do first

1. Commit the phone work in progress on this branch — the primitives and the
   queue-index fix — since phase 2 starts from them.
2. Write `verify/` and `.maestro/` skeletons with the spike scripts named
   above, then run the spike. Six checks, one throwaway branch, no product code.
3. Start phase 1. It is safe, it is valuable on its own, and it is the step
   that makes every later phase smaller.

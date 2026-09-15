# The native app

`apps/app` is one Expo (React Native) app for iOS, Android and the web. This
guide is about running it on a phone: the player and sync client for the library
in your bucket, with Android Auto.

It exists because a PWA cannot do three things that matter in practice —
reliable background audio on iOS, and real offline files rather than a Cache API
quota the OS may evict. Everything else it does, the web app already
did; the shared zod schemas and pure helpers in `packages/shared` are used
verbatim, not copied.

**Read the "What was and was not verified" section at the end before you plan an
afternoon around this.** The app was written, type-checked and linted on Linux.
No iOS or Android binary has ever been produced from it, because that cannot be
done without a Mac and an Android SDK.

---

## What it does

| | |
|---|---|
| **Library** | The whole library in one response, filtered, sorted and searched on the phone. Tag chips, sort chips, a "downloaded only" filter. |
| **Playlists** | List and detail, in playlist order, with play / shuffle / download-this-playlist. |
| **Now playing** | Artwork, scrubber, transport, shuffle and repeat, and a panel that switches between synced lyrics and the queue. |
| **Lyrics** | Parsed with the shared `lrc.ts`. Timestamped files highlight the current line and scroll themselves; plain ones just scroll. |
| **Offline** | Downloads to the app's document directory, resumable, with a persisted index, storage usage, and per-playlist or whole-library sync. A downloaded file is played from disk; anything else streams. |
| **Opens offline** | The last `/api/library` response is cached to disk, so the app opens with a full library on a plane. |
| **Background audio** | react-native-track-player: lock screen, notification, headphone buttons, audio focus. |
| **Android Auto** | See [Android Auto](#android-auto), which is the one place where the honest answer is "partly". |

Settings holds the Google account, the download controls and the storage
numbers.

---

## Prerequisites

**Both platforms**

- Node 22+ and a working `npm install` at the repository root.
- The shared package must be built before Metro or `tsc` can resolve it:
  `npm run build --workspace @selfmp3/shared`, and likewise `@selfmp3/cloud` and
  `@selfmp3/client`. `npm run check:app` from the root does this for you.

**iOS**

- macOS with Xcode 16 or newer, and its command line tools.
- CocoaPods (`sudo gem install cocoapods`, or `brew install cocoapods`).
- An Apple ID. A free one is enough to run this on your own phone, seven days
  at a time; a paid account ($99/year) is what makes a build last. This is a
  personal app on the free path, which is also why there is no CarPlay.

**Android**

- Android Studio, with the Android SDK and a JDK 17.
- `ANDROID_HOME` set, and `adb` on your `PATH`.
- For Android Auto testing, the **Desktop Head Unit** (see below).

---

## Running it on a phone

```bash
# once, from the repository root
npm install
npm run build --workspace @selfmp3/shared
npm run build --workspace @selfmp3/cloud
npm run build --workspace @selfmp3/client

cd apps/app
npx expo run:ios        # or: npx expo run:android
```

`expo run:*` generates the native project (`ios/`, `android/`), installs pods or
Gradle dependencies, builds a development binary and starts Metro. Both native
folders are generated and **git-ignored** — everything that has to survive lives
in `app.config.js` and `plugins/`. If a native folder ever looks wrong, delete
it and let `npx expo prebuild --clean` rebuild it rather than editing it.

After the first build, `npm run start --workspace @selfmp3/app` is enough for
day-to-day work; rebuild the three packages first if one of them changed.

On first launch the app asks you to sign in with Google, and the library is the
one in your bucket. There is no server address to type: the phone never talks
to the server directly. Development builds keep an address screen
(`selfmp3://onboarding`) for the simulator tests, which cannot sign in.

### Building for real

**EAS (Expo's build service, no local toolchain needed):**

```bash
npm install -g eas-cli
eas login
cd apps/app
eas build --platform ios --profile production
```

There is no `eas.json` in the repository. `eas build:configure` writes one; the
defaults are fine for a personal app. EAS builds from a Git checkout by default,
so commit before building, and note that a monorepo needs
`"cli": { "requireCommit": true }` and nothing else special — EAS handles npm
workspaces.

**Locally, which is free and often faster:**

```bash
cd apps/app
npx expo run:ios --configuration Release
npx expo run:android --variant release
```

For a release Android build you will need a signing keystore; Expo generates a
debug one automatically, which is fine for sideloading onto your own phone.

---


## Android Auto

This is the part where the marketing and the reality differ, so here is what was
actually established by reading the packages rather than the docs.

**What works.** react-native-track-player 5's `MusicService` is a media3
`MediaLibraryService`, and its manifest declares both
`androidx.media3.session.MediaLibraryService` and
`android.media.browse.MediaBrowserService`. Android Auto therefore sees the app,
lists it, and drives it with the standard transport controls, metadata and
artwork from the current queue. Playback started on the phone continues in the
car; the steering wheel controls work.

**What does not.** There is **no JavaScript API to publish a browse tree**.
`setBrowseTree` does appear inside the 5.0.0-alpha0 tarball, but only in
`lib/src/` — a stale build artifact that is not reachable through the package's
`exports`, is not in the TurboModule spec (`src/NativeTrackPlayer.ts`), and is
absent from every nightly since. Calling it would be calling a method that does
not exist. The stable 4.1.2 release is worse: it has no browse API *and* its
service is a plain `HeadlessJsTaskService` with no `MediaBrowserService` intent
filter at all, so Android Auto would not list the app.

**What the app does instead.** `src/car/androidAuto.ts` wires up the two entry
points RNTP *does* expose, resolving both against the same tested browse tree
the browse tree serves:

- `Event.RemotePlayId` — the car asks for a media id.
- `Event.RemotePlaySearch` — voice search ("play Kind of Blue"). The parsed
  `album` / `artist` / `playlist` fields are preferred over the raw query when
  the Assistant provides them.

So voice control works and the tree is ready; only the browsable menu in the
car's own UI is missing. The alternatives, in increasing order of effort:

1. Wait for RNTP to land the API — the media3 groundwork is already there.
2. `patch-package` the alpha to expose `setBrowseTree` through the TurboModule
   spec, then call it from `src/car/androidAuto.ts` with `browseTree.ts`'s
   nodes mapped to `MediaItem`s (the `MediaItem` interface already ships in the
   package, unused).
3. Write a small native `MediaLibraryService` in the app's own Android source
   and have it read the same tree. Most control, most work.

**Testing with the Desktop Head Unit.** No car required:

1. Install "Android Auto" from the Play Store on the phone (on Android 11+ it is
   built in), and enable Developer mode: in Android Auto settings, tap the
   version line ten times.
2. In that developer menu, turn on **Start head unit server**.
3. In Android Studio, open **SDK Manager → SDK Tools** and install **Android
   Auto Desktop Head Unit Emulator**.
4. Connect the phone by USB and forward the port:
   `adb forward tcp:5277 tcp:5277`
5. Run it: `$ANDROID_HOME/extras/google/auto/desktop-head-unit`

The app will appear in the media launcher once it is running and has a media
session. Google's page is at
<https://developer.android.com/training/cars/testing/dhu>.

---

## How it fits together

```
apps/app
  app/                    expo-router file routes, one per screen, at every width
  src/features/           a folder per screen or tool, with a pure model beside it
  src/ports/              what differs by platform (engine, offline store, prefs,
                          secrets, cloud platform, device, the car)
  src/player/             the provider: queue state, engine port, play counting
  src/offline/            downloads, the saved library, the listen outbox
  src/cloud/              @selfmp3/cloud, with this device's platform behind it
  src/ui/                 components, icons, the Unistyles theme
  plugins/                config plugins run at prebuild time
```

The player keeps the same three-way split as the web app, with one piece
swapped:

- **Queue rules** are `packages/shared/src/queue.ts`, the same pure functions
  the web build uses.
- **The engine** is react-native-track-player instead of two `<audio>` elements.
  It owns buffering, auto-advance and the lock screen.
- **The glue** is `src/player/PlayerProvider.tsx`: `QueueState` is the source of
  truth for *order*, the native player is the source of truth for *position*,
  and it reports back through `PlaybackActiveTrackChanged`.

**Gapless** is handled by the native player, which loads the next item before the
current one ends. **Crossfade is not implemented and will not be**: the web
engine does it by overlapping two audio elements and ramping their volumes, and
react-native-track-player exposes one player with one volume. The server's
`crossfadeSeconds` setting has no effect on this app, and Settings says so.

**Play counts** use the same rule as the web app: a play is recorded once the
listener has heard `min(duration × 0.5, 240s)`, or immediately when a track runs
to its end.

**Offline storage** is a JSON index rather than SQLite. It is one small object —
a few thousand entries at most — read once at launch and rewritten after each
download. A database would have bought indexed queries nobody needs and added a
native module, a migration story and a second source of truth about the same
folder; a JSON file can be printed, diffed and deleted by hand when something
goes wrong. `src/offline/downloadIndex.ts` is pure and unit-tested;
`downloads.ts` is the effectful half.

---

## Repository plumbing worth knowing

**The mobile workspace is excluded from the root TypeScript project and the root
ESLint config**, both with comments saying why. React Native's type definitions
declare globals that conflict with the DOM ones the web app relies on, so
sharing a project graph would leak them. `apps/app` is checked on its own, and
`npm run check` runs that too:

```bash
npm run typecheck:app      # builds the packages first, then tsc for the app and its worker
npm run lint:app
npm run check:app          # both, and the component tests
```

Its *pure* unit tests (`downloadIndex`, `browseTree`) do run in the root vitest
suite, because they import nothing from React Native.

**The `overrides` block in the root `package.json` needs explaining.** Each
fixes a real failure:

- `react` and `react-dom` pinned to `19.2.3` — the version Expo SDK 57 ships
  with. This is what keeps npm from installing a second copy of React nested
  under `apps/app`, which Metro would happily bundle alongside the root one,
  producing the "invalid hook call" that eats an evening. The web app's
  `^19.0.0` is satisfied either way; it just gets a slightly older patch.
- `react-native-reanimated` / `react-native-worklets` pinned exactly — see
  "Version alignment" below.

None of these are cosmetic. Removing any one of them either breaks
`npm install` or ships two copies of a package that must be a singleton.

`apps/app` is picked up by the existing `apps/*` workspace glob; nothing was
added to `workspaces`.

**`metro.config.js` deliberately does not set `disableHierarchicalLookup`.**
It is the usual monorepo advice, and it is wrong here: it stops Metro walking
up the tree, which fixes duplicate-react but breaks the ~50 packages in this
tree that legitimately have their own nested `node_modules` — each would
silently resolve to the wrong version of a transitive dependency. The
`overrides` above solve the duplication at its cause instead, so hierarchical
lookup stays on and nested dependencies keep working.


**Regenerating `package-lock.json` was unavoidable.** Adding the mobile
workspace on top of the existing lock fails with `ERESOLVE` however the
overrides are written — npm will not re-resolve an edge the lock already
pinned — so the lock was regenerated from an empty `node_modules`. Pre-existing
packages moved within their declared ranges (patch bumps to `@aws-sdk/*`,
`@babel/*`, `rollup`, `eslint` and similar); no declared range changed.

One consequence worth knowing: if you ever hit an `ERESOLVE` or a "two copies
of X" problem after changing dependencies here, delete `node_modules` *and*
`package-lock.json` and install again. npm reuses an existing tree aggressively
and will keep a stale resolution that a clean install resolves correctly. Every
strange result in this workspace's setup traced back to that.

**Version alignment.** Everything except the two below matches Expo SDK 57's
bundled versions exactly (`expo/bundledNativeModules.json`):

- `react-native-track-player` is pinned to `5.0.0-alpha0` rather than the stable
  `4.1.2`. This is a deliberate, uncomfortable choice, explained below.
- `react-native-reanimated` and `react-native-worklets` are pulled in
  transitively by `expo-router` (via `react-native-drawer-layout` and
  `@expo/ui`) and pinned by root `overrides` to `4.5.5` / `0.10.4`. Left alone,
  npm picks 4.6.0 / 0.12.2, and worklets 0.12 falls outside
  `expo-modules-core@57`'s declared peer range — `npm ls` reports it as
  invalid, and it is the kind of mismatch that surfaces as a native crash
  rather than an error message.

Run `npx expo-doctor` in `apps/app` on your Mac to check this against Expo's
current view of the world.

### Why the track-player alpha

React Native 0.86 — what Expo SDK 57 ships — runs the New Architecture.
react-native-track-player **4.1.2** (August 2025, the newest stable) is a legacy
bridge module: no codegen, an Android build script on AGP 4.2 with
`com.facebook.react:react-native:+`, and an iOS podspec that depends on
`React-Core` directly. **5.0.0-alpha0** is the modernised line: a TurboModule
spec, `install_modules_dependencies` in the podspec, AGP 8.7 with the
`com.facebook.react` Gradle plugin, and a media3 `MediaLibraryService` — which
is also the only reason Android Auto sees the app at all.

The alpha is a pre-release, and its last nightly was September 2025. If it turns
out not to build, the fallback is to pin the whole app to Expo SDK 54 / React
Native 0.81, where the legacy architecture can still be enabled and 4.1.2 works
— that is a `package.json` change and a `prebuild --clean`, not a rewrite, and
nothing in `src/` depends on which of the two is installed except the Android
Auto events.

---

## What was and was not verified

*This is the record from when the phone app was a separate workspace, before
any binary was built. The dev client has been built and run on iOS simulators
since; [docs/universal-progress.md](universal-progress.md) is the current
record, phase by phase.*

Everything below was actually run in the sandbox this was written in — Linux, no
Xcode, no Android SDK.

**Verified here**

- `npm install` from a clean checkout at the repository root: succeeds.
- `npm run check` (root typecheck + lint + tests): passes, 386 tests, zero
  warnings. That includes the 37 queue tests, which now live in
  `packages/shared` and still pass unchanged after the move.
- `npm run build` (shared + server + web): passes.
- `npm run check:app`: `tsc --noEmit` with the real React Native, Expo,
  track-player type definitions, plus ESLint with
  `eslint-config-expo` — both clean, zero errors and zero warnings. Every API
  used was checked against the actual `.d.ts` in `node_modules`, not from
  memory.
- The new pure modules have unit tests: 20 for the download index, 17 for the
  browse tree, all passing in the root vitest run.
- `npx expo prebuild --platform all --clean` runs to completion, and the output
  was inspected: `android:usesCleartextTraffic="true"` is in the release
  Android manifest, and the app icon is in the asset catalog.
- Autolinking resolves as intended: `react-native-track-player` on both
  platforms.
- After a clean install there is exactly one copy on disk of `react`,
  `react-dom`, `react-native-reanimated` and `react-native-worklets`, and `npm ls` reports
  no invalid peer ranges.

**Not verified, and it needs a device or a Mac**

- **Nothing has been compiled.** No `pod install`, no Gradle build, no binary.
  The single largest risk is that react-native-track-player 5.0.0-alpha0 does
  not build against React Native 0.86; see above for the fallback.
- **No screen has ever been rendered.** Layout, spacing, scroll behaviour and
  the lyric auto-scroll are reasoned about, not seen. Expect to nudge padding.
- Audio playback, gapless transitions, lock-screen controls, audio focus and
  interruption handling.
- Downloads: `expo-file-system`'s `DownloadTask` pause/resume path, and whether
  a paused download survives the app being backgrounded.
- Play/skip reporting reaching the server, and the play-count threshold feeling
  right in practice.
- Android Auto: that the app appears in the launcher, and that `RemotePlayId` /
  `RemotePlaySearch` fire as expected from the Assistant.
- Whether Expo's `NSAllowsArbitraryLoads` and the cleartext manifest flag are
  enough for a `*.ts.net` host in practice, or whether Tailscale's own HTTPS
  certificates would be less trouble.

The sensible first hour on a Mac: `npm install`, `npm run build --workspace
@selfmp3/shared`, `cd apps/app && npx expo-doctor`, then `npx expo run:ios`.
If the track-player pod fails, that is the known risk, and the SDK 54 fallback
is the answer.

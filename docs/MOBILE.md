# The native app

`apps/app` is one Expo (React Native) app for iOS, Android and the web. This
guide is about running it on a phone: the player and sync client for the library
in your bucket, with Android Auto.

It exists because a browser cannot do the two things that matter most in
practice — dependable background audio on iOS, and real files on the device
rather than a cache the OS may evict. Everything else it does, the same app
already does in a tab; the shared zod schemas and pure helpers in
`packages/shared` are used verbatim, not copied.

An iOS dev client has been built and run on simulators since this was written.
What to check on a phone before calling a build good is in
[PREPROD.md](PREPROD.md).

**No Android binary has ever been built, and nothing has ever run on a physical
Android device.** Not once, not partly. Every Android claim in this file is
either something read out of the generated project and the packages on disk, or
something reasoned about — never something seen working. `expo prebuild
--platform android` has been run and its output inspected (see [Android, from
nothing to a running app](#android-from-nothing-to-a-running-app)), but no
Gradle task has ever been executed against it, because the machine this was
prepared on has no Android SDK. Treat the first `expo run:android` as the real
test, and expect it to find things this file could not.

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
| **Android Auto** | See [Android Auto](#android-auto). The honest answer is "less than was hoped, and never tested in a car". |

The tabs along the bottom are **Library · Playlists · Import · You**; You holds
Stats & report, Untagged, Tags and Settings. Settings holds the Google account,
the download controls and the storage numbers.

---

## Prerequisites

**Both platforms**

- Node 22+ and a working `npm install` at the repository root.
- The shared package must be built before Metro or `tsc` can resolve it:
  `npm run build --workspace @selfmp3/shared`, and likewise `@selfmp3/replica` and
  `@selfmp3/client`. `npm run check:app` from the root does this for you.

**iOS**

- macOS with Xcode 16 or newer, and its command line tools.
- CocoaPods (`sudo gem install cocoapods`, or `brew install cocoapods`).
- An Apple ID. A free one is enough to run this on your own phone, seven days
  at a time; a paid account ($99/year) is what makes a build last. This is a
  personal app on the free path, which is also why there is no CarPlay.

**Android**

Nothing here is installed on the machine this was prepared on, which is why the
next section spells the whole thing out rather than saying "install Android
Studio". The versions are not a guess: they are what the generated project
actually asks for, read out of `node_modules/react-native/gradle/libs.versions.toml`
(which Expo adopts wholesale as its version catalog) and out of `android/` after
a prebuild.

| | |
|---|---|
| JDK | 17 or newer. AGP 8.12 will not run on 11; Temurin 21 is fine. |
| Gradle | 9.3.1 — no action needed, the wrapper downloads it. |
| Android Gradle Plugin | 8.12.0, pulled from Maven by the wrapper. |
| SDK Platform | **36** (compileSdk and targetSdk are both 36; minSdk is 24). |
| Build-Tools | **36.0.0**. |
| NDK | **27.1.12297006** — not optional. screens, gesture-handler, nitro-modules and unistyles all compile C++. |
| CMake | 3.22.1, the version the NDK ships with. |
| Emulator | only if you have no phone; a physical device over USB is faster. |

- `ANDROID_HOME` set, and `adb` on your `PATH`.
- For Android Auto testing, the **Desktop Head Unit** (see below).

---

## Running it on a phone

```bash
# once, from the repository root
npm install
npm run build --workspace @selfmp3/shared
npm run build --workspace @selfmp3/replica
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

### Android, from nothing to a running app

The short version above assumes a working Android toolchain. Nobody here has
one, so this is the whole path, in order. Steps 1–3 are one-time.

**1. A JDK.** `java -version` must print 17 or newer.

```bash
brew install --cask temurin@21     # skip if you already have 17+
```

**2. The SDK.** Android Studio is the easy route — install it, open it once, and
let the setup wizard run. Then **Settings → Languages & Frameworks → Android SDK**:

- **SDK Platforms** tab → tick **Android 16 (API 36)**.
- **SDK Tools** tab → tick **Show Package Details**, then:
  - **Android SDK Build-Tools** → `36.0.0`
  - **NDK (Side by side)** → `27.1.12297006` (the exact version; a different
    one makes every C++ module rebuild and can fail outright)
  - **CMake** → `3.22.1`
  - **Android SDK Command-line Tools (latest)**
  - **Android SDK Platform-Tools** (this is what gives you `adb`)
  - **Android Auto Desktop Head Unit Emulator**, if you want the car without a car

That is roughly 6 GB. If you would rather not install the IDE, the same set can
be had from the standalone command-line tools with `sdkmanager "platforms;android-36"
"build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1" "platform-tools"`.

**3. The environment.** Add to `~/.zshrc` and open a new shell:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

Check it: `adb version` and `sdkmanager --list_installed` should both answer.

**4. A device.** Either enable **Developer options → USB debugging** on the
phone and plug it in, or create an emulator (Android Studio → Device Manager →
a Pixel with the API 36 image). `adb devices` must list exactly one device; with
two, `expo run:android` picks one and you will wonder which.

**5. Build it.** From the repository root:

```bash
npm install
npm run build --workspace @selfmp3/shared
npm run build --workspace @selfmp3/replica
npm run build --workspace @selfmp3/client

cd apps/app
npx expo-doctor                          # see "What expo-doctor says" below
npx expo prebuild --platform android --clean
npx expo run:android
```

The first Gradle run downloads Gradle 9.3.1, AGP, media3, the AndroidX world and
then compiles the C++ in four architectures. Budget 15–30 minutes and several GB
of `~/.gradle`. Later builds are minutes.

**If it fails**, the useful output is not the tail of the log:

```bash
cd apps/app/android
./gradlew :app:assembleDebug --stacktrace
```

Two failures are worth recognising on sight:

- Anything naming `com.doublesymmetry.trackplayer`, `media3`, codegen or
  `TrackPlayerSpec` is the known react-native-track-player risk. The fallback is
  Expo SDK 54 / React Native 0.81 with track-player 4.1.2, described under
  [Why the track-player alpha](#why-the-track-player-alpha) — a `package.json`
  change and a `prebuild --clean`, not a rewrite.
- `aapt2 ... resource ... not found` means a config plugin produced a project
  that references something it did not generate. Do not hand-edit `android/`;
  fix `app.config.js` or `plugins/` and prebuild again. (This has happened once
  already — see the splash screen note below.)

**Release build**, for sideloading onto your own phone:

```bash
cd apps/app
npx expo run:android --variant release
```

Expo signs it with the generated debug keystore, which is fine for a phone you
own and useless for the Play Store.

### What expo-doctor says

Run in `apps/app`. As of this writing, 20 of its 21 checks pass and the one that
fails is this:

```
🔧 Patch version mismatches
expo ~57.0.23 / 57.0.21, expo-constants, expo-file-system, expo-linking,
expo-router, expo-secure-store, expo-splash-screen, expo-system-ui
```

Every one of those is a patch behind, and the declared ranges in
`apps/app/package.json` already allow the newer patch — it is `package-lock.json`
that is holding them back. Nothing forces the issue, but the first thing to do
on a machine that can actually build is `npx expo install --check` and accept
them: patch releases during an SDK's life are mostly build and prebuild fixes,
which is exactly the class of problem a first build hits.

Two complaints were silenced deliberately, both recorded in
`apps/app/package.json` under `expo`:

- **`reactNativeDirectoryCheck.exclude: ["react-native-track-player"]`.** The
  check reads React Native Directory's metadata, which describes the stable 4.x
  line and says "unsupported on New Architecture". That is true of 4.1.2 and not
  of the `5.0.0-alpha0` installed here, which is a TurboModule with a codegen
  spec. The warning was noise standing in front of real signal.
- **`install.exclude: ["react-native-reanimated", "react-native-worklets"]`.**
  Pinned by root `overrides` to `4.5.5` / `0.10.4` where Expo expects `4.5.1` /
  `0.10.1`. Both are inside the declared `~` ranges, both satisfy
  `expo-modules-core`'s peer range, and the pins are what stop npm installing a
  second nested copy. `expo install --fix` would fight the override forever.

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

**What does not — and this is worse than an earlier reading of the package
suggested.** The browse tree is missing on *both* sides, not just in JavaScript.

- **No JavaScript API.** `setBrowseTree` appears in the `5.0.0-alpha0` tarball
  only under `lib/src/` — a stale build artifact from the 4.x line. The package
  `main` is `lib/module/index.js` and its `exports` map admits nothing else, so
  `lib/src/` is unreachable; it is not in the TurboModule spec
  (`src/NativeTrackPlayer.ts`) either.
- **No native implementation.** This is the part that was not checked before.
  `android/src/.../service/MusicService.kt` builds a `MediaLibrarySession` but
  overrides only `onGetSession`. There is **no** `onGetLibraryRoot`, no
  `onGetChildren`, no `onGetItem`, no `onSearch`. `grep -rn setBrowseTree
  node_modules/react-native-track-player/android` finds nothing. So patching the
  JS spec would call a native method that was never written — option 2 below is
  dead, not merely fiddly.
- **The events the app listens for are never sent.** `MusicEvents.kt` declares
  `BUTTON_PLAY_FROM_ID = "remote-play-id"` and
  `BUTTON_PLAY_FROM_SEARCH = "remote-play-search"`, and nothing in
  `android/src/` ever emits either constant — the only lines that mention them
  are their own declarations. `Event.RemotePlayId` and `Event.RemotePlaySearch`
  therefore cannot fire on Android in this version, which makes
  `src/ports/car/androidAuto.ts` inert on the device even though it compiles,
  type-checks and reads correctly. **Voice search does not work.** An earlier
  version of this section said it did; that was wrong.

The stable 4.1.2 release is still worse in a different way: no browse API *and*
a plain `HeadlessJsTaskService` with no `MediaBrowserService` intent filter, so
Android Auto would not list the app at all.

**What is actually left.** Media3's default `MediaLibrarySession.Callback`
answers `onGetLibraryRoot` with `RESULT_ERROR_NOT_SUPPORTED`. The manifest
filters are real, so the app should still appear as a media session and be
drivable with transport controls, metadata and artwork from whatever is already
playing — but whether Android Auto lists an app whose browse root errors is
exactly the kind of thing that needs a head unit to settle, and nobody has run
one. Treat "Android Auto works, minus the menu" as a hypothesis.

`src/ports/car/androidAuto.ts` and `browseTree.ts` are worth keeping regardless:
the tree is pure, unit-tested (17 tests in the root vitest run), and it is the
input any of the routes below would need. The alternatives, in increasing order
of effort:

1. Wait for RNTP to land the API. The media3 groundwork is there — a
   `MediaLibrarySession` already exists — but the callbacks are not, so this is
   a larger ask of upstream than it looked.
2. ~~`patch-package` the alpha to expose `setBrowseTree` through the TurboModule
   spec.~~ Ruled out: there is no native side to expose.
3. Write the `MediaLibrarySession.Callback` overrides — `onGetLibraryRoot`,
   `onGetChildren`, `onGetItem`, and `onSetMediaItems` for voice — in the app's
   own Android source, reading the same tree. This is now the only route that
   ends in a browsable menu, and it would bring voice search with it.

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
  src/replica/            @selfmp3/replica, with this device's platform behind it
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
  producing the "invalid hook call" that eats an evening. The app's own
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
  rather than an error message. `expo-modules-core@57` declares
  `^0.7.4 || ^0.8.0 || ^0.9.0 || ^0.10.0` for worklets, so the pin is still
  doing real work; both are excluded from `expo install --fix` in
  `apps/app/package.json` so that it cannot undo them.

The `overrides` hold, checked rather than assumed: after a clean install there
is exactly one directory on disk for each of `react`, `react-dom`,
`react-native`, `react-native-reanimated` and `react-native-worklets`.

Since that was written, the *declared* Expo packages have also drifted a patch
behind what SDK 57 now expects — see [What expo-doctor says](#what-expo-doctor-says).
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

**Its Android Gradle setup, read against what Expo SDK 57 generates.** Coherent,
as far as static reading goes:

- The app project resolves AGP from React Native's version catalog: **8.12.0**,
  Gradle 9.3.1, compileSdk/targetSdk 36, minSdk 24, Kotlin 2.1.20.
  `node_modules/react-native/gradle/libs.versions.toml` is the source, and
  `expoAutolinking.useExpoVersionCatalog()` in `settings.gradle` is what adopts it.
- track-player's own `android/build.gradle` names `com.android.tools.build:gradle:8.7.2`
  in its `buildscript` block, but that is the ordinary
  create-react-native-library shape: the plugin classes come from the root
  project's classpath, so 8.12.0 is what actually applies. Its `compileSdkVersion`,
  `minSdkVersion` and `targetSdkVersion` all read `rootProject.ext`, which the
  `expo-root-project` plugin fills in — so it compiles at 36, not at the 35 in its
  own `gradle.properties` fallbacks.
- It applies `com.facebook.react` and sets `codegenJavaPackageName` to
  `com.doublesymmetry.trackplayer`, matching `codegenConfig` in its
  `package.json`; `MusicModule.kt` imports the generated
  `com.doublesymmetry.trackplayer.NativeTrackPlayerSpec`, and `TrackPlayerPackage`
  extends `BaseReactPackage` and reports `isTurboModule = true`. That is a
  New-Architecture module, not a bridge one.
- Autolinking finds it. `npx expo-modules-autolinking react-native-config
  --platform android` lists `react-native-track-player` with
  `packageImportPath: import com.doublesymmetry.trackplayer.TrackPlayerPackage;`,
  alongside the eleven other native modules.
- Its manifest carries `package="com.doublesymmetry.trackplayer"`, which AGP 8
  deprecated in favour of the `namespace` DSL. It sets `namespace` too, and
  `react-native-safe-area-context` — bundled with the SDK and certainly buildable
  — ships exactly the same pair, so this is a warning rather than the hard error
  it first looks like.

What no amount of reading settles is whether its Kotlin compiles against React
Native 0.86's headers and media3 1.8.0. That is still the single largest risk.

---

## The Android readiness pass

A pass was made over the Android side on a Mac with a JDK but no Android SDK at
all: no Android Studio, no `~/Library/Android/sdk`, no `adb`. So `expo prebuild
--platform android --clean` could be run and its output read, and Gradle could
not be run at all. This is what it found, worst first.

**Fixed, and the fix verified by regenerating the project**

- **The Android build could not have succeeded.** `app.config.js` configured
  `expo-splash-screen` with a `backgroundColor` and an `imageWidth` but no
  `image`. The plugin writes
  `<item name="windowSplashScreenAnimatedIcon">@drawable/splashscreen_logo</item>`
  into `values/styles.xml` unconditionally, and renders that drawable only when
  an image is given — so the generated project referenced a resource that was
  not in it, and `aapt2 link` would have failed at `:app:processDebugResources`
  before compiling a line of Kotlin. iOS shows a blank splash instead of
  failing, which is why an iOS-only build never caught it. The fix is
  `image: './assets/adaptive-icon.png'` (the mark with its background dropped,
  which is what a splash over `#14121a` wants); after a fresh prebuild,
  `splashscreen_logo.png` is present at all five densities. The bug is still in
  the newest SDK 57 patch of the plugin, so updating Expo will not remove the
  need for the `image` key.
- `@types/jest` was `^30` against a jest `29.7` runtime — a major-version skew
  expo-doctor flagged, which had also dragged a whole second jest 30 dependency
  subtree into `package-lock.json`. Pinned to `^29.5.14`.
- `npm run check:app` was failing on the branch for an unrelated reason
  (`QueueViaBucket.test.tsx` reading `.props.value` where the rest of the suite
  uses `.props['value']`, which `noPropertyAccessFromIndexSignature` rejects).
  Fixed, because an already-red gate hides the next real problem.

**Checked and found sound** — `expo prebuild --platform android --clean` runs
clean; `android:usesCleartextTraffic="true"` is in the *main* manifest, so the
config plugin applies to release builds as intended; the launcher icon and the
adaptive icon are generated at every density with `iconBackground` `#14121a`;
`INTERNET` and `WAKE_LOCK` are declared and `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_MEDIA_PLAYBACK` and the `MediaLibraryService` /
`MediaBrowserService` intent filters arrive by manifest merge from
react-native-track-player, exactly as claimed; all twelve native modules
autolink; and there is exactly one copy on disk of `react`, `react-dom`,
`react-native`, `react-native-reanimated` and `react-native-worklets`, at
19.2.3 / 19.2.3 / 0.86.3 / 4.5.5 / 0.10.4.

**Left alone, ranked by how likely each is to break the first build**

1. **react-native-track-player 5.0.0-alpha0 compiling at all.** Unchanged as the
   top risk, and nothing static can settle it. See
   [Why the track-player alpha](#why-the-track-player-alpha) for what *was*
   settled and for the SDK 54 fallback.
2. **Eight Expo packages a patch behind what SDK 57 now expects.** Within their
   declared ranges; only the lockfile holds them back. Run `npx expo install
   --check` first on a machine that can build.
3. **react-native-unistyles 3.3.0 against react-native-nitro-modules 0.37.1.**
   Unistyles was built with nitrogen 0.36.1 and its generated C++ is coupled to
   the nitro runtime. Its README only promises a *minimum* (≥ 0.35.2), which
   0.37.1 clears, but nitro version skew shows up as a C++ compile error rather
   than a resolution failure. If `:react-native-unistyles:buildCMakeDebug` fails,
   try `react-native-nitro-modules@0.36.1`.
4. **`POST_NOTIFICATIONS` is neither declared nor requested.** targetSdk is 36,
   and from API 33 the media notification needs that permission granted at
   runtime. Nothing in `src/` calls `PermissionsAndroid`. Declaring it without
   requesting it would achieve nothing, and what the right request point is
   depends on how the notification actually behaves on a device — so this is
   written down rather than guessed at. Expect the lock-screen and notification
   controls to need work here.
5. **Node 26.** Everything above was run on Node 26.8.2, which is newer than
   anything Expo SDK 57 was tested against. Nothing misbehaved, but if something
   inexplicable happens in Metro or prebuild, Node 22 is the version to fall
   back to.

**Still completely unknown**, because it needs the SDK, a device, or both: every
Gradle task; the C++ builds for screens, gesture-handler, nitro-modules and
unistyles; whether the app launches; audio, gapless, audio focus, lock-screen
controls; downloads and their pause/resume; and everything in
[Android Auto](#android-auto).

---

## Measuring performance on a phone

What a laptop can prove about the phone's speed, and what only the phone can.
The 2026-09-17 pass (Now Playing's visual stuttering; a like leaving its
pressed box on screen) is the worked example: each finding below was counted
in a jest test first, and the fix is the test's assertion.

**What a test on this Mac can count honestly** — renders and commits, not
milliseconds:

- **React renders per event.** Wrap the memoised component in a counting
  `memo` (`LibraryScreen.perf.test.tsx` does this for `SongRow`, and logs which
  props changed when a row rendered again), and put a component that calls the
  context hook beside the screen to count how far a change reaches
  (`PlayerReader`, `DownloadsReader`). A like went from 16 row renders to one.
- **Shadow-tree commits per frame.** On the New Architecture, every
  `Animated.Value.setValue` without the native driver is a `setNativeProps`,
  and each of those is a commit of the whole shadow tree on the JavaScript
  thread (`ReactNativeElement.setNativeProps` →
  `UIManager::setNativeProps_DEPRECATED` → `shadowTree.commit`). Spy on
  `Animated.Value.prototype.setValue` and divide by `requestAnimationFrame`
  calls (`SongVisual.perf.test.tsx`). The visual went from 9–20 commits a
  frame to one shared-value write, applied on the UI thread.
- **What a dropdown leaves behind.** Open and close it ten times with fake
  timers and compare mounted nodes, `jest.getTimerCount()`, and spies on
  `Appearance`, `Dimensions` and `AccessibilityInfo` listeners before and after
  (`AppearancePanel.perf.test.tsx`). The Settings theme dropdown leaves
  nothing; a same-theme pick costs one synchronous pref write and Unistyles
  ignores it.
- **Work per edit on a cloud library**, timed in Node against the replica's
  own functions: `show()`'s view rebuild, `LibrarySchema.parse` of a refetch,
  React Query's `replaceEqualDeep`. At 2,000 songs: 3 + 29 + 12 ms on this
  Mac's V8. Hermes on a phone is several times slower, so treat these as lower
  bounds.

**What is not honest here, and needs the phone:** any millisecond figure from
jest (a JS-only renderer, V8, no layout, no Fabric); whether a frame is
actually dropped; the cost of a layout prop (a border width, a font size)
versus a transform; memory. Jest's Reanimated mock runs `useAnimatedStyle` on
the JavaScript thread, so a test proves what is *written* per frame, not that
the UI thread carries it.

**On the device**, in this order:

1. **The in-app perf monitor** (shake → *Show Perf Monitor*, dev build only):
   two frame rates, JS and UI. A visual that stutters with the JS rate low and
   the UI rate at 60/120 is a JS-thread stall; both low is the GPU or layout.
   Watch the RAM number across ten open/close cycles of a sheet.
2. **Xcode Instruments → Time Profiler** on a *release* build run from Xcode
   (Product → Profile). Filter the call tree to the main thread and to
   `com.facebook.react.JavaScript`. Look for `UIManager::setNativeProps`,
   `ShadowTree::commit`, `Yoga` (`YGNodeCalculateLayout`) and
   `hermes::vm` frames under a tap or during a visual. A commit per
   `setValue` shows as a wall of `ShadowTree::commit` under the JS thread.
3. **Instruments → Animation Hitches** (Core Animation) on the same build
   records every late frame with what the main thread was doing.
4. **Reanimated**: `useAnimatedStyle` and `useFrameCallback` run on the UI
   thread; a `console.log` inside a worklet prints with `[worklet]`. To see
   whether a value is animated on the UI thread or through a shadow-tree
   commit, `ReanimatedModuleProxy::commitUpdates` versus
   `synchronouslyUpdateUIProps` in Time Profiler: transforms and opacity take
   the synchronous path, layout props (width, borderWidth) take a commit.
5. **Hermes sampling profiler** for the JS thread alone: dev menu →
   *Enable Sampling Profiler*, reproduce, disable; the trace opens in Chrome's
   Performance panel and shows every JS function with its self time, including
   the zod parse and the replica's replay on a like.
6. **A memory leak from a sheet**: Instruments → Allocations, mark a
   generation, open and close ten times, mark again; anything still live in
   the second generation that was made by `Sheet`, `Popover` or `Overlay` is
   the leak.

A release build is the only one that answers a "does it feel slow" question:
a dev build carries the dev menu, remote-debugging hooks and un-minified
Hermes bytecode, and is slower everywhere by a factor that hides the thing
being measured.

---

## What was and was not verified

*This is the record from when the phone app was a separate workspace, before
any binary was built. The dev client has been built and run on iOS simulators
since; the log of those runs, `docs/universal-progress.md`, was taken out of the
tree on 2026-09-18 and `git log` finds it.*

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
- Android Auto: that the app appears in the launcher. (`RemotePlayId` /
  `RemotePlaySearch` no longer belong on this list — reading the package
  established that the installed version never emits them. See
  [Android Auto](#android-auto).)
- Whether Expo's `NSAllowsArbitraryLoads` and the cleartext manifest flag are
  enough for a `*.ts.net` host in practice, or whether Tailscale's own HTTPS
  certificates would be less trouble.

The sensible first hour on a Mac: `npm install`, `npm run build --workspace
@selfmp3/shared`, `cd apps/app && npx expo-doctor`, then `npx expo run:ios`.
If the track-player pod fails, that is the known risk, and the SDK 54 fallback
is the answer. For Android, start instead at
[Android, from nothing to a running app](#android-from-nothing-to-a-running-app),
which assumes nothing is installed, and read
[The Android readiness pass](#the-android-readiness-pass) before you begin — it
ranks what is most likely to go wrong.

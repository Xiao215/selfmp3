# The native app

`apps/app` is one Expo (React Native) app for iOS, Android and the web. This
guide is about running it on a phone: building it, getting it onto a device,
how it finds its library and its server, and Android Auto.

It exists because a browser cannot do the two things that matter most in
practice — dependable background audio on iOS, and real files on the device
rather than a cache the OS may evict. Everything else it does, the same app
already does in a tab; the shared zod schemas and pure helpers in
`packages/shared` and `packages/client` are used verbatim, not copied.

The Mac is where the app is built and where its simulator tests run. It is not
where the library or the server lives: the library is in your bucket, and the
server runs on an always-on computer (see [INSTALL.md](INSTALL.md)).

**State of play.** The iOS app runs on simulators as a development build and on
a real iPhone as a release build; streaming a song from the bucket was first
confirmed on a real iPhone on 2026-09-17. **No Android binary has ever been
built, and nothing has ever run on an Android device.** Every Android claim in
this file is read out of the generated project and the packages on disk, or
reasoned about — never seen working. `expo prebuild --platform android` has been
run and its output inspected, but no Gradle task has, because no machine this was
prepared on has had an Android SDK. Treat the first `expo run:android` as the
real test. What to check on a phone before calling a build good is in
[PREPROD.md](PREPROD.md).

---

## How a phone finds its library and its server

**The library is the bucket's.** First launch opens on Welcome, whose one button
is Continue with Google. Signing in goes through the doorman, which hands the
device access to the bucket that belongs to the account; the library arrives
from there (First sync, once per device), and the device keeps its own copy of
it (`packages/replica`), so the app opens and browses with no connection. Edits
made on the phone are written to the bucket as log entries and reach every other
device from there ([SYNC.md](SYNC.md)).

**The server is found, never typed.** A few things only the server can do: it
runs yt-dlp, so importing is its, and so are Stats, metadata lookup and the
smart features. A signed-in phone reaches it directly by the addresses the
server writes into every snapshot it publishes to the bucket, with the token
that comes alongside (`packages/client/src/connection/reach.ts`). When the
bucket names no server at all, the phone joins the shared one — the
`DEFAULT_SERVER_URL` in `packages/shared/src/cloud.ts`, by itself and once
(`packages/replica/src/sharedServer.ts`; [shared-server.md](features/shared-server.md)).
When the server does not answer, the screens that need it say so, and Import
still works: the link is left in the bucket and the server takes it when it is
next reachable.

Two build-time variables change those defaults for a copy of the app:
`SELFMP3_DOORMAN_URL` (the doorman to sign in through) and `SELFMP3_SERVER_URL`
(the shared server to offer). `app.config.js` puts them in `extra`; left unset,
the values in `packages/shared/src/cloud.ts` are used.

Development builds keep one way to type an address: a quiet "Connect to a server
by address" under the Google button on Welcome. It is there for the simulator
flows, which cannot sign in to a Google account, and for trying the app against
a development server on the Mac (`apps/app/.maestro/README.md`). A normal build
does not draw it.

---

## What it does on a phone

The screens are the web app's, drawn at phone width; the layout is decided by
width, not platform. The tabs are **Home · Library · Playlists**. Home leads to
the rest: the tags from its tiles, Import from its +, and Profile from its
avatar, which holds Stats, the report and Settings.

What only the phone build adds:

| | |
|---|---|
| **Background audio** | react-native-track-player: lock screen, notification, headphone buttons, audio focus. |
| **Downloads** | Real files in the app's document directory, with a persisted index. Automatic on Wi-Fi if that is on, asking first on mobile data and over 500 MB, or by hand from a song or playlist. A downloaded song plays from disk. |
| **Streaming from the bucket** | A song that is not downloaded streams from the doorman's `/v1/files/<key>` with the session's bearer sent as a header on the track (`src/ports/bucketMedia.ts`). It obeys "Play songs that aren't downloaded" and the ask before using mobile data. |
| **Played songs kept** | With automatic downloads off, a song that counts as a play is also kept as a file, so it is not fetched again tomorrow (`src/ports/recentCopies.ts`). These copies are a cache, not downloads: they live in the system's cache folder, never show as on the device, take at most a quarter of the free space up to 2 GB, and the least recently played go first. Downloading one by hand moves it rather than fetching it again. |
| **Home-screen widgets** | iOS only; see [widget.md](features/widget.md). |
| **Android Auto** | See [Android Auto](#android-auto). Less than was hoped, and never tested in a car. |

**Crossfade is not implemented and will not be** on a phone: the web engine does
it by overlapping two audio elements, and react-native-track-player exposes one
player with one volume. Gapless is the native player's job; it loads the next
item before the current one ends.

### A hardware keyboard

An iPad with a Magic Keyboard, or an iPhone with a Bluetooth one, answers the desktop app's
menu keys: Space for play and pause, ⌘← ⌘→ for previous and next, ⌥⌘← ⌥⌘→ to seek, ⌘↑ ⌘↓
and ⌥⌘↓ for the volume, ⌘K for Search, ⌘1–3 for Library, Playlists and Now Playing, and ⌘,
for Settings. Escape — or ⌘., since a Magic Keyboard has no Escape key — closes the sheet,
menu or dialog on top, or with none open clears the
selection and, at a computer's width, closes Now Playing's stage. ⌘A in a song list selects every song. Holding ⌘ shows
them all in iPadOS's own list, named as the menu names them, and while a keyboard is attached
Settings › Keyboard shortcuts lists them and the sidebar shows ⌘K beside Search.

React Native delivers no key presses on iOS, so these are the app's own Expo module,
`apps/app/modules/key-commands`: Swift that puts a `UIKeyCommand` for each key on the root
view controller and sends each press to JavaScript, where `ports/keyCommands.ts` and
`shell/keyRegistry.ts` hand it to whichever hook registered it — `useCommands` (the menu's
keys, read from `packages/desktop-bridge/src/menu.ts`), `useHotkeys`, `useEscape` and a
list's `useListKeys`. A key command beats a text field, so the module takes Space, the
⌘-arrows and ⌘A away while one is being typed in, which is what the desktop's `pageKeeps`
marks; ⌘K, ⌘1–3 and the rest answer there too, as the desktop's menu does. Escape answers in
a field as well, unless an input method is composing. Whether a keyboard is attached is
GameController's `GCKeyboard`. A song list's arrows, Space and Enter are the web's alone: a
native row is nowhere the keyboard can be ([FEATURE_TODO.md](FEATURE_TODO.md)).

The module is native code, so it needs a dev client built after it was added; an older dev
client simply has no keys. Android does not build it and has none. On the simulator, I/O ›
Keyboard › Connect Hardware Keyboard passes the Mac's keyboard through; a debug build logs
`[KeyCommands]` lines (what is registered, each press) to the device log. An XCUITest's
`typeKey` presses them too, which is how they were checked on the iPad Pro 11-inch on
2026-10-14: ⌘2, ⌘,, ⌘K, the ⌘-arrows, Space, and ⌘. closing the top layer, with Space
typing a space into the palette's box. Two things that run did not show: the Escape key
itself (the test's Escape never arrived as a key command, though ⌘. did) and the list
iPadOS draws while ⌘ is held. The first press after a cold launch was also lost there, which
may be the test harness's.

---

## Prerequisites

**Both platforms**

- Node 22 or newer, and `npm install` at the repository root. In a fresh git
  worktree, run `npm install` there first: without its own `node_modules`, Node
  resolves `@selfmp3/*` up to the main checkout's (possibly stale) builds.
- The workspace packages built before Metro or `tsc` can resolve them:
  `npm run build:packages` (`shared`, `replica`, `client`, `desktop-bridge`).
  `npm run check:app` does this for you.

**iOS**

- macOS with a current Xcode and its command line tools.
- CocoaPods (`brew install cocoapods`).
- A UTF-8 locale in the shell that runs `pod install` or `expo run:ios`.
  Without it CocoaPods fails with "Unicode Normalization not appropriate for
  ASCII-8BIT", which `expo run:ios` reports as "The sandbox is not in sync with
  the Podfile.lock":

  ```bash
  export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
  ```

- An Apple ID. A free one is enough to run the app on your own phone, seven
  days at a time; the paid Developer Program ($99/year) is what makes a build
  last and allows TestFlight. This is a personal app on the free path, which is
  also why there is no CarPlay (its entitlement is granted only to paid teams).

**Android**

The versions are not a guess: they are what the generated project asks for, read
out of `node_modules/react-native/gradle/libs.versions.toml` (which Expo adopts
as its version catalog) and out of `android/` after a prebuild.

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

## Running it on the iOS simulator

```bash
# once, from the repository root
npm install
npm run build:packages

cd apps/app
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
npx expo run:ios        # or: npx expo run:android
```

`expo run:*` generates the native project (`ios/`, `android/`), installs pods or
Gradle dependencies, builds a development client and starts Metro. Both native
folders are generated and **git-ignored** — everything that has to survive lives
in `app.config.js`, `plugins/` and `targets/`. If a native folder ever looks
wrong, delete it and let `npx expo prebuild --clean` rebuild it rather than
editing it.

After the first build the development client only needs a bundler:
`npm run start --workspace @selfmp3/app` (`expo start --dev-client`). Rebuild the
packages first if one of them changed, and rebuild the client itself after any
native change (a new native module, `app.config.js`, the widget).

**Choosing the Metro port.** Several worktrees can each run their own Metro, and
a development client loads whichever bundler it was last pointed at — so after
starting one on a port of its own, point the simulator at it:

```bash
npx expo start --dev-client --port 8082
xcrun simctl openurl booted \
  "selfmp3://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082"
```

The first deep link on a fresh simulator raises "Open in self.mp3?", and
`simctl openurl` does not return until it is answered. Metro started inside a
worktree does not always notice edits; if the app shows old code, restart it
with `--clear`.

---

## A release build on your own iPhone

A development client is an empty shell that fetches its code from Metro on the
Mac, so it proves nothing about what a person installs and stops working when
the phone leaves the Wi-Fi. A **release** build carries its code and runs
anywhere. The one-time setup of the phone (a data cable, Developer Mode,
trusting the certificate) is in [PREPROD.md](PREPROD.md), stage 5.

With the phone plugged in and unlocked:

```bash
cd apps/app
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
npx expo run:ios --configuration Release --device <udid> --no-bundler
```

`app.config.js` sets no `ios.appleTeamId`, so prebuild warns about it and Xcode
picks the signing team. When the phone cannot be reached at build time, or
`expo run:ios` will not pick the team, build for any device and install
afterwards:

```bash
cd apps/app
npx expo prebuild -p ios --no-install
(cd ios && pod install)
xcodebuild -workspace ios/selfmp3.xcworkspace -scheme selfmp3 \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath build/ddp -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM=<your team id> build

xcrun devicectl list devices
xcrun devicectl device install app --device <device id> \
  build/ddp/Build/Products/Release-iphoneos/selfmp3.app
xcrun devicectl device process launch --device <device id> com.selfmp3.app
```

A fresh build, prebuild and pods included, takes 20–45 minutes; later ones about
ten. `-allowProvisioningUpdates` makes the profiles for the app and its widget.
Trust `devicectl list devices` over `xctrace`, which can list a working phone as
offline. `devicectl device install` sometimes fails with a dropped connection
(NWError 54 or 60); a plain retry usually works. It can install while the phone
is locked, but `process launch` needs it unlocked — or tap the icon.

**With a free Apple ID**, the profiles expire seven days after they are made: the
app stops launching until it is built and installed again. At most three apps
can be signed this way, and the profiles carry no App Group, which the widget
reads its snapshot through.

---

## Android, from nothing to a running app

Steps 1–3 are one-time.

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

That is roughly 6 GB. Without the IDE, the same set comes from the standalone
command-line tools: `sdkmanager "platforms;android-36" "build-tools;36.0.0"
"ndk;27.1.12297006" "cmake;3.22.1" "platform-tools"`.

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
npm run build:packages

cd apps/app
npx expo install --check                 # see "expo-doctor" below
npx expo prebuild --platform android --clean
npx expo run:android
```

The first Gradle run downloads Gradle, AGP, media3 and the AndroidX world, then
compiles the C++ in four architectures. Budget 15–30 minutes and several GB of
`~/.gradle`. Later builds are minutes.

**If it fails**, the useful output is not the tail of the log:

```bash
cd apps/app/android
./gradlew :app:assembleDebug --stacktrace
```

Two failures are worth recognising on sight:

- Anything naming `com.doublesymmetry.trackplayer`, `media3`, codegen or
  `TrackPlayerSpec` is the known react-native-track-player risk. The fallback is
  described under [Why the track-player alpha](#why-the-track-player-alpha) — a
  `package.json` change and a `prebuild --clean`, not a rewrite.
- `aapt2 ... resource ... not found` means a config plugin produced a project
  that references something it did not generate. Do not hand-edit `android/`;
  fix `app.config.js` or `plugins/` and prebuild again. The splash screen's
  `image` key in `app.config.js` exists for exactly this reason: without it the
  plugin points the theme at a drawable it never renders.

**Release build**, for sideloading onto your own phone:

```bash
cd apps/app
npx expo run:android --variant release
```

Expo signs it with the generated debug keystore, which is fine for a phone you
own and useless for the Play Store.

### What could break the first Android build

Ranked by likelihood:

1. **react-native-track-player 5.0.0-alpha0 compiling at all.** Nothing static
   can settle it; see [Why the track-player alpha](#why-the-track-player-alpha).
2. **Expo packages a patch behind** what the SDK now expects. Run
   `npx expo install --check` first and accept the patches: patch releases
   during an SDK's life are mostly build and prebuild fixes.
3. **react-native-unistyles against react-native-nitro-modules.** Unistyles'
   generated C++ is coupled to the nitro runtime, and version skew shows up as
   a C++ compile error rather than a resolution failure. If
   `:react-native-unistyles:buildCMakeDebug` fails, pin nitro-modules to the
   version unistyles was generated with.
4. **`POST_NOTIFICATIONS` is neither declared nor requested.** From API 33 the
   media notification needs it granted at runtime, and nothing in `src/` calls
   `PermissionsAndroid`. Expect the lock-screen and notification controls to
   need work here.

Still completely unknown, because it needs the SDK, a device or both: every
Gradle task, the C++ builds, whether the app launches, audio and audio focus,
lock-screen controls, downloads, and everything in [Android Auto](#android-auto).

### expo-doctor

`npx expo-doctor` (or `npm run doctor --workspace @selfmp3/app`) checks the
project against Expo's current view of the world. Two of its complaints are
silenced on purpose, both recorded in `apps/app/package.json` under `expo`:

- **`doctor.reactNativeDirectoryCheck.exclude: ["react-native-track-player"]`.**
  React Native Directory describes the stable 4.x line and says "unsupported on
  New Architecture". That is true of 4.1.2 and not of the `5.0.0-alpha0`
  installed here, which is a TurboModule with a codegen spec.
- **`install.exclude: ["react-native-reanimated", "react-native-worklets"]`.**
  Pinned by root `overrides` (below); `expo install --fix` would fight the
  override for ever.

### EAS

There is no `eas.json` in the repository, and no build has been made with EAS.
`eas build:configure` writes one; EAS builds from a Git checkout, handles npm
workspaces, and needs no local toolchain. It is also the route to a TestFlight
build, which needs the paid Developer Program.

---

## Android Auto

What follows was established by reading the installed packages rather than their
documentation.

**What should work.** react-native-track-player 5's `MusicService` is a media3
`MediaLibraryService`, and its manifest declares both
`androidx.media3.session.MediaLibraryService` and
`android.media.browse.MediaBrowserService`. So the app should appear to Android
Auto as a media session, drivable with transport controls, metadata and artwork
from the current queue.

**What does not.** The browse tree is missing on both sides:

- **No JavaScript API.** `setBrowseTree` appears in the `5.0.0-alpha0` tarball
  only under `lib/src/`, a stale build artifact from the 4.x line that the
  package's `exports` map makes unreachable; it is not in the TurboModule spec
  (`src/NativeTrackPlayer.ts`) either.
- **No native implementation.** `MusicService.kt` builds a
  `MediaLibrarySession` but overrides only `onGetSession`: no
  `onGetLibraryRoot`, `onGetChildren`, `onGetItem` or `onSearch`.
- **No voice search.** `MusicEvents.kt` declares `remote-play-id` and
  `remote-play-search`, and nothing in the native source ever emits them. So
  `Event.RemotePlayId` and `Event.RemotePlaySearch` cannot fire, and
  `src/ports/car/androidAuto.ts` is inert on a device even though it compiles
  and reads correctly.

Media3's default callback answers `onGetLibraryRoot` with
`RESULT_ERROR_NOT_SUPPORTED`. Whether Android Auto lists an app whose browse root
errors is exactly what needs a head unit to settle, and nobody has run one: treat
"Android Auto works, minus the menu" as a hypothesis. The stable 4.1.2 is worse:
no browse API and no `MediaBrowserService` intent filter, so Android Auto would
not list the app at all.

`src/ports/car/browseTree.ts` is worth keeping regardless: the tree is pure,
unit-tested in the root vitest run, and it is the input any fix would need. The
only route that ends in a browsable menu (and brings voice search with it) is
writing the `MediaLibrarySession.Callback` overrides — `onGetLibraryRoot`,
`onGetChildren`, `onGetItem`, and `onSetMediaItems` for voice — in the app's own
Android source, reading that tree. Waiting for upstream is the other option.

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

The app should appear in the media launcher once it is running and has a media
session. Google's page is at
<https://developer.android.com/training/cars/testing/dhu>.

---

## How it fits together

```
apps/app
  app/                    expo-router file routes, one per screen, at every width
  src/features/           a folder per screen or tool, with a pure model beside it
  src/ports/              what differs by platform (engine, offline store, prefs,
                          secrets, cloud platform, device, desktop, the car)
  src/player/             the provider: queue state, engine port, play counting
  src/offline/            downloads, covers, the listen outbox
  src/replica/            @selfmp3/replica, with this device's platform behind it
  src/connection/         finding the server: direct, or by the bucket's snapshot
  src/shell/              tabs, sidebar, layout by width
  src/ui/                 components, icons, the Unistyles theme
  plugins/                config plugins run at prebuild time
  modules/key-commands/   the app's own Expo module: a hardware keyboard's keys (iOS)
  targets/widget/         the iOS widget's SwiftUI target
```

The player keeps the same three-way split as the web app, with one piece
swapped:

- **Queue rules** are `packages/shared/src/queue.ts`, the same pure functions
  the web build uses.
- **The engine** is react-native-track-player (`src/ports/engine.ts`) instead of
  two `<audio>` elements (`engine.web.ts`). It owns buffering, auto-advance and
  the lock screen.
- **The glue** is `src/player/PlayerProvider.tsx`: `QueueState` is the source of
  truth for *order*, the native player is the source of truth for *position*,
  and it reports back through `PlaybackActiveTrackChanged`.

**Play counts** use the same rule everywhere (`packages/client/src/listens/counting.ts`):
a play is counted once a minute of the song has actually been heard — all of it,
for a shorter song — or when it plays to its end. Seeking adds nothing.

**The download index** is a JSON file rather than SQLite: one small object, read
once at launch and rewritten after each download, which can be printed, diffed
and deleted by hand when something goes wrong. The pure half is
`packages/client/src/downloads/downloadIndex.ts`; `src/offline/downloads.ts` is
the effectful half.

---

## Repository plumbing worth knowing

**The app is excluded from the root TypeScript project and the root ESLint
config**, both with comments saying why. React Native's type definitions declare
globals that conflict with the DOM ones, so sharing a project graph would leak
them. `apps/app` is checked on its own, and `npm run check` runs that too:

```bash
npm run typecheck:app      # builds the packages first, then tsc for the app and its service worker
npm run lint:app
npm run check:app          # both, and the jest component tests
```

Its pure tests (`*.test.ts`) run in the root vitest suite as well, because they
import nothing from React Native; component tests (`*.test.tsx`) are jest-expo's.

**The `overrides` block in the root `package.json`** fixes real failures:

- `react`, `react-dom` and `@types/react` pinned to what Expo SDK 57 ships with.
  This keeps npm from installing a second copy of React nested under
  `apps/app`, which Metro would bundle alongside the root one — the "invalid
  hook call" that eats an evening.
- `react-native-reanimated` and `react-native-worklets` pinned exactly. They
  arrive transitively through `expo-router`; left alone, npm picks a worklets
  release outside `expo-modules-core`'s declared peer range, the kind of
  mismatch that surfaces as a native crash rather than an error message.

**`metro.config.js` deliberately does not set `disableHierarchicalLookup`.** It
is the usual monorepo advice and wrong here: it fixes duplicate React but breaks
the packages in this tree that legitimately have their own nested
`node_modules`. The `overrides` solve the duplication at its cause instead.

If you hit an `ERESOLVE` or a "two copies of X" problem after changing
dependencies, delete `node_modules` *and* `package-lock.json` and install again.
npm reuses an existing tree aggressively and keeps a stale resolution that a
clean install resolves correctly.

### Why the track-player alpha

React Native 0.86 — what Expo SDK 57 ships — runs the New Architecture.
react-native-track-player **4.1.2** (August 2025, the newest stable) is a legacy
bridge module: no codegen, an Android build on AGP 4.2, and an iOS podspec that
depends on `React-Core` directly. **5.0.0-alpha0** is the modernised line: a
TurboModule spec, `install_modules_dependencies` in the podspec, the
`com.facebook.react` Gradle plugin, and a media3 `MediaLibraryService` — which is
also the only reason Android Auto sees the app at all. It also takes `headers`
with each track, which is what lets a phone stream from the bucket.

It builds and plays on iOS. If it turns out not to build on Android, the fallback
is to pin the whole app to Expo SDK 54 / React Native 0.81, where the legacy
architecture can still be enabled and 4.1.2 works — a `package.json` change and
a `prebuild --clean`. Nothing in `src/` depends on which is installed except the
Android Auto events and the track headers, so streaming from the bucket would
have to be rechecked.

On Android, read against what Expo SDK 57 generates, its Gradle setup is
coherent as far as static reading goes: AGP and the SDK levels come from the
root project (its own `buildscript` AGP and `gradle.properties` fallbacks are
not what applies); it applies `com.facebook.react` with
`codegenJavaPackageName` `com.doublesymmetry.trackplayer`, and
`TrackPlayerPackage` reports `isTurboModule = true`; autolinking finds it; and
its manifest's deprecated `package=` attribute sits beside a `namespace`, as
`react-native-safe-area-context` does, so it is a warning rather than an error.
What no amount of reading settles is whether its Kotlin compiles against React
Native 0.86 and media3. That is still the single largest Android risk.

---

## Measuring performance on a phone

What a laptop can prove about the phone's speed, and what only the phone can.
The 2026-09-17 pass (Now Playing's visual stuttering; a like leaving its
pressed box on screen) is the worked example: each finding below was counted in
a jest test first, and the fix is the test's assertion.

**What a test on the Mac can count honestly** — renders and commits, not
milliseconds:

- **React renders per event.** Wrap the memoised component in a counting
  `memo` (`LibraryScreen.perf.test.tsx` does this for `SongRow`, and logs which
  props changed when a row rendered again), and put a component that calls the
  context hook beside the screen to count how far a change reaches
  (`PlayerReader`, `DownloadsReader`). A like went from 16 row renders to one.
- **Shadow-tree commits per frame.** On the New Architecture, every
  `Animated.Value.setValue` without the native driver is a `setNativeProps`,
  and each of those is a commit of the whole shadow tree on the JavaScript
  thread. Spy on `Animated.Value.prototype.setValue` and divide by
  `requestAnimationFrame` calls (`SongVisual.perf.test.tsx`). The visual went
  from 9–20 commits a frame to one shared-value write, applied on the UI thread.
- **What a dropdown leaves behind.** Open and close it ten times with fake
  timers and compare mounted nodes, `jest.getTimerCount()`, and spies on
  `Appearance`, `Dimensions` and `AccessibilityInfo` listeners before and after
  (`AppearancePanel.perf.test.tsx`).
- **Work per edit on a cloud library**, timed in Node against the replica's
  own functions: `show()`'s view rebuild, `LibrarySchema.parse` of a refetch,
  React Query's `replaceEqualDeep`. At 2,000 songs: 3 + 29 + 12 ms on a Mac's
  V8. Hermes on a phone is several times slower, so treat these as lower
  bounds.

**What is not honest there, and needs the phone:** any millisecond figure from
jest (a JS-only renderer, V8, no layout, no Fabric); whether a frame is actually
dropped; the cost of a layout prop versus a transform; memory. Jest's Reanimated
mock runs `useAnimatedStyle` on the JavaScript thread, so a test proves what is
*written* per frame, not that the UI thread carries it.

**On the device**, in this order:

1. **The in-app perf monitor** (shake → *Show Perf Monitor*, development build
   only): two frame rates, JS and UI. A visual that stutters with the JS rate low
   and the UI rate at 60/120 is a JS-thread stall; both low is the GPU or
   layout. Watch the RAM number across ten open/close cycles of a sheet.
2. **Xcode Instruments → Time Profiler** on a *release* build run from Xcode
   (Product → Profile). Filter the call tree to the main thread and to
   `com.facebook.react.JavaScript`. Look for `UIManager::setNativeProps`,
   `ShadowTree::commit`, `Yoga` (`YGNodeCalculateLayout`) and `hermes::vm`
   frames under a tap or during a visual.
3. **Instruments → Animation Hitches** (Core Animation) on the same build
   records every late frame with what the main thread was doing.
4. **Reanimated**: `useAnimatedStyle` and `useFrameCallback` run on the UI
   thread. To see whether a value is animated on the UI thread or through a
   shadow-tree commit, compare `ReanimatedModuleProxy::commitUpdates` with
   `synchronouslyUpdateUIProps` in Time Profiler: transforms and opacity take
   the synchronous path, layout props take a commit.
5. **Hermes sampling profiler** for the JS thread alone: dev menu →
   *Enable Sampling Profiler*, reproduce, disable; the trace opens in Chrome's
   Performance panel with every JS function's self time.
6. **A memory leak from a sheet**: Instruments → Allocations, mark a
   generation, open and close ten times, mark again; anything still live in
   the second generation made by `Sheet`, `Popover` or `Overlay` is the leak.

A release build is the only one that answers a "does it feel slow" question: a
development build carries the dev menu, debugging hooks and un-minified Hermes
bytecode, and is slower everywhere by a factor that hides the thing being
measured.

# The app on a computer (macOS)

**Where:** macOS (installed app); Windows and Linux: not built. The browser and
the phone: see [offline-sync.md](offline-sync.md).

The same app the browser draws at 1280, installed. `apps/desktop` is an Electron
shell around `apps/app`'s web export — the identical build GitHub Pages serves
at `/selfmp3/`. Anything that looks different in the window and in the tab is a
bug, with one named exception: the window's title bar is inset, so the sidebar's
top is padded for the traffic lights.

What is still to be built for the desktop and the iPad is in
[`docs/FEATURE_TODO.md`](../FEATURE_TODO.md).
[`docs/PREPROD.md`](../PREPROD.md) is what to check before calling a build good.

## Why it exists when a tab already works

- **It downloads.** A tab always streams (decided 2026-09-12). An installed app
  downloads by default and plays from the files, the way the phone does, which
  is the point of a library you own. A laptop on a plane behaves like a phone
  with no signal.
- **It is a desktop app.** Its own Dock icon, an application menu, the media keys
  and Now Playing in Control Center, ⌘Q, a window that remembers where it was,
  and the keychain for its token. Chrome's "install as app" gives a window and
  none of that.
- **It does not forget.** A tab's storage is the browser's to evict. Files
  under `~/Library/Application Support/self.mp3` are not.

## Using it

First launch signs in with Google through your ordinary browser and comes back
to the app by `selfmp3://` — the same doorman flow every device uses, so the
library and its files arrive with the sign-in and nothing else is asked for.

**That is the only way in.** There is no address field: Settings › Account
shows who you are signed in as and how to sign out. The library is the bucket's
on a computer for the same reason it is on a phone. What needs the server —
importing, Stats, metadata lookup, the smart features — reaches it directly by
the addresses in the bucket's own snapshot, or the shared server when the bucket
names none, never by anything typed (`packages/client/src/connection/reach.ts`,
[shared-server.md](shared-server.md)).

Every connection on a computer counts as Wi-Fi, so the 500 MB ask and the two
offline settings behave as they do on a phone at home.

**A song not on the computer streams.** The doorman reads a bearer header and
nothing else, and the window's `<audio>` element cannot send one. A tab's
service worker attaches it and a phone's player sends it; here the shell does.
The page points the element at `app://selfmp3/_stream/<key>`
(`apps/app/src/ports/desktop/bucketMedia.desktop.ts`), and the main process asks
the doorman for `/v1/files/<key>` with the header and the element's own
`Range:`, and hands back the doorman's 200 or 206 as it came, so a song plays
and seeks while it arrives (`apps/desktop/src/main/stream.ts`). The session is
the page's: it is kept in IndexedDB beside the replica, where the main process
cannot read it, so the page hands it over (`bucket.use`) and the shell holds it
in memory only.

The refusals are the service worker's too. A 401, a session that is over, goes
back as the doorman said it, and the player shows its words. The bucket's cap
is held for ten minutes, answered from the shell without asking, and told to the
page, whose own reads then hold off and say why. With no connection the song is
not tried at all: the player says the computer is offline. A downloaded song
plays from disk as before, and with "Download automatically" off a song that
counts as a play is kept in the `recent` folder, as on a phone
(`ports/desktop/recentCopies.desktop.ts`), so the next play is from disk.

## What it is not

- **Not a second UI.** The renderer is `apps/app`'s web export (`dist/`), byte for byte.
  Desktop-only code lives in `apps/app/src/ports/`, chosen at runtime by the
  presence of the bridge — never a second Metro platform or a build switch.
- **Not the server.** It does not hold the library, run yt-dlp or open the
  SQLite file. The server runs on an always-on computer
  ([INSTALL.md](../INSTALL.md)); the Mac app is one more client of it.
- **Not a Mac App Store app**, and not Windows or Linux yet: their targets are
  in the packaging config and are not built.

## How it is put together

| What | Where |
|---|---|
| The Electron shell | `apps/desktop/src/main/` |
| The preload, and nothing else on the page | `apps/desktop/src/preload/preload.ts` |
| The contract between them | `packages/desktop-bridge/src/` |
| The desktop's ports in the renderer | `apps/app/src/ports/desktop/` |
| The `Range` rule both the server and the shell answer with | `packages/shared/src/range.ts` |
| Bucket songs not on the computer, through the doorman | `apps/desktop/src/main/stream.ts` |
| The smoke flow, against the built app | `apps/desktop/verify/smoke.spec.ts` |
| Packaging, the signing tiers, and the icon | `apps/desktop/electron-builder.yml`, `apps/desktop/scripts/dist.mjs` |
| The release workflow | `.github/workflows/desktop.yml` |
| Where releases are, and what a tag means — read by the updater and by a tab's Settings › Advanced › Mac app | `packages/shared/src/releases.ts` |
| The app offered from a browser tab on a Mac | `apps/app/src/ports/macApp.web.ts`, `apps/app/src/features/settings/GetAppPanel.tsx` |

`window.selfmp3Desktop` is the whole surface between the page and the shell,
exposed by the preload with `contextIsolation` on, `nodeIntegration` off and
`sandbox` on. Every message and every reply is parsed with a zod schema from
`packages/desktop-bridge` on the receiving side, so an invalid message is an
error at the boundary rather than a crash in the middle. There is no
`ipcRenderer` on the page.

## Why Electron, and what was rejected

Decided 2026-09-12, for four reasons that hold even though the shell is thin:
one rendering engine on every OS, and the desktop layout has only ever been
checked in Chromium; TypeScript end to end; the four things the shell needs are
first-party (`protocol.handle` for files with `Range`, `safeStorage` for the
keychain, `navigator.mediaSession` for Now Playing and the media keys,
`setAsDefaultProtocolClient` for the `selfmp3://` return); and it can run a
Node child process if one is ever wanted. The packages and their pinned versions
are in the Stack table of [ARCHITECTURE.md](../ARCHITECTURE.md).

What was checked before choosing it:

- Official Electron builds decode AAC and MP3 (`proprietary_codecs`,
  `ffmpeg_branding = "Chrome"`), and the default `autoplayPolicy` needs no
  gesture, so the engine's `play()` and `AudioContext.resume()` work cold.
- A privileged custom scheme (`standard`, `secure`, `supportFetchAPI`,
  `allowServiceWorkers`, `stream`) registers service workers and keeps a stable
  origin for IndexedDB; `file://` does neither. (The shell in the end registers
  `app://` with `allowServiceWorkers: false`: songs and covers are files there.)
  `protocol.handle` hands over the request's `Range:` header but
  `net.fetch('file://…')` ignores it and answers 200 with the whole body, so the
  206 has to be built by hand — which is why the range rule lives in
  `packages/shared`.
- `safeStorage` is the keychain-backed store.
- Tauri 2.11 would put the UI in WKWebView, which refuses service workers on
  custom schemes (tauri #13031). Tauri 3's Chromium runtime was an alpha as of
  2026-09-13; revisit only if it stabilises.
- react-native-macos is at 0.81 against the app's 0.86; Expo has no prebuild
  for it; Unistyles 3 and track-player do not build for it.
- "Designed for iPad" is Mac App Store or TestFlight only; Catalyst needs the
  paid program to distribute. Both are cloud-only clients.

## Notes for whoever touches it next

- Only files under `apps/app/src/ports/` may import `ports/desktop/bridge`. A
  feature asks a port for the capability, never for the platform; ESLint
  enforces it.
- The shell has no native modules and no runtime dependencies: esbuild bundles
  main and preload, `electron` excepted. Keep it that way; a native module brings
  a rebuild step for Electron's Node ABI into every build.
- Tokens the page stores itself go through `desktop.secrets` (`safeStorage`,
  encrypted at rest in `userData/secrets.json`). The doorman session is the
  exception: the replica keeps it in its platform store, which on a computer is
  IndexedDB, as in a tab (`apps/app/src/ports/cloudPlatform.web.ts`).
- An unsigned build is ad-hoc signed. Downloaded through a browser it carries
  the quarantine flag and macOS calls it damaged until you use Privacy &
  Security › Open Anyway, or `xattr -dr com.apple.quarantine`. A build made on
  the Mac it runs on simply opens.
- The signing tier is decided by the environment, not by a flag: `CSC_LINK` and
  `CSC_KEY_PASSWORD` make a signed build (notarised too with the `APPLE_API_*`
  variables), `CSC_NAME` naming a certificate in this Mac's keychain a
  development-signed one, and neither an ad-hoc one; `apps/desktop/scripts/dist.mjs`
  prints which, and reads `CSC_NAME` from the checkout's `.env`. It is baked into the bundle as well, because
  the updater has to know and a running app cannot ask about its own signature.
- The media keys and Now Playing in Control Center come from Chromium turning
  the page's `navigator.mediaSession` into macOS's own; the shell adds only the
  Dock menu and `powerSaveBlocker` (`apps/desktop/src/main/nowPlaying.ts`).
- In development, `npm run dev:desktop` loads the window from the web dev server
  (`SELFMP3_DESKTOP_DEV_URL`) instead of `app://selfmp3/`; it is the same build
  either way.
- Five of the Playback menu's accelerators are drawn without being registered
  (Space, ⌘←, ⌘→, ⌥⌘←, ⌥⌘→). A registered Electron accelerator fires inside text
  fields too, so registering Space would take the space bar out of the search
  box. `pageKeeps` in the menu model marks them; the page handles them through
  `useHotkeys`, which already stands aside while someone is typing.

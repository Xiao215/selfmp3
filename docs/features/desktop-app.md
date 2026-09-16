# The app on a computer (macOS)

**Where:** macOS (installed app); Windows and Linux: not built. The browser and
the phone: see [offline-sync.md](offline-sync.md).

The same app the browser draws at 1280, installed. `apps/desktop` is an Electron
shell around `apps/app`'s web export — the identical build GitHub Pages serves
at `/selfmp3/`. Anything that looks different in the window and in the tab is a
bug, with one named exception: the window's title bar is inset, so the sidebar's
top is padded for the traffic lights.

**The plan and the reasoning are [`docs/DESKTOP.md`](../DESKTOP.md)**: why
Electron, what each phase adds, and what was rejected.
[`docs/universal-progress.md`](../universal-progress.md) records what has been
checked, on what, and how.

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

**That is the only way in.** This was the last surface that could be pointed at
a server by typing its address, and it no longer can (2026-09-16): Settings ›
Connection shows who you are signed in as and how to sign out, and there is no
server switch, no address field and no confirmation about clearing downloads
before one. The library is the bucket's on a computer for the same reason it is
on a phone, and importing still reaches the server directly when it can — by the
addresses in the bucket's own snapshot, never by anything typed
(`packages/client/src/connection/reach.ts`).

Every connection on a computer counts as Wi-Fi, so the 500 MB ask and the two
offline settings behave as they do on a phone at home.

## What it is not

- **Not a second UI.** The renderer is `apps/app`'s web export (`dist/`), byte for byte.
  Desktop-only code lives in `apps/app/src/ports/`, chosen at runtime by the
  presence of the bridge — never a second Metro platform or a build switch.
- **Not the server.** It does not hold the library, run yt-dlp or open the
  SQLite file. The server keeps running where it runs. Embedding it is written
  up under "Later" in `DESKTOP.md`, with the reason it waits.
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
| The smoke flow, against the built app | `apps/desktop/verify/smoke.spec.ts` |
| Packaging, the signing tiers, and the icon | `apps/desktop/electron-builder.yml`, `apps/desktop/scripts/dist.mjs` |
| The release workflow | `.github/workflows/desktop.yml` |

`window.selfmp3Desktop` is the whole surface between the page and the shell,
exposed by the preload with `contextIsolation` on, `nodeIntegration` off and
`sandbox` on. Every message and every reply is parsed with a zod schema from
`packages/desktop-bridge` on the receiving side, so an invalid message is an
error at the boundary rather than a crash in the middle. There is no
`ipcRenderer` on the page.

## Notes for whoever touches it next

- Only files under `apps/app/src/ports/` may import `ports/desktop/bridge`. A
  feature asks a port for the capability, never for the platform; ESLint
  enforces it.
- The shell has no native modules and no runtime dependencies: esbuild bundles
  main and preload, `electron` excepted. If a change seems to need a native
  module, it is the "embedding the server" phase in disguise.
- Tokens go through `desktop.secrets` (`safeStorage`, encrypted at rest in
  `userData/secrets.json`) and nowhere else.
- An unsigned build is ad-hoc signed. Downloaded through a browser it carries
  the quarantine flag and macOS calls it damaged until you use Privacy &
  Security › Open Anyway, or `xattr -dr com.apple.quarantine`. A build made on
  the Mac it runs on simply opens.
- The signing tier is decided by the environment, not by a flag: `CSC_LINK` and
  `CSC_KEY_PASSWORD` make a signed build, their absence an ad-hoc one, and
  `apps/desktop/scripts/dist.mjs` prints which. It is baked into the bundle as well, because
  the updater has to know and a running app cannot ask about its own signature.
- Five of the Playback menu's accelerators are drawn without being registered
  (Space, ⌘←, ⌘→, ⌥⌘←, ⌥⌘→). A registered Electron accelerator fires inside text
  fields too, so registering Space would take the space bar out of the search
  box. `pageKeeps` in the menu model marks them; the page handles them through
  `useHotkeys`, which already stands aside while someone is typing.

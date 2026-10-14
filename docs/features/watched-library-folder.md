# Watched inbox folder

While the server is running, any change inside a library's folder — a file added or
renamed, whether copied over the network or dropped in by hand — triggers a sweep
automatically. No timer, no Rescan click. The folder is an inbox rather than the library
(docs/SYNC.md): the bucket is the library. An import writes its download here, a file
dropped in by hand is an import too, and either way the sweep makes a song of it, the
cloud pass uploads it, and once it is wholly in the bucket the copy here is deleted. A
file that is gone says nothing to the sweep; a song leaves the library only when someone
removes it.

Each library a server works for has its own folder and its own watcher. On a shared
server (docs/features/shared-server.md) that is `library/<id>` under the server's library
folder, one per workspace — in Docker, `/app/library/<id>`, which is `./library/<id>`
beside the compose file. With a folder for a bucket (`SELFMP3_CLOUD_DIR`, the dev profile
and the verify lanes) there is one library and it uses the library folder itself.

## Setting

`watchLibrary` (boolean, default **true**), a setting of the library on its server.
Changing it starts or stops the watcher immediately; no restart. `autoScanMinutes`
(default 0, off) adds a sweep on a timer, for a folder where watching misses changes,
such as a network share.

**Watch the library folder** is under Settings → Advanced → Importing, and **Rescan** under
Settings → Advanced → Library, on every device: a signed-in device reaches its server for
them as Import does (`useServerApi`), and says so when the server is away. The Library panel
names the folder, as the server sees it. `autoScanMinutes` has no control; set it with
`PATCH /api/settings`.

## How it works

`apps/server/src/services/libraryWatcher.ts` uses Node's own
`fs.watch(dir, { recursive: true })` rather than chokidar:

- On Linux (the server's usual home) recursive watching works since Node 20; on macOS it
  is backed by FSEvents. Zero dependencies, no native build.
- Events are filtered to audio and lyric extensions; `.DS_Store`, `._*` resource forks and
  other dotfiles are ignored, so Finder merely looking at a shared folder does not rescan.
- Events are **debounced** (`services/debounce.ts`): 1.5 s of quiet after the last event,
  with a 15 s ceiling so a very long copy still gets a sweep partway through. A folder of
  forty files becomes one sweep.
- A file still being copied is harmless: the sweep is incremental (an unchanged time is
  skipped) and idempotent, so the next write event simply reads it again once it settles.
- The watcher is applied by `startContainer` (`apps/server/src/start.ts`) after the import
  queue starts, again whenever settings change, and stopped when the container closes.

chokidar's extras — polling fallbacks, globbing, `awaitWriteFinish` — solve problems this
app does not have, so it was not added.

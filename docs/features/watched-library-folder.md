# Watched library folder

While the server is running, any change inside the library folder — a file added, removed
or renamed, including a drag-and-drop into Finder — triggers a rescan automatically. No
timer, no "Rescan library" click.

## Setting

`watchLibrary` (boolean, default **true**), under *Settings → Importing → Watch the library
folder*. Toggling it starts or stops the watcher immediately; no restart. It is a no-op
with the S3 storage driver, which has no folder to watch.

The older `autoScanMinutes` timer still exists and still works; with the watcher on it is
redundant for a local library.

## How it works

`apps/server/src/services/libraryWatcher.ts` uses Node's own
`fs.watch(dir, { recursive: true })` rather than chokidar:

- On macOS it is backed by FSEvents, the same mechanism Finder and Spotlight use, and
  since Node 20 the recursive flag also works on Linux. Zero dependencies, no native build.
- Events are filtered to audio and lyric extensions; `.DS_Store`, `._*` resource forks and
  other dotfiles are ignored so Finder merely looking at the folder does not rescan.
- Events are **debounced** (`services/debounce.ts`): 1.5 s of quiet after the last event,
  with a 15 s ceiling so a very long copy still gets a scan partway through. A folder of
  forty files becomes one scan.
- A file still being copied is harmless: the scanner is incremental (unchanged size+mtime
  is skipped) and idempotent, so the next write event simply rescans it once its size
  settles.
- The watcher is started from `main.ts` after the import queue, and stopped on shutdown
  and in `container.close()`.

chokidar's extras — polling fallbacks, globbing, `awaitWriteFinish` — solve problems this
app does not have, so it was not added.

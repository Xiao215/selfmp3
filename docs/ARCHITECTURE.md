# Architecture

Notes on how this is put together and, more usefully, *why*. Written for whoever
touches this next — most likely you, six months from now.

---

## The shape

```
packages/shared          the API contract (zod schemas + pure helpers)
  └── imported by the server, the app and the cloud client

packages/replica         a device's copy of the library in the bucket: session,
                         replica, outbox, the routes that answer from it

packages/client          what the app shares across platforms: API client, React
                         Query hooks, download queue, practice and auto-mix rules,
                         theme tokens, and the ports each platform implements

apps/server
  main.ts                boot, shutdown, signals
  config.ts              env → validated, frozen config object
  container.ts           composition root: constructs everything, once
  app.ts                 express wiring, middleware order
  http/                  route helper, error handling, range requests
  db/                    connection, migrations, row types
  storage/               StorageDriver interface + local and s3 implementations
  repositories/          all SQL lives here, nowhere else
  services/              behaviour: scanning, metadata, lyrics, imports
  routes/                thin — validate, call a service, return

apps/app                 one Expo app for iOS, Android and the web (docs/UNIVERSAL.md)
  app/                   expo-router file routes, one per screen
  src/features/          a folder per screen or tool; each model file is pure and tested
  src/ports/             what differs by platform: engine, offline store, prefs,
                         secrets, cloud platform, device; `name.ts` on a phone,
                         `name.web.ts` in a browser
  src/player/            queue (from packages/shared), engine port, provider (React glue)
  src/offline/           downloads, the saved library, the listen outbox
  src/shell/             the width-decided frame: tab bar or sidebar, mini player or bar
  src/ui/                components, icons, the Unistyles theme
  sw/sw.ts               service worker, bundled to public/sw.js by esbuild
  public/                manifest, icons: copied into the web export as they are

apps/doorman             Cloudflare Worker: Google sign-in and bucket access for devices

packages/desktop-bridge  the contract between the desktop app's shell and the page:
                         channel names, a zod schema for every argument and every
                         reply, and the application menu as data

apps/desktop             the Electron shell around apps/app's web export
  src/main/              the shell: window and bounds, `app://` with byte ranges,
                         files on disk, keychain, menu, Dock, deep links, updates
  src/preload/           the only door — `contextBridge`, and nothing of Node
                         reaches the page
  scripts/               esbuild bundling, the icon, and the signing tiers
  verify/                Playwright against the built app
```

The desktop app is a *shell*, not a fourth client. The page inside it is
`apps/app`'s web export byte for byte — the same one the server serves and Pages
serves — and everything a window can do that a tab cannot goes through a port in
`src/ports/`, the same mechanism that separates a phone from a browser. See
[DESKTOP.md](DESKTOP.md).

---

## Decisions worth explaining

### The contract is shared code, not documentation

`packages/shared` holds zod schemas. The server validates incoming requests with them; the
client parses responses with the same ones. There is no hand-written type on either side
that can drift.

The concrete payoff: rename a field in `SongSchema` and the build breaks in both apps
immediately, with the exact lines. The alternative — types on one side, validation on the
other — fails silently on a phone, weeks later.

### Layers, strictly

`routes → services → repositories → database`

A route validates input and returns a value. A service holds behaviour. A repository holds
SQL. **No SQL exists outside `repositories/`**, so a schema change has one blast radius.
Routes never touch the database directly, so any route can be tested by handing it a
container built on an in-memory SQLite.

### The composition root

`container.ts` constructs every dependency once and passes them explicitly. Nothing reaches
for a global or a singleton. This is slightly more typing and it buys two things: the
construction order is visible in one place, and swapping any piece for a fake in a test is
a one-line change.

### Storage is an interface

`StorageDriver` — `stat`, `read`, `write`, `list`, `rangeSource`, `signedUrl`, `localPath`.
Local disk implements it today; `S3StorageDriver` implements it for R2, B2, MinIO and AWS
behind an optional dependency that is imported dynamically.

This was a deliberate ~100 lines of extra work. It means "move my library to cloud storage"
is a config change and one file, not a rewrite of every path that touches a file. `localPath`
returning `null` is the honest escape hatch: tools like `ffprobe` need a real filesystem
path, and object storage does not have one, so those code paths know to buffer instead.

### Range requests get their own module and the most tests

`http/range.ts` is small and disproportionately important. Seeking in a track is a `Range:`
header; get the 206 response wrong and iOS Safari refuses to play at all — not "plays
badly", *refuses*. The failure mode is remote, silent and miserable to debug, so it is
isolated, pure where it can be, and covered thoroughly.

The service worker duplicates a version of this logic in `sw.ts`, because the Cache API
returns whole responses and something has to slice them when the player asks for bytes
500–999 of a cached file.

### Missing files are marked, not deleted

A scan that cannot find a file sets `missing = 1`. It does not delete the row.

Unplug an external drive, or rename a file, and your tags, play counts and playlist
membership survive — and come back when the file does. Permanently forgetting them is a
separate, explicit action behind a confirmation. Losing a play history to a temporarily
unmounted drive would be unforgivable, and it is exactly the kind of thing an
over-eager reconciler does.

### Play events, not just counters

`play_events` stores a row per play. `songs.play_count` is also maintained, because smart
playlists and sorting want a cheap number.

Keeping the events means stats can answer questions nobody has asked yet — hourly
distribution, streaks, "what did I listen to in March" — without the underlying data having
already been thrown away. A counter is lossy the moment you write it.

### The import queue is a table

Jobs live in `import_jobs`, not a `Map`. Forty queued downloads survive a server restart,
another device can watch progress, and a job orphaned by a crash is requeued at boot rather
than lost.

The worker is pull-based: after each job finishes it asks the database for the next one. No
coordination is needed between the HTTP layer and the worker, and a job added by your phone
gets picked up by the same loop.

### Live playlist rules compile to parameterised SQL

`services/smartPlaylist.ts` is the only place in the server that builds a query string from
user input, so it follows two rules absolutely:

1. Every user **value** is a bound parameter.
2. Every user **identifier** (column, sort field, direction) is looked up in a fixed map. If
   it is not in the map, it does not exist.

Because the rule types are a discriminated union, adding a variant to the shared schema
makes this file stop compiling until the new case is handled. The tests run the generated
SQL against a real in-memory database — asserting on the SQL *string* would be brittle and
would not prove the query is even valid.

### The player is three pieces, deliberately

- `engine.ts` — imperative, framework-free, owns two `<audio>` elements.
- `queue.ts` — pure functions, no side effects, fully tested.
- `PlayerProvider.tsx` — the React glue, plus server sync and Media Session.

Two elements rather than one is what makes gapless and crossfade possible at all: by the
time `ended` fires on a single element, the gap has already happened. The next track is
loaded and buffered in the second element ahead of time, and the handover is either instant
or an equal-power volume ramp.

Keeping the queue rules pure means every awkward ordering question — shuffle that preserves
the current track, restoring the original order, "play next" versus "add to queue" — is
testable without mounting a component or touching audio.

### The whole library in one response

`GET /api/library` returns every song, tag and playlist. No pagination.

For a personal library — a few thousand songs at most — this is both simpler and faster
than paginating: the client filters, sorts and searches locally with zero round trips, and
the phone can mirror the entire payload into IndexedDB for offline use. Pagination would
add complexity to buy nothing at this scale. If a library ever got to six figures this
would be the first thing to revisit.

### Offline is explicit

Nothing is cached by casual listening. Songs enter the offline cache only through a
deliberate sync, and what is cached is always visible and countable in Settings.

The alternative — caching whatever you happen to play — quietly fills a phone and leaves
the user unable to answer "why is this app using 12 GB?". Metadata goes to IndexedDB; audio
goes to the Cache API, because a cached `Response` can be handed straight to an `<audio>`
element by the service worker without ever passing through JavaScript memory.

### The service worker is hand-written

Workbox would generate most of this, but not the part that matters: slicing a cached
response into a 206 for range requests. Since that is the whole reason offline playback
works on iOS, the file is written by hand and the three caching strategies are explicit —
cache-first for the shell, cache-first-with-range for audio, network-first for the API.

---

## Testing

| Area | Why it is tested the way it is |
|---|---|
| `range.ts` | Highest bug density, worst failure mode, purely functional |
| `queue.ts` | All the awkward ordering rules, no mocking required |
| `smartPlaylist.ts` | Builds SQL from user input — run it against a real database |
| `lrc.ts` | The format is loose in the wild; fixtures are synthetic placeholder text |
| `format.ts` | Cheap, and formatting bugs are visible to the user everywhere |
| `metadata.ts` | Filename parsing has a long tail of real-world shapes |

Run `npm run check` for typecheck + lint + tests.

---

## Things deliberately not done

- **No auth by default.** Tailscale is the security boundary. An optional bearer token
  exists for defence in depth, off unless configured.
- **No ORM.** Hand-written SQL in typed repositories. At this size an ORM adds a layer of
  indirection over queries that are already short and readable.
- **No CSS framework.** ~2000 lines of plain CSS with custom properties. A framework would
  be larger than the styles it replaced.
- **No chart library.** Three chart forms, hand-drawn as SVG. A charting library would
  outweigh the rest of the app on a page that has to load over a phone connection.
- **No state management library.** TanStack Query for server state, React state for UI
  state. There is no third category here.

---

## If you extend it

**A new API field:** add it to the schema in `packages/shared`, then follow the compile
errors. They will take you to every place that needs updating.

**A new smart-playlist rule:** add the variant to `SmartRuleSchema`, then fix
`compileRule` and `describeSmartRules` — the exhaustive switch will not compile until you
do. Add a test that runs it against the in-memory database.

**A new storage backend:** implement `StorageDriver`, register it in `storage/index.ts`,
add the config branch. Nothing else changes.

**A schema change:** append a migration to the array in `db/migrate.ts`. Never edit an
existing entry, never renumber — the array index *is* the version.

**A dropdown, a menu, or anything that floats:** use `components/Select.tsx` and
`components/Menu.tsx` rather than a native `<select>` or a hand-rolled popover, and take
z-index, radii, durations and the focus ring from the tokens. See
[docs/features/design-system.md](features/design-system.md).

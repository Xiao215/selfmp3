# Install and ops

Everything for getting self.mp3 running and keeping it running: a one-command Mac setup, a
health check, a `selfmp3` command and a Docker image. The user-facing walkthrough is **[docs/INSTALL.md](../INSTALL.md)**; this file is
what the pieces are and why they are shaped that way.

## `scripts/setup-mac.sh`

Idempotent by construction — it can be the "I just pulled" command as well as the "I just
cloned" one. Checks Node ≥ 22, installs `yt-dlp` and `ffmpeg` through Homebrew when they are
missing (and gives the brew.sh link rather than failing when Homebrew itself is absent),
runs `npm install` and `npm run build`, creates the library and data folders the server will
use (`~/Music/selfmp3` and `~/Library/Application Support/selfmp3` unless the environment
says otherwise — `scripts/_dirs.sh` works them out the same way the server does), then hands
the launchd step to the existing `scripts/install-service.sh` rather than duplicating the
plist.

`--yes` answers every prompt, `--no-service` skips launchd. A closed stdin counts as "no",
so piping it somewhere never hangs waiting for an answer.

## `scripts/doctor.sh`

The five things that are usually wrong, one line each, plus the last five log lines. Pure
shell and `curl` on purpose: it has to work when the build is broken or Node is the problem,
which rules out anything that needs the app to run. Exits non-zero when something is wrong,
so it is usable from a cron job.

macOS-specific parts (launchd, `~/Library/Logs`) are guarded by `uname`, so it degrades to
the useful subset on Linux.

## The `selfmp3` command

`apps/server/src/cli.ts`, wired as the `bin` of `@selfmp3/server` and as `npm run cli` at
the root. Built with `apps/server`, so `dist/cli.js` appears with the rest of the build.

```
start                 run the server in the foreground
scan                  rescan the library folder
import <url...>       queue links for download
backup <dest-dir>     incremental copy of data/ and library/
doctor                node, yt-dlp, ffmpeg, server, folders
--version
```

Two rules shape it:

- **No dependencies.** Argument parsing is node's own `util.parseArgs`
  (`cli/args.ts`, pure and unit-tested); HTTP is `fetch`.
- **Everything goes through the running server's API** (`cli/api.ts`), never the database.
  One code path for scanning, importing and tagging, and no way for the CLI to corrupt a
  database the server has open. Commands that need the server say so and print how to start
  it instead of failing with a connection error. `--url` and `--token` reach a server
  elsewhere.

`backup` (`cli/backup.ts`) is the exception that touches files directly. A file is copied
when the destination is missing, a different size, or meaningfully older — size plus mtime,
no hashing, because a music library is large and almost entirely immutable. SQLite databases
are copied through better-sqlite3's `backup()` instead, so the copy is consistent while the
server is writing, and `-wal` / `-shm` files are skipped. Nothing is ever deleted from the
destination.

`doctor` (`cli/doctor.ts`) is the same set of checks as the shell script, but it runs
anywhere Node does — including inside the container, where there is no Homebrew and no
launchd.

## Docker

Multi-stage, and the two builds are separate. The app's web export is built on the *build*
platform (`node:22-bookworm-slim`), so a Pi's image is not cross-compiled through emulation
for a step that only produces static files. The server stage is `node:22-alpine` plus
`python3 make g++`, because better-sqlite3 and sharp compile from source when no prebuilt
binary matches (musl on arm64, for one); it installs, builds, then installs again with
`--omit=dev` and checks both native modules load. The runtime stage is a clean
`node:22-alpine` with `ffmpeg`, `yt-dlp` and `tini`, and copies only those production
`node_modules` plus the three `dist/` folders and their `package.json` files. The layout
mirrors the repo so `config.ts`'s `REPO_ROOT` still resolves to `/app` and the workspace
symlinks in `node_modules` still point somewhere real.

- Runs as `node`, not root; `/app/library` and `/app/data` are volumes, chowned in the image
  so a fresh bind mount is writable.
- `HEALTHCHECK` hits `/api/health` with busybox `wget`. That route is exempt from bearer
  auth, so the check works whatever token the server is using — its own or one set in
  `SELFMP3_AUTH_TOKEN`. In a container the loopback exemption is no help: the container is
  its own machine, so a request from the host is a request from the network.
- `tini` as entrypoint, because `yt-dlp` and `ffmpeg` subprocesses would otherwise leave
  zombies and `SIGTERM` would not reach node.

`docker-compose.yml` bind-mounts `./library` and `./data` so the backup story is unchanged,
and binds the port to `127.0.0.1` so Tailscale (or another reverse proxy) is the only way in.

## Also changed

`http/middleware.ts` — the bearer-auth health exemption compared `req.path` against
`/api/health`, but the middleware is mounted at `/api`, so express had already stripped the
prefix and the exemption never fired. `/api/health` returned 401 whenever a token was set,
which would have broken the container's `HEALTHCHECK`, `scripts/doctor.sh` and any monitor.
It now accepts both spellings.

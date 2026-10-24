# Install and ops

The pieces that get the server running and keep it running: the Docker image and its
workflow, the compose file, the scripts for running without Docker, and the `selfmp3`
command. The walkthrough is **[docs/INSTALL.md](../INSTALL.md)**. This file is what the
pieces are and why they are shaped that way.

## The image

`Dockerfile`, two stages, both on `node:22-bookworm-slim`.

- **`server`** installs the server's two workspaces (`@selfmp3/shared` and
  `@selfmp3/server`) with their own development dependencies, so the root's tooling and the
  Expo app never enter it. It builds them, then installs again with `--omit=dev`. It keeps
  only this platform's build of onnxruntime, because the listening model's runtime ships
  every platform's (about 290 MB). `python3 make g++` are there for a native module with no
  prebuilt binary for the platform.
- **The runtime** is a clean image with `ffmpeg`, `tini` and `yt-dlp`. It copies the
  production `node_modules` (the root's and `apps/server/node_modules`, where npm nests a
  version the server wants differently), the two `dist/` folders, their `package.json` files
  and `apps/server/admin`, the owner's admin page. The layout mirrors the repo, so the
  workspace symlinks in `node_modules` still resolve. Before it is published, the build
  imports every package the server declares and opens SQLite, so an image that could not
  start fails to build.

`yt-dlp` comes from PyPI into a venv (`/opt/ytdlp`), not from Debian, whose package runs
months behind a tool YouTube breaks on a scale of weeks. `yt-dlp[default]` brings mutagen,
which embeds cover art, and yt-dlp-ejs, which solves YouTube's player challenges on the
image's own node. The build argument `YTDLP_REFRESH` exists only to change: the workflow
passes the ISO week, so a weekly build gets a fresh layer instead of a cached one.

Debian rather than Alpine because onnxruntime-node ships glibc builds only. The model's
own files are not in the image. The server downloads them into the data volume
(`data/models/`, about 750 MB) the first time analysis wants them.

- It runs as `node` (uid 1000), not root. `/app/library` and `/app/data` are volumes, owned
  by that user in the image so a fresh volume is writable.
- The environment sets `SELFMP3_HOST=0.0.0.0`, `SELFMP3_PORT=4600` and the two folders. The
  server's `.env` reader asks git where the checkout is, and the image has no git and no
  checkout, so in a container every setting comes from the environment.
- `HEALTHCHECK` asks `/api/health` with the image's own `node`, since the slim image has no
  `wget` or `curl`. That route needs no token, so the check works on a server with any
  number of libraries.
- `tini` is the entrypoint, because `yt-dlp` and `ffmpeg` subprocesses would otherwise
  leave zombies and `SIGTERM` would not reach node.

## The workflow

`.github/workflows/docker.yml` builds on every push to `main` that touches what the image
is made from (its `paths` list), every Monday at 05:00 UTC for a fresh `yt-dlp`, and on
demand. Each architecture builds on a native runner of its own kind (`ubuntu-latest` for
amd64, `ubuntu-24.04-arm` for arm64) and pushes by digest. A last job ties the two digests
into one manifest list tagged `latest` and the commit's SHA, so a Pi and a VPS pull their own
architecture from the same name. One job building both through QEMU took longer than its
hour once the layer cache missed, which is why it was replaced.

A new `COPY` in the Dockerfile needs its path added to the workflow's `paths` too, or a
change to it never reaches the image.

## The compose file

`docker-compose.yml` matches how Xiao's Pi runs the server:

- **`network_mode: host`.** The server lists the computer's own interfaces to publish its
  addresses (`services/addresses.ts`). On Docker's bridge it would see only the container's.
  On the host's network it also reaches a helper on `127.0.0.1` (cli-bridge, for the
  model), and a request from the computer itself arrives over loopback, which is what
  `http/local.ts` lets through without a token. A port Docker publishes would also bypass
  ufw.
- **`user: '1000:1000'`**, the owner of the bind mounts.
- **`env_file`** with `required: false`, so a `.env` beside the file is handed in when there
  is one and the file still works without. That form needs Compose 2.24 or newer.
- **`TZ`**, interpolated from the same `.env`, so the log and the days the server counts are
  local time.
- **`./library` and `./data`** bind-mounted, so both are ordinary folders on the host.

Updating is `docker compose pull && docker compose up -d`, run by hand or on a timer. Xiao's
Pi runs it from its own dashboard a few minutes after the image is published.

## Without Docker

### `scripts/setup-mac.sh`

macOS only, and idempotent by construction, so it is the "I just pulled" command as well as
the "I just cloned" one. It checks for Node 22 or newer, and installs `yt-dlp` and `ffmpeg`
through Homebrew when they are missing. When Homebrew itself is absent it gives the brew.sh
link rather than failing. Then it runs `npm install` and `npm run build`, and creates the
library and data folders (`scripts/_dirs.sh` works them out exactly as `defaultDirs` in
`apps/server/src/config.ts` does). Last, it hands the launchd step to
`scripts/install-service.sh` rather than duplicating the plist.

`--yes` answers every prompt and `--no-service` skips launchd. A closed stdin counts as
"no", so piping it somewhere never hangs waiting for an answer.

### `scripts/install-service.sh`

A launchd job, `com.selfmp3.server`, that starts the server at login and restarts it when it
exits with an error, logging to `~/Library/Logs/selfmp3.log`. It sets
`SELFMP3_HOST=127.0.0.1`, so the server publishes no local addresses and is reached through
whatever stands in front of it (`tailscale funnel` and `SELFMP3_PUBLIC_URL`).
`scripts/uninstall-service.sh` removes the job and leaves the folders. On Linux there is no
script. INSTALL.md gives a systemd user unit instead.

### `scripts/doctor.sh`

The usual things that go wrong, one line each, plus the last five log lines. It is pure shell
and `curl` on purpose: it has to work when the build is broken or Node is the problem, which
rules out anything that needs the app to run. It exits non-zero when something is wrong, so a
cron job can use it. The launchd and `~/Library/Logs` parts are guarded by `uname`, so on
Linux it checks the rest.

## The `selfmp3` command

`apps/server/src/cli.ts`, the `bin` of `@selfmp3/server` and `npm run cli` at the root. It
is built with the server, so `dist/cli.js` comes with the rest of the build. In the image it
is `node apps/server/dist/cli.js`.

```
start                 run the server in the foreground
scan                  import what was dropped into the inbox folder
import <url...>       queue links for download
backup <dest-dir>     copy the data and library folders into <dest-dir>, only what changed
doctor                node, yt-dlp, ffmpeg, server, whom it works for, folders
--url <base>          a server elsewhere
--library <id|email>  which library, on the server's own computer
--token <token>       which library, from elsewhere
--version
```

Two rules shape it:

- **No dependencies.** Argument parsing is node's own `util.parseArgs` (`cli/args.ts`, pure
  and unit-tested), and HTTP is `fetch`.
- **Everything goes through the running server's API** (`cli/api.ts`), never a database.
  There is one code path for scanning and importing, and no way for the CLI to corrupt a
  database the server has open. Commands that need the server say so, and print how to start
  it, instead of failing with a connection error.

It talks to `http://localhost:$SELFMP3_PORT` unless `--url` says otherwise. The server routes
a request by its token (`hub/hub.ts`, `resolve`). From the server's own computer a request
with no token may name its library by id instead, in the `X-Selfmp3-Library` header, and
otherwise goes to the only library when there is exactly one. So `scan` and `import` first
ask `GET /api/hub` whom the server works for (`cli/library.ts`): `--library <id or email>`
picks one, the only one needs no name, and with several and no `--library` the command stops
and lists them, as it does for a name that matches none. From elsewhere `/api/hub` is
refused, and `--token` names the library. `doctor` lists the libraries when it is asked on the
server's own computer.

`backup` (`cli/backup.ts`) is the one command that touches files directly. A file is copied
when the destination is missing, a different size, or meaningfully older: size plus mtime, no
hashing. SQLite databases are copied through better-sqlite3's `backup()` instead, so the copy
is consistent while the server writes, and `-wal`, `-shm` and `-journal` files are skipped.
Nothing is ever deleted from the destination. Since workspaces, everything in the data folder
except `hub.json` can be rebuilt from the buckets, so a backup is mostly a convenience
([shared-server.md](shared-server.md)).

`doctor` (`cli/doctor.ts`) is the same set of checks as the shell script, but it runs
anywhere Node does, including inside the container, where there is no Homebrew and no launchd.

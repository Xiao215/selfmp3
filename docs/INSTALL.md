# Installing self.mp3

Three ways to run it, depending on where you want it to live:

| You want | Go to |
|---|---|
| It on your Mac, which is where your music already is | [On a Mac](#on-a-mac) |
| It on your phone too | [On your phone](#on-your-phone) |
| It on a box that never sleeps — a VPS, a NAS, a Pi | [With Docker](#with-docker) |

Everything below assumes you have the repo checked out and a terminal open in it.

---

## On a Mac

```bash
./scripts/setup-mac.sh
```

That is the whole thing. It checks you have Node 22 or newer, installs `yt-dlp` and
`ffmpeg` with Homebrew if they are missing, installs the npm packages, builds the app,
creates `library/` and `data/`, and offers to install the background service so the server
starts at login.

It is safe to run again whenever you like — every step is a no-op once it has been done,
so it doubles as the "I pulled new code, set me up again" command.

Two flags, if you want them:

```bash
./scripts/setup-mac.sh --yes          # don't ask anything
./scripts/setup-mac.sh --no-service   # skip the launchd step; I'll run it by hand
```

When it finishes, open <http://localhost:4600>.

### Is it working?

```bash
./scripts/doctor.sh
```

One screen: Node, `yt-dlp` and `ffmpeg` versions, whether the build is there, whether the
background service is running, whether the port is answering, how big `library/` and
`data/` are, your Tailscale address, and the last few log lines. Every line is a tick or a
cross, and the crosses tell you the command that fixes them.

Run it first whenever something is wrong. It is usually one of five things and this tells
you which.

### Doing it by hand

If you would rather see each step:

```bash
brew install node yt-dlp ffmpeg
npm install
npm run build
npm start
```

`docs/SETUP.md` walks through the same ground more slowly, plus the parts that only matter
for your phone.

---

## On your phone

Install self.mp3 to your home screen, download your library to the device, and it plays
with the Mac closed and in a bag.

That is its own walkthrough, because the interesting part is Tailscale and HTTPS rather
than installation: **[docs/SETUP.md](SETUP.md)**. About twenty minutes, once.

The short version: install Tailscale on both devices, run `tailscale serve --bg 4600` on
the Mac, open the resulting `https://…ts.net` address in Safari, **Add to Home Screen**,
then Settings → **Download everything**.

---

## With Docker

For a machine that is always on — a small VPS, a Synology, a Raspberry Pi. The image
carries `ffmpeg` and `yt-dlp`, so there is nothing else to install.

```bash
mkdir -p library data
docker compose up -d
docker compose logs -f
```

Then <http://localhost:4600> on that machine.

`library/` and `data/` next to `docker-compose.yml` are bind-mounted into the container, so
your music and your database stay ordinary folders on the host. Backing up is still "copy
those two folders", and moving to a different machine is still "copy those two folders".

Without compose:

```bash
docker build -t selfmp3 .
docker run -d --name selfmp3 --restart unless-stopped \
  -p 127.0.0.1:4600:4600 \
  -v "$PWD/library:/app/library" \
  -v "$PWD/data:/app/data" \
  selfmp3
```

A few things worth knowing:

- **It runs as an ordinary user**, uid 1000, not root. If your host account is a different
  uid you will see permission errors on the two mounted folders; fix it once with
  `sudo chown -R 1000:1000 library data`, or uncomment the `user:` line in
  `docker-compose.yml`.
- **The port is bound to `127.0.0.1` on purpose.** Put Tailscale in front of it rather than
  opening it to the internet (next section). Drop the `127.0.0.1:` prefix only if something
  else is already terminating TLS in front.
- **There is a `HEALTHCHECK`** against `/api/health`, so `docker ps` tells you whether the
  app is actually up rather than merely running. That route stays open even when
  `SELFMP3_AUTH_TOKEN` is set, so a monitor never needs the secret.
- **The image is multi-stage.** Compilers live in the build stage only; the runtime image is
  the built app, its production dependencies, `ffmpeg`, `yt-dlp` and `tini`.

### Tailscale in front of it

Same idea as on a Mac: your own devices reach the server, nobody else does, and you get a
real Let's Encrypt certificate — which iOS requires before it will cache anything offline.

Install Tailscale on the host, then:

```bash
tailscale serve --bg 4600
tailscale serve status
```

Your app is now at `https://<machine>.<tailnet>.ts.net/`. Use that address on your phone
and follow [step 6 of SETUP.md](SETUP.md#step-6--install-it-on-your-phone) to install it to
the home screen.

If you would rather run Tailscale in a container next to this one, the usual
`tailscale/tailscale` sidecar with `network_mode: service:selfmp3` works; nothing in the app
cares either way.

### Settings

Anything from the table in `README.md` can go in the `environment:` block of
`docker-compose.yml`. The two most likely:

```yaml
environment:
  SELFMP3_AUTH_TOKEN: <openssl rand -hex 24>   # a second lock, on top of Tailscale
  SELFMP3_LOG_LEVEL: debug
```

---

## The `selfmp3` command

The same operations, without a browser. It works against a running server over the API, so
it never opens the database behind the server's back.

```bash
npm run cli -- doctor            # from the repo
selfmp3 doctor                   # after `npm link`, or inside the container
```

| Command | What it does |
|---|---|
| `selfmp3 start` | run the server in the foreground |
| `selfmp3 scan` | rescan the library folder |
| `selfmp3 import <url…>` | queue one or more links for download |
| `selfmp3 backup <dest-dir>` | copy `data/` and `library/`, only what changed |
| `selfmp3 doctor` | node, yt-dlp, ffmpeg, the server, the folders |
| `selfmp3 --version` | print the version |

`--url` points it at a server somewhere else, `--token` supplies the bearer token if you
set one:

```bash
selfmp3 --url https://nas.tail1a2b.ts.net --token "$SELFMP3_AUTH_TOKEN" scan
```

Inside the container:

```bash
docker compose exec selfmp3 node apps/server/dist/cli.js doctor
```

---

## Backing up

```bash
npm run cli -- backup /Volumes/Backup/selfmp3
```

It copies `data/` and `library/` and skips anything already there with the same size and
timestamp, so the first run is as slow as your disk and every run after it takes seconds.
It never deletes from the destination.

The database is copied through SQLite's own backup API rather than as bytes, so the copy is
consistent even though the server is running and writing to it. You do not have to stop
anything.

Nightly, if you want, with cron:

```cron
0 3 * * *  cd ~/self.mp3 && npm run cli -- backup /Volumes/Backup/selfmp3 >> ~/Library/Logs/selfmp3-backup.log 2>&1
```

Restoring is copying the two folders back. `data/covers/` is a disposable cache and rebuilds
itself on the next scan, so if you are short of space that is the one directory you can drop.

---

## Updating

On a Mac:

```bash
git pull
./scripts/setup-mac.sh          # installs, builds, restarts the service
```

With Docker:

```bash
git pull
docker compose up -d --build
```

Database migrations run automatically at startup and only ever go forwards. Take a backup
first if you want to be able to go back.

Keep `yt-dlp` current either way — it is the piece that breaks when YouTube changes
something:

```bash
brew upgrade yt-dlp             # on a Mac
docker compose up -d --build    # in Docker, it comes from the image
```

---

## Migrating from hum

If you were running the earlier version — a folder with `data/hum.db` and a `library/` —
this brings the audio, the lyrics sidecars, the tags and the play counts across:

```bash
npm start                                             # in one terminal
node scripts/migrate-from-hum.mjs ~/hum --dry-run     # in another
node scripts/migrate-from-hum.mjs ~/hum
```

The dry run prints exactly what the real run will do and writes nothing.

What happens, in order: audio files and their `.lrc` / `.txt` sidecars are copied into the
new library folder, skipping anything already there; the server is asked to rescan; the old
tags are recreated by name and linked to the songs they were on; and play counts are carried
over. Songs are matched by file path first, then by file name, so a reorganised folder is
still recognised.

Everything goes through the running server's API, which is why the server has to be up:
there is no second copy of the schema in the script and no chance of writing to a database
the server has open. The old `hum.db` is opened read-only and never modified — run it twice
and the second run changes nothing.

```bash
node scripts/migrate-from-hum.mjs ~/hum --url http://localhost:4600 --token … --no-plays
```

`--no-plays` skips the play counts. They arrive stamped as of now, since hum only kept a
counter and not per-play timestamps, so your listening history charts start on migration day
even though the totals are right.

When it is done, open the app and hit refresh.

---

## When something is wrong

Start with `./scripts/doctor.sh` (or `selfmp3 doctor`, which works anywhere Node does,
container included). Beyond that, `docs/SETUP.md` has a troubleshooting section covering the
phone-specific failures — offline downloads not starting, playback stopping on lock,
Tailscale relaying instead of connecting directly.

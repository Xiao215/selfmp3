# Installing self.mp3

self.mp3 has three parts, and only one of them is installed on a computer of your own:

- **The app** you listen in: the [GitHub Pages tab](https://xiao215.github.io/selfmp3), the
  phone app and the desktop app. You sign in with Google and the library is there.
- **The bucket and the doorman.** The library lives in a storage bucket that belongs to your
  Google account, and the doorman signs you in and lets devices into it
  ([SYNC.md](SYNC.md)).
- **The server**, on a computer that is always on. It is the one with `yt-dlp`: it imports,
  analyses each song, publishes to the bucket, and runs the Smart features. One server works
  for every Google account that joins it ([features/shared-server.md](features/shared-server.md)).

If somebody already runs a server and a doorman and has let you in, you need nothing from
this guide: open the app and sign in. Your devices join that server by themselves. This guide
is for running the server.

| You want | Go to |
|---|---|
| The server on an always-on computer — a Raspberry Pi, a NAS, a small VPS | [With Docker](#with-docker) |
| The Smart features (Ask, tidy, describing songs) | [Smart features](#smart-features-cli-bridge-beside-the-server) |
| Your own bucket and doorman | [The bucket and the doorman](#the-bucket-and-the-doorman) |
| The server on a Mac or Linux box without Docker | [Without Docker](#without-docker) |
| The app on your phone, or on a Mac | [On your phone](#on-your-phone), [The desktop app](#the-desktop-app) |

---

## With Docker

The image is `ghcr.io/xiao215/selfmp3`, built for arm64 and amd64 by
`.github/workflows/docker.yml` whenever a push to `main` changes the server, and again every
Monday so the `yt-dlp` inside it stays current. It carries the server, `ffmpeg` and `yt-dlp`,
so a computer with Docker needs nothing else. The server's settings come from a `.env` beside
the compose file.

On any Linux computer with Docker and Docker Compose 2.24 or newer:

```bash
mkdir -p ~/services/selfmp3 && cd ~/services/selfmp3
curl -fsSLO https://raw.githubusercontent.com/Xiao215/selfmp3/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Xiao215/selfmp3/main/.env.example -o .env
mkdir -p library data
docker compose up -d
docker compose logs -f
```

Make the two folders yourself before the first `up`. Left to Docker, they are created
owned by root, and the server, which runs as uid 1000, cannot write to them.

The log should show `listening on http://…:4600` for each of the computer's addresses and
`working for 0 libraries`. `docker compose ps` says `healthy` once the image's health check
has had an answer from `/api/health`.

The server's own page is `http://localhost:4600`, opened on the server itself: whom it works
for, how each library's publishing is going, and **Publish now**. On a computer with no
screen, such as a Pi, open it through SSH from your own computer:

```bash
ssh -L 4600:localhost:4600 pi
```

then `http://localhost:4600` in your browser. The page also opens at the server's other
addresses with a library's token, but there it only shows: the server takes signing in, a
bucket and Publish now from its own machine alone (`apps/server/src/routes/cloud.ts`).

What `docker-compose.yml` sets, and why:

- **The host's own network** (`network_mode: host`), not a published port. The server sees
  the computer's home and Tailscale addresses and publishes them into each bucket, which is
  how devices find it. It can reach a helper on the same computer at `127.0.0.1`, which is
  where [cli-bridge](#smart-features-cli-bridge-beside-the-server) listens. And a firewall
  still decides who reaches port 4600 (see [The firewall](#the-firewall)). Docker Desktop on
  a Mac or Windows has host networking off unless it is turned on in its settings. There,
  use `ports: ['127.0.0.1:4600:4600']` instead.
- **`user: '1000:1000'`**, the uid that owns `library/` and `data/` on the host. If your
  account has another uid, put yours there or run `sudo chown -R 1000:1000 library data`
  once.
- **`env_file`**: the `.env` beside it, if there is one. The server reads nothing else in a
  container.
- **`TZ`**, from `.env`, so the log's times and the days the server counts are yours rather
  than UTC.
- **`./library` and `./data`**, bind-mounted to `/app/library` and `/app/data`, so they are
  ordinary folders on the host.

To build the image yourself instead of pulling it, run `docker compose build` from a
checkout.

### On a Raspberry Pi

This is how Xiao's server runs: a Raspberry Pi 4 with 4 GB of memory and a 32 GB card,
running **Raspberry Pi OS Lite (64-bit)**. The OS must be 64-bit: the image has an arm64
build and no 32-bit one. A card is enough space: the music lives in the bucket, and the
server keeps only an inbox, caches and the listening model (about 750 MB, downloaded the
first time analysis wants it).

1. Write Raspberry Pi OS Lite (64-bit) to the card with Raspberry Pi Imager, with SSH turned
   on and your own user. Then `ssh` in and run `sudo apt update && sudo apt full-upgrade`.
2. Install Docker from Docker's own script, and let your user run it:

   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker "$USER"      # then log out and in again
   ```

3. Install Tailscale and join your tailnet:

   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```

4. Make `~/services/selfmp3` and start the server, as in [With Docker](#with-docker) above.
5. Give it a public HTTPS address (next section), and put that address in `.env`.

The first user on Raspberry Pi OS is uid 1000, so the `user:` line needs no change.

### A public address: Tailscale Funnel

The server needs one `https://` address that works from anywhere. The addresses it finds on
the computer are all local and all plain `http://`, and the app on GitHub Pages is served
over HTTPS, so a browser will not let it call any of them, even on the same Wi-Fi. A friend's
phone has nothing local to try at all.

Tailscale Funnel gives the Pi such an address, with a real certificate, without opening a
port on your router:

```bash
sudo tailscale funnel --bg 4600
tailscale funnel status
```

The first time, it may say that HTTPS certificates or Funnel are not turned on for your
tailnet, with a link to the admin console that turns them on. `--bg` keeps the funnel
running across reboots. The address it prints looks like `https://pi.tail1a2b.ts.net`.
Put it in `.env`, with no trailing slash:

```bash
SELFMP3_PUBLIC_URL=https://pi.tail1a2b.ts.net
```

Then run `docker compose up -d` again. A changed `.env` makes Compose recreate the container.
The log now says `published as reachable at https://… (SELFMP3_PUBLIC_URL)`, and warns if
the address is not `https://`. From then on the address goes into every snapshot beside the
local ones, and each device races the lot: at home the local address answers first, and
anywhere else the public one does. Setting it also lets the Pages app's origin call the
server. Without it, the Pages tab cannot reach the server at all.

Check it from a computer that is not on your tailnet (a phone on mobile data will do):

```bash
curl -s https://pi.tail1a2b.ts.net/api/health
```

`tailscale serve --bg 4600` is the same thing for your tailnet only. That is enough when you
are the only user and every device you use runs Tailscale. A Cloudflare *named* tunnel
(`cloudflared tunnel create selfmp3`, routed to a hostname on a domain you own) works as
well. A throwaway `trycloudflare.com` address changes every run, so it is no good in a
snapshot.

Being reachable is not being let in. A request through the funnel needs the token of the
library it is for, which each library's devices are given with the sync. Only the health
check answers without one, and joining, which takes a doorman session instead.

### The firewall

Raspberry Pi OS ships with no firewall rules. If you add `ufw`, know one thing: ports that Docker
publishes with `ports:` **bypass ufw**, because Docker writes its own packet-filter rules
ahead of ufw's. That is one more reason the compose file uses the host's network. The
server then listens like any other program on the computer, and ufw applies to it.

Funnel traffic reaches the server through Tailscale on the computer itself, so it needs no
rule. Open port 4600 to your home network and your tailnet if you want devices there to use
the shorter local route:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 4600 proto tcp   # your home network's range
sudo ufw allow in on tailscale0
```

If you publish a port instead, bind it to `127.0.0.1`, as in `127.0.0.1:4600:4600`, and let
Tailscale be the only way in.

### Updating itself

Updating is pulling the new image and recreating the container:

```bash
docker compose pull && docker compose up -d
```

`up -d` recreates the container only when the image changed, so this is safe to run often.
To have the server follow `main` by itself, run it on a timer, for example from
`crontab -e`:

```cron
*/10 * * * *  cd ~/services/selfmp3 && docker compose pull -q && docker compose up -d
```

Xiao's Pi does the same from its own dashboard, so a push to `main` reaches it a few minutes
after the image is published. Old images pile up; `docker image prune -f` clears them.

---

## Smart features: cli-bridge beside the server

Ask, tidy, describing songs and the other Smart features call a language model through any
endpoint that speaks OpenAI's chat completions with JSON-schema replies
([features/ai.md](features/ai.md)). With no endpoint set they are off, and the screens that
offer them say so. Everything else works without one.

Xiao's server uses [cli-bridge](https://github.com/Xiao215/cli-bridge), a small service on
the same computer that answers through the Claude Code CLI signed in there, and optionally
Gemini through its own CLI. It runs outside Docker, as a systemd user service:

```bash
# Node 22 or newer, and Claude Code signed in: run `claude` once and /login.
git clone https://github.com/Xiao215/cli-bridge && cd cli-bridge
npm run install-service                 # systemd user unit cli-bridge.service
sudo loginctl enable-linger "$USER"     # keep it running with nobody logged in
journalctl --user -u cli-bridge -f      # its log
```

It listens on `127.0.0.1:8787`, which the container reaches because it shares the host's
network. Tell the server in `.env`, then `docker compose up -d`:

```bash
SELFMP3_AI_BASE_URL=http://127.0.0.1:8787/v1
```

Add `SELFMP3_AI_API_KEY` only if you gave cli-bridge an `API_KEY`. The two model tiers are
`SELFMP3_AI_MODEL_FAST` and `SELFMP3_AI_MODEL_SMART`, both `sonnet` unless you set them.
Settings › Advanced › Model in the app shows the address and has a **Test** that checks
both legs: the device to the server, then the server to the model.

cli-bridge runs on your own Claude subscription, and its README asks that it serve only you.
A server that works for other people's accounts runs their Smart features on the same model.
If other people use your server, point `SELFMP3_AI_BASE_URL` at an endpoint with an API key
of its own instead.

---

## The bucket and the doorman

The library is the bucket. Setting one up, and the doorman that signs devices in to it, is
**[SYNC.md](SYNC.md), "Setting up"**: a Backblaze B2 bucket, a Cloudflare Worker deployed
by hand from `apps/doorman` ([apps/doorman/README.md](../apps/doorman/README.md)), and the
key pasted once, on the first device that signs in.

The server is never given a bucket key by hand. When a device whose bucket names no server
asks for one, it joins the server the app offers. The server gets a **grant** for that
account from the doorman, and works for it from then on in a workspace of its own
([features/shared-server.md](features/shared-server.md)).

### Who uses your server

Two settings decide this, and neither of them is on the server.

- **Who may sign in** is the doorman's decision. Its owners (the `OWNER_EMAILS` secret) are
  always let in. Everyone else is on the list an owner keeps in Settings › Who can sign in,
  unless the owner turns on **Anyone with a Google account**. Taking someone off also cuts
  off the server's grant for them.
- **Which server the app offers** is `DEFAULT_SERVER_URL` in
  `packages/shared/src/cloud.ts`. A fork that runs its own server changes that line, or sets
  the repository variable `SERVER_URL`, which the Pages and desktop builds read, and
  `SELFMP3_SERVER_URL` when building the phone app. It does the same for its doorman
  (`DOORMAN_URL`, and `SELFMP3_DOORMAN_URL` in the server's `.env`) and, if it publishes its
  own Pages site, `SELFMP3_APP_URL`.

Each account's devices list the servers that hold a grant in Settings › Account ›
Computers, where **Remove** ends one. Every account that joins imports from your server's
internet address and asks your model for its Smart features, so the doorman's list is also
the list of people who use those.

---

## Without Docker

The server is an ordinary Node program, and runs on any Mac or Linux computer with Node 22 or
newer, `yt-dlp` and `ffmpeg`. The scripts in `scripts/` are for this route. Nothing here is
needed for Docker.

### On a Mac

```bash
./scripts/setup-mac.sh
```

It checks for Node 22 or newer, installs `yt-dlp` and `ffmpeg` with Homebrew if they are
missing, runs `npm install` and `npm run build`, creates the library and data folders, and
offers to install the background service. It is safe to run again. Every step does nothing
once it has been done, so it is also the command to run after pulling new code.

```bash
./scripts/setup-mac.sh --yes          # don't ask anything
./scripts/setup-mac.sh --no-service   # skip the launchd step; I'll run `npm start` myself
```

The background service is `./scripts/install-service.sh`: a launchd job,
`com.selfmp3.server`, that starts the server at login and restarts it if it crashes.
`./scripts/uninstall-service.sh` removes it and leaves the folders alone.

```bash
launchctl kickstart -k gui/$(id -u)/com.selfmp3.server   # restart
launchctl bootout gui/$(id -u)/com.selfmp3.server        # stop
tail -f ~/Library/Logs/selfmp3.log                       # watch the log
```

The job binds the server to `127.0.0.1`, so it publishes no local addresses, and devices
reach it only through a public address in front of it: `tailscale funnel --bg 4600` and
`SELFMP3_PUBLIC_URL` in the checkout's `.env`, as in
[A public address](#a-public-address-tailscale-funnel).

A Mac that sleeps is a server that is away. The server holds off idle sleep while it is
streaming or importing, but closing a laptop's lid still sleeps it. On power, this keeps it
awake with the lid open:

```bash
sudo pmset -c sleep 0
```

### On Linux

There is no setup script. By hand:

```bash
sudo apt install ffmpeg pipx            # and Node 22 or newer, from nodejs.org or fnm
pipx install "yt-dlp[default]"          # a distribution's yt-dlp is months behind
git clone https://github.com/Xiao215/selfmp3 && cd selfmp3
npm install
npm run build
npm start
```

The server reads `.env` from the checkout it is started in. To keep it running, a systemd user
unit in `~/.config/systemd/user/selfmp3.service` does what launchd does on a Mac:

```ini
[Unit]
Description=self.mp3 server

[Service]
WorkingDirectory=%h/selfmp3
ExecStart=/usr/bin/node apps/server/dist/main.js
Environment=NODE_ENV=production
Restart=on-failure

[Install]
WantedBy=default.target
```

Use the path `command -v node` prints for `ExecStart`. Then
`systemctl --user enable --now selfmp3`, and `sudo loginctl enable-linger "$USER"` so it
runs with nobody logged in.

### Is it working?

```bash
./scripts/doctor.sh
```

One screen: Node, `yt-dlp` and `ffmpeg` versions, whether the build is there, whether port
4600 answers, where the library and data folders are and how big, the Tailscale address, and
the last few log lines. On a Mac it also checks the launchd job. Each line is a tick or a
cross, and each cross names the command that fixes it.

---

## The `selfmp3` command

The same operations without the app. It talks to the running server over its API, so it never
opens a database behind the server's back.

```bash
npm run cli -- doctor                                      # from a checkout
docker compose exec selfmp3 node apps/server/dist/cli.js doctor   # in Docker
```

| Command | What it does |
|---|---|
| `start` | run the server in the foreground |
| `scan` | sweep the inbox folder for files dropped there |
| `import <url…>` | queue one or more links for download |
| `backup <dest-dir>` | copy the data and library folders, only what changed |
| `doctor` | Node, `yt-dlp`, `ffmpeg`, the server and whom it works for, the folders |
| `--version` | print the version |

The server keeps one library for each account that joined it. On the server's own computer, a
command goes to the only library when there is only one. With several, name it with
`--library` and its account's email or its id; without it the command stops and lists them.
`doctor` lists them too.

```bash
npm run cli -- scan --library me@example.com
```

From another computer, give the library's token with `--token` instead, and point the command
at the server with `--url`. Any signed-in device copies it from **Settings › Advanced ›
Importing › Copy token**, with **Copy address** beside it for `--url`. On the server it is in
`data/hub.json`, and the server's log prints it when it works for one library:

```bash
npm run cli -- --url https://pi.tail1a2b.ts.net --token <token> scan
```

---

## Where things live

| | In Docker | Without Docker |
|---|---|---|
| The inbox: downloads, and files dropped in to import | `./library` (`/app/library`) | `~/Music/selfmp3` |
| The databases, caches, `hub.json` and the listening model | `./data` (`/app/data`) | `~/Library/Application Support/selfmp3` on a Mac, `~/.local/share/selfmp3` elsewhere |

`SELFMP3_LIBRARY_DIR` and `SELFMP3_DATA_DIR` put them anywhere else. Docker sets both
itself. `SELFMP3_PROFILE=dev` adds `-dev` to both default names, which is how `npm run dev`
keeps a development server away from a real one. `./scripts/doctor.sh` and `selfmp3 doctor`
print the paths in use.

Inside the data folder, `hub.json` lists who the server works for. Each account's workspace
is `accounts/<id>/` (its `selfmp3.db` and `covers/`), with its inbox at `<library>/<id>/`.
The listening model is in `models/`, and `yt-throttle.json` keeps YouTube's pace for the
whole computer. The inbox empties itself. Once a song is wholly in the bucket, the server
deletes its copy ([SYNC.md](SYNC.md)).

A `selfmp3.db` in the data folder itself, with no `hub.json`, is the one library of a server
whose bucket is a folder (`SELFMP3_CLOUD_DIR`). Without that setting the server refuses to
start on it, since no account here owns it: move it aside, or point `SELFMP3_DATA_DIR`
elsewhere.

---

## Backing up

The server holds no one's only copy of anything that matters. The library is the bucket.
Plays go to the bucket too, one file a month, and a workspace deleted or lost is rebuilt from
its bucket, Stats included, the next time the server starts.

What the server alone has is `data/hub.json`: which accounts it works for, each library's
token and each grant. Lose it and every account joins again from its next device, with a new
token. Each library's few server settings, such as how it signs in to YouTube, are in its
database and would need setting again. Copy `hub.json` off the computer now and then, and keep
the copy as private as the original, which holds every library's key:

```bash
scp pi:~/services/selfmp3/data/hub.json ~/selfmp3-hub.json
```

For a full copy of both folders, `selfmp3 backup` copies only what changed: size and
modification time, no hashing. Databases are copied through SQLite's own backup API, so the
copy is consistent while the server writes, and nothing needs stopping. It never deletes from
the destination.

```bash
npm run cli -- backup /Volumes/Backup/selfmp3              # from a checkout
docker compose run --rm -v /mnt/backup:/backup selfmp3 \
  node apps/server/dist/cli.js backup /backup              # in Docker
```

In Docker, the destination folder must be writable by uid 1000. Restoring is putting the two
folders back. `covers/` is a cache, and `models/` downloads again, so either can be left out.

---

## Updating

| | |
|---|---|
| Docker | `docker compose pull && docker compose up -d`, by hand or [on a timer](#updating-itself) |
| A Mac | `git pull && ./scripts/setup-mac.sh`, which installs, builds and restarts the service |
| Linux | `git pull && npm install && npm run build && systemctl --user restart selfmp3` |

Database migrations run by themselves at startup and only go forwards.

Keep `yt-dlp` current. It is the piece that breaks when YouTube changes something. The image
gets a fresh one every week, so in Docker pulling is enough. Elsewhere, run
`brew upgrade yt-dlp` or `pipx upgrade yt-dlp`.

---

## On your phone

The quickest way is a browser tab. Open <https://xiao215.github.io/selfmp3> and sign in with
Google. There is no address to type, because the tab reads the library from the bucket. **Add
to Home Screen** in Safari, or **Install app** in Chrome, gives it an icon and a full screen.
Open it from the icon: that is what keeps playback going on a locked iPhone.

A tab streams and keeps no songs. For music with no signal, the iPhone and Android app
downloads the audio to the device. You build it yourself from this repository:
**[MOBILE.md](MOBILE.md)**. That needs a Mac with Xcode for iOS, or the Android SDK.

---

## The desktop app

The same app in a window of its own, with the media keys, and songs kept on the disk rather
than in a browser's cache ([features/desktop-app.md](features/desktop-app.md)).

In the web app on a Mac, Settings › Advanced › **Mac app** finds the latest release and offers
the download for this Mac's chip where the browser can tell. The same files are on
[the releases page](https://github.com/Xiao215/selfmp3/releases): `-arm64` for Apple silicon,
`-x64` for an Intel Mac. Open the `.dmg` and drag **self.mp3** to Applications. Signing in with Google opens your own
browser and comes back to the app.

**The first launch of an unsigned build.** macOS refuses an app it cannot trace to a
registered developer. Open System Settings › **Privacy & Security** and press **Open Anyway**
under the message about self.mp3, or run this once:

```bash
xattr -dr com.apple.quarantine "/Applications/self.mp3.app"
```

An unsigned copy cannot replace itself with a new version. Settings › Advanced › Desktop app ›
**Check for updates** then offers the release page instead.

**If the keychain asks for your password after every install.** An unsigned build is signed
ad hoc, by a hash of that exact binary, so macOS treats each build as a different app. Build
it yourself with a free Apple Development certificate instead. Add your Apple ID in Xcode ›
Settings › Accounts, then Manage Certificates › + › Apple Development. If
`security find-identity -v -p codesigning` reports 0 valid identities, install Apple's
"Worldwide Developer Relations - G3" intermediate from
[apple.com/certificateauthority](https://www.apple.com/certificateauthority/). Then put the
certificate's name in the main checkout's `.env` (copy `.env.example`):

```
CSC_NAME="Apple Development: you@example.com (TEAMID)"
```

`npm run build:desktop` reads it, from a worktree too, and prints `development-signed build`.
The `.dmg` lands in `apps/desktop/release/`. The keychain asks once more on that build's first
run. After **Always Allow**, every later build signed with the same certificate is the same
app to it.

The app keeps its files in `~/Library/Application Support/self.mp3`: songs under `songs/`,
covers under `covers/`. Settings › On this computer shows the folder, with **Reveal in
Finder**.

---

## When something is wrong

Start with the server's log (`docker compose logs --tail 100`, or the launchd log file), then
`selfmp3 doctor` or `./scripts/doctor.sh`.

**The app shows no songs.** The library comes from the bucket, so this is the bucket, not the
server. Check that the device is signed in to the right Google account and that a bucket is
connected (Settings › Account › Storage). [SYNC.md](SYNC.md) has the rest.

**"No computer works for your library yet", or "Your library's computer isn't answering".**
Check that the server is up (`docker compose ps` says `healthy`) and that
`curl -s https://<your address>/api/health` answers from outside your network. If it does not,
check `tailscale funnel status`. If it does, check that `SELFMP3_PUBLIC_URL` is set, is
`https://`, and matches the address. Without it the Pages tab is not allowed to call the
server.

**Permission errors on `/app/library` or `/app/data`.** The folders are not owned by the uid in
the `user:` line. Run `sudo chown -R 1000:1000 library data` in the compose folder.

**Imports fail with a yt-dlp error.** Update it ([Updating](#updating)). If YouTube says
"Sign in to confirm you're not a bot" on every link, the block may be on your network's
address rather than on the request. The server's log has yt-dlp's own words.

**Smart features say they are off, or the Test fails at the second leg.** Check
`SELFMP3_AI_BASE_URL` in `.env`, and that cli-bridge is running:
`systemctl --user status cli-bridge`, then `curl -s http://127.0.0.1:8787/v1/models` on the
server.

**The server is not running after a reboot.** In Docker, `restart: unless-stopped` brings it
back once Docker starts, and Docker's install script enables it at boot. On a Mac,
`launchctl list | grep selfmp3` should show the job. If it does not, run
`./scripts/install-service.sh` again.

**Everything is slow over Tailscale.** A device is probably relaying through Tailscale's
servers rather than connecting directly. `tailscale netcheck` says so. It usually sorts
itself out, and turning on UPnP on your router helps.

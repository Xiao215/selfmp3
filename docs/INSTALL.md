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
creates the library and data folders, and offers to install the background service so the server
starts at login.

It is safe to run again whenever you like — every step is a no-op once it has been done,
so it doubles as the "I pulled new code, set me up again" command.

Two flags, if you want them:

```bash
./scripts/setup-mac.sh --yes          # don't ask anything
./scripts/setup-mac.sh --no-service   # skip the launchd step; I'll run it by hand
```

When it finishes, open <http://localhost:4600>. That is the server's own page — how many
songs it has, the Cloud section where you sign in with Google and name your bucket, and a
**Publish now** button. It is setup and status, not a music player: once the library is
published you listen in the [GitHub Pages tab](https://xiao215.github.io/selfmp3), the
desktop app or the phone app, each signed in with the same Google account.

### Is it working?

```bash
./scripts/doctor.sh
```

One screen: Node, `yt-dlp` and `ffmpeg` versions, whether the build is there, whether the
background service is running, whether the port is answering, where the library and data
folders are and how big, your Tailscale address, and the last few log lines. Every line is a tick or a
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

Two ways, and they are not alternatives so much as steps.

**A browser tab.** The quickest: open <https://xiao215.github.io/selfmp3> and sign in with
Google. There is no address to type and nothing to install, because the tab reads the
library from your bucket rather than from your server — so it works with the server asleep.
It streams and keeps no songs. **Add to Home Screen** in Safari, or **Install app** in
Chrome, gives it an icon and a full screen.

Your server still has to publish to that bucket before there is anything to open, and the
bucket is where you set that up: **[docs/SYNC.md](SYNC.md)**. Tailscale is worth doing too —
not to reach the app, which is on Pages, but so your phone can hand an import straight to
the server while it is awake, and so handoff and remote control work at home:
**[docs/SETUP.md](SETUP.md)**.

**The app, for music with no signal.** A browser tab keeps no songs. The iPhone and Android
app does: it signs in with Google, reads the library from your bucket
([docs/SYNC.md](SYNC.md)) and downloads the audio to the device, so it plays with the server
asleep and in a bag. You build it yourself from this repository —
**[docs/MOBILE.md](MOBILE.md)** — which needs a Mac with Xcode for iOS, or the Android SDK.

---

## The desktop app

A self.mp3 in the Dock, with its own window, the media keys, and your music on the disk
rather than in a browser's cache. Same app as the tab — it is the same build inside a
window — so nothing is set up twice and a library downloaded in one is not downloaded
again in the other.

Download the `.dmg` from
[the releases page](https://github.com/Xiao215/selfmp3/releases) — `-arm64` for a Mac
with Apple silicon (M1 or later), `-x64` for an Intel Mac; Apple menu → About This Mac
says which — open it, and drag **self.mp3** to Applications.

**The first launch, if the build was not signed.** macOS refuses an app it cannot trace to
a registered developer, and a personal project usually has no such certificate. Open
System Settings → **Privacy & Security**, and press **Open Anyway** under the message
about self.mp3. Or, in Terminal, once:

```
xattr -dr com.apple.quarantine "/Applications/self.mp3.app"
```

It is the same app either way. The one thing an unsigned copy cannot do is replace itself
when there is a new version — Settings → **Desktop app** → Check for updates then offers
the release page instead of a button.

**If the keychain asks for your password after every install.** An unsigned build is
signed ad-hoc, which identifies it by a hash of that exact binary, so macOS treats each
new build as a different app asking for the first one's "self.mp3 Safe Storage" key.
Pressing Always Allow lasts until the next build. Building it yourself with a free Apple
Development certificate ends it: add your Apple ID in Xcode → Settings → Accounts,
then Manage Certificates → + → Apple Development. Check that
`security find-identity -v -p codesigning` lists it as valid — if it says 0 valid
identities, install Apple's "Worldwide Developer Relations - G3" intermediate from
[apple.com/certificateauthority](https://www.apple.com/certificateauthority/) with
`security add-certificates -k ~/Library/Keychains/login.keychain-db AppleWWDRCAG3.cer`
— and put its name in a `.env` at the top of your main checkout (copy `.env.example`;
git ignores `.env`):

```
CSC_NAME="Apple Development: you@example.com (TEAMID)"
```

Every `npm run build:desktop` reads it and prints `development-signed build`, from a
worktree too — a worktree branched from your checkout has no `.env` of its own, so the
main checkout's is read after it. The same file holds the server's own settings, such as
`SELFMP3_AUTH_TOKEN`; a variable set in the shell wins over the file. The keychain asks
once more, the first time that build runs; after Always Allow, every later build signed
with the same certificate is the same app to it.

Signing in is the same as anywhere: Settings → Cloud → Sign in with Google, which opens
your own browser and comes back to the app.

**Where things are.** `~/Library/Application Support/self.mp3` — downloaded songs under
`songs/`, covers under `covers/`, and the window's size. Settings → Offline music shows
the folder and has a **Reveal in Finder** button.

To build it yourself on a Mac, rather than downloading it:

```
npm install
npm run build:desktop
```

The `.dmg` lands in `apps/desktop/release/`.

---

## Letting someone else in

Your server is at home behind a router, and the app is a web page on the internet. Two
separate things have to be true before somebody else's browser can import into your
library, and it is worth keeping them apart, because each fails in its own way.

### 1. An address their browser can call

The server publishes the addresses it finds on this machine with every snapshot it writes,
and every one of them is a `http://192.168.…` or `http://100.…` — useless from anywhere
else, and refused outright by the Pages app even at home, because a page served over HTTPS
may not call `http://`. So it needs one address it cannot work out for itself, and
`SELFMP3_PUBLIC_URL` is where you put it:

```bash
SELFMP3_PUBLIC_URL=https://music.example.com
```

Set it and the server publishes that address beside the local ones. Every device races the
whole list at once, so at home the Wi-Fi address still answers first and the public one is
only paid for when nothing nearer replies. The boot log prints `published as reachable at
…`, and warns if what you gave it is not `https://` — a plain `http://` address is one the
app is not allowed to call at all, which looks exactly like the server being switched off.

Two ways to get such an address, neither of which asks you to open a port on your router:

**Tailscale Funnel**, if you already followed [SETUP.md](SETUP.md) and have `tailscale
serve` running. `serve` is your tailnet only; `funnel` is the same HTTPS address opened to
the public internet:

```bash
tailscale funnel --bg 4600
tailscale funnel status
```

**A Cloudflare tunnel**, if you would rather use a name of your own. `cloudflared tunnel
--url http://localhost:4600` gives you a throwaway `trycloudflare.com` address in one
command, which changes every run — fine for an afternoon, no good in a published snapshot.
A *named* tunnel (`cloudflared tunnel create selfmp3`, then route it at a hostname on a
domain you own) keeps the same address forever, which is the one to put in
`SELFMP3_PUBLIC_URL`.

Either way the token still stands between the address and your library. A request arriving
through a tunnel carries the tunnel's hostname and a forwarding header, so it is not the
"came from this computer" case that skips the check (`apps/server/src/http/local.ts`) — it
needs the token like any other request from the network, and devices are handed that with
the sync. Setting a public address also lets the published app's own origin call the API,
which it otherwise could not; nothing else is let in.

The server does not have to be awake for any of this. A device that cannot reach it says
so and keeps looking, and a link left on the Import screen is picked up the next time the
server is on ([SYNC.md](SYNC.md), rule 6) — so "tell me when you want to import and I will
switch it on" works.

### 2. An account that can see your library

This is the part an address does not solve. **Your library is your bucket, not your
server.** Signing in with Google gets somebody into the app; what they then see is whatever
bucket is attached to their own account, which for a friend is none. So a friend who signs
in does not see a smaller version of your library — they see an empty app, and your server
never enters into it.

For them to use your library they have to be *on* your bucket:

1. Add their address to the doorman's `ALLOWED_EMAILS` (`apps/doorman/README.md`), or the
   door does not open at all. (`*` there opens it to any Google account; the README says
   what that costs.)
2. Give them the bucket's keys, which they connect in the app's Settings the same way you
   did.

Be clear-eyed about what step 2 hands over: the same bucket, with no read-only version of
it, so they can delete songs, and the snapshot they read carries your server's token. It is
the arrangement for somebody you would give a key to the house — a partner, a sibling —
rather than for lending a friend your music for an evening. Sharing that is genuinely
one-way does not exist here yet.

---

## With Docker

For a machine that is always on — a Raspberry Pi, a Synology, a small VPS. The image
carries `ffmpeg` and `yt-dlp`, so there is nothing else to install. It is published for
arm64 and amd64 as `ghcr.io/xiao215/selfmp3`, so the machine pulls it rather than building.

```bash
mkdir -p library data
docker compose up -d
docker compose logs -f
```

Then <http://localhost:4600> on that machine, which is the server's own page: the library
count, the Cloud section and **Publish now**. Listening happens elsewhere, signed in with
Google.

`library/` and `data/` next to `docker-compose.yml` are bind-mounted into the container, so
your music and your database stay ordinary folders on the host. Backing up is still "copy
those two folders", and moving to a different machine is still "copy those two folders".

Without compose:

```bash
docker pull ghcr.io/xiao215/selfmp3:latest
docker run -d --name selfmp3 --restart unless-stopped \
  -p 127.0.0.1:4600:4600 \
  -v "$PWD/library:/app/library" \
  -v "$PWD/data:/app/data" \
  ghcr.io/xiao215/selfmp3:latest
```

To build the image yourself instead: `docker build -t selfmp3 .` from a checkout.

A few things worth knowing:

- **It runs as an ordinary user**, uid 1000, not root. If your host account is a different
  uid you will see permission errors on the two mounted folders; fix it once with
  `sudo chown -R 1000:1000 library data`, or uncomment the `user:` line in
  `docker-compose.yml`.
- **The port is bound to `127.0.0.1` on purpose.** Put Tailscale in front of it rather than
  opening it to the internet (next section). Drop the `127.0.0.1:` prefix only if something
  else is already terminating TLS in front.
- **There is a `HEALTHCHECK`** against `/api/health`, so `docker ps` tells you whether the
  app is actually up rather than merely running. That route stays open whatever token the
  server is using, so a monitor never needs the secret.
- **The image is multi-stage.** The web app is built once, as static files; the server is
  built with its compilers in a stage of its own. The runtime image is the built server, its
  production dependencies, the web app, `ffmpeg`, `yt-dlp` and `tini`.

### On a Raspberry Pi

A Pi 4 or 5 with 4 GB or more, running a **64-bit** OS (Raspberry Pi OS Lite 64-bit is
enough; the image is arm64 only on a Pi). Keep the music on a USB SSD rather than the SD
card: the library is read constantly and the database written often.

```bash
curl -fsSL https://get.docker.com | sh            # Docker, from Docker's own script
sudo usermod -aG docker "$USER"                   # then log out and in again
mkdir -p /mnt/ssd/selfmp3 && cd /mnt/ssd/selfmp3
curl -fsSLO https://raw.githubusercontent.com/Xiao215/selfmp3/main/docker-compose.yml
mkdir -p library data
docker compose up -d
```

The Pi never builds the image; it pulls the one GitHub builds for it. Moving from an existing
server is copying the two folders across while that server is stopped:

```bash
rsync -a --info=progress2 ~/Music/selfmp3/ pi@<pi>:/mnt/ssd/selfmp3/library/
rsync -a ~/Library/Application\ Support/selfmp3/ pi@<pi>:/mnt/ssd/selfmp3/data/
```

(The folders are wherever `npm run cli -- doctor` says they are on the old server.) Then point
Tailscale at the Pi as below, and each device at the Pi's address.

### Tailscale in front of it

Same idea as on a Mac: your own devices reach the server, nobody else does, and you get a
real Let's Encrypt certificate rather than a warning page.

Install Tailscale on the host, then:

```bash
tailscale serve --bg 4600
tailscale serve status
```

The server's page is now at `https://<machine>.<tailnet>.ts.net/`, reachable from your
laptop or phone wherever you are. It is not how you listen — that is Google sign-in, in the
Pages tab or an installed app — but it is how you check on the box without an SSH session,
and it is the address the browser extension and the apps' Import screens use to hand it
links. [SETUP.md](SETUP.md) has the same ground in more detail.

If you would rather run Tailscale in a container next to this one, the usual
`tailscale/tailscale` sidecar with `network_mode: service:selfmp3` works; nothing in the app
cares either way.

### Settings

Anything from the table in `README.md` can go in the `environment:` block of
`docker-compose.yml`. The two most likely:

```yaml
environment:
  SELFMP3_AUTH_TOKEN: <openssl rand -hex 24>   # a token of your own, instead of its own
  SELFMP3_LOG_LEVEL: debug
```

The token is worth a word in a container. The server always has one — it makes its own on
the first boot that finds none — but it keeps it in the database, which here is a bind mount
that a `docker compose down -v` or a fresh `./data` would take with it. Every device signed
in to your bucket would then be holding last week's key until the next sync reached it.
Setting `SELFMP3_AUTH_TOKEN` in the compose file pins it to something the container cannot
lose. The exemption for requests from the server's own machine does not help you here
either: the container is its own machine, so a request from the host arrives over the
network like any other.

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
| `selfmp3 backup <dest-dir>` | copy the data and library folders, only what changed |
| `selfmp3 doctor` | node, yt-dlp, ffmpeg, the server, the folders |
| `selfmp3 --version` | print the version |

`--url` points it at a server somewhere else. On the machine the server runs on you need no
token — the default `http://localhost:4600` is not asked for one — and `--token` supplies it
when you are reaching a server anywhere else:

```bash
selfmp3 --url https://nas.tail1a2b.ts.net --token "$SELFMP3_AUTH_TOKEN" scan
```

Inside the container:

```bash
docker compose exec selfmp3 node apps/server/dist/cli.js doctor
```

---

## Where your music lives

The server keeps the two folders outside the checkout, so a `git pull` can never touch
your music and every checkout or worktree finds the same library:

| | Where |
|---|---|
| Your music | `~/Music/selfmp3` (`~/Music/selfmp3-dev` with `SELFMP3_PROFILE=dev`) |
| The database and cover art | `~/Library/Application Support/selfmp3` (`~/.local/share/selfmp3` off macOS) |

`./scripts/doctor.sh` prints both paths.

To keep them somewhere else entirely — an external drive, say — name it and the
defaults are not consulted at all:

```bash
export SELFMP3_LIBRARY_DIR=/Volumes/Music/selfmp3
export SELFMP3_DATA_DIR=/Volumes/Music/selfmp3-data
```

Docker sets both variables itself, so none of this changes anything there.

---

## Backing up

```bash
npm run cli -- backup /Volumes/Backup/selfmp3
```

It copies the data and library folders and skips anything already there with the same size and
timestamp, so the first run is as slow as your disk and every run after it takes seconds.
It never deletes from the destination.

The database is copied through SQLite's own backup API rather than as bytes, so the copy is
consistent even though the server is running and writing to it. You do not have to stop
anything.

Nightly, if you want, with cron:

```cron
0 3 * * *  cd ~/self.mp3 && npm run cli -- backup /Volumes/Backup/selfmp3 >> ~/Library/Logs/selfmp3-backup.log 2>&1
```

Restoring is copying the two folders back. `covers/` in the data folder is a disposable cache and rebuilds
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
docker compose pull
docker compose up -d
```

Database migrations run automatically at startup and only ever go forwards. Take a backup
first if you want to be able to go back.

Keep `yt-dlp` current either way — it is the piece that breaks when YouTube changes
something:

```bash
brew upgrade yt-dlp             # on a Mac
docker compose pull && docker compose up -d   # in Docker, it comes from the image
```

---

## When something is wrong

Start with `./scripts/doctor.sh` (or `selfmp3 doctor`, which works anywhere Node does,
container included). Beyond that, `docs/SETUP.md` has a troubleshooting section covering the
phone-specific failures — offline downloads not starting, playback stopping on lock,
Tailscale relaying instead of connecting directly.

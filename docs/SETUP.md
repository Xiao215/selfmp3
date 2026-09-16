# Setting up self.mp3 on your server and your phone

This gets you to: **your library on your phone, reachable from anywhere, privately.**

It takes about twenty minutes. You only do it once.

---

## What you are building, and why

Your music lives with the server (this guide runs it on a Mac). Your phone talks to the
server over **Tailscale**, a private network that only your own devices can join. Nothing is
exposed to the public internet.

The important thing to understand up front: **a browser tab streams, so it needs the server
awake.** Songs on the device play with no connection at all, and the apps that keep songs on
the device are the phone app and the Mac desktop app, not a tab. So this guide gets your
phone to the server; if you want music in a bag with the lid closed, finish with
[MOBILE.md](MOBILE.md), which builds the phone app, and [SYNC.md](SYNC.md), which puts the
library in a bucket both ends read.

Music is small — a four-minute track is roughly 4 MB, so 500 songs is about 2 GB — so
keeping everything on a phone is realistic rather than a chore.

---

## Step 1 — Install the tools

```bash
brew install yt-dlp ffmpeg
```

`yt-dlp` does the downloading; `ffmpeg` embeds artwork and tags. Without ffmpeg imports
still work, they just arrive plainer.

Keep `yt-dlp` current — it breaks whenever YouTube changes something:

```bash
brew upgrade yt-dlp
```

---

## Step 2 — Build and run

From the project folder:

```bash
npm install
npm run build
npm start
```

You should see something like:

```
14:22:01 INFO  self.mp3 1.0.0
14:22:01 INFO  listening on http://localhost:4600
14:22:01 INFO  listening on http://192.168.1.44:4600
```

Open <http://localhost:4600>. To bring in music you already have, copy the files into
`~/Music/selfmp3` and hit **Rescan library** — everything gets picked up.

Stop it with `Ctrl-C` for now.

---

## Step 3 — Install Tailscale

Tailscale is a private network built on WireGuard. Your server and your phone each get a
stable address that only your own devices can reach. Nothing is exposed to the public
internet, and you never open a port on your router.

**On your Mac:**

```bash
brew install --cask tailscale
```

Open the Tailscale app and sign in (Google, GitHub or Apple — no new account needed).

**On your phone:** install Tailscale from the App Store or Play Store and sign in with the
same account.

That is it — both devices are now on your private network. It is free for personal use.

Check your server's Tailscale name:

```bash
tailscale status
```

You will see something like `xiaos-macbook-pro.tail1a2b.ts.net`.

---

## Step 4 — Turn on HTTPS

This step is not optional, and it is worth knowing why: **iOS only allows offline caching
and Add-to-Home-Screen over HTTPS.** Without a real certificate, the whole offline feature
silently does not work.

Tailscale issues a genuine Let's Encrypt certificate for free. One command:

```bash
tailscale serve --bg 4600
```

Now check:

```bash
tailscale serve status
```

You should see your app served at `https://xiaos-macbook-pro.tail1a2b.ts.net/`.

Open that URL on the server to confirm it works. **Use this HTTPS address from now on** —
not the `http://100.x.x.x` one.

> If `tailscale serve` says HTTPS is not enabled, open the Tailscale admin console at
> <https://login.tailscale.com/admin/dns>, and enable **HTTPS Certificates**.

---

## Step 5 — Keep the server running in the background

Right now the server dies when you close your terminal. This makes macOS start it at login
and restart it if it ever crashes.

Install the background service:

```bash
./scripts/install-service.sh
```

That writes a launchd job, loads it, and starts the server. Logs go to
`~/Library/Logs/selfmp3.log`.

Useful commands afterwards:

```bash
launchctl kickstart -k gui/$(id -u)/com.selfmp3.server   # restart
launchctl bootout gui/$(id -u)/com.selfmp3.server        # stop
tail -f ~/Library/Logs/selfmp3.log                       # watch logs
```

### Optional: keep the server awake while it is plugged in

If you want streaming to work whenever the lid is open and the server is on power:

```bash
sudo pmset -c sleep 0        # don't sleep on AC power
sudo pmset -c disablesleep 0 # but do allow display sleep
```

This does not help when the lid is closed and the server is in your bag — nothing does. That
is what the offline download is for.

---

## Step 6 — Install it on your phone

1. Open Safari on your iPhone (it must be Safari — Chrome on iOS cannot install web apps).
2. Go to `https://xiaos-macbook-pro.tail1a2b.ts.net`.
3. Tap the **Share** button, then **Add to Home Screen**.
4. Tap **Add**.

You now have a self.mp3 icon on your home screen. Open it from there, not from Safari —
launching from the icon is what gives you the full-screen app, background playback and
lock-screen controls.

**On Android:** open the URL in Chrome and tap **Install app** in the menu.

---

## Step 7 — Music with no signal (the important one)

What you have now streams: with the server asleep, the music stops. A browser tab keeps no
songs — its storage is the browser's to evict, so it is not promised — which is why the app
that keeps songs is an installed one:

- **On your phone**, build the iPhone or Android app from this repository:
  [MOBILE.md](MOBILE.md). It signs in with Google and reads the library from your bucket
  ([SYNC.md](SYNC.md)), so it works with the server switched off entirely.
- **On another Mac**, the desktop app does the same in a window:
  [INSTALL.md](INSTALL.md#the-desktop-app).

In either, **Settings → Offline music** has **Download everything**, and
**Download what's missing** to top it up after importing. They download on Wi-Fi by
themselves, one song at a time, and ask first on mobile data or past 500 MB. When a song is
on the device it plays with no connection at all — aeroplane mode, underground, anywhere —
and the plays you make offline reach the server later, dated when they happened.

---

## Optional: a second lock

Tailscale already means only your devices can reach the server. If you want belt and braces
— say your phone gets stolen — add a token:

```bash
# generate one
openssl rand -hex 24
```

Then add it to the launchd plist as `SELFMP3_AUTH_TOKEN` and restart the service. Note that
you will need to append `?token=…` for the app to stream audio, so this is genuinely
optional and most people should skip it.

---

## Troubleshooting

**The phone cannot reach it.**
Check Tailscale is connected on both devices (the app shows a green dot). Run
`tailscale status` on the server and confirm your phone appears in the list.

**"Add to Home Screen" does not offer to install.**
You are on `http://`, not `https://`. Go back to step 4.

**Songs will not download to the phone.**
A browser tab does not download songs at all, however it was installed — it streams, and it
has no Offline music settings. Downloading is the phone app's, and the desktop app's: step 7.

**Imports fail with a yt-dlp error.**
Run `brew upgrade yt-dlp`. YouTube changes things frequently and yt-dlp updates often.

**Playback stops when the phone locks.**
Make sure you opened the app from the home screen icon rather than from a Safari tab.

**The server is not running after a reboot.**
`launchctl list | grep selfmp3` should show it. If not, re-run
`./scripts/install-service.sh`.

**Everything is slow over Tailscale.**
Your phone is probably relaying through a Tailscale server rather than connecting directly.
`tailscale netcheck` on the server will tell you. It usually resolves itself; enabling UPnP on
your router helps.

---

## Later: moving your music to cloud storage

If you decide you want your library reachable even with the server switched off entirely, the
storage layer already supports S3-compatible object storage (Cloudflare R2, Backblaze B2):

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

```bash
SELFMP3_STORAGE_DRIVER=s3 \
SELFMP3_S3_BUCKET=my-music \
SELFMP3_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
SELFMP3_S3_ACCESS_KEY_ID=... \
SELFMP3_S3_SECRET_ACCESS_KEY=... \
npm start
```

You would also need the API itself running somewhere always-on (a small VPS or Fly.io
machine) for this to buy you anything — which is the real cost, not the storage. R2 charges
no egress fees and roughly $0.015/GB-month, so 100 GB of music is about $1.50/mo.

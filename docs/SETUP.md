# Setting up self.mp3 on your Mac and your phone

This gets you to: **your whole library on your phone, playing anywhere, even with your
MacBook closed in a bag.**

It takes about twenty minutes. You only do it once.

---

## What you are building, and why

Your music and the server live on your Mac. Your phone talks to the Mac over
**Tailscale**, a private network that only your own devices can join.

The important thing to understand up front: **when your Mac is asleep, streaming stops —
but downloaded songs keep playing.** That is why the last step of this guide is downloading
your library to your phone, and it is the step that actually makes this work day to day.
Music is small (a four-minute track is roughly 4 MB, so 500 songs is about 2 GB), so
keeping everything on your phone is realistic rather than a chore.

Your Mac only needs to be awake when you are importing new music or pulling down a sync.

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

Open <http://localhost:4600>. If your old library was in `hum/library/`, copy those files
into `library/` and hit **Rescan library** — everything gets picked up.

Stop it with `Ctrl-C` for now.

---

## Step 3 — Install Tailscale

Tailscale is a private network built on WireGuard. Your Mac and your phone each get a
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

Check your Mac's Tailscale name:

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

Open that URL on your Mac to confirm it works. **Use this HTTPS address from now on** —
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

### Optional: keep the Mac awake while it is plugged in

If you want streaming to work whenever the lid is open and the Mac is on power:

```bash
sudo pmset -c sleep 0        # don't sleep on AC power
sudo pmset -c disablesleep 0 # but do allow display sleep
```

This does not help when the lid is closed and the Mac is in your bag — nothing does. That
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

## Step 7 — Download your library (the important one)

In the app on your phone:

1. Go to **Settings**.
2. Under **Offline music**, tap **Download everything**.
3. Leave it running on wifi. It downloads one song at a time and shows progress.

When it finishes, those songs play with no connection at all — Mac asleep, aeroplane mode,
underground, anywhere.

After importing new music later, tap **Download what's missing** to top it up.

> iOS can clear a web app's storage if it goes unused for a long stretch. Installing to the
> home screen (step 6) tells iOS to treat the storage as persistent, which is why that step
> matters more than it looks.

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
`tailscale status` on the Mac and confirm your phone appears in the list.

**"Add to Home Screen" does not offer to install.**
You are on `http://`, not `https://`. Go back to step 4.

**Songs will not download to the phone.**
Same cause — offline caching requires HTTPS. Confirm the address bar shows a padlock.

**Imports fail with a yt-dlp error.**
Run `brew upgrade yt-dlp`. YouTube changes things frequently and yt-dlp updates often.

**Playback stops when the phone locks.**
Make sure you opened the app from the home screen icon rather than from a Safari tab.

**The server is not running after a reboot.**
`launchctl list | grep selfmp3` should show it. If not, re-run
`./scripts/install-service.sh`.

**Everything is slow over Tailscale.**
Your phone is probably relaying through a Tailscale server rather than connecting directly.
`tailscale netcheck` on the Mac will tell you. It usually resolves itself; enabling UPnP on
your router helps.

---

## Later: moving your music to cloud storage

If you decide you want your library reachable even with the Mac switched off entirely, the
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

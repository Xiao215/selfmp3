# Setting up self.mp3 on your server and your phone

This gets you to: **your library on your phone, reachable from anywhere, privately.**

It takes about twenty minutes. You only do it once.

---

## What you are building, and why

Your music lives with the server (this guide runs it on a Mac). It imports, scans, analyses
and then **publishes** the library to a storage bucket you own, and that bucket is what
every device reads. You sign in with Google and the library is there — in a browser tab, in
the Mac desktop app, on your phone — with no address to type and no need for the server to
be awake. Setting the bucket up is [SYNC.md](SYNC.md), and it is the part that actually
gets music onto your phone.

So what is Tailscale for? **Reaching the server itself**, privately, from anywhere:

- Its own page, on `:4600`, where you set it up and see whether it has published.
- Handing it a link to import, from the Import screen or the browser extension, while it is
  awake. Only the server runs yt-dlp.
- Handoff and remote control between devices that can both see it.

Tailscale is a private network that only your own devices can join, so none of that is
exposed to the public internet and you never open a port on your router.

The other thing to understand up front: **a browser tab streams and keeps no songs.** The
apps that keep songs on the device are the phone app and the Mac desktop app. If you want
music in a bag with the lid closed, finish with [MOBILE.md](MOBILE.md), which builds the
phone app.

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

Open <http://localhost:4600>. This is the server's own page: how many songs it has, the
**Cloud** section where you sign in with Google and name your bucket, **Publish now**, and
where to go to listen. It is deliberately not a music player — that is the Pages tab, the
desktop app and the phone app, all reading the bucket.

To bring in music you already have, copy the files into `~/Music/selfmp3`. The folder is
watched, so they are usually picked up on their own; `npm run cli -- scan` in another
terminal forces a pass.

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

This step is not optional, and it is worth knowing why: **the app is served over HTTPS, and
a page served over HTTPS may not call a plain `http://` address.** The app runs from GitHub
Pages, so a server reachable only as `http://100.x.x.x:4600` is one the Import screen cannot
talk to — the browser blocks the call before it leaves, with nothing useful in the way of an
error. A real certificate on the server fixes it for every device at once.

Tailscale issues a genuine Let's Encrypt certificate for free. One command:

```bash
tailscale serve --bg 4600
```

Now check:

```bash
tailscale serve status
```

You should see the server's page at `https://xiaos-macbook-pro.tail1a2b.ts.net/`.

Open that URL on the server to confirm it works. **Use this HTTPS address from now on** —
not the `http://100.x.x.x` one.

One more line, and then there is nothing to type on any device again. The server publishes
its addresses with every snapshot it writes, and that is how your phone and the Pages tab
find it — but it can only publish what it can see, which is the plain `http://100.x.x.x:4600`
it listens on. It has no way of knowing that Tailscale put an HTTPS address in front of it.
So tell it:

```bash
echo 'SELFMP3_PUBLIC_URL=https://xiaos-macbook-pro.tail1a2b.ts.net' >> .env
```

Your own address, of course — the one `tailscale serve status` just printed, with no
trailing slash. Restart the server and its log says `published as reachable at …`. From
then on the HTTPS address rides along with every snapshot, the local ones stay beside it,
and each device races the lot: at home the Wi-Fi address wins, and anywhere else the HTTPS
one does. Nothing to type, nothing to switch by hand.

> This address is your tailnet's, so it works on your own devices and no one else's. To let
> a friend's browser reach the server too, see [Letting someone else
> in](INSTALL.md#letting-someone-else-in).

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

## Step 6 — Put the library in a bucket, and open it on your phone

The server's page has a **Cloud** section: sign in with Google, give it your bucket's
endpoint, name and key, and press **Publish now**. It uploads the audio, covers and lyrics
and writes a snapshot of the library. The whole of that — where the bucket comes from, what
the doorman is, how edits from different devices combine — is **[SYNC.md](SYNC.md)**, and it
is worth reading once.

Then, on your phone:

1. Open Safari on your iPhone (it must be Safari — Chrome on iOS cannot install web apps).
2. Go to <https://xiao215.github.io/selfmp3>.
3. Sign in with Google, with the account you signed the server in with.
4. Tap the **Share** button, then **Add to Home Screen**, then **Add**.

You now have a self.mp3 icon on your home screen. Open it from there, not from Safari —
launching from the icon is what gives you the full-screen app, background playback and
lock-screen controls.

**On Android:** open the same address in Chrome and tap **Install app** in the menu.

Note what you did *not* do: type your server's address. There is nowhere to type one. The
library came from the bucket, and the phone finds the server on its own — from the addresses
in that snapshot — when it has a link to import.

---

## Step 7 — Music with no signal (the important one)

What you have now streams: with no signal, the music stops. A browser tab keeps no songs —
its storage is the browser's to evict, so it is not promised — which is why the app that
keeps songs is an installed one:

- **On your phone**, build the iPhone or Android app from this repository:
  [MOBILE.md](MOBILE.md). It signs in with Google and reads the library from your bucket
  ([SYNC.md](SYNC.md)), exactly as the tab does, and downloads the audio as well.
- **On another Mac**, the desktop app does the same in a window:
  [INSTALL.md](INSTALL.md#the-desktop-app).

In either, **Settings → Offline music** has **Download everything**, and
**Download what's missing** to top it up after importing. They download on Wi-Fi by
themselves, one song at a time, and ask first on mobile data or past 500 MB. When a song is
on the device it plays with no connection at all — aeroplane mode, underground, anywhere —
and the plays you make offline reach the server later, dated when they happened.

---

## The token, which you already have

The server listens on every interface, and it has to: those addresses are how your phone
finds it to import. Anyone else on the Wi-Fi can reach the same port, so there is a key, and
it is not something you have to remember to set — the server makes one on the first boot
that finds none and keeps it in its database.

**You never type it.** It goes into the bucket beside the addresses, so every device signed
in to your Google account is handed it with the sync. And requests from the computer running
the server are not asked for it at all: its page at `http://localhost:4600`, the `selfmp3`
command and a browser extension pointed at localhost carry on exactly as before. Someone
sitting at that keyboard can open the database the token lives in, so asking them for it
would protect nothing. A request that merely arrives *from* loopback is not enough —
`tailscale serve` connects from loopback too, and those requests came from the network.

Two places it surfaces. The server prints it in its startup log, which is what you read if
you ever open its page from another computer. And `selfmp3 --token` wants it when you point
the command at a server that is not this one:

```bash
selfmp3 --url https://nas.tail1a2b.ts.net --token "$SELFMP3_AUTH_TOKEN" scan
```

To choose your own instead — say you would rather it lived in the launchd plist than in the
database — generate one and set `SELFMP3_AUTH_TOKEN`:

```bash
openssl rand -hex 24
```

Then add it to the plist and restart the service. The server uses it and leaves its own
alone. Playing is unaffected either way: the audio comes from the bucket, not the server.
`/api/health` stays open with no token at all, so a monitor never needs the secret.

---

## Troubleshooting

**The phone shows no songs at all.**
The library comes from the bucket, so this is the bucket, not Tailscale. Check the server's
page says it has published, and that the phone is signed in to the same Google account.
[SYNC.md](SYNC.md) has the rest.

**The Import screen says the server is away.**
That one *is* the network. Check Tailscale is connected on both devices (the app shows a
green dot), run `tailscale status` on the server and confirm your phone appears, and make
sure `tailscale serve` is on — an HTTPS page cannot call a plain `http://` address, so an
awake server with no certificate looks exactly like an asleep one. Step 4.

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

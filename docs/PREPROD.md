# Pre-production verification

What to check before calling a build of self.mp3 good, on every platform, against the real
thing: the real server, your real bucket, your real doorman, the published site. The unit
tests and the flows prove the code behaves; this proves the *product* does, and they are
different claims. Every serious bug this project has shipped was green in CI.

It takes about ninety minutes by hand, less with an agent driving. It is written to be
followed by either. The commands use Xiao's server as the example — a Raspberry Pi reached
as `ssh pi`, running the server in Docker from `~/services/selfmp3`, published at
`https://pi.tail3d8516.ts.net` — so put your own names in where yours differ
([INSTALL.md](INSTALL.md) has how a server is set up).

- [Ground rules](#ground-rules) — read these even if you read nothing else
- [Stage 0 · The gates](#stage-0--the-gates)
- [Stage 1 · The server](#stage-1--the-server)
- [Stage 2 · The web app](#stage-2--the-web-app)
- [Stage 3 · The desktop app](#stage-3--the-desktop-app)
- [Stage 4 · The browser extension](#stage-4--the-browser-extension)
- [Stage 5 · The phone](#stage-5--the-phone)
- [Stage 6 · Across devices](#stage-6--across-devices)
- [User journeys](#user-journeys) — the way people actually use it, end to end
- [Testing as a device away from home](#testing-as-a-device-away-from-home)
- [What automation cannot see](#what-automation-cannot-see)
- [Writing it up](#writing-it-up)

---

## Ground rules

Production here means the server on its always-on computer and the bucket with your actual
library in it. There is no staging copy of your music, so the first job of a preprod run is
not to be the thing that damages it. Each of these is a mistake that was really made.

**1. One server per bucket. Ever.** The library is whatever the newest snapshot says, and
every server that works for a bucket writes snapshots. Two of them take turns overwriting
each other, and whatever only one of them knew — a tag you put on ten songs, a playlist — is
gone the next time the other publishes.

**2. A copy of the server's data folder is a production server, whatever it is called.**
The server's `data` folder (`./data` beside the compose file; `/app/data` inside the
container) holds `hub.json`, which carries a doorman grant to the bucket of every account it
works for, and each workspace's database under `accounts/<id>/` keeps that session in its
`secrets` table as well. Booted anywhere else, a copy of either publishes over those
libraries. This is how a real library reached three rows a song on 2026-09-17.

A test server is a throwaway one: an empty data folder, its own library folder, a folder
standing in for the bucket, and a port of its own. `npm run dev` is exactly that (the `dev`
profile with `SELFMP3_CLOUD_DIR=bucket`; [verify/README.md](../verify/README.md)). By hand:

```bash
SELFMP3_PORT=4610 SELFMP3_DATA_DIR=/tmp/scratch/data SELFMP3_LIBRARY_DIR=/tmp/scratch/library \
  SELFMP3_CLOUD_DIR=bucket npm run dev --workspace @selfmp3/server
```

If a test really needs a copy of a workspace's database, take the cloud session out of the
copy *before* it boots, and still give it its own `SELFMP3_CLOUD_DIR`:

```bash
sqlite3 /path/to/copy/selfmp3.db "DELETE FROM secrets WHERE name LIKE 'cloud.%';"
```

**3. The server works for other people too.** One server holds a workspace for every Google
account that joined it (docs/features/shared-server.md). Restarting the container, stopping
it to see what a device does without it, or filling its disk is done to everyone's library,
not only yours. To see the app without its server, take the server away from the *device*
([Testing as a device away from home](#testing-as-a-device-away-from-home) shows how), or use
a throwaway server you can stop.

**4. Look before you start, and again at the end.** From the server itself, the hub lists
each workspace with its song count:

```bash
ssh pi 'curl -s localhost:4600/api/hub' | python3 -m json.tool
```

Know the song count you expect, and that every workspace says `"connected": true`. In the
log (Stage 1), `[cloud] took on the library already in the bucket … songs=N` should not
appear on a restart of a server that has been running all along: it means the bucket held a
library this server did not know, so something else has been writing to it. Stop and find
out what before going further.

**5. Nothing else on port 4600 on a computer you test from.** The server publishes
`http://localhost:4600` among its addresses, and a device races all of them. A development
server left running on 4600 on the same computer answers first, and the real app on that
computer then talks to it. Run test servers on another port while you test the real thing.

**6. Leave nothing behind.** Every write you make in a test is a write to your library.
Prefer the ones with an Undo (Up next's Save, a tag), undo them, and check the count went
back. If a test has to create something, name it `Preprod — delete me` and delete it at the
end. Never test *delete*, *remove all downloads*, signing out of storage or letting go of
the server against the real library; those belong to a throwaway server and the flows.

**7. Test the build you mean to ship.** The site deploys from `main`: check the Pages run for
the commit is green and that the page is serving it (Stage 2 has the one-liner). The server
updates itself from the image CI publishes on each push to `main` that touches it (Stage 1
checks which one it runs). The desktop app in `/Applications` is whatever was installed
last — usually days old. Build `main` and test *that*.

**8. A finding is not a fix.** Write it down with what you saw, keep going, and fix
afterwards. A run that stops at the first bug never learns about the second.

---

## Stage 0 · The gates

On the commit being verified, in a worktree that has had `npm install` run in it (stale
workspace links make `typecheck` pass when it should not — compare
`ls node_modules/@selfmp3` with `ls apps packages`).

| Command | What it proves | Needs |
|---|---|---|
| `npm run check` | types, lint, format, unused exports, the names comments point at, the unit tests, the app's component tests | nothing |
| `npm run verify:flows` | the app's behaviour end to end, at computer and phone widths | `npm run dev` in another terminal, with `SELFMP3_CORS_ORIGINS=http://localhost:4601` ([verify/README.md](../verify/README.md)) |
| `npm run build:desktop && npm run verify:desktop` | the Electron shell: files, ranges, menus, single instance, the packaged binary | a Mac |
| `npm run build:extension && npm run verify:extension` | the extension's pill, popup and bucket route | Chromium |

All of `npm run check`, not the quick ones: `check:exports`, `check:comments` and
`check:app` have each been the one that was red.

A skip is information, not a pass. `verify:flows` skips what the dev library cannot
support and says why; read the list.

---

## Stage 1 · The server

**Which build it runs.** CI builds `ghcr.io/xiao215/selfmp3` for every push to `main` that
touches what the image holds (`.github/workflows/docker.yml`), tagged `latest` and with the
commit's sha, and the server pulls `latest` and restarts on its own within minutes. For a
commit that did not touch the server, the newest one that did is what should be running.
Compare the digest the server runs with the one CI published for that commit:

```bash
ssh pi 'docker image inspect ghcr.io/xiao215/selfmp3:latest --format "{{index .RepoDigests 0}}"
        docker buildx imagetools inspect ghcr.io/xiao215/selfmp3:<sha> | grep Digest
        docker ps --filter name=selfmp3 --format "{{.Image}} {{.Status}}"'
```

- [ ] The two digests are the same, and the container is `Up … (healthy)`. If the server is
      behind, `docker compose pull && docker compose up -d` in `~/services/selfmp3` brings it
      level — after ground rule 3.

**Boot log.** `ssh pi 'docker logs selfmp3 --since 30m'`. Read the first screenful after
the restart, not just "it started":

- [ ] `schema migrated to=N` with no error, when the build brings a migration. An upgrade
      is the only time migrations meet real data.
- [ ] `listening on` for localhost, the LAN and Tailscale; `published as reachable at
      https://…` for the public address, and **no** "is not https" warning.
- [ ] One `scan complete` per workspace, prefixed with the first characters of its id, and
      the totals you expect.
- [ ] No `took on the library already in the bucket` (ground rule 4).
- [ ] `cloud pass complete … failed=0` — never a failure.

**The public address**, from outside. `curl` from any computer on the tailnet resolves the
Tailscale name to the tailnet and proves nothing, so go in through the public ingress (DNS
over HTTPS, since plain `dig @1.1.1.1` fails on networks that block outside DNS):

```bash
H=pi.tail3d8516.ts.net
IP=$(curl -s -H 'accept: application/dns-json' "https://cloudflare-dns.com/dns-query?name=$H&type=A" | python3 -c "import json,sys; print(json.load(sys.stdin)['Answer'][0]['data'])")
curl -s --resolve $H:443:$IP -D - -o /dev/null -H 'Origin: https://xiao215.github.io' https://$H/api/health | grep -iE '^HTTP|access-control-allow-origin'
curl -s --resolve $H:443:$IP -o /dev/null -w '%{http_code}\n' https://$H/api/library          # 401
curl -s --resolve $H:443:$IP -D - -o /dev/null -H 'Origin: https://evil.example' https://$H/api/health | grep -ci access-control-allow-origin   # 0
```

- [ ] 200 with `access-control-allow-origin: https://xiao215.github.io`
- [ ] **401** without a token. This is the one that matters: Tailscale Funnel hands the
      request to the server from loopback, and it must still be refused.
- [ ] no CORS header for a site that is not ours.

**The smart features.** The server's model endpoint is `SELFMP3_AI_BASE_URL`; Xiao's is
cli-bridge on the same computer:

```bash
ssh pi 'systemctl --user is-active cli-bridge.service; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/v1/models'
```

- [ ] `active` and 200; Settings → Smart features → Test says it answered.

**YouTube.** Imports fail in ways that look like bugs and are not. If one fails with
"needs a signed-in account", compare the address families on the server before believing it:

```bash
ssh pi "curl -s -4 -o /dev/null -w '%{http_code}\n' 'https://www.youtube.com/watch?v=jNQXAC9IVRw'"
ssh pi "curl -s -6 -o /dev/null -w '%{http_code}\n' 'https://www.youtube.com/watch?v=jNQXAC9IVRw'"
```

A 302 is Google's CAPTCHA wall for that family. The server pins IPv4 for this reason.
`ssh pi 'docker exec selfmp3 yt-dlp --version'` says how old the yt-dlp in the image is; CI
rebuilds the image every Monday for a fresh one.

---

## Stage 2 · The web app

The published site, in a real signed-in browser.

**First, that you are testing what you think you are:**

```js
// DevTools console on the site
fetch(document.querySelector('script[src*="index-"]').src).then(r => r.text()).then(t => console.log(t.includes('<a string only the new build has>')))
```

| Area | Do this | It is right when | Watch for |
|---|---|---|---|
| **Cold start** | Close every tab of the site, open it fresh | Library draws in a second or two, with the song count you expect | A long "Connecting…"; a count that differs from the hub's |
| **Covers and streaming** | Scroll the library; play a song you have not played on this browser | Every row has its cover; sound within ~2 s; scrubbing works | Letter tiles instead of covers = the service worker is not answering |
| **Hard refresh** | Shift-Cmd-R, then play something | Covers and playback survive | "This song is not available offline" on a song that was never offline |
| **Duplicates** | Sort by Recently added, read the top twenty rows | No song appears twice | Two rows with the same title, length and cover: two servers' libraries merged |
| **Tags widen** | In Library's tag strip, tap one tag, then a second | Count and minutes update per tap; a second tag *adds* songs, and the line says how many have both ("62 have both tags, and come first") | A second tag narrowing the list |
| **Save asks nothing** | Play from two tags, open Up next, *Save*, then **Undo** in the toast | Up next is named after the two tags; Save turns into Saved; the playlist count goes up with no dialog, and back down after Undo | A name prompt; an Undo that leaves the playlist behind |
| **Playlists grid** | Open Playlists | "N playlists · last played first"; the New tile first; no empty playlist anywhere; *fills from tags* on the ones that do | A playlist with nothing in it |
| **A new playlist** | New → *Pick songs* → a name → pick two → *Make playlist*. Then again, and close the picker instead | The first lands on its page with the two songs; the closed one exists nowhere | A playlist made before it had a song |
| **A playlist's ⋯** | Open a playlist → ⋯ | *Download*, or *Remove download* once every song is here | A download button beside Play |
| **Selection** | Select the first song in the library | The bar takes a lane above the list; the selected row is still readable | The bar covering the row you just selected |
| **Tag chips on a row** | Find a song with four tags, or one very long one | Chips that fit, then `+2`; nothing cut mid-chip or over the album column | |
| **Server reach** | Open Import and Stats | The real form and real numbers, not "Your library's computer isn't answering" | In DevTools → Network, which `api/health` answered |
| **Import: already have it** | Paste a link to a song you own, in a *different* form (`youtu.be/…` for one imported from `music.youtube.com`) → Look it up | The row says *In library* and is not counted; the button says *Import 0 songs* | A row counted as coming in: it would download a copy |
| **Import: a real one** | One short new song | The queue shows it downloading; it appears in the library here and on another device within about a minute | Stuck at 0% for more than two minutes; "needs a signed-in account" (Stage 1, YouTube) |
| **Server away** | Take the server away from this browser (not the server away from everyone: ground rule 3), open Import | It says so plainly and offers *Add it anyway* → *Add for later* | A spinner that never resolves |
| **Appearance** | Drag the accent picker | Colour follows the drag with no stutter | |
| **Sign-in wall** | A private window | Welcome and nothing else; no library flash | Any glimpse of the app before signing in |

Do the playback rows yourself, by ear. See [What automation cannot see](#what-automation-cannot-see).

---

## Stage 3 · The desktop app

Build `main` and run *that* — `open apps/desktop/release/mac-arm64/self.mp3.app` — after
quitting the installed one. It has the same bundle id, so it opens onto the installed
app's sign-in and downloads, which makes this the upgrade test as well.

| Area | Do this | It is right when | Watch for |
|---|---|---|---|
| **Upgrade** | Launch the new build over an older install's data | Still signed in, downloads still marked, the song you were on is restored, paused | Welcome; every song needing download again |
| **First launch of a fresh build** | — | Can take 15–60 s once while macOS scans it | Do not mistake this for a hang |
| **Plays from disk** | Double-click a downloaded song | Time advances; works with Wi-Fi off | |
| **The not-downloaded case** | A song with no downloaded mark | Refuses, offering to download. **The desktop cannot stream from the bucket**; the web and the phone can | Silence, or a toast blaming "offline" |
| **Counts agree** | The sidebar's count vs Settings → On this computer | The same two numbers in both places | "82 of 61 songs downloaded": the index counting songs the library no longer has |
| **Settings header** | Top of Settings | Says what this is and how many songs | "self.mp3 web · 0 songs" in the desktop app |
| **Auto-download** | Import a song from another device | It arrives *and downloads* here unasked, on Wi-Fi | |
| **Reach** | Import, Stats | As on the web | |
| **An application, not a page** | Menus, ⌘-shortcuts, media keys, close-and-reopen from the Dock, window position after relaunch | Each does what a Mac app does | Covered by `verify:desktop` except media keys and Now Playing in Control Centre, which are by hand |
| **Reveal in Finder** | Settings → On this computer → Reveal in Finder | Opens `~/Library/Application Support/self.mp3/songs` | |

---

## Stage 4 · The browser extension

Load `apps/extension/dist` unpacked (or the zip from `npm run zip:extension`).

- [ ] **Signed out, no address:** the popup says to sign in; nothing is offered that cannot work.
- [ ] **Signed in, server reachable:** the pill on a YouTube Music track page imports it; the popup's queue shows it.
- [ ] **Signed in, server out of reach** (block its addresses in the extension's worker, as in [Testing as a device away from home](#testing-as-a-device-away-from-home)): the same click leaves the link in the bucket and says *Waiting for your server*; the server imports it at its next look at the bucket.
- [ ] **Already have it:** the pill on a song you own says so rather than offering it.
- [ ] Signed in with Google, no token is asked for.

The checks only a person can do, and which have been done, are in
[FEATURE_TODO.md](FEATURE_TODO.md), "The browser extension".

---

## Stage 5 · The phone

A **release** build on a real phone. Not the simulator — it has no mobile data, no lock
screen worth the name and no car — and not a development build either: that is an empty
shell which fetches its code from a bundler on the Mac over the local network, so it
proves nothing about what a person installs and stops working the moment the phone
leaves the Wi-Fi. A release build carries its code and runs anywhere.

### Getting it onto an iPhone

Once per phone:

1. A **data** cable, straight into the Mac. Unlock the phone. macOS asks *Allow accessory
   to connect?* — Allow. If Finder shows the phone's details, it is paired; there is no
   second Trust prompt to wait for.
2. Open Xcode with the phone plugged in. **Developer Mode does not exist in Settings until
   Xcode has seen the phone**; afterwards it is at the very bottom of Settings → Privacy &
   Security. Turn it on; the phone restarts. `xcrun devicectl list devices` should then
   say `connected`.
3. After the first install: Settings → General → VPN & Device Management → the developer
   certificate → **Trust**. Until then the app installs and refuses to launch ("invalid
   code signature … not been explicitly trusted").

Every time:

```bash
cd apps/app
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8   # CocoaPods fails without a UTF-8 locale
npx expo run:ios --configuration Release --device <udid> --no-bundler
```

The UDID is in `xcrun xctrace list devices`. The first build is 15–20 minutes, later ones
a few. It generates `apps/app/ios/`, which is ignored by git and by Prettier. The phone
must be plugged in and unlocked at the install step, or it waits on *Connecting to…*
for ever. A build signed with a free Apple ID stops launching after seven days; build it
again.

When iOS asks whether the app may **find devices on your local network, say no.** A user
does not need it — the library is the bucket's and the server is reached at its public
address — and denying it makes the run stricter: the phone cannot fall back on a LAN
address, so Import working at all proves the public one.

### What to check

- [ ] Sign-in through Google returns to the app, and the library's count matches the hub's.
- [ ] **Streaming a song that is not downloaded**, on Wi-Fi, with automatic downloads off
      (pause the download bar at once, or it fetches everything first). The player sends
      the doorman's bearer as a track header. Sound within a couple of seconds, scrubbing
      works, the lock screen shows title and cover.
- [ ] The same on mobile data asks first, once.
- [ ] Import on mobile data shows the real form, not "Your library's computer isn't
      answering".
- [ ] Play the streamed song again with no signal: it plays, from the copy kept when it
      counted as a play. That copy is **not** listed under *On this phone*.
- [ ] Download it by hand: instant, no second fetch.
- [ ] Airplane mode, cold start: the library opens and downloaded songs play.
- [ ] Background the app mid-song for five minutes; it keeps playing and the controls still work.

### What a phone gets wrong that nothing else shows

Each of these was found by hand on a phone, passed every automated check at the time,
and is worth thirty seconds on every run:

- [ ] **Skip a few songs with Now Playing open.** The seek bar must start at 0:00, never
      at the last song's position for a moment; and the page must not change shape — the
      artwork stays one size, and the words do not flicker to the visual.
- [ ] **Open a song with no lyrics, then use the app.** Taps must stay instant. The visual
      once committed the native view tree up to twenty times a frame, and the whole app
      felt slow while it was up.
- [ ] **Tap a row in a list.** The pressed look goes the moment the finger lifts. One that
      lingers means the tap's release is queued behind a re-render of the whole list.
- [ ] **Swipe sideways on a tab's own page** (Home, Library, Playlists): nothing happens.
      Swipe on a pushed page (a playlist, a tag, Settings): it goes back.
- [ ] **Tap two tags in Library's strip.** The songs are listed under it, Play, Shuffle and
      Save are there, and a picked chip is plainly told from an unpicked one at arm's
      length.
- [ ] **In a playlist you made, hold a row and drag it.** It reorders, and the order
      survives a relaunch. A playlist that fills from tags does not lift.
- [ ] **Delete a downloaded song from the library** (one this run imported). One
      confirmation, and it is gone from the phone too; Settings → On this phone counts one
      fewer.
- [ ] **Remove all downloads**, on a throwaway server's library only. The button reads
      *Removing…* and cannot be tapped twice.

For numbers rather than feel — frames, which thread is busy — see "Measuring performance
on a phone" in [MOBILE.md](MOBILE.md).

---

## Stage 6 · Across devices

The product is the sync, so the last stage is two devices and a stopwatch.

- [ ] Add a tag to a song on the desktop, and look for it on the web. A device writes its
      change into the bucket at once, and another device reads it at its next look — within
      about a minute while the doorman's change counter answers, a few minutes without it.
      The server folds it into its own copy within ten minutes (`applied changes from other
      devices` in its log). Take the tag off again.
- [ ] Import on the web → the song is on the desktop, downloaded, without touching it.
- [ ] Edit a title on a device that cannot reach the server; the edit reaches the other
      devices anyway, and nothing else moves.
- [ ] After all of it, the song count is what it was at the start, plus what you
      deliberately imported.

---

## User journeys

The stages above check features. These check *evenings* — the handful of things somebody
actually sits down to do, each one crossing several features and at least one network hop.
A build can pass every row of every table and still fail one of these, because the seams
are between the rows. Run them after the stages, on the web and again on the desktop, as
[a device away from home](#testing-as-a-device-away-from-home).

Each is written as what the person is trying to do, the steps, and the one thing that
proves it worked.

### 1. "Put something on" — the evening listen

The commonest thing anyone does, and it never touches the server.

1. Open the app cold. 2. Search for three letters of a song. 3. Play a result. 4. Scrub to
the middle. 5. Skip to the next song, then back. 6. Like it. 7. Open Now Playing; look at
the words or the visual. 8. Pause and walk away.

**Proves it:** time advances within two seconds of step 3; step 4 lands where you
clicked; Previous past three seconds restarts rather than going back; the like is still
there after a reload. *On the desktop with Wi-Fi off, all of it still works for a
downloaded song.*

### 2. "I found a song" — import

1. Copy a link from YouTube Music. 2. Import → paste → Look it up. 3. Fix the title if
it is ugly (open the row); add a tag. 4. Import. 5. Go back to the library and play it.

**Proves it:** the queue row goes from waiting to downloading to added without a refresh;
the song is at the top of Recently added here, **and on your other device, downloaded,
within a minute**; Song details shows a tempo and a key, which means analysis ran. Then
paste the same song's link in another form (`youtu.be/…`): *In library*, *Import 0 songs*.

Use something short you do not mind having, or delete it after — journey 6.

### 3. "I'm in the mood for…" — tags into a playlist

1. Library → tap one tag in the strip, then a second. 2. Play. 3. Open Up next: it is named
after the two tags. 4. Save — or Undo from the toast.

**Proves it:** the second tag makes the list *longer*, and says how many songs have both;
Save asks nothing; the playlist count goes up by one and back down on Undo.

### 4. "Tidy up" — organise a few songs

1. Select three songs. 2. Tag them from the selection bar. 3. Add them to a playlist.
4. Open one song's ⋯ → Fix song info… → pick a suggestion, or cancel.

**Proves it:** the bar sits in its own lane and never covers a selected row; the row shows
the new tag as a chip, or as `+N` when there is no room; Fix song info shows iTunes' and
MusicBrainz's listings (that is the server asking them — if it spins forever the server is
not reachable and the screen should have said so).

### 5. "I'm not at home" — the server is out of reach

The design's central promise: adding music must not depend on reaching the server.

1. Take the server away from this device ([below](#testing-as-a-device-away-from-home),
with its public address blocked too). 2. Open Import. 3. *Add it anyway* → paste a link →
*Add for later*. 4. Give the server its addresses back.

**Proves it:** step 2 says *Your library's computer isn't answering* and offers the form,
rather than spinning; step 3 says the link waits in your library's pending imports; the
server's log says `[import]` for it at its next look at the bucket (within ten minutes),
and the song arrives everywhere.

**And the unkind version:** take the server away *while* the Import screen is open, then
press Look it up. It must say the server stopped answering and look for it again — not
"Failed to fetch".

### 6. "That was a mistake" — deleting a song

Only ever on a song this run imported.

1. ⋯ on the row → Delete from library… → *Delete song*.

**Proves it:** gone here at once, and from the other devices after their next look; its
files leave the bucket at the server's next pass; it does not come back after the next
sync. A song that reappears has been resurrected by another server's snapshot.

### 7. "New computer" — a second device joins

1. Install the desktop app on a Mac that has never run it (or launch with a fresh
`--user-data-dir`). 2. Sign in with Google.

**Proves it:** no library is visible before sign-in; after it, the whole library draws
and downloads begin unasked on Wi-Fi; the sidebar count and Settings → On this computer
agree when they finish.

### 8. "How much did I listen?" — stats

1. Play two songs past the halfway mark on one device. 2. Open Stats on another.

**Proves it:** plays and time listening moved. A play goes into the device's log in the
bucket and the server works the numbers out once it has read it, so allow up to ten
minutes. It is the quickest end-to-end check that plays recorded offline are delivered.

---

## Testing as a device away from home

At home every app finds the server on the LAN or over Tailscale first, because addresses
are raced and the nearest wins. That is correct, and it means a preprod run from home
**never touches the public address** unless it is made to. Two ways, no product changes:

**The desktop app** takes Chromium's flags. Launch the built binary with a debugging port
and with the server's public name pinned to Tailscale's public ingress (the address from
DNS over HTTPS, as in Stage 1):

```bash
H=pi.tail3d8516.ts.net
IP=$(curl -s -H 'accept: application/dns-json' "https://cloudflare-dns.com/dns-query?name=$H&type=A" | python3 -c "import json,sys; print(json.load(sys.stdin)['Answer'][0]['data'])")
apps/desktop/release/mac-arm64/self.mp3.app/Contents/MacOS/self.mp3 \
  --remote-debugging-port=9333 --host-resolver-rules="MAP $H $IP"
```

Then attach Playwright with `chromium.connectOverCDP('http://127.0.0.1:9333')`, which can
drive the real app — real sign-in, real downloads — by role and test id instead of by
screenshot.

**Both apps** need local addresses taken away, or they will still win. Install this before
the app probes (`context.addInitScript` over CDP; pasted into the console on the web,
followed by a client-side navigation):

```js
const local = u => /^http:\/\/(localhost|127\.|10\.|192\.|100\.|\[::1\])/.test(String(u?.url ?? u))
const realFetch = window.fetch
window.__blocked = []; window.__server = []
window.fetch = function (input, init) {
  const url = String(input?.url ?? input)
  if (local(url)) { window.__blocked.push(url); return Promise.reject(new TypeError('Failed to fetch')) }
  if (/ts\.net/.test(url)) window.__server.push((init?.method ?? 'GET') + ' ' + new URL(url).pathname)
  return realFetch.apply(this, arguments)
}
```

(`EventSource` wants the same treatment, for the presence stream.) Afterwards
`window.__blocked` should list the server's local addresses and `window.__server` every call
that went out through the public one — `GET /api/health` first, then the import queue, the
heartbeat and `SSE /api/events`. **If `__server` is empty, the run did not test the public
address, whatever else passed.**

To take the server away altogether — for the "server away" rows and journey 5 — add `ts\.net`
to the `local` pattern. That is the device's view of a server that is off, without turning
off a server other people use.

---

## What automation cannot see

An agent driving a browser gets most of this right and a few things reliably wrong. Know
which, or you will file bugs against the harness.

- **A background tab is not a tab.** Chrome defers all media in a hidden tab and clamps
  its timers to a second. An automated tab reports `document.visibilityState ===
  'hidden'`: nothing plays, a cold start measures at fifteen seconds that takes two by
  hand, and "the page is busy" means throttled. **Playback and timings are checked by a
  person, in a window they can see.** What automation *can* prove about playback is the
  plumbing: a range request for the song returns `206` with an audio type.
- **A hidden tab stops looking for the server.** React Query pauses `refetchInterval` while
  the page is not visible, so the look-out never fires in an automated tab: take the
  server away and the Import form is still there minutes later. Reload to get a fresh
  look, and check the "unkind version" of journey 5 by pressing a button instead of waiting.
- **Several screens are mounted at once.** The router keeps earlier screens in the DOM,
  hidden, so `[data-testid^="song-row-"]` matches seventy rows of which the first is
  invisible, and a wait on it times out against an app that is working. Filter every
  locator with `:visible`.
- **A row's Play and ⋯ buttons appear on hover.** Hover the row first.
- **Typing may not land.** React Native Web inputs ignored synthetic keystrokes in a
  hidden tab; setting the value through the element's native setter and dispatching
  `input` works. If a search "does nothing", suspect this first.
- **The in-app browser pane** pauses React Query and cannot register a service worker, so
  the app inside it looks offline. Use a real Chrome.
- **`curl` from any computer on the tailnet** takes the tailnet route. Use `--resolve`
  (Stage 1).
- **The desktop app's accessibility tree is truncated**; drive it by coordinates from a
  screenshot, and pause anything you start playing — it plays out loud.
- **Google sign-in, sudo, and anything that reads a browser's cookies** are the owner's
  to do. Stop and ask.

---

## Writing it up

One line a finding, most serious first, each with what was *seen* rather than what is
suspected:

```
B1  blocker   Adoption duplicates songs          web shows 60 rows for 45 songs; three rows share audio hash 1f4f00…
M1  minor     Settings says "82 of 61 downloaded" desktop, Settings → On this computer; sidebar says 61
H1  harness   Cold start measured 15 s            hidden tab; not reproduced by hand
```

`blocker` is data loss, a security hole, or a core path (sign-in, play, import, sync)
broken on any platform. `minor` is wrong but harmless. `harness` is the test's fault, and
is written down so the next run does not rediscover it.

Say what was **not** tested as plainly as what was. "Phone: not run, no device" is a
result. A stage left out in silence reads as a stage that passed.

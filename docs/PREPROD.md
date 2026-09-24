# Pre-production verification

What to check before calling a build of self.mp3 good, on every platform, against the real
thing: your real bucket, your real doorman, the published site. The unit tests and the
flows prove the code behaves; this proves the *product* does, and they are different
claims. Every serious bug this project has shipped was green in CI.

It takes about ninety minutes by hand, less with an agent driving. It is written to be
followed by either.

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

Production here means one bucket with your actual library in it. There is no staging copy
of your music, so the first job of a preprod run is not to be the thing that damages it.
Each of these is a mistake that was really made.

**1. One server per bucket. Ever.** The library is whatever the newest snapshot says, and
every server that is signed in writes snapshots. Two of them take turns overwriting each
other, and whatever only one of them knew — a tag you put on ten songs, a playlist — is
gone the next time the other publishes.

**2. A signed-in profile is a production server, whatever it is called.** The cloud sign-in
lives in `selfmp3.db`, and the doorman hands every sign-in from one Google account the same
bucket and the same folder in it. So the `dev` profile, once somebody has signed it in, is
not a sandbox: `npm run dev` boots a second production server that publishes the dev
library over the real one. The same goes for a "throwaway" server made by copying either
data folder. This is how a real library reached three rows a song on 2026-09-17.

Check what a profile is before trusting its name:

```bash
sqlite3 -readonly ~/Library/Application\ Support/selfmp3-dev/selfmp3.db "SELECT name FROM secrets WHERE name LIKE 'cloud.%';"
```

Any rows mean it is signed in. For a scratch server start from an empty data directory, or
disconnect the copy *before* it boots:

```bash
sqlite3 /path/to/copy/selfmp3.db "DELETE FROM secrets WHERE name LIKE 'cloud.%';"
```

and always give it its own `SELFMP3_LIBRARY_DIR` and `SELFMP3_CLOUD_DIR`, or it imports
into `~/Music/selfmp3` and publishes into your real bucket.

**3. Look before you start the real server.** Before `npm start`, and again after:

```bash
curl -s localhost:4600/api/cloud | python3 -m json.tool | grep -E '"(connected|state|total|inCloud|lastError|deviceId)"'
```

Know the song count you expect. The boot log line to read is `[cloud] took on the library
already in the bucket … songs=N`: **N should be 0** on a server that has been running all
along. Anything else means another server has been writing to your bucket, and you stop
and find out which before going further.

**4. Leave nothing behind.** Every write you make in a test is a write to your library.
Prefer the ones with an Undo (Save as playlist, a like), undo them, and check the count
went back. If a test has to create something, name it `Preprod — delete me` and delete it
at the end. Never test *delete*, *forget missing songs*, *remove all downloads* or
*disconnect* against the real library; those belong to `npm run dev` and the flows.

**5. Test the build you mean to ship.** The site deploys from `main`; check the Pages run
for the commit is green and that the page is serving it (Stage 2 has the one-liner). The
desktop app in `/Applications` is whatever was installed last — usually days old. Build
`main` and test *that*.

**6. A finding is not a fix.** Write it down with what you saw, keep going, and fix
afterwards. A run that stops at the first bug never learns about the second.

---

## Stage 0 · The gates

On the commit being verified, in a worktree that has had `npm install` run in it (stale
workspace links make `typecheck` pass when it should not — compare
`ls node_modules/@selfmp3` with `ls apps packages`).

| Command | What it proves | Needs |
|---|---|---|
| `npm run check` | types, lint, format, unused exports, ~2000 unit tests, the app's component tests | nothing |
| `npm run verify:flows` | the app's behaviour end to end, desktop and phone widths | `npm run dev` in another terminal (the **dev** profile, never the real one) |
| `npm run build:desktop && npm run verify:desktop` | the Electron shell: files, ranges, menus, single instance, the packaged binary | a Mac |
| `npm run build:extension && npm run verify:extension` | the extension's pill, popup and bucket route | Chromium |

All of `npm run check`, not the three quick ones: `check:exports` and `check:app` have
each been the one that was red.

A skip is information, not a pass. `verify:flows` skips what the dev library cannot
support and says why; read the list.

---

## Stage 1 · The server

Start it the way you will really run it — `npm start` from the checkout, real profile —
after ground rule 3.

**Boot log.** Read the first screenful, not just "it started":

- [ ] `schema migrated to=N` with no error, on a database that existed before. An upgrade
      is the only time migrations meet real data.
- [ ] `listening on` for localhost, the LAN and Tailscale; `published as reachable at
      https://…` for the public address, and **no** "is not https" warning.
- [ ] `scan complete … missing=0`. A non-zero `missing` is files that were in the
      database and are no longer on disk: find out why before anything publishes.
- [ ] `took on the library already in the bucket … songs=0` (ground rule 3).
- [ ] `cloud pass complete uploaded=0 failed=0` — nothing to upload on a quiet restart,
      and never a failure.

**The public address**, from outside. `curl` on the same Mac resolves the Tailscale name
to the tailnet and proves nothing, so go in through the public ingress:

```bash
H=<your-machine>.<tailnet>.ts.net; IP=$(dig +short @1.1.1.1 $H | head -1)
curl -s --resolve $H:443:$IP -D - -o /dev/null -H 'Origin: https://xiao215.github.io' https://$H/api/health | grep -iE '^HTTP|access-control-allow-origin'
curl -s --resolve $H:443:$IP -o /dev/null -w '%{http_code}\n' https://$H/api/library          # 401
curl -s --resolve $H:443:$IP -D - -o /dev/null -H 'Origin: https://evil.example' https://$H/api/health | grep -ci access-control-allow-origin   # 0
```

- [ ] 200 with `access-control-allow-origin: https://xiao215.github.io`
- [ ] **401** without the token. This is the one that matters: a tunnel connects from
      loopback, and loopback is what skips the token.
- [ ] no CORS header for a site that is not ours.

**YouTube.** Imports fail in ways that look like bugs and are not. If one fails with
"needs a signed-in account", compare the address families before believing it:

```bash
curl -s -4 -o /dev/null -w '%{http_code}\n' 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
curl -s -6 -o /dev/null -w '%{http_code}\n' 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
```

A 302 is Google's CAPTCHA wall for that family. The server pins IPv4 for this reason.

---

## Stage 2 · The web app

The published site, in a real signed-in browser, with the server from Stage 1 running.

**First, that you are testing what you think you are:**

```js
// DevTools console on the site
fetch(document.querySelector('script[src*="index-"]').src).then(r => r.text()).then(t => console.log(t.includes('<a string only the new build has>')))
```

| Area | Do this | It is right when | Watch for |
|---|---|---|---|
| **Cold start** | Close every tab of the site, open it fresh | Library draws in a second or two; footer says `Cloud library · N songs` with the N you expect | A long "Connecting…"; an N that differs from the server's |
| **Covers and streaming** | Scroll the library; play a song you have not played on this browser | Every row has its cover; sound within ~2 s; scrubbing works | Letter tiles instead of covers = the service worker is not answering |
| **Hard refresh** | Shift-Cmd-R, then play something | Covers and playback survive | "This song is not available offline" on a song that was never offline |
| **Duplicates** | Sort by Recently added, read the top twenty rows | No song appears twice | Two rows with the same title, length and cover: the sync merged two servers |
| **Tags are what you play** | *Pick tags* → tap two tags | Count and minutes update per tap; several tags *add* songs; Play plays them | A second tag narrowing the list to nothing (that was the old filter) |
| **Save asks nothing** | With tags picked, *Save as playlist*, then **Undo** in the toast | Playlist count +1 with no dialog; −1 after Undo | A name prompt; an Undo that leaves the playlist behind |
| **Playlists grid** | Open Playlists | "N playlists · last played first"; *New playlist* tile first; each tile "5 songs · yesterday"; no empty playlist anywhere; "follows tags" badge on the ones that do | A pin, or a playlist with nothing in it |
| **A new playlist** | *New* → a name → *Add songs*; pick two → *Make playlist*. Then again, and *Cancel* at the picker | The first lands on its page with the two songs; the cancelled one exists nowhere | A playlist made at the name step, before it had a song |
| **A playlist's ⋯** | On the phone, open a playlist → ⋯ | *Download* with its size, or *Remove download* once every song is here; no pin | A download button beside Play |
| **Selection** | Tick the first song in the library | The bar takes a lane above the list; the ticked row is still readable | The bar covering the row you just ticked |
| **Tag chips on a row** | Find a song with four tags, or one very long one | Chips that fit, then `+2`; nothing cut mid-chip or over the album column | |
| **Server reach** | Open Import and Stats | The real form and real numbers, not "Your server isn't answering" | In DevTools → Network, which `api/health` answered: localhost at home, the `ts.net` address away |
| **Import: already have it** | Paste a link to a song you own, in a *different* form (`youtu.be/…` for one imported from `music.youtube.com`) → Look it up | The row says *In library* and is not counted; the button says *Import 0 songs* | A row counted as coming in: it would download a copy |
| **Import: a real one** | One short new song | Queue shows it downloading; it appears in the library here and on another device within about a minute | Stuck at 0% for more than two minutes; "needs a signed-in account" (Stage 1, YouTube) |
| **Server off** | Stop the server, open Import | It says so plainly and offers *Add when the server wakes* | A spinner that never resolves |
| **Appearance** | Drag the accent picker | Colour follows the drag with no stutter | |
| **Sign-in wall** | A private window | Sign-in page and nothing else; no library flash | Any glimpse of the app before signing in |

Do the playback rows yourself, by ear. See [What automation cannot see](#what-automation-cannot-see).

---

## Stage 3 · The desktop app

Build `main` and run *that* — `open apps/desktop/release/mac-arm64/self.mp3.app` — after
quitting the installed one. It has the same bundle id, so it opens onto the installed
app's sign-in and downloads, which makes this the upgrade test as well.

| Area | Do this | It is right when | Watch for |
|---|---|---|---|
| **Upgrade** | Launch the new build over an older install's data | Still signed in, downloads still marked, the song you were on is restored, paused | A sign-in page; every song needing download again |
| **First launch of a fresh build** | — | Can take 15–60 s once while macOS scans it | Do not mistake this for a hang |
| **Plays from disk** | Double-click a downloaded song | Time advances; works with Wi-Fi off | |
| **The not-downloaded case** | A cloud song with no green mark | Refuses, offering to download. **The desktop cannot stream from the bucket**; the web and the phone can | Silence, or a toast blaming "offline" |
| **Counts agree** | Sidebar footer vs Settings → Offline music | The same two numbers in both places — both read one shared tally since 2026-09-17 | "82 of 61 songs downloaded": the index counting songs the library no longer has |
| **Settings header** | Top of Settings | Says what this is and how many songs | "self.mp3 web · 0 songs" in the desktop app |
| **Auto-download** | Import a song from another device | It arrives *and downloads* here unasked, on Wi-Fi | |
| **Reach** | Import, Stats | As on the web | |
| **An application, not a page** | Menus, ⌘-shortcuts, media keys, close-and-reopen from the Dock, window position after relaunch | Each does what a Mac app does | Covered by `verify:desktop` except media keys and Now Playing in Control Centre, which are by hand |
| **Reveal in Finder** | Settings → Offline music → Reveal | Opens `~/Library/Application Support/self.mp3/songs` | |

---

## Stage 4 · The browser extension

Load `apps/extension/dist` unpacked (or the zip from `npm run zip:extension`).

- [ ] **Signed out, no address:** the popup says to sign in; nothing is offered that cannot work.
- [ ] **Signed in, server on:** the pill on a YouTube Music track page imports it; the popup's queue shows it; the header pill names the address it reached.
- [ ] **Signed in, server off:** the same click leaves the link in the bucket, and says so; it imports when the server next starts.
- [ ] **Already have it:** the pill on a song you own says so rather than offering it.
- [ ] There is no token field, and none is needed.

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
npx expo run:ios --configuration Release --device <udid> --no-bundler
```

The UDID is in `xcrun xctrace list devices`. The first build is 15–20 minutes, later ones
a few. It generates `apps/app/ios/`, which is ignored by git and by Prettier. The phone
must be plugged in and unlocked at the install step, or it waits on *Connecting to…*
for ever.

When iOS asks whether the app may **find devices on your local network, say no.** A user
does not need it — the library is the bucket's and the server is reached at its public
address — and denying it makes the run stricter: the phone cannot fall back on a LAN
address, so Import working at all proves the public one.

### What to check

- [ ] Sign-in through Google returns to the app, and the library's count matches the server's.
- [ ] **Streaming a song that is not downloaded**, on Wi-Fi, with automatic downloads off
      (pause the download bar at once, or it fetches everything first). The player sends
      the doorman's bearer as a track header; first confirmed working on a real iPhone on
      2026-09-17. Sound within a couple of seconds, scrubbing works, the lock screen shows
      title and cover.
- [ ] The same on mobile data asks first, once.
- [ ] Import on mobile data shows the real form, not "Your server isn't answering".
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
      artwork stays one size, the Similar songs strip keeps its place (empty for an
      instant is fine), and *Lyrics* does not flicker to *Visual*.
- [ ] **Open the Visual of a song with no lyrics, then use the app.** Taps must stay
      instant. The visual once committed the native view tree up to twenty times a frame,
      and the whole app felt slow while it was up.
- [ ] **Like a song in a list.** The pressed highlight goes the moment the finger lifts.
      A highlight that lingers means the tap's release is queued behind a re-render of
      the whole list.
- [ ] **Swipe sideways on a tab's own page** (Library, Playlists, Import, You): nothing
      happens. Swipe on a pushed page (a playlist, Settings): it goes back.
- [ ] **Pick two tags in the Library.** The songs are listed under the picker, Play /
      shuffle / Save are there, and a picked chip is filled with a ✓ while an unpicked one
      is hollow — tellable at arm's length.
- [ ] **You → Tags** is management only: rows, tap to rename or recolour, *New tag*, and
      *Pick tags to listen to*, which opens the Library with the picker down.
- [ ] **In a playlist, hold a row and drag it.** It reorders, and the order survives a
      relaunch. A playlist that follows tags does not lift — holding starts a selection.
      Rows there look exactly like the Library's: heart, tags, the accent wash on the
      playing row.
- [ ] **Remove a downloaded song from the library.** One confirmation, and it is gone from
      the phone too. The sidebar line and Settings → Offline music then show the *same*
      two numbers, both lower.
- [ ] **Remove all downloads.** The button reads *Removing…* and cannot be tapped twice.

For numbers rather than feel — frames, which thread is busy — see "Measuring performance
on a phone" in [MOBILE.md](MOBILE.md).

---

## Stage 6 · Across devices

The product is the sync, so the last stage is two devices and a stopwatch.

- [ ] Like a song on the desktop → `applied changes from other devices changes=1` in the
      server log → the heart is filled on the web after its next look. Unlike it again.
      **The server reads device logs every three minutes**, so allow up to that, not
      seconds: measured 30 s one time and 100 s the next, depending on where in the
      cycle the edit fell. An edit that has not landed after five minutes is a bug.
- [ ] Import on the web → the song is on the desktop, downloaded, without touching it.
- [ ] Edit a title on one device while the server is **off**; start the server; the edit
      lands and nothing else moves.
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

1. Open the app cold. 2. Type three letters into the library search. 3. Play a result.
4. Scrub to the middle. 5. Skip to the next song, then back. 6. Like it. 7. Open Now
Playing; look at the words or the visual. 8. Pause and walk away.

**Proves it:** time advances within two seconds of step 3; step 4 lands where you
clicked; Previous past three seconds restarts rather than going back; the like is still
there after a reload. *On the desktop with Wi-Fi off, all of it still works.*

### 2. "I found a song" — import

1. Copy a link from YouTube Music. 2. Import → paste → Look it up. 3. Fix the title if
it is ugly (open the row); add a tag. 4. Import. 5. Go back to the library and play it.

**Proves it:** the queue row goes *waiting → downloading → N added* without a refresh; the
song is at the top of Recently added here, **and on your other device, downloaded,
within a minute**; Song details shows a tempo and a key, which means analysis ran.
Then paste the same song's link in another form (`youtu.be/…`): *In library*,
*Import 0 songs*.

Use something short you do not mind having, or remove it after — journey 6.

### 3. "I'm in the mood for…" — tags into a playlist

1. Library → Pick tags → tap one tag, then a second. 2. Play. 3. Save as playlist.
4. Rename it from the toast — or Undo.

**Proves it:** the second tag makes the list *longer*, and says how many songs have both
("1 have both tags, and come first"); Save asks nothing; the playlist count goes up by one
and back down on Undo; a saved one shows *follows tags* in the grid, and tagging another
song with that tag later puts it in the playlist without anyone adding it.

### 4. "Tidy up" — organise a few songs

1. Tick three songs. 2. Tag them from the selection bar. 3. Add them to a playlist.
4. Open one song's details → Fix metadata → Find matches → pick one, or cancel.

**Proves it:** the bar sits in its own lane and never covers a ticked row; the row shows
the new tag as a chip, or as `+N` when there is no room; Find matches returns suggestions
(that is the server asking iTunes and MusicBrainz — if it spins forever the server is not
reachable and the screen should have said so).

### 5. "I'm not at home" — the server is asleep

The design's central promise: adding music must not depend on being near the server.

1. Stop the server. 2. Open Import. 3. Paste a link into *Add it anyway* → *Add when the
server wakes*. 4. Start the server.

**Proves it:** step 2 says *Your server isn't answering* and offers the form, rather than
spinning; step 3 answers *Waiting for your server*; within about ten seconds of step 4 the
server log says `[import] importing …` and the song arrives everywhere.

**And the unkind version:** stop the server *while* the Import screen is open, then press
Look it up. It must say the server stopped answering and look for it again — not
"Failed to fetch". (It said exactly that until 2026-09-17.)

### 6. "That was a mistake" — removing a song

Only ever on a song this run imported.

1. ⋯ on the row → Remove from library… → *Delete the file too*.

**Proves it:** gone here at once; the server's row count drops and the file leaves
`~/Music/selfmp3` within the three-minute log cycle; it does not come back after the next
sync. A song that reappears has been resurrected by another device's snapshot.

### 7. "New computer" — a second device joins

1. Install the desktop app on a Mac that has never run it (or launch with a fresh
`--user-data-dir`). 2. Sign in with Google.

**Proves it:** no library is visible before sign-in; after it, the whole library draws
and downloads begin unasked on Wi-Fi; the sidebar count and Settings → Offline music
agree when they finish.

### 8. "How much did I listen?" — stats

1. Play two songs past the halfway mark on one device. 2. Open Stats on another.

**Proves it:** Plays and *Time listening* moved. Stats are the server's — this is the
quickest end-to-end check that plays recorded offline are delivered.

---

## Testing as a device away from home

On the server's own Mac every app finds `http://localhost:4600` first, because addresses
are raced and the nearest wins. That is correct, and it means a preprod run from that Mac
**never touches the public address** unless it is made to. Two ways, no product changes:

**The desktop app** takes Chromium's flags. Launch the built binary with a debugging port
and with the server's public name pinned to Tailscale's public ingress (find the address
with DNS-over-HTTPS — plain `dig @1.1.1.1` fails on networks that block outside DNS):

```bash
H=<machine>.<tailnet>.ts.net
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
`window.__blocked` should list the three local addresses and `window.__server` every call
that went out through the public one — `GET /api/health` first, then the library, the
import queue, the heartbeat and `SSE /api/events`. **If `__server` is empty, the run did
not test the public address, whatever else passed.**

---

## What automation cannot see

An agent driving a browser gets most of this right and a few things reliably wrong. Know
which, or you will file bugs against the harness.

- **A background tab is not a tab.** Chrome defers all media in a hidden tab and clamps
  its timers to a second. An automated tab reports `document.visibilityState ===
  'hidden'`: nothing plays, a cold start measures at fifteen seconds that takes two by
  hand, and "the page is busy" means throttled. **Playback and timings are checked by a
  person, in a window they can see.** What automation *can* prove about playback is the
  plumbing: a range request to `api/stream/<id>` returns `206 audio/mp4`.
- **A hidden tab stops looking for the server.** React Query pauses `refetchInterval` while
  the page is not visible, so the twenty-second look-out never fires in an automated tab:
  stop the server and the Import form is still there minutes later. Reload to get a fresh
  look, and check the "unkind version" of journey 5 by pressing a button instead of waiting.
- **Several screens are mounted at once.** The router keeps earlier screens in the DOM,
  hidden, so `[data-testid^="song-row-"]` matches seventy rows of which the first is
  invisible, and a wait on it times out against an app that is working. Filter every
  locator with `:visible`.
- **A row's Play and ⋯ buttons appear on hover.** Hover the row first.
- **Typing may not land.** React Native Web inputs ignored synthetic keystrokes in a
  hidden tab; setting the value through the element's native setter and dispatching
  `input` works. If a search "does nothing", suspect this first.
- **The in-app browser pane blocks cross-host calls** (`ERR_BLOCKED_BY_CLIENT`), so the
  app can never reach a server from inside it, and it cannot register a service worker.
  Use a real Chrome.
- **`curl` from the server's own Mac** takes the tailnet route. Use `--resolve` (Stage 1).
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
M1  minor     Settings says "82 of 61 downloaded" desktop, Settings → Offline music; sidebar says 61
H1  harness   Cold start measured 15 s            hidden tab; not reproduced by hand
```

`blocker` is data loss, a security hole, or a core path (sign-in, play, import, sync)
broken on any platform. `minor` is wrong but harmless. `harness` is the test's fault, and
is written down so the next run does not rediscover it.

Say what was **not** tested as plainly as what was. "Phone: not run, no device" is a
result. A stage left out in silence reads as a stage that passed.

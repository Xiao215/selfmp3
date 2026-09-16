# Sync: the cloud holds the library

Until now the server *was* the library. Every other device was a window onto it, and when the server
slept, those windows went dark: no new songs, no edits, nothing you had not already
downloaded. This document describes where the library lives instead — a storage bucket in
the cloud that every device syncs with — and how devices stay in step without a server of
their own to ask.

Most of it is built. What is not is marked **Still to come**, at the end.

---

## The idea in one paragraph

The music, the covers, the lyrics and everything you do to them live in one cloud bucket
that belongs to your Google account. Every device keeps its own full copy of the library's
*metadata*, and decides for itself how much of the *audio* to keep: an app on a phone
downloads ahead so it works with no signal, a browser tab streams and keeps what you play.
Any device can play, edit, tag and ask for an import; each writes what it did to the
bucket, and every other device picks it up the next time it syncs. The bucket is plain
storage — no code runs there — so every rule about how changes combine lives in
`packages/shared`, and every device runs the same rules.

## The stack

| Piece | Where | Cost |
|---|---|---|
| Music, covers, lyrics, snapshots, the change log | [Backblaze B2](https://www.backblaze.com/cloud-storage) | Free up to 10 GB, no card. $0.005/GB-month past that |
| Signing in, and the bucket's key | The doorman, a [Cloudflare Worker](https://workers.cloudflare.com/) (`apps/doorman`) | Free |
| The web app | GitHub Pages, at `xiao215.github.io/selfmp3` | Free |
| Fetching YouTube links (yt-dlp) | The server; later the Android app | — |

**Why B2.** It speaks the S3 API, which the server already uses for its S3 storage driver. It
needs no card for the free tier. Uploads, downloads and listings are free API calls. Downloads
are free up to three times what you store each month — 30 GB for a full 10 GB library, which
is a great deal more listening than one person does. And it is not tied to your Google account,
so nothing that happens to the bucket can touch your email.

Google Drive was considered: more free space (15 GB, shared with Gmail and Photos), but a
proprietary API, an OAuth app that must be moved to "production" or it signs you out every
seven days, and your whole Google account on the line if a file is ever flagged. The bucket
is behind an interface, so a Drive driver can still be added later.

**Why not a server.** A server that is always on costs money. The free ones either sleep,
lose their disk (and the database with it), or can be reclaimed when idle — which a personal
music server nearly always is. And it could not import from YouTube anyway: YouTube blocks
yt-dlp from data-centre addresses, so fetching has to happen on a device on a home or mobile
connection regardless. The doorman is not that server: it keeps no library and no disk, and
song bytes stream through it without it holding them.

---

## Six rules

1. **The bucket is plain storage.** Nothing runs there. Every rule is code in
   `packages/shared`, and every device runs the same code.
2. **Files never change once uploaded.** Audio, covers and lyrics are stored under the
   SHA-256 of their bytes. Changing a song's cover uploads a new file and points the song at
   it; the old one is never overwritten. A device that has `audio/4f1c…9a.m4a` has exactly
   those bytes, forever, and can cache it forever.
3. **Each device writes only its own files.** A device's changes go in its own folder of the
   log. Two devices never write the same file, so no change is ever lost to another device
   overwriting it — which matters, because plain storage cannot tell you it happened.
4. **Done means uploaded.** An import, or an edit, counts once it is in the bucket where other
   devices can see it. Before that it is "on this device, uploading".
5. **A device keeps what it will want, not everything there is.** An installed app — the
   phone app, the desktop app — downloads ahead, because the point of it is music with no
   signal. A browser tab streams from the bucket a range at a time and keeps nothing, because
   a library of a thousand songs is not something a tab should quietly copy and a tab's
   storage is the browser's to evict. A song already on the device plays from the device: see
   `packages/client/src/downloads/recentCopies.ts` and
   `apps/app/src/ports/recentCopies.web.ts`, which hold the songs an installed app kept
   because they were played.
6. **Devices do what they are able to.** No device has a fixed role. Each does what it can —
   fetch YouTube links, analyse audio, look up lyrics — and work it cannot do waits in the
   bucket until a device that can do it picks it up. The server is special only because it can
   usually do the most.

---

## The bucket

Everything sits under one folder (a prefix, `selfmp3/` unless you choose another), so the
bucket could hold other things too.

```
selfmp3/
  format.json                        which version of this layout the bucket uses
  audio/<sha256>.<ext>               the music. Never changes.
  covers/<sha256>.<ext>              cover art. Never changes.
  lyrics/<sha256>.lrc | .txt         lyrics, timed (.lrc) or plain (.txt). Never changes.
  lyrics/<sha256>.json               the romanized lines (romaji, pinyin) of one lyric text. Never changes.
  lyrics/<sha256>.json               one song's motion curve: loudness and onsets, 20 a second. Never changes.
  snapshots/<time>-<device>.json     the whole library at one moment
  log/<device>/<seq>.json            changes, one folder per device
```

**`format.json`** says `{"app":"self.mp3","format":1,…}`. A device that finds a format number
newer than it understands refuses to write to the bucket and says why, instead of corrupting
something it cannot read.

**Snapshots** are the whole library — songs, tags, playlists — as one JSON document,
gzip-compressed. They are how a new device gets the library in one download instead of
replaying every change ever made. The key starts with a fixed-width UTC time, so the newest
snapshot is simply the last one in a listing. A writer keeps its three newest and deletes
the rest. A snapshot also carries, for each device, how far into that device's log it has
been folded in (`upTo`), so a device replays only what comes after.

**Log files** are one batch of one device's changes: `log/<device>/000000000042.json`. A
device numbers its files 1, 2, 3, … and never writes the same number twice with different
contents, so a file, once written, never changes and a resend is harmless. A device tidies
its own files away once a snapshot has folded them in.

**Identity.** Songs, tags and playlists each get a `uid`: 32 random hex characters, made by
whichever device creates the thing. Each device's own database keeps its integer ids as
local handles, but they never leave the device — SQLite reuses integer ids after a delete,
and two devices would hand out the same number on the same day. A song's `uid` is its
identity; its audio's SHA-256 is the identity of the *file*, which can change (a better
upload of the same song) while the song stays the same song.

The schemas for all of this are in `packages/shared/src/schemas/cloud.ts` and
`packages/shared/src/schemas/sync.ts`; the key helpers are in `packages/shared/src/cloud.ts`.

---

## Signing in: the doorman

The bucket's key must not sit on a phone, and a phone should not have to be handed one. So
between every device and the bucket there is **the doorman** (`apps/doorman`): a small
Cloudflare Worker that signs you in with Google, keeps the one bucket that belongs to your
Google account with its key sealed, and passes a signed-in device's reads and writes through
to it. No device ever holds the key. Only the Google addresses on its list may sign in.

**One Google account, one bucket.** You connect the bucket once, from any device; every
device you sign in on afterwards gets the same library. Someone else — a friend — signs in
with their own Google account and connects a bucket of their own; nothing is shared.

**Signing in** leaves the app for Google and comes back. Where it comes back to depends on
the device: the same tab on a computer, and on an iPhone home-screen app a sheet with storage
of its own. So the device makes an attempt id, remembers it, and afterwards claims the
session with **the code the doorman shows** once Google is done — read from the address it
comes back to, or typed in from the sheet. Starting a sign-in is not enough to claim it: a
link someone else sends you gets them nothing, because they never see your code, and one
wrong guess ends the attempt.

Deploying it, and what each setting means, is in [apps/doorman/README.md](../apps/doorman/README.md).

---

## What is built

### The server publishes the library

*Settings → Cloud* on the server signs in with Google through the doorman, and then asks for the
bucket if the account has none. (With no doorman set up, a bucket can still be connected
directly with its key, as the way in.)

The cloud sync service (`apps/server/src/services/cloudSync.ts`) goes through every song whose
file is present and uploads what the bucket does not have: the audio, hashed as it is read and
uploaded under its hash — skipped if the bucket already has that file — the cover, and the
lyrics from the song's `.lrc`/`.txt` sidecar or else the audio file's own tags. Beside Chinese or
Japanese lyrics go their romanized lines, a JSON list with one line per line of the words, made
here (romaji needs a dictionary only the server has) and named in the snapshot's lyrics entry, so a
device signed in to the cloud shows them exactly as a device talking to the server does.

A table, `cloud_songs`, remembers what was uploaded for each song and from which state of it,
so a rescan, a restart or a tag edit does not re-hash two thousand files. That bookkeeping is
checked against the bucket's own listing on the first pass after connecting or starting up,
and whenever you press *Publish now*: a file the bucket has lost is forgotten, and its song
goes up again.

After uploading, the server writes a snapshot. It lists only songs whose audio is in the bucket —
a song still uploading is not in the library yet, as far as any other device is concerned.
Passes run at startup, a few seconds after anything changes, when another device has written
something, and on demand. An import is not done until its song is in a snapshot.

### A server joining a bucket that already has a library

For a long time the server only ever *wrote* snapshots. That is the right shape for exactly one
server — the one that filled the bucket — and the wrong shape for every other, and the difference
is not academic: a fresh install signed in to an account holding 52 songs, published its empty
library as the whole library, and every device followed it within seconds. The audio survived,
because nothing deletes from the bucket; the index did not.

So a server that connects to a bucket now reads the newest snapshot **before it publishes
anything**, and takes on every song in it that it does not already have
(`apps/server/src/services/cloudAdopt.ts`).

| | |
|---|---|
| **When** | Once per bucket, on the first pass after connecting, signing in, or starting up — and again when you press *Publish now*, which starts over. Nothing is published until it has finished, an import's own publish included. |
| **What it makes** | A whole song row per song: uid, title, artist, album, year, track, duration, loved, play and skip counts, when it was added and last played, where it came from, its tags, its place in each manual playlist, its analysed features, its cover's colour, and the per-field stamps that decide how a later edit combines with it. Tags and playlists it does not have, likewise. The bucket's file keys go into `cloud_songs`, so publishing re-emits the song it was handed instead of uploading files that are already up there. |
| **`missing`** | Set on every adopted song: the audio is in the bucket, not on this disk. That is what the column has always meant. |
| **Matching** | By uid, always. A song already here under the same uid is left exactly as it is, field for field — a snapshot is not a change with a stamp, so it must never win an edit; anything genuinely later still arrives through the other device's log. Ten of the bucket's fifty-two here ends at fifty-two, not sixty-two, and a second run adopts nothing. |
| **A song the bucket has no audio for** | Gets its row — its tags, its plays and its place in a playlist are all still true — but nothing in `cloud_songs`, so it is left out of what this server publishes. No device is ever pointed at a file it cannot download. |
| **When it cannot read the bucket** | It stops, and publishes nothing. "I could not read the library" must never come out the far side as "there is no library": that is the reading that publishes over it. |
| **`SELFMP3_PUBLISH_ANYWAY=1`** | Skips adoption as well as the guard below. It is how you say *this server's library is the one I want everywhere*, and merging the bucket's in first would be the opposite of that. |

**What is not adopted.** The snapshot's `upTo` cursors: this server reads every log file from the
beginning on its first pass instead. Replaying is idempotent by design — plays and skips are
deduplicated by id, edits by stamp — and a device tidies its log away once a snapshot has folded
it in, so there is usually nothing there to replay. Adopting a cursor would mean skipping a change
on the strength of a snapshot whose songs this server may have *declined* to overwrite. Requests
to import a link are not adopted either; they are the last week's, and the devices that made them
say how they went.

**What adoption cannot see.** A library restored from a disk backup with no database is scanned
into fresh uids, and the bucket's songs are then a second set of rows under different uids: 52
adopted beside 52 scanned. Uid is the only identity the bucket has, and guessing that two songs
are one on the strength of their names would be a worse failure than the duplicate. Restore the
database with the folder, or let adoption bring the files down instead of copying them by hand.

**Then the files come down.** Behind the pass, one song at a time, the audio, cover and lyrics of
every adopted song are fetched into the library folder
(`apps/server/src/services/cloudRestore.ts`) and the song stops being missing. It never blocks a
pass — a big library is hours of downloading and everything else has to carry on — and stopping it
costs nothing: the queue is a query over `missing` rows with a `cloud_songs` entry, not a cursor,
and a song leaves it only when its files are on disk. Every step asks the disk first, so resuming
re-downloads nothing and a second run over a finished library downloads nothing at all. The cloud
panel says how many are left and which one is coming down.

Two things it deliberately does **not** do. It does not fetch a song whose file this server once
had and has lost — an unplugged drive is not an invitation to re-download a library, and the two
are told apart by whether the row was ever scanned. And it does not verify what arrives against
the hash in its key: the bucket names files by their SHA-256 and B2 checks the transfer, so this
would only catch a bucket lying to itself.

**What a scan does to an adopted song: nothing.** A scan marks a song whose file is not there
missing rather than deleting it — that rule was already there, so that an unplugged drive does not
cost you a play history — and an adopted song is missing already. A file that lands at its path,
from the fetching above or dropped in by hand, is matched to it by path and becomes that song, with
its tags and counts intact. *Settings → Forget missing songs* leaves them alone too: they are a
library being restored, not a library that is gone.

### Every device reads the bucket

The app's web export builds for GitHub Pages (under `/selfmp3/`, which the Pages workflow
passes as `EXPO_PUBLIC_BASE`), with no server behind
it. It signs in with Google, connects the account's bucket if no device has yet, and shows the
library from the newest snapshot. The service worker (`apps/app/sw/sw.ts`) stands between the
player and the bucket: a song already on the device is served from there, ranges and all, and
one that is not is streamed from the bucket through the doorman, which passes `Range` straight
to B2 and its `206` straight back. Nothing is kept on the way past, and a tab keeps nothing
afterwards either. In an installed app — the desktop app, the phone — a song listened to all
the way through is kept, up to a budget, oldest let go first, unless that device is
downloading everything anyway; a song downloaded by hand is kept for good.

### Editing from anywhere

Every device can edit the library, not only the server. An edit is a small change — a song's
fields, a tag put on or taken off, a song added to a playlist, a play — written to the editing
device's own log, and replayed by every other device.

**Order** comes from a hybrid logical clock (`packages/shared/src/hlc.ts`): wall-clock time,
moved past any later stamp the device has seen, with the device id breaking ties. A phone
whose clock runs fast cannot make its edits win forever: every device that sees one of its
changes moves its own clock past it.

**How changes combine** (`packages/shared/src/sync.ts`), and every device runs exactly this:

| Data | Rule |
|---|---|
| Audio, covers, lyrics | Files never change, so there is nothing to combine. A song points at a file; the latest pointer wins. |
| Song fields, loved, tag names and colours, playlist names and rules | The change with the latest stamp wins, per field. Editing the title on the phone and the artist on the server keeps both. |
| A tag on a song, a song in a playlist | The latest of "on" and "off" wins, so a tag taken off after it was put on stays off. |
| Playlist order | The latest order wins; songs it does not mention keep their place after the ones it does, so reordering an old view never drops a song another device added. |
| Plays and skips | Only ever added. The same one twice counts once. |
| New tags and playlists | The device makes the `uid`, so a playlist can be made offline and have songs added to it before any other device has heard of it. A tag made twice under one name on two devices becomes one tag, and the second uid still finds it. |
| Deleting | For good: a change to something that is not there is ignored, so a late edit never brings back a deleted playlist. The files stay in the bucket. |

Because the latest stamp wins whenever a change is applied, the same changes give every device
the same library, in whatever order they arrive. Snapshots carry the stamp of anything a change
ever set, so a change that arrives late combines with them correctly.

The server folds other devices' logs into its database on every pass, following the same rules
(`apps/server/src/services/cloudIngest.ts`), and publishes a snapshot saying how far it has
read. A test runs one set of changes of every kind through both, and expects the same library.
A song removed on another device takes its file from the server's library folder too — left there,
the next scan would add it back as a new song — and the bucket keeps its audio.

Live playlists are worked out on the device (`packages/shared/src/smartRules.ts`), the same
rules the server compiles to SQL, so a playlist of loved songs gains a song the moment it is loved
on a phone with the server asleep.

### Importing from anywhere

Importing is two steps. *Getting the audio* needs yt-dlp for a link, which only some devices
have. *Adding it to the library* works anywhere.

| Device | Import a link |
|---|---|
| Server | Yes, itself |
| iPhone, iPad, any browser | Asks the server, through the bucket |
| Android app | Later (still to come) |

A link pasted in the web app becomes an `importRequested` change in that device's log, with
the tags and playlist to put what it brings in. The server reads it with the rest of the log,
looks the link up — one song, or a whole playlist — queues what the library does not have
already, and downloads it as any other import. Every snapshot says how each request from the
last week went: waiting for a device that can fetch, downloading, added, failed with the
reason, or called off.

### Reaching the server for what only it can do

Some things are the server's and cannot be anyone else's. It runs yt-dlp, so importing is
its. It keeps `play_events`, so the stats are its — a snapshot says a song has been played
41 times, never *when*, so there is no history in the bucket to work a streak or a chart
out of. It asks iTunes and MusicBrainz and downloads the cover you pick, so metadata polish
is its.

A device signed in to the cloud reaches it directly. Every snapshot carries the addresses
the server listens on and the token (`CloudServerSchema`); a screen that needs the server
probes them all at once and talks to the first that answers, and looks again every twenty
seconds so a server switched on is found without a tap. Nothing is typed, and there is no
"connect to a server" screen — that was removed on purpose.

**This is also how the server is locked.** It listens on every interface, because that is
what makes those addresses real, and so anyone else on the Wi-Fi can reach the port. The
token is what separates them from your phone, and the snapshot is what hands your phone the
token — a channel the doorman already guards with your Google account, so proving who you
are to Google is what gets you the key. The server makes one for itself on the first boot
that finds none rather than waiting to be configured
(`apps/server/src/repositories/auth.ts`), because an optional lock is an open door.

When no address answers the screen is still drawn, and says why in its own words: not
answering, or never having said where it is. **A feature that is simply not drawn is
indistinguishable, from where the user sits, from one that does not exist** — which is what
Stats, the metadata lookup and the untagged inbox all looked like for months.

| Screen | Needs the server for | When it is away |
|---|---|---|
| Import | reading a link, playing a song before it is added, downloading it | says so, keeps looking |
| Stats (Overview and Report) | every play ever recorded | says so, keeps looking |
| Fix metadata… | iTunes, MusicBrainz, and writing the correction | says so, keeps looking |
| Settings › Devices | the device list | shows the last list it was given, marked offline |
| Devices, handoff, remote control | presence itself: a heartbeat and an open stream | says so in the sheet, and keeps looking while the app is in use |
| Untagged | *nothing* — it is a pass over the library, and tagging is an ordinary edit | always works |

**Two libraries, two sets of numbers.** The bucket names songs by uid; the server numbers
them its database's way, and a device numbers them as uids arrive
(`snapshotToLibrary`). So an answer from the reached server is about songs under ids that
mean nothing on the device: a play in the stats is song 812 there and song 47 here.
`GET /api/cloud/uids` is one library's list of `{ id, uid }` pairs, and **both sides
answer it** — the server from its `songs` table, a device from its snapshot. Two of them
make the translation, both ways (`packages/client/src/connection/serverIds.ts`). Without
it the stats would light up whichever song happened to hold that number here, and a
metadata correction would land on the wrong song.

A song only one side has simply has no translation, which is the honest answer: the cover
is left off the line and it does not play, and the metadata dialog says the server does not
have this song yet.

### Presence from a cloud library

Every other screen asks the server a question and is done. Presence is not a question: it is
a heartbeat every ten seconds and a stream held open for as long as the app runs. Two things
had to be decided for a cloud library to take part in it.

**How hard to look, and for how long.** Looking is the expensive half — a connection opened
to every address the server named at once, each held until it times out, for a server that
with a cloud library is usually away. Holding is the cheap half: one idle socket and a small
POST six times a minute. So they get different answers. A device looks only while it is in
use — in the foreground, or playing, in which case it is awake anyway — and once a minute
rather than three times, and not at all while the stream is up, because a stream that is
open is a better liveness signal than a probe and a free one. A stream that is already open
is never dropped for the app being in the background: the whole point of "play on my phone"
is a phone nobody is looking at. (On a phone the OS suspends a backgrounded app that is not
playing regardless, which stops the beats without anyone deciding to; this only declines to
go hunting again until the app is back.) `apps/app/src/features/devices/usePresenceServer.ts`
is that decision, written down.

**Whose numbers travel.** A handoff carries song ids, and a cloud device numbers songs its
own way — the same song is 47 on a phone, 812 on the server and 3 on a laptop that synced in
a different order. **The wire speaks the server's numbering.** A cloud device translates into
it on the way out and back on the way in, through the same uid table the stats use; a device
talking to its own server translates nothing, because its ids already are the server's. Two
cloud devices therefore agree without either knowing the other exists: both pass through the
same third numbering.

A song that cannot be translated is never guessed at. A state whose song the other side has
never been given is blanked — the device is still there, still playing, it just cannot say
what — and a command that cannot be expressed is refused rather than sent, because a handoff
that lands on the *wrong* song is silent and there is no version of that better than doing
nothing. The sheet draws those rows disabled with the reason beside them.
`packages/client/src/devices/translate.ts`, and its test walks a handoff between three
libraries that deliberately number different songs the same.

---

## Still to come

- **Adding a file from a device.** Uploading audio from a phone or a browser, for a library
  with no server at all.
- **Android fetches links itself**, with a native module wrapping
  [youtubedl-android](https://github.com/yausername/youtubedl-android) — the library the Seal
  app is built on. It comes after the native app has been built at all, and only once it is
  confirmed to handle YouTube's JavaScript challenge.
- **Tidying up**: snapshots written from the log, so a new device replays only recent changes;
  files no song points at, deleted after 30 days.
- **A Google Drive driver**, if it is ever wanted.

## What this gives up

- **Handoff and remote control still need the server awake.** A bucket cannot hold a
  connection open between two devices, so this is the one thing a cloud library cannot do
  from the bucket alone. What it *can* do is find the server the way every other screen
  does and hold presence against it — see "Presence from a cloud library" below — so a
  phone and a laptop that both read the bucket hand playback to each other whenever the
  server is within reach. When it is not, the devices sheet says so rather than listing
  nothing forever.
- **Other devices see a change on their next sync**, not instantly: when the app opens, comes
  back to the foreground, or the next time the library is asked for.
- **Some things still need the server**: looking metadata up, the stats, and searching inside
  lyrics. The screens that need it reach for it and say so when it is away, rather than
  hiding — see "Reaching the server for what only it can do" above.
- **Importing does not**, though only the server can fetch a link. Near it, the whole import
  screen works: what a link holds, a song played before it is added, the download. Away from
  it, the link goes into the bucket with its tags and its playlist, and the server takes it
  the next time it is awake — rule 6, and the reason a device never has to be anywhere in
  particular to add a song. What is lost while away is the looking, not the importing.
- **Space.** 10 GB free is roughly 2,000–2,500 songs.

---

## Setting up

### 1. The bucket

1. Sign up for **B2 Cloud Storage** at [backblaze.com](https://www.backblaze.com/sign-up/cloud-storage).
   No card is needed.
2. **Create a bucket.** Private. Any name — bucket names are global across B2, so something
   like `selfmp3-<yourname>`. Default encryption on is fine; leave Object Lock off.
3. **Lifecycle settings → "Keep only the last version of the file".** B2 keeps every version
   of every file by default, so deleted snapshots would go on counting against your 10 GB.
4. **Application Keys → Add a New Application Key.** Allow access to this bucket only, *Read
   and Write*. Copy the `keyID` and `applicationKey` — the second is shown only once.
5. The bucket's page shows its **Endpoint**, like `s3.us-west-004.backblazeb2.com`. The
   region (`us-west-004`) is worked out from it.

### 2. The doorman

Follow [apps/doorman/README.md](../apps/doorman/README.md): a free Cloudflare account, a KV
namespace, a Google OAuth client, three secrets, and `npx wrangler deploy`. It ends with an
address like `https://selfmp3-doorman.<your-subdomain>.workers.dev`.

The doorman is deployed **by hand**. No workflow deploys it, so a change to `apps/doorman`
reaches your devices only when you run `npx wrangler deploy` yourself.

Then tell the apps about it: set `DEFAULT_DOORMAN_URL` in `packages/shared/src/cloud.ts`, or
the repository variable `DOORMAN_URL` for the web app and `SELFMP3_DOORMAN_URL` for the server.

### 3. The web app

Every push to `main` builds it and publishes it to GitHub Pages
(`.github/workflows/pages.yml`). Nothing to do but push.

### 4. Each device

Open self.mp3, sign in with Google, and — the first time, on any device — paste the bucket's
endpoint, name, key ID and key. The key goes to the doorman, sealed; no device keeps it. On
the server that is *Settings → Cloud*; everywhere else it is the first thing the app asks for.

---

## Where the code lives

| What | Where |
|---|---|
| The bucket layout, snapshots, changes and log files | `packages/shared/src/schemas/cloud.ts`, `packages/shared/src/schemas/sync.ts`, `packages/shared/src/cloud.ts` |
| When a change was made | `packages/shared/src/hlc.ts` |
| How changes combine, for every device | `packages/shared/src/sync.ts` |
| Live playlists on a device | `packages/shared/src/smartRules.ts` |
| The doorman | `apps/doorman/` (`src/auth.ts`, `src/signin.ts`, `src/files.ts`, `src/bucket.ts`), `apps/doorman/README.md` |
| The doorman's contract | `packages/shared/src/schemas/doorman.ts` |
| Talking to the bucket, from the server | `apps/server/src/bucket/store.ts` (S3), `apps/server/src/bucket/doorman.ts` (through the doorman) |
| Uploading, publishing, and reading other devices' logs | `apps/server/src/services/cloudSync.ts`, `apps/server/src/services/cloudSnapshot.ts` |
| Taking on the library already in a bucket, and fetching its files | `apps/server/src/services/cloudAdopt.ts`, `apps/server/src/services/cloudRestore.ts` |
| Applying other devices' changes to the server | `apps/server/src/services/cloudIngest.ts`, `apps/server/src/services/localEdits.ts`, `apps/server/src/repositories/sync.ts` |
| Links other devices ask the server to import | `apps/server/src/services/cloudImports.ts`, `apps/server/src/repositories/importRequests.ts` |
| The schema: uids, stamps, requests | `apps/server/src/db/migrate.ts` (the `uid` columns, `sync_stamps`, `import_requests`) |
| The server's cloud API and settings | `apps/server/src/routes/cloud.ts`, `apps/app/src/features/settings/CloudPanel.tsx` |
| A device's own copy of the library, and its outbox | `packages/replica/src/library.ts`, `replay.ts`, `edits.ts`, `routes.ts` |
| Signing in, and out, on a device | `apps/app/src/features/signIn/SignInScreen.tsx`, `apps/app/src/features/settings/signOut.ts`, `packages/replica/src/session.ts`, `apps/app/src/ports/cloudPlatform.web.ts` |
| Finding the server from a cloud library, and what each screen says when it is away | `packages/client/src/connection/reach.ts`; `apps/app/src/connection/useServerDirect.ts`, `ServerAway.tsx`; `apps/server/src/services/addresses.ts` |
| Importing through the reached server | `apps/app/src/features/import/ImportViaServer.tsx`, `importSource.ts` |
| Stats and the Report through the reached server | `apps/app/src/features/stats/StatsViaServer.tsx`, `statsSource.ts` |
| Fixing metadata through the reached server | `apps/app/src/features/metadata/FixMetadata.tsx`, `metadataSource.ts` |
| Lining the two libraries' song ids up by uid | `packages/client/src/connection/serverIds.ts`, `apps/app/src/connection/useServerSongIds.ts`; `GET /api/cloud/uids` in `apps/server/src/routes/cloud.ts` and `packages/replica/src/routes.ts` |
| Presence, handoff and remote control from a cloud library | `apps/app/src/features/devices/usePresenceServer.ts`, `DevicesProvider.tsx`, `DevicesSheet.tsx`; `packages/client/src/devices/translate.ts` |
| Publishing the web app | `.github/workflows/pages.yml` |
| Tests | `packages/shared/src/sync.test.ts`, `hlc.test.ts`, `smartRules.test.ts`, `apps/server/src/services/cloudIngest.test.ts` (the server and the shared rules held to the same answers), `cloudSync.test.ts`, `cloudImports.test.ts`, `packages/replica/src/edits.test.ts`, `apps/doorman/src/*.test.ts` |

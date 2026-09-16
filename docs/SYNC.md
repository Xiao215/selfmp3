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

The **Cloud** section of the server's own page, on `:4600`, signs in with Google through the
doorman and then asks for the bucket if the account has none. (With no doorman set up, a
bucket can still be connected directly with its key, as the way in.) That page is the
server's setup and status — the library count, the Cloud section, *Publish now* — and not
somewhere to listen: the server is a worker that fills the bucket, and the bucket is what
every device reads.

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

- **Handoff and remote control** need a live connection between devices, which a bucket
  cannot provide. They are `/api/devices` on the server, and a device reading the bucket has
  nowhere to send its heartbeat, so they are in the same position as Stats below: built and
  running, with nothing asking.
- **Other devices see a change on their next sync**, not instantly: when the app opens, comes
  back to the foreground, or the next time the library is asked for.
- **Some things still need the server**: Stats, the Untagged inbox, looking metadata up,
  romaji and pinyin, searching inside lyrics, and fetching links. The app hides them rather
  than offering what it cannot do, and since every surface now reads the bucket, **they are
  not reachable from any of them today**. Fetching links is the exception and works: the
  Import screen reaches the server directly, by the addresses in its own snapshot. The rest
  are routes the server still serves over `/api` with nothing left to ask for them.
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
(`.github/workflows/pages.yml`). Nothing to do but push. `xiao215.github.io/selfmp3` is
where you listen in a browser — the server does not serve the app.

### 4. Each device

Open self.mp3, sign in with Google, and — the first time, on any device — paste the bucket's
endpoint, name, key ID and key. The key goes to the doorman, sealed; no device keeps it. On
the server that is the *Cloud* section of its page on `:4600`; everywhere else it is the
first thing the app asks for, and the only thing: there is no server address to type on any
device.

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
| Applying other devices' changes to the server | `apps/server/src/services/cloudIngest.ts`, `apps/server/src/services/localEdits.ts`, `apps/server/src/repositories/sync.ts` |
| Links other devices ask the server to import | `apps/server/src/services/cloudImports.ts`, `apps/server/src/repositories/importRequests.ts` |
| The schema: uids, stamps, requests | `apps/server/src/db/migrate.ts` (the `uid` columns, `sync_stamps`, `import_requests`) |
| The server's cloud API and settings | `apps/server/src/routes/cloud.ts`, `apps/app/src/features/settings/CloudPanel.tsx` |
| A device's own copy of the library, and its outbox | `packages/replica/src/library.ts`, `replay.ts`, `edits.ts`, `routes.ts` |
| Signing in, and out, on a device | `apps/app/src/features/signIn/SignInScreen.tsx`, `apps/app/src/features/settings/signOut.ts`, `packages/replica/src/session.ts`, `apps/app/src/ports/cloudPlatform.web.ts` |
| Importing from a device — through the server, reached by the addresses in its snapshot | `apps/app/src/features/import/ImportViaServer.tsx`, `useServerDirect.ts`, `importSource.ts`; `packages/client/src/connection/reach.ts`; `apps/server/src/services/addresses.ts` |
| Publishing the web app | `.github/workflows/pages.yml` |
| Tests | `packages/shared/src/sync.test.ts`, `hlc.test.ts`, `smartRules.test.ts`, `apps/server/src/services/cloudIngest.test.ts` (the server and the shared rules held to the same answers), `cloudSync.test.ts`, `cloudImports.test.ts`, `packages/replica/src/edits.test.ts`, `apps/doorman/src/*.test.ts` |

# Sync: the cloud holds the library

Until now the Mac *was* the library. Every other device was a window onto it, and when the Mac
slept, those windows went dark: no new songs, no edits, nothing you had not already
downloaded. This document describes where the library lives instead — a storage bucket in
the cloud that every device syncs with — and how devices stay in step without a server of
their own to ask.

It is the design for several pieces of work. What is built so far is marked **Built**; the
rest is the plan, in the order it will be done.

---

## The idea in one paragraph

The music, the covers, the lyrics and everything you do to them live in one cloud bucket.
Every device keeps its own full copy of the library's *metadata*, and downloads the *audio*
it wants to keep. Nothing plays until it is on the device. Any device can import, edit, tag
and play; each writes what it did to the bucket, and every other device picks it up the next
time it syncs. The bucket is plain storage — no code runs there — so every rule about how
changes combine lives in `packages/shared`, and every device runs the same rules.

## The stack

| Piece | Where | Cost |
|---|---|---|
| Music, covers, lyrics, snapshots, the change log | [Backblaze B2](https://www.backblaze.com/cloud-storage) | Free up to 10 GB, no card. $0.005/GB-month past that |
| The web app | GitHub Pages, at `xiao215.github.io/selfmp3` | Free |
| Fetching YouTube links (yt-dlp) | The Mac; later the Android app | — |

**Why B2.** It speaks the S3 API, which the server already uses for its S3 storage driver. It
needs no card for the free tier. Uploads, downloads and listings are free API calls. Downloads
are free up to three times what you store each month, which fits a download-once design
exactly: each device fetches each song once, ever. And it is not tied to your Google account,
so nothing that happens to the bucket can touch your email.

Google Drive was considered: more free space (15 GB, shared with Gmail and Photos), but a
proprietary API, an OAuth app that must be moved to "production" or it signs you out every
seven days, and your whole Google account on the line if a file is ever flagged. The bucket
is behind an interface, so a Drive driver can still be added later.

**Why not a server.** A small server that is always on costs money. The free ones either
sleep, lose their disk (and the database with it), or can be reclaimed when idle — which a
personal music server nearly always is. And it could not import from YouTube anyway: YouTube
blocks yt-dlp from data-centre addresses, so fetching has to happen on a device on a home or
mobile connection regardless.

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
5. **Nothing plays until it is on the device.** Tapping a song that is not downloaded fetches
   it first, then plays it from the device. Streaming from the bucket is not a thing.
6. **Devices do what they are able to.** No device has a fixed role. Each says what it can
   do — fetch YouTube links, analyse audio, look up lyrics — and work waits in the bucket
   until a device that can do it picks it up. The Mac is special only because it can usually
   do the most.

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
  snapshots/<time>-<device>.json     the whole library at one moment
  log/<device>/<seq>.jsonl           changes, one folder per device          (milestone 2)
```

**`format.json`** says `{"app":"self.mp3","format":1,…}`. A device that finds a format number
newer than it understands refuses to write to the bucket and says why, instead of corrupting
something it cannot read.

**Snapshots** are the whole library — songs, tags, playlists — as one JSON document,
gzip-compressed. They are how a new device gets the library in one download instead of
replaying every change ever made. The key starts with a fixed-width UTC time, so the newest
snapshot is simply the last one in a listing. A writer keeps its three newest and deletes
the rest.

**Identity.** Songs, tags and playlists each get a `uid`: 32 random hex characters, made by
whichever device creates the thing. Each device's own database keeps its integer ids as
local handles, but they never leave the device — SQLite reuses integer ids after a delete,
and two devices would hand out the same number on the same day. A song's `uid` is its
identity; its audio's SHA-256 is the identity of the *file*, which can change (a better
upload of the same song) while the song stays the same song.

The schemas for all of this are in `packages/shared/src/schemas/cloud.ts`; the key helpers are
in `packages/shared/src/cloud.ts`.

---

## Milestone 1 — songs reach the cloud

### Built: the Mac uploads the library

**Connecting.** *Settings → Cloud* on the Mac takes the bucket's endpoint, its name, and an
application key. The key is tested — list, write, read back — before it is saved, so "wrong
key" and "wrong bucket" are different messages. It is stored in the `secrets` table, which
the settings API can never return.

**Uploading.** The cloud sync service (`apps/server/src/services/cloudSync.ts`) goes through
every song whose file is present and uploads what the bucket does not have:

- the audio, hashed as it is read and uploaded under its hash — skipped if the bucket already
  has that file, so re-connecting to a bucket, or two songs with identical audio, cost nothing;
- the cover, if the song has one;
- the lyrics, from the song's `.lrc`/`.txt` sidecar or else from the audio file's own tags.

A table, `cloud_songs`, remembers what was uploaded for each song and from which state of it —
the audio file's size and modification time, the cover's revision, the sidecar's size and
modification time. So a rescan, a restart, or a tag edit does not re-hash two thousand files:
only a song whose file actually changed is looked at again.

That bookkeeping is checked against the bucket's own listing — a thousand files to a request —
on the first pass after connecting or starting up, and whenever you press *Publish now*. A file
the bucket has lost (deleted by hand in the provider's console, or the bucket made again under
the same name) is forgotten, and its song goes up again. An emptied bucket is filled back in,
`format.json` and all.

**Publishing.** After uploading, the Mac writes a snapshot. It lists only songs whose audio is
in the bucket — a song still uploading is not in the library yet, as far as any other device
is concerned. Smart playlists go in with their rules (tag references rewritten to tag `uid`s)
*and* their current song list, so a device that cannot evaluate rules still shows them right.

**When it runs.** At startup, once the first scan is done, and a few seconds after anything in
the library changes — an import, a scan, an edit — so a burst of changes becomes one snapshot.
If the bucket cannot be reached, it tries again after one minute, then two, five, fifteen, and
every thirty. *Settings → Cloud* shows progress, what is uploaded ("212 of 214 songs · 1.1
GB"), and the last error.

Making the uid trigger safe needed one change to an old trigger: the search index's update
trigger now fires only when a title, artist or album changes. Before, every update to a song —
every play — rewrote its search entry; and fired by the uid trigger for a brand-new song, it
would have deleted a search entry that did not exist yet, which corrupts an FTS5 index.

**Importing.** An import has a new last step, *Uploading*. The job is not done until its song
is in a snapshot in the bucket. If the upload fails — the Mac is offline — it is retried like
any other failed step; if it still cannot, the job says "Saved on this Mac, but not uploaded
yet", and the background sync uploads it and marks the job done by itself when the connection
comes back. Retrying the job never downloads the song again.

With no bucket connected, nothing about importing changes.

### Next: devices read the bucket

- The web app builds for GitHub Pages (`/selfmp3/` base path, service worker scope, router
  basename, a `404.html` copy of `index.html` for deep links, the security policy as a
  `<meta>` tag since Pages cannot send headers).
- A device joins by pasting a pairing code the Mac shows — the bucket's details and a
  *read-only* key, created in B2 for devices. On an iPhone, Universal Clipboard makes that a
  copy on the Mac and a paste on the phone.
- It downloads the newest snapshot, shows the library, and says "212 songs · 0 on this device
  · Download all (1.1 GB), or pick playlists". Downloads go to the Cache API as they do now.

---

## Milestone 2 — edit and import from anywhere

Each device appends its changes to its own log, `log/<device>/<seq>.jsonl`. Every device reads
every log and replays the changes in order into its own copy of the library. Because everyone
applies the same changes with the same rules, everyone ends up with the same library.

**Order** comes from a hybrid logical clock: wall-clock time, nudged forward whenever a device
sees a change stamped later than its own clock, with the device id breaking ties. A phone
whose clock runs fast cannot make its edits win forever.

**How changes combine:**

| Data | Rule |
|---|---|
| Audio, covers, lyrics | Files never change, so there is nothing to combine. A song points at a file; the latest pointer wins. |
| Plays | Only ever added. The same play id twice counts once, as the play outbox already does. |
| A tag on a song | Adding and removing are separate changes; a later add beats an earlier remove, and the other way round. |
| Song fields, loved, tag names and colours, smart playlist rules | The latest change wins, per field. Editing the title on the phone and the artist on the Mac keeps both. |
| New tags and playlists | The device makes the `uid`, so a playlist can be created offline and have songs added to it before any other device has heard of it. |
| Playlist order | Each entry carries a position key that sorts between its neighbours, so two devices inserting at once never collide. |
| Deleting a song | A "removed" change. The files stay in the bucket for 30 days before they are cleaned up. |

All of it is one pure function in `packages/shared` — `applyChange(library, change)` — used by
the Mac, the web app and the native app alike, and tested like the queue rules are.

**Importing from any device.** Importing is two steps. *Getting the audio* needs yt-dlp for a
link, which only some devices have. *Adding it to the library* — upload the file, write a
`songAdded` change — works anywhere.

| Device | Import a file it has | Import a YouTube link itself |
|---|---|---|
| Mac | Yes | Yes |
| Android app | Yes | Yes, later (milestone 3) |
| iPhone app | Yes | No — writes an import request instead |
| Browser, any computer | Yes | No — writes an import request instead |

An import request is a change like any other:

```
importRequested  {requestId, url, tags, playlist}    any device
importClaimed    {requestId, by}                     a device that can fetch; lapses after ~30 min
songAdded        {uid, audio, source, requestId, …}  written only after the file is uploaded
importFailed     {requestId, reason}                 everyone sees why
```

Two devices that claim the same request at once both do the work; the first `songAdded` for
that source wins and the other file is cleaned up. No locking needed, and the worst case is a
few wasted minutes.

Tempo and key, lyrics and covers never hold an import up. The importing device does what it
can; anything missing becomes a request that a capable device fills in later. A song imported
from an iPhone gets its tempo when the Mac next wakes.

**Web app** — every `/api/...` call becomes a read or write against the bucket and the local
copy. Smart playlists and stats move from SQL on the Mac to code that runs on the device;
at a few thousand songs that is fast.

---

## Milestone 3 — Android fetches links itself

A native module wrapping [youtubedl-android](https://github.com/yausername/youtubedl-android)
— the library the Seal app is built on, which bundles Python and yt-dlp and can update yt-dlp
itself. It comes after the native app has been built at all, and only once it is confirmed to
handle YouTube's JavaScript challenge, which since late 2025 needs a JavaScript runtime.

## Milestone 4 — tidying up

- Snapshots written from the log, so a new device replays only recent changes.
- Files no song points at, deleted after 30 days.
- A Google Drive driver, if it is ever wanted.

---

## What this gives up

- **Handoff and remote control** need a live connection between devices, which a bucket
  cannot provide. They keep working when the Mac is reachable over Tailscale, as today.
- **Other devices see a change on their next sync**, not instantly: when the app opens, comes
  back to the foreground, or every few minutes while it is open.
- **Space.** 10 GB free is roughly 2,000–2,500 songs.

---

## Setting up the bucket

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
6. In self.mp3 on the Mac: *Settings → Cloud*, paste the endpoint, the bucket name, the key ID
   and the key. It checks them and starts uploading.

For devices (milestone 1, next step) you will add a second key, *Read Only*, and allow the web
app's address in the bucket's CORS rules.

---

## Where the code lives

| What | Where |
|---|---|
| The bucket layout and snapshot schema | `packages/shared/src/schemas/cloud.ts`, `packages/shared/src/cloud.ts` |
| Talking to the bucket | `apps/server/src/cloud/store.ts` (S3 API), `apps/server/src/cloud/memoryStore.ts` (tests) |
| Connection details and upload bookkeeping | `apps/server/src/repositories/cloud.ts` |
| Uploading and publishing | `apps/server/src/services/cloudSync.ts` |
| Snapshot building | `apps/server/src/services/cloudSnapshot.ts` |
| The import's upload step | `apps/server/src/services/importQueue.ts` |
| Stable ids and upload bookkeeping, in the schema | `apps/server/src/db/migrate.ts` (migration 9) |
| The API: `GET`/`PUT`/`DELETE /api/cloud`, `POST /api/cloud/sync` | `apps/server/src/routes/cloud.ts` |
| *Settings → Cloud*, and an import waiting to upload | `apps/web/src/cloud/CloudSettings.tsx`, `apps/web/src/views/ImportView.tsx` |
| Tests | `packages/shared/src/cloud.test.ts`, `apps/server/src/services/cloudSync.test.ts`, `apps/server/src/cloud/store.test.ts` (the real S3 client against an S3 look-alike over HTTP), `apps/server/src/repositories/cloud.test.ts` |

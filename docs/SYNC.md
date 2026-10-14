# Sync: the cloud holds the library

The library lives in a storage bucket in the cloud, and every device syncs with it. The
server — an always-on computer running `apps/server` in Docker, a Raspberry Pi in Xiao's
case — is one more device: the one with yt-dlp, the listening model and the SQL behind Stats.
It keeps a working copy of each library it serves and nothing it could not get back from the
bucket. This document describes the bucket, how devices stay in step through it, and what
still needs the server.

Most of it is built. What is not is marked **Still to come**, near the end.

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
| Fetching YouTube links (yt-dlp), Stats, the smart features | The server, one that works for anyone signed in ([features/shared-server.md](features/shared-server.md)), on a computer at home | The computer's electricity |

**Why B2.** It speaks the S3 API, so the server reaches it with the AWS SDK like any other bucket. It
needs no card for the free tier. Uploads are free API calls; downloads, reads of a file's
headers and listings are counted, with 2,500 of each free per day. Downloads are free up to
three times what you store each month — 30 GB for a full 10 GB library, which is a great deal
more listening than one person does. And it is not tied to your Google account, so nothing that
happens to the bucket can touch your email.

**Caps.** Backblaze stops the account for the rest of the day (until midnight GMT, 5 pm Pacific)
when a day's count passes the cap set under *Caps & Alerts*, which starts at the free amount.
It refuses everything with the same 403 a wrong key gets, saying "Transaction cap exceeded" or
"Download cap exceeded" only in its message; the doorman passes those words on as
`bucket_cap_exceeded`, and the server keeps trying by itself until the day turns. A big import —
hundreds of songs, each a check, an upload and a snapshot — and a boot that reads every song's
words from the bucket can reach the count together. Raising the cap costs nothing until it is
actually used.

A device that hears that refusal **holds off for ten minutes** rather than asking again on every
row and every play (`packages/replica/src/hold.ts`; in a browser the service worker holds too
and tells the page): reads inside the hold are refused on the device with the doorman's own
words, writes still go, and one real request afterwards finds out whether the cap was raised.
The app says so once, in a toast, and while it lasts Settings says it under its title and on
Account › Storage (with Open Backblaze), and the sidebar under the library's name; the player names the song it could not play as before. Before this, a day past its cap looked
like a hundred other things — songs skipped one after another, letter tiles for covers, a song
remembered for the session as having no words — and each of those asked the bucket again.

What a song costs on its way up is kept small on purpose: the server sends each of its files
without asking the bucket about it first, and so does the doorman (Backblaze takes
`If-None-Match` on an upload and ignores it, and the server knows from its listing what the
bucket has); a run of imports publishes its first snapshot within a minute and the rest further apart the
longer it goes on — two minutes, then five, then ten (`services/importPacing.ts`) — since every
snapshot is a listing and a read on each device that is looking, and a thousand-song day
published one a song; a snapshot that adds nothing but what arrives after a song — its cover's
colour, its motion curve and analysis, the sound vectors' pointer, artists' pictures — is held
ten minutes and goes up once with all of them (`ENRICHMENT_DEFER_MS`), where each used to be a
snapshot of its own, unless something else is published first and takes them along;
and the server prunes its old snapshots from memory instead of listing the folder after each
one.

What sitting still costs is kept near nothing. **The doorman counts changes**: each account has
a counter (`apps/doorman/src/changes.ts`, a Durable Object) that moves whenever a snapshot or a
log file is written or deleted through it, and `GET /v1/changes` reads it without touching the
bucket. A device's look asks the counter first and lists `log/` and `snapshots/` only when it
has moved — or when its last listing is half an hour old, since a server holding the bucket's
own key writes past the doorman — and each write is answered with the counter before and
after it (`Selfmp3-Changes`), so a device's own uploads never make it list. A look is due a
minute after the last when the counter answers, and five minutes after it when the doorman
keeps none, and when it last looked is kept with the device's copy, so a new tab or a relaunch
does not look again at once. The routes asked every few seconds — where the server is, which
uid is which song — answer from the device's copy and never start a look. The server's own
ten-minute poll asks the counter the same way. Measured before (2026-10-07): an open tab
listed both folders every eighty seconds, about 2,160 of the day's 2,500 listings on its own.

What starting costs is kept small too: a server whose library has not changed since its last
snapshot publishes nothing when it starts again (every device used to download the new one),
reads the newest snapshot once for adoption, the guard and the pruning together, and keeps the
words it has read from the bucket on its own disk (`bucket/kept.ts`; a start used to read every
song's). Analysis and the listening model together download at most a thousand songs a day,
counted in the database so a restart does not start the day over.

Google Drive was considered: more free space (15 GB, shared with Gmail and Photos), but a
proprietary API, an OAuth app that must be moved to "production" or it signs you out every
seven days, and your whole Google account on the line if a file is ever flagged. The bucket
is behind an interface, so a Drive driver can still be added later.

**Why not keep the library on the server.** The server is a computer at home: it can be
switched off, lose its network or lose its disk, and while it is away the bucket and the
doorman still answer, so every device keeps its library, its edits and its music. A hosted
server instead would cost money, or sleep, lose its disk or be reclaimed when idle — and it
could not import from YouTube anyway, since YouTube blocks yt-dlp from data-centre addresses.
The doorman is not a server of that kind: it keeps no library and no disk, and song bytes
stream through it without it holding them.

---

## Six rules

1. **The bucket is plain storage.** Nothing runs there. Every rule is code in
   `packages/shared`, and every device runs the same code.
2. **Files never change once uploaded.** Audio, covers and lyrics are stored under the
   SHA-256 of their bytes. Changing a song's cover uploads a new file and points the song at
   it; the old one is never overwritten. A device that has `audio/4f1c…9a.m4a` has exactly
   those bytes, for as long as the file exists, and can cache it for that long. A file is
   deleted only once no song in the library names it — a removed song's, after the snapshot
   without the song is up — and a device that kept a copy of a removed song lets its copy
   go when it learns of the removal.
3. **Each device writes only its own files.** A device's changes go in its own folder of the
   log. Two devices never write the same file, so no change is ever lost to another device
   overwriting it — which matters, because plain storage cannot tell you it happened.
4. **Done means uploaded.** An import, or an edit, counts once it is in the bucket where other
   devices can see it. Before that it is "on this device, uploading".
5. **A device keeps what it will want, not everything there is.** An installed app — the
   phone app, the desktop app — downloads ahead, because the point of it is music with no
   signal; a phone also keeps the song after the one playing before it plays, so a song played
   in order is one download and no streaming. A browser tab fetches what it plays and keeps
   only the last few songs it played, because a library of a thousand songs is not something a
   tab should quietly copy and a tab's storage is the browser's to evict. A song already on the
   device plays from the device: see
   `packages/client/src/downloads/recentCopies.ts` and its ports — `recentCopies.ts` on a
   phone, `desktop/recentCopies.desktop.ts` in the desktop app (a `recent` folder beside
   `songs`) — which hold the songs an installed app kept because they were played.

   How a tab does it: the page asks for a song and a cover at addresses of the app's own,
   `api/stream/<id>` and `api/art/<id>` under the base the build was made for
   (`apps/app/src/ports/bucketMedia.web.ts`), and the service worker answers them
   (`apps/app/sw/sw.ts`) — looking the song's bucket key and the doorman session out of
   IndexedDB and fetching the file with the bearer header no `<audio>` element or `<img>`
   could have sent. The first range of a song starts one download of the whole file, and every
   range the player asks for — Safari's two-byte look first, a seek — is read from that
   download as it arrives; once it is all here the worker keeps it, the last ten songs played,
   under the file's key, so a replay, the next song preloaded and a reload cost nothing. A
   range far past what has arrived is asked of the bucket by itself. A phone has
   nowhere to put that header, so its twin of that port is null and a cloud song is
   downloaded before it plays; the installed desktop app registers no worker and uses files
   for the same reason.
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
  covers/<sha256>.<ext>              cover art, and each artist's picture (banner and portrait). Never changes.
  lyrics/<sha256>.lrc | .txt         lyrics, timed (.lrc) or plain (.txt). Never changes.
  lyrics/<sha256>.json               the romanized lines (romaji, pinyin) of one lyric text. Never changes.
  lyrics/<sha256>.json               one song's motion curve: loudness and onsets, 20 a second. Never changes.
  lyrics/<sha256>.vec                every song's sound vector, as the server heard it. Never changes.
  lyrics/<sha256>.plays              one month of plays: which song, when, for how long. Never changes.
  snapshots/<time>-<device>.json     the whole library at one moment
  log/<device>/<seq>.json            changes, one folder per device
```

The motion curves, the sound vectors and the plays sit in `lyrics/` rather than folders of
their own because the doorman lets a device reach only the folders it knows
(`isCloudFileKey`), and a new folder would need every doorman redeployed before any device
could read it.

**`format.json`** says `{"app":"self.mp3","format":1,…}`. A device that finds a format number
newer than it understands refuses to write to the bucket and says why, instead of corrupting
something it cannot read.

**Snapshots** are the whole library — songs, tags, playlists — as one JSON document,
gzip-compressed. They are how a new device gets the library in one download instead of
replaying every change ever made. The key starts with a fixed-width UTC time, so the newest
snapshot is simply the last one in a listing. A writer keeps its three newest and deletes
the rest. A snapshot also carries, for each device, how far into that device's log it has
been folded in (`upTo`), so a device replays only what comes after.

**Artists' pictures** are pictures named by their hash like a cover, so they sit in `covers/`
— a folder of their own would need every doorman redeployed first. The server finds one for
every artist of the library (`services/artistBackdrops.ts`, `fill`, after each pass) and the
next pass puts it up; the snapshot's `artists` names each pair by `artistKey` of the artist's
name, and a device keeps them the way it keeps a cover.

**Sound vectors** are how each song sounds to the server's listening model (docs/features/
audio-intelligence.md), all of them in one file (`apps/server/src/sound/pack.ts`), keyed by each
song's audio key. One file rather than one a song: a server starting again from the bucket
reads them back in one download rather than fifteen hundred. The server sends a new one
when they change — at most once an hour while songs are still being heard — and the
snapshot's `sound` names it; the one it replaces goes in the trash. Before it sends any, a
server reads back the file the bucket's snapshot names, so a new server hears only the songs
nobody has heard, and a file it could not read is never replaced by one without its vectors.

**Plays** are a file a month (`apps/server/src/services/playsArchive.ts`): each play as its
song's uid, when it happened, how long it was heard, whether it ran to the end, and an id
that makes the same play read twice count once. A snapshot says how often a song was played,
never when, and a device's log is tidied away once a snapshot has folded it in, so these files
are where the history behind Stats is kept. The server writes them, since plays reach it
through the devices' logs; the snapshot's `plays` names each month. This month goes up at most
once an hour, a past month as soon as it changes, and a server starting from an empty
database reads every month back as soon as it has taken on the bucket's library.

**Log files** are one batch of one device's changes: `log/<device>/000000000042.json`. A
device numbers its files 1, 2, 3, … and never writes the same number twice with different
contents, so a file, once written, never changes and a resend is harmless. A device tidies
its own files away once a snapshot has folded them in, and the server tidies away what a
device that stopped coming back left behind: other devices' files its own snapshot has folded
in, ten minutes after, while that snapshot is still the newest. Every file in the folder is in
every listing of it.

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
to it. No device ever holds the key. Its owners (the `OWNER_EMAILS` secret) may always sign
in; anyone else only if the owner has put their address on the list in *Settings › Who can
sign in*, or let in anyone with a Google account (`apps/doorman/src/access.ts`).

**One Google account, one bucket.** You connect the bucket once, from any device; every
device you sign in on afterwards gets the same library. Someone else — a friend — signs in
with their own Google account and connects a bucket of their own; nothing is shared. A
server can work for both of them, each in their own bucket, through a **grant** each
account gives it ([features/shared-server.md](features/shared-server.md)).

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

A server reaches an account's bucket through a **grant**, a doorman session of its own for
that account, which it is given when one of the account's devices joins it — by itself, the
first time the device looks for a server and the bucket names none
([features/shared-server.md](features/shared-server.md)). Each account it works for is a
workspace of its own, with its own database and inbox, and everything below happens once per
workspace. The *Cloud* card on the server's own page (port 4600, opened on the server itself)
can also sign a server with one library in with Google, or connect a bucket directly with its
key when there is no doorman.

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
A device that is watching the queue asks for the library again the moment a job is done
— a look at the bucket in front of the answer, not the copy with a look behind it — so
the song is in the library as its row leaves the queue, rather than whenever the next look
was due (`apps/app/src/features/import/useSongsLanding.ts`).

### The server keeps no copy of the library

The bucket is the library, and the server is one more device — the one with yt-dlp. It keeps
a database that is its copy of the library's metadata, as every device does, and nothing else
of the library for longer than it has to. That includes the plays: each month of them goes to
the bucket as a file of its own (`lyrics/<sha256>.plays`, named in the snapshot's `plays`),
so a database made again from the bucket has its Stats back. And it may keep several: a
server works for every account that joins it, one database each
([features/shared-server.md](features/shared-server.md)). The only record that is the
server's own is `data/hub.json`: who joined, and the token and grant of each.

**The folder is an inbox, not a library.** An import downloads into the workspace's folder
under the library folder (`/app/library/<id>` in Docker; `~/Music/selfmp3` is only the
default outside it), and a file dropped there by hand is an import too (`services/scanner.ts` sweeps it, on a watch and
at boot). The pass uploads what it finds. Once a song is wholly in the bucket — audio, cover,
words, motion curve — and analysis is done with it, and the snapshot naming it is up, **the
pass deletes the copy here** (`#letGo` in `services/cloudSync.ts`) — the audio, the words
beside it, and the folder. From then on the server reads a song's words from the bucket like
every other device (`fetchLyrics`; the lyrics routes, the search index and the romanization
pass all go through `LyricsService.stored`), and the pass knows the bucket's words are current
because nothing here can have changed them. A folder with nothing new in it is a folder with
nothing in it.

**A song's audio comes from the bucket when it is wanted here.** Analysis of a song whose copy
has gone fetches it into the staging folder and throws it away after
(`services/analysis.ts`). The server's own stream route serves a copy that is still here and
otherwise forwards each range the player asks for to the bucket (`routes/media.ts`), so nothing
that streams through the server has to know the difference.

**Removing is one thing, everywhere.** A song removed on any device — the server's own routes,
a phone's log — loses its row here, whatever copy was still in the inbox, and its cover and
caches, and its bucket files are put in `cloud_trash`. Nothing is deleted from the bucket at
once: the snapshot every device is reading still names the song. The next pass writes the
snapshot without it, and then deletes from the bucket every trashed file that no remaining
song names (two songs can share a cover; a song imported twice shares everything). There is
no "keep the file" option on any device: a copy left on a disk is how removed songs once came
back as new ones, picked up by the sweep that the next import set off.

**A replaced file goes the same way.** A cover made again, words edited, an artist's new
picture: the file the row named before is put in `cloud_trash` as the row is saved
(`CloudRepository.saveState`, `saveArtist`), and deleted after the next snapshot like a removed
song's. Once per bucket listing the pass also
trashes every cover nothing names (`trashUnnamedCovers`): covers only, since a cover the server
can always send again, where audio or words no row names may be the only copy of a song whose
row was reconciled away.

**Devices keep only what the library names.** A phone and the desktop app keep every cover and
artist's picture of the library as a file named by its hash (the phone in its document folder,
which the OS does not reclaim). Once a pass has every picture the library names, the ones it
no longer names are deleted (`sweepPictures`, `offline/useKeepAlongside.ts`); a pass that could
not fetch every one — the bucket's daily cap — runs again ten minutes later.

**No bucket, no library.** With none connected the API answers every route but the cloud
ones and the health check with a 409 saying so (`http/middleware.ts`, `requireCloud`), rather
than an empty library every device would take for the truth. So the app does nothing without
a cloud — including the dev profile and the verify lanes, which is why `SELFMP3_CLOUD_DIR`
exists: a folder that speaks the bucket's five words (`bucket/local.ts`), connected from the
start and never saved. `npm run dev` sets it. A phone or a browser never sees such a bucket;
it is one this server publishes to and streams from.

### A server joining a bucket that already has a library

A server that only ever *wrote* snapshots would be right for exactly one server — the one that
filled the bucket. Any other, a fresh install or a workspace whose folder was deleted, would
publish its empty library as the whole library, and every device would follow it within
seconds.

So a server that connects to a bucket reads the newest snapshot **before it publishes
anything**, and takes on every song in it that it does not already have
(`apps/server/src/services/cloudAdopt.ts`).

| | |
|---|---|
| **When** | Once per bucket, on the first pass after connecting, signing in, or starting up — and again when you press *Publish now*, which starts over. Nothing is published until it has finished, an import's own publish included. |
| **What it makes** | A whole song row per song: uid, title, artist, album, year, track, duration, loved, play count, when it was added and last played, where it came from, its tags, its place in each manual playlist, its analysed features, its cover's colour, and the per-field stamps that decide how a later edit combines with it. Tags and playlists it does not have, likewise. The bucket's file keys go into `cloud_songs`, so publishing re-emits the song it was handed instead of uploading files that are already up there. |
| **Matching** | By uid first, and then by the audio itself. A song already here under the same uid is left exactly as it is, field for field — a snapshot is not a change with a stamp, so it must never win an edit; anything genuinely later still arrives through the other device's log. A song here under a *different* uid whose audio is the same file — the bucket names audio by the hash of its bytes, so the same key is the same song — is left alone too, and the other uid is kept as an alias (`song_aliases`), so a change or a playlist that names it still finds the song. Ten of the bucket's fifty-two here ends at fifty-two, not sixty-two, whatever the two sides call the ten, and a second run adopts nothing. |
| **A song the bucket has no audio for** | Gets its row — its tags, its plays and its place in a playlist are all still true — but nothing in `cloud_songs`, so it is left out of what this server publishes. No device is ever pointed at a file it cannot download. |
| **When it cannot read the bucket** | It stops, and publishes nothing. "I could not read the library" must never come out the far side as "there is no library": that is the reading that publishes over it. |
| **`SELFMP3_PUBLISH_ANYWAY=1`** | Skips adoption as well as the guard that refuses to publish over a snapshot holding songs this server lacks (`#refuseToLoseLibrary` in `cloudSync.ts`). It is how you say *this server's library is the one I want everywhere*, and merging the bucket's in first would be the opposite of that. |

**What is not adopted.** The snapshot's `upTo` cursors: this server reads every log file from the
beginning on its first pass instead. Replaying is idempotent by design — plays are
deduplicated by id, edits by stamp — and a device tidies its log away once a snapshot has folded
it in, so there is usually nothing there to replay. Adopting a cursor would mean skipping a change
on the strength of a snapshot whose songs this server may have *declined* to overwrite. Requests
to import a link are not adopted either; they are the last week's, and the devices that made them
say how they went.

**What adoption cannot see.** A re-encode. A library restored from a disk backup with no database
is scanned into fresh uids, and that much is fine: the files are the same files, their hashes match
the bucket's, and each is folded into the bucket's song rather than adopted beside it.
What still makes a second row is audio that really differs — the same song downloaded again at
another bitrate, or re-tagged by a tool that rewrites the file. Guessing those are one on the
strength of their names would be a worse failure than the duplicate; the import's own matcher
(`services/alreadyHave.ts`) is what keeps them from arriving in the first place.

**And that is all.** Nothing is fetched. An adopted song's audio stays in the bucket, which is
where every song's audio ends up anyway (above); its row here reads to the pass as unchanged,
so the pass sends nothing for it and publishes the bucket's files as they are. A sweep of the
inbox leaves it alone: a sweep makes songs of files, and a song with no file here is not its
business.

### Every device reads the bucket

The app's web export builds for GitHub Pages (under `/selfmp3/`, which the Pages workflow
passes as `EXPO_PUBLIC_BASE`), with no server behind
it. Whatever is in `apps/app/public/` is published beside it as it is. `privacy.html` is the
privacy policy Google's OAuth consent screen points at, written at export from
`packages/shared/src/privacy.ts` (the one place its words live); `index.html` is the page's template (Expo's own, plus a link to that policy
for the crawler that checks the home page for one); and a Search Console verification file
dropped there is served at the site's root too. It signs in with Google, connects the account's bucket if no device has yet, and shows the
library from the newest snapshot. The service worker (`apps/app/sw/sw.ts`) stands between the
player and the bucket: a song already on the device is served from there, ranges and all, and
one that is not is fetched from the bucket through the doorman once per play, its ranges cut
from that one download as it arrives, and the last ten played kept by the worker. Every
request to the bucket is one read against the day's count, so a
song loaded to sit paused — the queue restored when the tab opens, Next pressed while paused —
fetches nothing until it is played (`ports/engine.web.ts`, `#startWhenPlayed`). What a tab does
keep is small and named by hash: covers, and the words and motion curve of every song played,
in Cache Storage, which a new build leaves alone. In an installed app — the desktop app, the phone — a song listened to all
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
| Plays | Only ever added. The same one twice counts once. |
| New tags and playlists | The device makes the `uid`, so a playlist can be made offline and have songs added to it before any other device has heard of it. A tag made twice under one name on two devices becomes one tag, and the second uid still finds it. |
| Deleting | For good: a change to something that is not there is ignored, so a late edit never brings back a deleted playlist. A removed song's files are deleted from the bucket by the next pass after the snapshot without it, unless another song still names them, and every device deletes the copy it kept. |

Because the latest stamp wins whenever a change is applied, the same changes give every device
the same library, in whatever order they arrive. Snapshots carry the stamp of anything a change
ever set, so a change that arrives late combines with them correctly.

The server folds other devices' logs into its database on every pass, following the same rules
(`apps/server/src/services/cloudIngest.ts`), and publishes a snapshot saying how far it has
read. A test runs one set of changes of every kind through both, and expects the same library.
A song removed on another device takes whatever copy was still in the server's inbox too — left
there, the next sweep would add it back as a new song — and its bucket files go as described
under "Removing is one thing, everywhere".

Live playlists are worked out on the device (`packages/shared/src/smartRules.ts`), the same
rules the server compiles to SQL, so a playlist of loved songs gains a song the moment it is loved
on a phone, with the server away or not.

An edit made with no connection at all is not lost either: the device's copy of the library
applies it at once and keeps it in an outbox stored on the device
(`packages/replica/src/library.ts`), and the outbox goes up to the device's log once the bucket answers again.

### Importing from anywhere

Importing is two steps. *Getting the audio* needs yt-dlp for a link, which only some devices
have. *Adding it to the library* works anywhere.

| Device | Import a link |
|---|---|
| Server | Yes, itself |
| iPhone, iPad, the desktop app, any browser | Asks the server: directly when it answers, through the bucket when it does not |
| Android app | The same; fetching by itself is still to come |

With the server in reach, Import talks to it directly (below). Away from it, a link pasted
becomes an `importRequested` change in that device's log, with
the tags and playlist to put what it brings in. The server reads it with the rest of the log,
looks the link up — one song, or a whole playlist — queues what the library does not have
already, and downloads it as any other import. Every snapshot says how each request from the
last week went: waiting for a device that can fetch, downloading, added, failed with the
reason, or called off.

### Reaching the server for what only it can do

Some things are the server's and cannot be anyone else's. It runs yt-dlp, so importing is
its. It works the stats out — the history is in the bucket, a file a month, but the queries
over it are SQL on the server. It asks iTunes and MusicBrainz and downloads the cover you
pick, so metadata polish is its. It holds the whole library together and asks the model, so
the smart features (Ask, tidying tags) are its, and so is searching the words of every song,
whose index only it builds. A device's copy of the library answers each of these routes with
a `needs_server` refusal (`SERVER_ONLY_ROUTES` in `packages/replica/src/routes.ts`).

A device signed in to the cloud reaches it directly. Every snapshot carries the addresses
the server listens on — the ones on its own network, and `SELFMP3_PUBLIC_URL` last, the
Tailscale Funnel address that answers from anywhere — and the token (`CloudServerSchema`,
`apps/server/src/services/addresses.ts`); a screen that needs the server
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
answering, or never having said where it is. A library that never had a server joins the
shared one this build knows of (`DEFAULT_SERVER_URL`) by itself
([features/shared-server.md](features/shared-server.md)). **A feature that is simply not drawn is
indistinguishable, from where the user sits, from one that does not exist**, so the screen is
always drawn (`ServerAway`, with the words for each in `SERVER_NEEDS`,
`packages/client/src/connection/reach.ts`).

| Screen | Needs the server for | When it is away |
|---|---|---|
| Import | reading a link, playing a song before it is added, downloading it | says so, takes the link through the bucket, keeps looking |
| Stats and the Report | working the numbers out of every play | says so, keeps looking |
| Fix metadata… | iTunes, MusicBrainz, and writing the correction | says so, keeps looking |
| Ask and the other smart features | the model, and the whole library in one place | says so, keeps looking |
| Settings › Devices | the device list | shows the last list it was given, marked offline |
| The Devices sheet (handoff) | presence itself: a heartbeat and an open stream | says so in the sheet, and keeps looking while the app is in use |

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
it on the way out and back on the way in, through the same uid table the stats use (a
development build given a server's address by hand translates nothing, because its ids
already are the server's). Two
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
  audio and words that no song points at and that nothing trashed — an upload whose import
  failed halfway — deleted after 30 days. (Covers nothing names already go.)
- **A Google Drive driver**, if it is ever wanted.

## What this gives up

- **Handoff needs the server reachable.** A bucket cannot hold a connection open between two
  devices, so this is the one thing a cloud library cannot do from the bucket alone. What it
  *can* do is find the server the way every other screen does and hold presence against it —
  see "Presence from a cloud library" above — so a phone and a laptop that both read the
  bucket hand playback to each other whenever the server is within reach. When it is not,
  the devices sheet says so rather than listing nothing forever.
- **Other devices see a change on their next sync**, not instantly: when the app opens, comes
  back to the foreground, or the next time the library is asked for.
- **Some things still need the server**: looking metadata up, the stats, the smart features
  and searching inside lyrics. The screens that need it reach for it and say so when it is
  away, rather than hiding — see "Reaching the server for what only it can do" above.
- **Importing does not**, though only the server can fetch a link. In reach of it, the whole
  import screen works: what a link holds, a song played before it is added, the download.
  Away from it, the link goes into the bucket with its tags and its playlist, and the server
  takes it the next time it is running — rule 6, and the reason a device never has to be
  anywhere in particular to add a song. What is lost while away is the looking, not the
  importing.
- **Space.** 10 GB free is roughly 2,000–2,500 songs.

---

## Setting up

### 1. The bucket

1. Sign up for **B2 Cloud Storage** at [backblaze.com](https://www.backblaze.com/sign-up/cloud-storage).
   No card is needed.
2. **Create a bucket.** Private. Any name — bucket names are global across B2, so something
   like `selfmp3-<yourname>`. Default encryption on is fine; leave Object Lock off.
3. **Lifecycle settings → "Keep only the last version of the file".** B2 keeps every version
   of every file by default: deleting by name only hides a file, and the old version goes on
   counting against your 10 GB — every removed song, replaced cover and pruned snapshot. A key
   for one bucket cannot change this setting (Backblaze allows `writeBuckets` only on a key for
   the whole account), so the doorman reads it when the key is pasted and refuses a bucket
   without it, saying what to set. A rule that keeps old versions some days longer passes too.
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

### 3. The server

Run it on a computer that stays on, as [INSTALL.md](INSTALL.md) describes (Docker, with
`SELFMP3_PUBLIC_URL` set to its Tailscale Funnel address so devices away from home and the
web app can reach it). Then tell the apps where it is: `DEFAULT_SERVER_URL` in
`packages/shared/src/cloud.ts`, or the repository variable `SERVER_URL` for the web app. A
library whose bucket names no server joins that one by itself.

### 4. The web app

Every push to `main` builds it and publishes it to GitHub Pages
(`.github/workflows/pages.yml`). Nothing to do but push.

### 5. Each device

Open self.mp3, sign in with Google, and — the first time, on any device — paste the bucket's key
ID and application key on the page that follows, *Where it lives* (`POST /v1/storage/backblaze`).
The doorman asks Backblaze which bucket the key opens, where, and whether it keeps old versions
(step 3); for another provider, *Not
Backblaze?* takes the endpoint, name and region instead (`PUT /v1/storage`). The key goes to the
doorman, sealed; no device keeps it. A second device signed in to the same account skips the
page: the bucket is already the account's. Afterwards it is *Settings › Account › Storage*, to
change or disconnect, and *Settings › Account › Computers* lists the servers the account has
given a grant to, with *Remove* on each.

---

## Where the code lives

| What | Where |
|---|---|
| The bucket layout, snapshots, changes and log files | `packages/shared/src/schemas/cloud.ts`, `packages/shared/src/schemas/sync.ts`, `packages/shared/src/cloud.ts` |
| When a change was made | `packages/shared/src/hlc.ts` |
| How changes combine, for every device | `packages/shared/src/sync.ts` |
| Live playlists on a device | `packages/shared/src/smartRules.ts` |
| The doorman | `apps/doorman/` (`src/auth.ts`, `src/signin.ts`, `src/files.ts`, `src/bucket.ts`, `src/changes.ts` the change counter, `src/access.ts` who may sign in, `src/grants.ts`), `apps/doorman/README.md` |
| The doorman's contract | `packages/shared/src/schemas/doorman.ts`, `packages/shared/src/doormanWire.ts` |
| A day past the bucket's cap | `packages/replica/src/hold.ts`, `BUCKET_HOLD_MS` in `packages/shared/src/doormanWire.ts`, `apps/app/sw/sw.ts` |
| Talking to the bucket, from the server | `apps/server/src/bucket/store.ts` and `s3.ts` (S3), `apps/server/src/bucket/doorman.ts` (through the doorman), `apps/server/src/bucket/local.ts` (a folder, for the dev profile and the lanes), `apps/server/src/bucket/kept.ts` (words read from the bucket, kept on disk) |
| One server for many accounts | `apps/server/src/hub/` ([features/shared-server.md](features/shared-server.md)) |
| Uploading, publishing, and reading other devices' logs | `apps/server/src/services/cloudSync.ts`, `apps/server/src/services/cloudSnapshot.ts`, `apps/server/src/services/importPacing.ts` |
| Plays and sound vectors in the bucket | `apps/server/src/services/playsArchive.ts`, `apps/server/src/sound/pack.ts` |
| Taking on the library already in a bucket | `apps/server/src/services/cloudAdopt.ts` |
| Letting go of the copies here, and of a removed song's bucket files | `apps/server/src/services/cloudSync.ts` (`#letGo`, `#emptyTrash`), `apps/server/src/services/songRemoval.ts`, `cloud_trash` in `apps/server/src/repositories/cloud.ts` |
| Applying other devices' changes to the server | `apps/server/src/services/cloudIngest.ts`, `apps/server/src/services/localEdits.ts`, `apps/server/src/repositories/sync.ts` |
| Links other devices ask the server to import | `apps/server/src/services/cloudImports.ts`, `apps/server/src/repositories/importRequests.ts` |
| The schema: uids, stamps, requests | `apps/server/src/db/migrate.ts` (the `uid` columns, `sync_stamps`, `import_requests`) |
| The server's cloud API and its own page | `apps/server/src/routes/cloud.ts`, `apps/server/public/admin.js` |
| A device's own copy of the library, and its outbox | `packages/replica/src/library.ts`, `replay.ts`, `edits.ts`, `routes.ts` |
| Signing in, and out, on a device | `apps/app/src/features/welcome/WelcomeScreen.tsx`, `apps/app/src/features/settings/signOut.ts`, `packages/replica/src/session.ts`, `apps/app/src/ports/cloudPlatform.web.ts` |
| Finding the server from a cloud library, and what each screen says when it is away | `packages/client/src/connection/reach.ts`; `apps/app/src/connection/useServerDirect.ts`, `ServerAway.tsx`; `apps/server/src/services/addresses.ts` |
| Importing through the reached server | `apps/app/src/features/import/ImportViaServer.tsx`, `importSource.ts` |
| Stats and the Report through the reached server | `apps/app/src/features/stats/StatsViaServer.tsx`, `statsSource.ts` |
| Fixing metadata through the reached server | `apps/app/src/features/metadata/FixMetadata.tsx`, `metadataSource.ts` |
| Lining the two libraries' song ids up by uid | `packages/client/src/connection/serverIds.ts`, `apps/app/src/connection/useServerSongIds.ts`; `GET /api/cloud/uids` in `apps/server/src/routes/cloud.ts` and `packages/replica/src/routes.ts` |
| Presence and handoff from a cloud library | `apps/app/src/features/devices/usePresenceServer.ts`, `DevicesProvider.tsx`, `DevicesSheet.tsx`; `packages/client/src/devices/translate.ts` |
| Publishing the web app | `.github/workflows/pages.yml` |
| Tests | `packages/shared/src/sync.test.ts`, `hlc.test.ts`, `smartRules.test.ts`, `apps/server/src/services/cloudIngest.test.ts` (the server and the shared rules held to the same answers), `cloudSync.test.ts`, `cloudImports.test.ts`, `packages/replica/src/edits.test.ts`, `apps/doorman/src/*.test.ts` |

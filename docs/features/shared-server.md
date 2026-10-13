# One server for everyone

A server is a worker for any Google account that asks it to be, not the home of one
library. Each account's library stays in that account's own bucket; the server keeps a
working copy of it and nothing it could not get back from the bucket. Agreed with Xiao on
2026-10-12, after a friend signed in and found no server: each Google account has its own
bucket, and a server's address only ever reached the devices that read *its* bucket.

Xiao chose **a revocable grant** for the server's way into each bucket, and **anyone
signed in** for who may use it.

**Where:** the server (`apps/server/src/hub/`), the doorman (`apps/doorman/src/grants.ts`),
and every app, which knows the shared server's address the way it knows the doorman's
(`DEFAULT_SERVER_URL` in `packages/shared/src/cloud.ts`).

## The idea

| | Before | Now |
|---|---|---|
| Libraries on one server | One | One per Google account that joined |
| What the server keeps | Its library's database, which held the only copy of the play history | A cache per account, rebuilt from the bucket when lost, and a list of who joined |
| How a device finds it | The address in its own bucket's snapshot | The same, and the app's offered server before any snapshot names one |
| How it reaches an account's bucket | A sign-in on the server's own page | A **grant**: a doorman session the account gave this server, revocable |
| Who may use it | Whoever signed the server in | Anyone the doorman lets sign in |

## Workspaces

The server runs one **workspace** per account. A workspace is the whole of what used to be
the server (`createContainer`): its database, its inbox, its sync and its import queue. It
lives under `<data>/accounts/<id>/` and `<library>/<id>/`.

A request is routed to its workspace by the token it carries. The token is the workspace's
own, published in its snapshots to that account's bucket, exactly as the one server's token
always was. So a device needs nothing new to talk to its library: what it read from its
bucket is what it sends. A request from the server's own machine with no token goes to the
only workspace, when there is only one.

What the workspaces share is what is heavy, or tied to the machine rather than to anyone's
library (`apps/server/src/shared.ts`):

| Shared | Why |
|---|---|
| The listening model | About 600 MB loaded. One copy is lent to each workspace in turn |
| Analysis, one song at a time | Several backlogs at once would run several ffmpegs and the model together on a Pi |
| YouTube's pace (`<data>/yt-throttle.json`) | YouTube counts requests per address. Two libraries each within the budget would together be over it, and the block that follows is the machine's |
| Metadata lookup | MusicBrainz's pace is per address too |
| The Japanese dictionary | Loaded once and kept |
| Staying awake | One assertion for the machine |

`<data>/hub.json` is the only record the server keeps of its own (`hub/registry.ts`). For
each workspace it holds:

- the workspace's id;
- the account it is for;
- the token its devices are given;
- the grant it reaches the bucket with.

Delete a workspace's folder and the next start takes the library back from the bucket, plays
included (docs/SYNC.md, "A server joining a bucket that already has a library"). The token is
the same one, because it lives in `hub.json`. Delete `hub.json` and every account joins again
from its next device.

## Joining

Joining happens by itself, with no button (Xiao, 2026-10-12). The first time a signed-in
device with a bucket asks where its server is, and the bucket's snapshot names none, the
device joins the shared one (`automatic` in `packages/replica/src/sharedServer.ts`). Every
screen that needs the server asks, and so does presence while the app is in use, so a
friend's first minute in the app is enough. The device sends its doorman session to the
server's `POST /api/hub/join`, once:

1. The server asks the doorman who the session belongs to (`GET /v1/me`, which now says
   `account`). An account with no bucket yet is turned away until it connects one.
2. It asks the doorman for a grant for itself (`POST /v1/grants`). The grant is a session of
   its own for that account, named for this server.
3. It makes the account's workspace, takes on the library already in the bucket, and
   publishes a snapshot naming its addresses and the workspace's token.
4. It answers the device with the same addresses and token. The device keeps them
   (`packages/replica/src/sharedServer.ts`) until that snapshot reaches it.

Joining again is harmless: an account that already has a workspace gets its token back. A
join that fails is tried again by itself ten minutes later.

The button is for one case only. **Use the shared computer**, under **No computer works for
your library yet** and in Settings › Account › Computers, appears when this device has
removed the shared computer. Removing it there is remembered on that device, so it does not
join again by itself; pressing the button joins by hand and forgets that.

## Grants

A grant is a doorman session with a server's name on it and no 180-day end (`grants:<sub>`
in KV). The doorman lists an account's grants (`GET /v1/grants`) and ends one
(`DELETE /v1/grants/<id>`). Settings › Account lists them under **Computers**, with
**Remove** on each.

Three rules keep grants safe:

- **A removed grant is noticed promptly.** The server's next request to the bucket is
  refused. The server checks once with the doorman, then lets the workspace go and deletes
  its folders. Nothing is lost by that, because the folders were a copy of the bucket.
- **Signing out everywhere ends grants too.**
- **A grant cannot make grants.** Otherwise a server could hand the account on to another
  without anyone being asked.

## What moved into the bucket

The server held one thing no device could get back: the **play history**. A snapshot says how
often a song was played, never when. The log a play arrives in is tidied away once a snapshot
has folded it in.

Each workspace now keeps its plays in the bucket too (`services/playsArchive.ts`):

- **One file a month.** Each file is gzipped JSON, `lyrics/<sha256>.plays`, beside the words
  as the sound vectors are. A new top-level folder would have needed every doorman
  redeployed first.
- **Named in the snapshot.** The snapshot's `plays` field names each file.
- **This month goes up at most once an hour.** A past month goes as soon as it changes.
- **Read back before anything is published.** A new workspace reads the months back as
  soon as it has taken on the bucket's library, so Stats, the Report and Wrapped answer
  as they did.

The rest of a workspace's database is a cache or a queue:

| Kind | What |
|---|---|
| Rebuilt from the snapshot | The library itself |
| Rebuilt from the bucket | Upload bookkeeping, the sound vectors |
| Rebuilt by the server itself | The lyrics index, the caches on disk |
| Forgotten, harmlessly | The import queue's history, the devices' last playback state, a playlist's last-played time |

The server's settings table holds the server's own defaults. A device's settings already
lived on the device.

## A server from before

A data folder holding `selfmp3.db` and no `hub.json` is a server from before workspaces
(`hub/migrate.ts`). At its first start as a hub:

1. **It moves into a workspace of its own.** The database and its caches move by rename;
   the inbox moves too.
2. **Its token goes into `hub.json`,** so no device is given a new one.
3. **YouTube's pace goes with it**, into the machine's file.
4. **It settles once the hub is running.** The hub asks the doorman which account the
   database's session is for. It swaps that session, a device's that would end after 180
   days, for a grant, opens the workspace again on the grant, and signs the old session
   out. A doorman too old to say asks again in an hour.

## Cost and risk

- **Anyone signed in may join.** Every import goes out from the server's address to YouTube,
  and every Smart feature runs on the server's model. YouTube has blocked this home's IPv6
  range before (yt-dlp now pins IPv4). The doorman's `ALLOWED_EMAILS` and the Google OAuth app's
  publishing state are what decide who can sign in at all.
- **The Pi's memory.** A workspace is a SQLite database with a 64 MB page cache at most, and
  a few timers. The model is shared, so the cost of a friend is mostly their library's
  database.

## Deploying

- **The doorman goes first**, by hand (`cd apps/doorman && npx wrangler deploy`). It adds
  `/v1/grants` and `account` in `/v1/me`, and nothing an older server or app reads changes.
- **Then the server.** On the Pi it updates itself from `main`. Its first start moves the
  library into a workspace and settles its grant.
- **Then the app**, which offers the shared computer. Pages deploys it from `main` with the
  rest.

## Where the code lives

| What | Where |
|---|---|
| The hub: workspaces, routing, joining, letting go | `apps/server/src/hub/hub.ts`, `hub/app.ts` |
| Who joined | `apps/server/src/hub/registry.ts` (`<data>/hub.json`) |
| A server from before | `apps/server/src/hub/migrate.ts` |
| What the workspaces share | `apps/server/src/shared.ts`, `sound/sound.ts` (`SoundModelHost`), `util/gate.ts` |
| One library's background work | `apps/server/src/start.ts` |
| Grants | `apps/doorman/src/grants.ts`; `DoormanGrant*` in `packages/shared/src/schemas/doorman.ts` |
| Plays in the bucket | `apps/server/src/services/playsArchive.ts`, `cloudSync.ts` (`#uploadPlays`, `#readBucketPlays`); `CloudPlays*` in `packages/shared/src/schemas/cloud.ts` |
| Joining, from a device | `packages/replica/src/sharedServer.ts`; `apps/app/src/connection/ServerAway.tsx`; `apps/app/src/features/settings/ConnectionPanel.tsx` (`Computers`) |
| Tests | `apps/server/src/hub/hub.test.ts` (the real doorman over HTTP), `apps/doorman/src/grants.test.ts`, the `plays` block in `apps/server/src/services/cloudSync.test.ts`, `packages/replica/src/sharedServer.test.ts` |

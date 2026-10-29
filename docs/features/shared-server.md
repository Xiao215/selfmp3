# One server for everyone

A server is a worker for any Google account that asks it to be, not the home of one
library. Each account's library stays in that account's own bucket; the server keeps a
working copy of it and nothing it could not get back from the bucket. Agreed with Xiao on
2026-10-12, after a friend signed in and found no server: each Google account has its own
bucket, and a server's address only ever reached the devices that read *its* bucket.

Xiao chose **a revocable grant** for the server's way into each bucket, and anyone
signed in for who may use it — then, on 2026-10-13, an **allow list** for who may sign in
at all, kept by the doorman's owner in Settings (below).

**Where:** the server (`apps/server/src/hub/`), the doorman (`apps/doorman/src/grants.ts`
and `access.ts`), and every app, which knows the shared server's address the way it knows
the doorman's (`DEFAULT_SERVER_URL` in `packages/shared/src/cloud.ts`, today
`https://pi.tail3d8516.ts.net`, Xiao's Raspberry Pi behind Tailscale Funnel; a build may set
its own).

Every server is a hub; there is no other mode. The one exception is a server whose bucket is
a folder on its own disk (`SELFMP3_CLOUD_DIR`: the dev profile, the verify lanes): there are
no accounts to work for, so it holds one library in the data folder itself, with no
`hub.json`. A server working for accounts refuses to start on a data folder like that, a
`selfmp3.db` and no `hub.json`, rather than leave the library there unseen
(`hub/registry.ts`).

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
workspace its `X-Selfmp3-Library` header names by id, or else to the only workspace, when
there is only one. A request with no token, or a token nobody here was given, is a 401,
except `GET /api/health`.

The hub's own routes (`hub/app.ts`) need no workspace: `POST /api/hub/join` (below),
`POST /api/hub/check`, the doorman's notice that a grant was taken back (below), and
`GET /api/hub`, the list of workspaces (id, account, songs, whether it reaches its bucket),
answered only to the server's own machine. There is no route to leave by: an
account takes its grant back (below), which works while the server is off.

The `selfmp3` command on the server itself lists the workspaces from `GET /api/hub`. The
owner's admin page shows only how many there are ([admin.md](admin.md)). Changing a library's cloud connection
(sign-in, bucket, disconnect, publish now) is refused from anywhere but that machine, token or
not: a workspace reaches its bucket through the grant its devices gave it, and nothing a
device holds may repoint it. The `selfmp3` command names one the same
way, with `--library <id or email>` ([install-and-ops.md](install-and-ops.md)).

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
   publishes a snapshot naming itself (its `id`), its addresses and the workspace's token.
4. It answers the device with the same id, addresses and token. The device keeps them
   (`packages/replica/src/sharedServer.ts`) until that snapshot reaches it.

Joining again is harmless: an account that already has a workspace gets its token back, once
the server has checked with the doorman that the workspace's grant still holds. One taken back
a moment ago, before the workspace noticed, is let go there and then, and the account joins
afresh. A join that fails is tried again by itself ten minutes later.

**A server that no longer works for a library.** A server that let a library go cannot say so
in the bucket: the grant it would write with is what was taken back. So the newest snapshot
goes on naming it, with a token it no longer takes. A device finds that out by asking. Its
look at an address asks `/api/health` with no token, and only once the server there has
answered as the one the snapshot names, the library's version with the token
(`askAddress` in `packages/client/src/connection/reach.ts`). A 401 then means that server no
longer holds this library. The app tells its copy of the library
(`POST /api/cloud/server/refused`), which passes that server over from then on as though
the snapshot named none:

- **Taken back, so it stays gone.** Removed on this device, or on another one: either way the
  account has no grant for it any more. That counts as having left it, as **Remove** does
  (below), so the screens say **No computer works for your library yet** and offer the
  button. The device that pressed **Remove** passes it over at once, without waiting for the
  server to notice.
- **Lost some other way, so it is joined again.** For example, its `hub.json` was deleted,
  or its whole data folder (a Pi rebuilt on a new SD card). The grant is still there, nobody
  asked it to stop, and the device joins again by itself. It uses the new token straight
  away, before the snapshot that names it arrives. A rebuilt server is still the one the
  snapshot names because it is named by its public address, not by anything in its data
  folder (docs/SYNC.md, "The name has to outlive the data folder").

Before this (2026-10-14), every device kept choosing a removed server, and every import and
lookup was a 401 instead of the bucket's way round.

The button is for when that did not happen. **Use the shared computer** appears under **No
computer works for your library yet** (the notice a screen shows when no server answers for
it) and in Settings › Account › Computers when the list is empty. In practice that is after
the shared computer was removed. On the device where it was removed, that is remembered, so
the device does not join again by itself. Another device works it out when the server refuses
its token and the account has no grant for it (above). Pressing the button joins by hand and
forgets that.

The browser extension never joins. It cannot read what a device remembered about removing
the shared computer, so it leaves the link in the bucket and says to open self.mp3 until a
snapshot names a server that takes the library's token
([browser-extension.md](browser-extension.md), "Connecting it").

## Grants

A grant is a doorman session with a server's name on it and no 180-day end (`grants:<sub>`
in KV). The doorman lists an account's grants (`GET /v1/grants`) and ends one
(`DELETE /v1/grants/<id>`). Settings › Account lists them under **Computers**, with
**Remove** on each.

Three rules keep grants safe:

- **A removed grant is noticed at once.** **Remove** asks the doorman alone, so it works
  while the server is off. Once the grant is ended, the doorman tells the server, after it
  has answered **Remove** and without waiting on it ("Telling the server", below). The
  server asks the doorman whether the grant still holds and, refused, lets the workspace go
  and deletes its folders. Nothing is lost by that, because the folders were a copy of the
  bucket. A server that was off, or that the doorman could not reach, finds out as it always
  did: its next request to the bucket is refused (an idle workspace looks every ten minutes,
  and every workspace looks as the server starts), and it checks once with the doorman
  before letting go. The bucket's snapshot still names the server afterwards. Devices pass
  it over because it refuses their token ("A server that no longer works for a library",
  above), so once the server has been told, that is a second or two after **Remove**.
- **Signing out everywhere ends grants too.**
- **A grant cannot make grants.** Otherwise a server could hand the account on to another
  without anyone being asked.

### Telling the server

A grant has always kept the address the server gave when it asked for it (`server`: its
public address, `SELFMP3_PUBLIC_URL`, else the first it listens on). When a grant is ended
from a device, or when the account signs out everywhere, the doorman sends
`POST <server>/api/hub/check` with `{ "grant": "<id>" }` (`tellServer` in
`apps/doorman/src/grants.ts`). It does so in the Worker's `waitUntil`, after the answer, with
a five-second limit and no redirects followed. A failure is a line in the doorman's log and
nothing more. A server letting the account go with its own grant is not told.

The notice proves nothing and the server does not take its word (`Hub.check` in
`apps/server/src/hub/hub.ts`). It carries no token, and the route needs none. All it does is
make the workspace holding that grant ask the doorman `GET /v1/me` with the grant's own
token, now rather than at its next look; only the doorman's refusal lets the library go. So
anyone who sends one can at most make the server ask a little sooner:

- **A grant no workspace holds** is ignored without asking anyone. The answer is 204
  whatever the grant, so it says nothing about which grants are held here.
- **One that is held** is looked at no more than once every five seconds. Notices that come
  while a look is under way are folded into it.
- **One that still holds** is looked at once more 65 seconds on, and then left to the usual
  ten-minute look. The doorman's copies of its sessions can take up to a minute to agree that
  one ended (`apps/doorman/src/kv.ts`, `boundedCache.ts`).

Only grants whose address the doorman can reach are told. A server whose grant names an
address on a home network, as one with no public address does, is never reached, and is left
to its next look.

## What moved into the bucket

The server held one thing no device could get back: the **play history**. A snapshot says how
often a song was played, never when. The log a play arrives in is tidied away once a snapshot
has folded it in — and now only once the play is in its month's file as well
([SYNC.md](../SYNC.md), "Tidying up").

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

Each workspace's settings table holds that library's settings: what the server acts on for
it, such as whether smart features are on, how many downloads run at once and whether its
folder is watched. A device reaches its server for them (Settings › Smart features, Settings ›
Advanced › Library and Importing), the way Import does; the bucket holds none of them. What a
device acts on, such as crossfade, stays on the device.

## Who may sign in

The doorman decides, and the server takes its word. Its owners — the `OWNER_EMAILS` secret,
set where the doorman is deployed — are always let in. Everyone else is on a list the owner
keeps on the admin page's **People** tab (`/v1/access`, `apps/doorman/src/access.ts`,
kept in KV; [admin.md](admin.md)), or the owner turns on **Anyone with a Google account**.
Someone added can sign in within about a minute, as soon as KV's copies have the change: a
refusal always reads the list afresh, never a Worker's remembered copy. Taking someone off
refuses their next request within a minute, and with it any server's grant for them: the
server can no longer reach their bucket.

## Cost and risk

- **Anyone signed in may join.** Every import goes out from the server's address to YouTube,
  and every Smart feature runs on the server's model (`SELFMP3_AI_BASE_URL`,
  [ai.md](ai.md)). YouTube has blocked this home's IPv6 range before (yt-dlp now pins
  IPv4). The doorman's allow list (the admin page's People tab, owner only) and the Google
  OAuth app's publishing state are what decide who can sign in at all.
- **The model is the owner's.** With cli-bridge as the endpoint, as on Xiao's Pi, every
  account's Smart features run on the Claude subscription signed in on the server.
  cli-bridge's own README says a Pro or Max plan is for its owner's use only, and that
  anything serving other people should use an API key; an endpoint with a key of its own
  (Anthropic's, say) is the setting for a server friends use.
- **The Pi's memory.** A workspace is a SQLite database with a 64 MB page cache at most, and
  a few timers. The model is shared, so the cost of a friend is mostly their library's
  database.

## Deploying

A change that touches the doorman, the server and the app goes out in that order:

- **The doorman first, by hand.** No workflow deploys it: `cd apps/doorman && npx wrangler
  deploy` ([apps/doorman/README.md](../../apps/doorman/README.md)). The server and the app
  ask it for grants (`/v1/grants`), `account` in `/v1/me` and the allow list (`/v1/access`),
  so it has to answer before they do. Telling the server works in either order: a doorman
  ahead of the server sends its notice to a route the server does not have yet, which
  answers 401, and the server finds out at its next look as before.
- **Then the server, by pushing to `main`.** `.github/workflows/docker.yml` builds
  `ghcr.io/xiao215/selfmp3:latest` (arm64 and amd64) when a push touches the server or
  `packages/shared`, and again every Monday for a fresh yt-dlp. The server picks it up with
  `docker compose pull && docker compose up -d`, run by hand or on a timer; Xiao's Pi does it
  by itself within minutes of the image being published ([docs/INSTALL.md](../INSTALL.md)).
- **Then the app.** The same push to `main` publishes the web app to GitHub Pages
  (`.github/workflows/pages.yml`). The desktop app is released from a `desktop-v*` tag
  (`desktop.yml`), and the phone app is built and installed by hand.

## Where the code lives

| What | Where |
|---|---|
| The hub: workspaces, routing, joining, letting go | `apps/server/src/hub/hub.ts`, `hub/app.ts` |
| Who joined | `apps/server/src/hub/registry.ts` (`<data>/hub.json`) |
| What the workspaces share, and the server's name for itself (`serverIdOf`) | `apps/server/src/shared.ts`, `sound/sound.ts` (`SoundModelHost`), `util/gate.ts` |
| One library's background work | `apps/server/src/start.ts` |
| Grants | `apps/doorman/src/grants.ts`; `DoormanGrant*` in `packages/shared/src/schemas/doorman.ts` |
| Telling the server | `tellServer` in `apps/doorman/src/grants.ts`; `Hub.check` and `POST /api/hub/check` in `apps/server/src/hub/`; `HubCheckSchema` in `packages/shared/src/schemas/hub.ts` |
| Plays in the bucket | `apps/server/src/services/playsArchive.ts`, `cloudSync.ts` (`#uploadPlays`, `#readBucketPlays`); `CloudPlays*` in `packages/shared/src/schemas/cloud.ts` |
| Joining, from a device | `packages/replica/src/sharedServer.ts`; `apps/app/src/connection/ServerAway.tsx`; `apps/app/src/features/settings/ConnectionPanel.tsx` (`Computers`) |
| Tests | `apps/server/src/hub/hub.test.ts` (the real doorman over HTTP, and the device's side against it), `apps/doorman/src/grants.test.ts`, the `plays` block in `apps/server/src/services/cloudSync.test.ts`, `packages/replica/src/sharedServer.test.ts`, `packages/client/src/connection/reach.test.ts` |

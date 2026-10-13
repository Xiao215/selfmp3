# One server for everyone

A server is a worker for any Google account that asks it to be, not the home of one
library. Each account's library stays in that account's own bucket; the server keeps a
working copy of it and nothing it could not get back from the bucket. Agreed with Xiao on
2026-10-12, after a friend signed in and found no server: each Google account has its own
bucket, and a server's address only ever reached the devices that read *its* bucket.

**Where:** the server (`apps/server/src/hub/`), the doorman (grants), and every app,
which knows the shared server's address the way it knows the doorman's.

## The idea

| | Before | Now |
|---|---|---|
| Libraries on one server | One | One per Google account that joined |
| What the server keeps | Its library's database, which held the only copy of the play history | A cache per account, rebuilt from the bucket when lost; a list of who joined |
| How a device finds it | The address in its own bucket's snapshot | The same, and the app's default server before any snapshot names one |
| How it reaches an account's bucket | A sign-in on the server's own page | A **grant**: a doorman session the account gave this server, revocable |
| Who may use it | Whoever signed the server in | Anyone signed in to the doorman |

## Workspaces

The server runs one **workspace** per account: the whole of what used to be the server
(`createContainer`) — its database, its inbox, its sync, its import queue — under
`<data>/accounts/<id>/` and `<library>/<id>/`. A request is routed to its workspace by the
token it carries; the token is the workspace's own, published in its snapshots to that
account's bucket, exactly as the one server's token always was. So a device needs nothing
new to talk to its workspace: what it read from its bucket is what it sends.

What the workspaces share is the part that is heavy or tied to the machine rather than
to anyone's library:

- the listening model (about 600 MB loaded; one copy, lent to each workspace in turn);
- yt-dlp's pace, because YouTube counts requests per address, not per library;
- the romanization dictionaries;
- the AI endpoint.

`<data>/hub.json` is the server's only record of its own: each workspace's id, the
account it is for, and that account's grant. Delete a workspace's folder and the next
start takes the library back from the bucket (docs/SYNC.md, "A server joining a bucket
that already has a library"); delete `hub.json` and every account joins again from its
next device.

## Joining

A device signed in to the doorman whose bucket names no server shows **Use the shared
computer** where it would say the library's computer has not said where it is. That
sends the device's doorman session to the server's `POST /api/hub/join`, once:

1. the server asks the doorman who the session belongs to (`GET /v1/me`, which now says
   `account`);
2. it asks the doorman for a grant for itself (`POST /v1/grants`), which is a session of
   its own for that account, named for this server;
3. it makes the account's workspace, takes on the library already in the bucket, and
   publishes a snapshot naming its addresses and the workspace's token;
4. it answers the device with the same addresses and token, which the device keeps until
   that snapshot reaches it.

Joining again is harmless: an account that already has a workspace gets its token back.

## Grants

A grant is a doorman session with a server's name on it and no 180-day end. The doorman
lists an account's grants (`GET /v1/grants`) and ends one (`DELETE /v1/grants/<id>`);
Settings › Account shows the list, with **Remove** on each. A removed grant stops the
server's next request to the bucket; the server then lets the workspace go. Signing out
everywhere ends grants too.

## What moved into the bucket

The server held two things no device could get back:

- **Play history.** A snapshot says how often a song was played, never when, and the log a
  play arrives in is tidied away once a snapshot has folded it in. Each workspace now
  keeps its plays in the bucket too, one file a month (`plays/<sha256>.json`), named in the
  snapshot like the sound vectors. A new workspace reads them back before Stats answers.
- **(Anything else the inventory finds; see below.)**

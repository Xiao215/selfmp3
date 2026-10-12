# Listening together

Friends add songs to one Up next, and it plays. Agreed with Xiao on 2026-10-12 from the
lettered proposal (<https://claude.ai/artifact/Adx1XtxKyFPJpeMn4b4CzY>, picks E1 C1 S1 O1
A3 G1 L3).

**Where:** the phone, the computer and the web. A friend without self.mp3 joins from a
browser with only a name. The room itself lives in the doorman, so the server does not
have to be reachable. The exception is a link a guest adds, which plays through the host's
server.

## The idea

A **room** is a shared Up next. You press **Together** in Up next's head, and your Up next
becomes *Xiao's room*. Friends join with a link, a QR code or a six-letter code (`KQ7 482`).
Every row shows who added it. Nothing about it is a new kind of list:

- while it lasts, it is Up next;
- when it ends, it is a Recently played tile;
- Save turns it into a playlist.

| Who | How they join | What they can add |
|---|---|---|
| **Host** | Opens the room | Their own songs. Everything else too |
| **Friend** | Signed in to self.mp3, opens the code | Their own songs, from their own bucket. What's in the room. Links |
| **Guest** | A browser and a name | What's in the room. Links |

What a friend or a guest may do is the host's choice under **People**:

- **Add songs**, on by default.
- **Skip**, on by default.
- **Pause and seek**, off by default.
- **Add links**, on by default.

## Songs never move

Each song stays in its owner's bucket. When Mia adds a song, the room records its files'
keys (audio, cover, words). The doorman then lends exactly those files, under three
conditions:

- only to people in the room;
- only while the room is open;
- read through Mia's sealed key, which nobody ever sees.

Nobody can list Mia's library, and nothing of it is copied anywhere. A room that ends lends
nothing more, and ten minutes later the doorman has forgotten it entirely.

If your own library has the same song, your own copy plays and the play counts in your
Stats. "The same song" means the same audio file, which is named by its hash, or the same
source link.

## Where it plays (C1)

The invite asks each time, with **On this phone** first:

- **On this phone**: one speaker. The host's device plays. Everyone else's is a remote that
  adds, skips if allowed, and shows the song with its words. Each song is read from its
  owner's bucket once, by the host.
- **On everyone's phone**: each member's device plays it in step. Each device streams every
  song, so each play counts against the owner's daily Backblaze downloads. A friend whose
  bucket has hit its cap has their songs skipped, and the room says so once.

**Keeping in step.** The host's player is the clock. It reports what it is on and where.
The room keeps the song and when it started, on the doorman's clock. Each device works the
position out with its own clock's offset from the doorman's, measured by a ping on the
socket. A device more than a third of a second out seeks.

## Who plays next (O1)

Each person's songs wait behind their own, and the list deals one from each person in turn:

- whoever has waited longest for one of theirs to play goes first;
- someone whose song is playing goes to the back;
- someone with nothing played yet goes before them all, earliest to join first.

So twenty songs from one friend do not push another's one to the end. The host can hold a
song and move it; a moved song leaves the turns and stays where it was put (`roomOrder` in
`packages/shared/src/room.ts`).

**Keep it going** (on by default): with two songs left, the room adds songs that sound like
the last ones, taking turns between the people whose songs were played.

## What friends see of you (S1)

Only the songs you add. A friend can also put up a **shelf**: one tag or playlist of theirs,
which everyone can add from under *In the room*. A shelf is lent only while they are in the
room.

## After (A3, G1)

When the room ends it becomes a Recently played tile, **With Mia, Ken, Ana**. Its page lists
every song that played, with who brought it:

- **Save as playlist** keeps it.
- **Get it** brings one of a friend's songs home. Your server imports it from the same link
  hers came from (the song's source link), into your own bucket, and finds its words again.
  A song with no link, such as a file Mia dropped in, says *Mia's only*.

## Links (L3)

A guest has no library, so they can paste a YouTube, YouTube Music or 网易云 link. It plays
through the host's server, the same stream that import review previews from. Nothing is
kept. *Get it* afterwards imports it properly.

The first version plays a link only **On this phone**, since only the host's device can
reach the host's server.

## How it is built

| What | Where |
|---|---|
| The contract: codes, members, songs, entries, actions, socket messages | `packages/shared/src/schemas/room.ts` |
| The rules: who may do what, taking turns, the clock, what a member may read | `packages/shared/src/room.ts` |
| A room: one Durable Object per code, its sockets, its alarm | `apps/doorman/src/room.ts` |
| The doorman's routes, and lending a song's files from its owner's bucket | `apps/doorman/src/rooms.ts` |

The doorman's routes:

```
POST /v1/rooms                       RoomCreate  → RoomJoined    signed in
POST /v1/rooms/<code>/join           RoomJoin    → RoomJoined    a session makes you a friend
GET  /v1/rooms/<code>?t=<token>                  → RoomState
POST /v1/rooms/<code>/act?t=<token>  RoomAction  → RoomState     add needs the session too
GET  /v1/rooms/<code>/socket?t=<token>           WebSocket: state down, ping up
GET  /v1/rooms/<code>/files/<entry>/<part>?t=<token>   audio | cover | lyrics | romanized
```

The member's token rides in the query. A browser's WebSocket and an `<audio>` element cannot
send a header, and those are the two things that most need it. Tokens are kept only as their
hash. Which Google account each signed-in member joined as is kept beside them and never
sent to anyone: it is what the doorman lends a member's songs by.

A room ends in any of these ways:

- the host ends it;
- the host leaves;
- nobody has done anything for two hours (`ROOM_IDLE_MS`).

It is forgotten ten minutes after it ends.

**Deploying.** The room class needs the `ROOMS` binding and the `v2` migration in
`apps/doorman/wrangler.toml`. `npx wrangler deploy` from `apps/doorman` creates it; nothing
deploys the doorman automatically.

**Who can sign in.** A friend who brings songs signs in to *your* doorman, so their address
must be on its `ALLOWED_EMAILS`. Anyone not on it can still join as a guest.

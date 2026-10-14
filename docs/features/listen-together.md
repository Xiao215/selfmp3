# Listening together

Friends add songs to one Up next, and it plays. Agreed with Xiao on 2026-10-12 from the
lettered proposal (<https://claude.ai/artifact/Adx1XtxKyFPJpeMn4b4CzY>, picks E1 C1 S1 O1
A3 G1 L3).

**Where:** the phone, the computer and the web. A friend without self.mp3 joins from a
browser with only a name. The room itself lives in the doorman, so the server does not
have to be reachable. The exception is a link a guest adds, which plays through the host's
server.

## The idea

A **room** is a shared Up next. You press **Listen together** beside the song playing, and
your Up next becomes *Xiao's room*. Friends join with a link, a QR code or a six-letter code
(`KQ7 482`). Every row shows who added it. Nothing about it is a new kind of list:

- while it lasts, it is Up next;
- when it ends, it is a Recently played tile;
- Save turns it into a playlist.

**Where it starts (T1 + T3, Xiao 2026-10-13).** On the player, where you are when a friend asks
what is playing, rather than inside the queue:

- a People button in the phone's Now Playing head and in a computer's player bar, beside
  Devices. It opens Together: where it plays, or a code to join;
- in a room, that button is the room's faces. On the phone's Now Playing the room takes the
  head's middle as *Xiao's room* (unless the sleep timer or play-and-tag has it). Either opens
  the room's sheet;
- on Home, a **Listen together** card until this device has been in a room or was told
  *Not now*. It is kept with the guides (`together-card`), so Show tips again brings it back.

Up next lists the room while you are in one; it is no longer the way in.

**The room's sheet, and ending it (E1 + C1 + C3, Xiao 2026-10-13).** In a room, the pill, the
player bar's faces and the ⋯ on Up next's room head all open one sheet: the invite (QR, code,
Share invite), who is here, **Friends can** (folded to one line until opened), Keep as a shared
playlist, and **End the room** at the foot (**Leave the room** for a friend). Ending asks first
only when it reaches someone else, naming them (*End the room for Mia and Kai?*); leaving, or
ending a room you are alone in, just goes. Either way a toast says so, with **See what played**
once a song has played, which opens the room in Recently played.

| Who | How they join | What they can add |
|---|---|---|
| **Host** | Opens the room | Their own songs. Everything else too |
| **Friend** | Signed in to self.mp3, opens the code | Their own songs, from their own bucket. What's in the room. Links |
| **Guest** | A browser and a name | What's in the room. Links |

**Faces.** Each person is a round face in their own colour, which also marks the songs they
added. Someone signed in shows their Google profile picture, inside a thin ring of their
colour; a guest, or anyone without a picture, shows their initial. The doorman takes the
picture from the session, never from what a device sends, and a shared playlist's people
show theirs the same way. Rooms and playlists kept before faces had pictures load with
none; a shared playlist's person gets theirs the next time they open it.

What a friend or a guest may do is the host's choice under **Friends can**:

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

**A connection that drops.** A ping unanswered for six seconds is taken as the line gone, and
the room says **Reconnecting…** (its head, Now Playing's pill, the line under the song) until
the socket is back. Meanwhile a device that follows the host keeps playing what it has rather
than chasing the room's last word. A room's song that stops asks the room whether it can still
hear this device: if not, the song waits where it stopped and goes on once the room is back,
rather than being skipped down the list; if so, it is a song that will not play, tried again
and skipped as any other.

**Mobile data.** A room works on any connection that holds, so it is not Wi-Fi only. Opening
or joining one on a phone's mobile data, where that phone will play the room, says once that
a room streams every song, about 5 MB each.

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

- **Where the songs come from:** shelves, and songs that played, leaving out the last dozen.
- **How a song is picked:** each person's turn is the song of theirs whose sound is nearest
  to the songs playing and just played.
- **Where the sound comes from:** every member who brings songs reads their own bucket's sound
  pack (the listening model's vectors, `snapshot.sound`) and tells the room how their own songs
  sound. Each vector is packed to a byte per dimension, about a kilobyte
  (`packages/shared/src/soundVectors.ts`).
- **Where the room keeps them:** beside its state, never in it, so no socket carries them.
  Nobody can describe someone else's songs.
- **Without vectors:** where the room has none for what played, it picks by turns alone.

## What friends see of you (S1)

Only the songs you add. A friend can also put up a **shelf**: one tag or playlist of theirs,
which everyone can add from under *In the room*. A shelf is lent only while they are in the
room.

## After (A3, G1)

When the room ends it becomes a Recently played tile, **With Mia, Ken, Ana**. Its page lists
every song that played, with who brought it. The room lent its covers only while it was open,
so a song you have draws your own copy's cover, a link the picture its page showed, and a friend's
the copy this device kept of it as it played (held from the library's sweep of pictures while
the room is remembered; a browser tab keeps none, and draws the letter). A room you were in
alone shows your own face on its tile.

- **Open the shared playlist**, when the host kept the room as one (below).
- **Save as playlist** keeps the songs that are yours as a playlist of your own.
- **Get it** brings one of a friend's songs home. Your server imports it from the same link
  hers came from (the song's source link), into your own bucket, and finds its words again.
  A song with no link, such as a file Mia dropped in, says *Mia's only*.

## Links (L3)

A guest has no library, so they can paste a YouTube, YouTube Music or 网易云 link. It plays
through the host's server, the same stream that import review previews from. Nothing is
kept. *Get it* afterwards imports it properly.

**How it reaches everyone.** The host's device reaches its own server directly. For everyone
else, the first time a link comes in, the host tells the room where its server answers from
the internet:

- **Which address:** the https one, usually the Tailscale Funnel's `*.ts.net`
  (`publicServerBase`).
- **How it plays:** the doorman plays the link through that address for every member.
- **The token:** the server's token stays in the room's private storage, never sent to a
  member, and goes with the room.
- **A server the internet can't reach:** a link plays on the host's device alone, and
  everyone's phone skips it.

## Shared playlists

A shared playlist is a playlist friends keep adding to, after a room or without one.

- **Who has it:** it belongs to Google accounts rather than devices, so it is on every device
  of everyone in it, among their playlists, with their faces for a cover.
- **Where it lives:** the doorman keeps it as a Durable Object per playlist, plus a list per
  account of the playlists it is in.
- **Its songs:** each stays in its owner's bucket and is lent to the playlist's people for as
  long as it is in it.
- **Adding:** anyone in it adds their own songs, and a song goes in once.
- **Taking out:** you take out your own songs; whoever made it can take out anyone's, and
  rename it.
- **Leaving:** leaving takes your songs with you, because nobody can lend them any more. The
  last to leave lets it go.

Its page:

- **Play** plays it on this device: each song lent by the doorman, or your own copy.
- **Play together** opens a room filled with it. Its songs are lent from each owner's bucket
  even when the owner is not in the room, and named for them.
- **Add songs** adds from your library.
- **Invite** shares a link and a QR code: `/shared/<id>/join/<invite>`. Joining needs an
  account; an invite opened before signing in opens again after.
- **More** holds Rename and Leave.

A room's host can **Keep as a shared playlist** from the room's sheet: everyone in the room who signed
in gets it, with every song that played or is waiting. Guests, who have no account, do not.

## The invite

The invite carries the room's link as a QR code beside the code, for a friend across the
table. It is drawn as one SVG path from `toqr`, the encoder Expo's CLI already ships. It is
always black on white, because that is what cameras read. **Share invite** opens the system's
share sheet; where there is none (the desktop app), it copies the link.

## How it is built

| What | Where |
|---|---|
| The contract: codes, members, songs, entries, actions, socket messages | `packages/shared/src/schemas/room.ts` |
| The rules: who may do what, taking turns, the clock, what a member may read | `packages/shared/src/room.ts` |
| A room: one Durable Object per code, its sockets, its alarm | `apps/doorman/src/room.ts` |
| The doorman's routes, and lending a song's files from its owner's bucket | `apps/doorman/src/rooms.ts` |
| A device's side: the doorman's routes, the clock's offset, a room song as a track | `packages/client/src/room/` |
| One of your songs as a room carries it | `packages/replica/src/roomSong.ts` (`cloudRoomSongNow`) |
| The room this device is in: its pass, its socket, Join, Leave | `apps/app/src/features/room/room.store.ts` |
| Rows, tracks, the host's plan, Keep it going, what Recently played keeps | `apps/app/src/features/room/room.model.ts` |
| The host's player playing the room; everyone's phones following it | `apps/app/src/features/room/RoomProvider.tsx` |
| The room in Up next (phone sheet, computer rail, the room's page) | `apps/app/src/features/room/RoomList.tsx` |
| Together and the room's sheet (invite, people, ending it), Add songs (Mine, In the room, A link) | `apps/app/src/features/room/RoomSheets.tsx` |
| The way in: the player's button, the room's pill, Home's card | `apps/app/src/features/room/Together.tsx` |
| `/join/<code>`, `/room`, `/past-room/<code>` | `apps/app/src/features/room/RoomScreens.tsx` |
| The invite's QR code | `apps/app/src/features/room/qr.model.ts`, `RoomQr.tsx` |
| Sound vectors: reading a pack, packing, closeness | `packages/shared/src/soundVectors.ts` |
| A shared playlist's rules | `packages/shared/src/sharedPlaylist.ts`, `schemas/shared.ts` |
| A shared playlist on the doorman, and its routes | `apps/doorman/src/shared.ts`, `sharedRoutes.ts` |
| Shared playlists in the app: Playlists, their page, joining | `apps/app/src/features/shared/` |
| Who brought the song, and Get it, in Now Playing | `apps/app/src/features/room/RoomSongLine.tsx` |

**A room's songs in the player.** The player and every row are keyed by song id, and a
friend's song has none on this device. So each room entry gets an id of its own: negative,
which no library hands out (`roomTrackId`). The room's provider registers each entry as a
track (`player/roomTracks.ts`): the song, where it streams from, its cover, and your own
copy if you have one. The player reads that beside the library. A track plays your own copy
when it can, and otherwise the lent file; a play counts only for your own copy.

**The host's player plays the room** (`hostPlan`). It starts when the first song comes in
and nothing of your own is playing. It keeps everything after the playing song the room's
list (`withUpcoming` in `packages/shared/src/queue.ts`). When it ran out and a song arrives,
it goes on. It reports what it is on whenever that differs from what the room says. It
acts once on each skip or pause a friend asks for (`want`). Together keeps what was
playing: the song and what follows it go in as the host's, and the room starts at the
place the song was.

**Testing it without Google or Backblaze.** The doorman's test harness
(`apps/doorman/src/fakes.ts`) has a fake Google, KV and bucket. Run in Node behind an HTTP
server, with real WebSockets for the rooms, it serves the web app as a whole doorman: two
signed-in accounts, each with a bucket stocked from the development library. That is how
this was tried in Chromium: a host, a friend on a phone-sized window and a guest, with a
friend's song playing on the host and, on everyone's phone, in step on the friend's.

The doorman's routes:

```
POST /v1/rooms                       RoomCreate  → RoomJoined    signed in
POST /v1/rooms/<code>/join           RoomJoin    → RoomJoined    a session makes you a friend
GET  /v1/rooms/<code>?t=<token>                  → RoomState
POST /v1/rooms/<code>/act?t=<token>  RoomAction  → RoomState     add needs the session too
GET  /v1/rooms/<code>/socket?t=<token>           WebSocket: state down, ping up
GET  /v1/rooms/<code>/files/<entry>/<part>?t=<token>   audio | cover | lyrics | romanized
GET | POST /v1/rooms/<code>/vectors?t=<token>    how the room's songs sound
PUT  /v1/rooms/<code>/link-server?t=<token>      the host's server, for links
POST /v1/rooms/<code>/keep?t=<token>             kept as a shared playlist   signed in
POST /v1/rooms/<code>/from-shared?t=<token>      a shared playlist's songs   signed in

GET | POST /v1/shared                            yours; make one             signed in
GET  /v1/shared/<id>   POST …/join   POST …/act                            signed in
GET  /v1/shared/<id>/files/<entry>/<part>?t=<listen token>
```

The member's token rides in the query. A browser's WebSocket and an `<audio>` element cannot
send a header, and those are the two things that most need it. Tokens are kept only as their
hash. Which Google account each signed-in member joined as is kept beside them and never
sent to anyone: it is what the doorman lends a member's songs by. A shared playlist's files
take its listen token in the same way, which opens that playlist's songs and nothing else.

A room ends in any of these ways:

- the host ends it;
- the host leaves;
- nobody has done anything for two hours (`ROOM_IDLE_MS`).

It is forgotten ten minutes after it ends. A shared playlist lasts until its last person
leaves.

**Deploying.** The room and shared playlist classes need the `ROOMS` and `SHARED` bindings
and the `v2` and `v3` migrations in `apps/doorman/wrangler.toml`. `npx wrangler deploy` from
`apps/doorman` creates them; nothing deploys the doorman automatically.

**Who can sign in.** A friend who brings songs, or joins a shared playlist, signs in to
*your* doorman, so their address must be on its list (Settings › Who can sign in). Anyone
not on it can still join a room as a guest.

## Tried on

Chromium, the iPhone simulator (iPhone 17) and the desktop app (Electron), all against the
real doorman code (see "Testing it without Google or Backblaze"). On the iPhone:

- the room opened from what was playing without a gap;
- a friend's song streamed from her bucket;
- a shared playlist's page drew its lent covers.

The desktop app copies the invite where it has no share sheet. Not yet tried on a real iPhone
or Android.

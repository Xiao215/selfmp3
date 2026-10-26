# Listening together

Friends add songs to one Up next, and it plays. Agreed with Xiao on 2026-10-12 from the
lettered proposal (<https://claude.ai/artifact/Adx1XtxKyFPJpeMn4b4CzY>, picks E1 C1 S1 O1
A3 G1 L3).

**Where:** the phone, the computer and the web. A friend without self.mp3 joins from a
browser with only a name. The room itself lives in the doorman, so the server does not
have to be reachable. The exception is a link a guest adds, which plays through the host's
server.

## The idea

A **room** is a shared Up next. You press **Listen together**, and your Up next becomes
*Xiao's room*. Friends join with a link, a QR code or a six-letter code
(`KQ7 482`). Every row shows who added it. Nothing about it is a new kind of list:

- while it lasts, it is Up next;
- when it ends, it is a Recently played tile;
- Save turns it into a playlist.

**Where it starts (T1 + T3, Xiao 2026-10-13; A1 + A2, 2026-10-14).**

- **On the player.** A People button sits in the phone's Now Playing head and in a computer's
  player bar, beside Devices. It is there when a friend asks what is playing.
- **On Home.** A People button sits in the phone's header, beside Import, so a room needs
  nothing playing first. (The **Listen together** card under it was removed 2026-10-24: the
  header button is enough, and rooms aren't something Home pushes.)
- **On a list.** A tag's, an artist's, a playlist's or an Ask answer's ⋯ has **Listen
  together**. In a room, that item reads **Add to Xiao's room** instead.
- **From Ask.** "Start a room with something chill" picks the songs and offers **Start a
  room** with them. In a room, the offer is to add them (docs/features/ai.md, "Listening
  together").

In a room, the People button (Home's head, the player bar, Now Playing) becomes the room's
button (L1, 2026-10-14): the same round with an accent edge and a ring pulsing out from it
every two seconds, holding the faces of whoever else is here, or People while you are alone,
since your own face is beside it already. Under Reduce Motion the ring is left out. On the phone's Now Playing the room
takes the middle of the head as *Xiao's room*, unless the sleep timer or play-and-tag has it.
Either one opens the room's sheet. Up next lists the room while you are in one, but it is not a
way in.

**What a room starts with (Xiao 2026-10-14).** Where you pressed decides it, and the start
sheet's **Starts with** line shows it before you press Start:

- from the player, the song playing, carrying on from where it was;
- from a list or from Ask, every song in it, in order (up to the 300 a room keeps waiting);
- from Home, nothing. You add songs, or ask for some, once it is open.

Before 2026-10-14 a room also copied the next 20 songs of Up next, unannounced, which is why
songs nobody chose turned up in it. A room started from a list or from Home plays its first
song over whatever of yours was playing, because that is what it was opened for
(`RoomStartHint.takeOver`). One started from the player keeps the song that is playing. While a
host's room has songs waiting and nothing playing, the room's card in Up next offers **Play**.
An empty room offers **Add songs**.

**Adding songs is Search (A2, 2026-10-14).** Up next's **Add songs** opens the Search page
(`/search?to=room`, on every device), with *Adding to Xiao's room* under its field and Done
for Cancel. The one box works as it does everywhere: a song of yours is added by its line or
its +, Ask's songs answer offers **Add to Xiao's room** in place of Play, and a YouTube or
网易云 link is looked up and added (when friends may add links). Before anything is typed it
shows what you played last and what the room's people brought (shelves, and songs that played).
The room's own Add sheet, with its Mine / In the room / A link tabs, is gone. A guest, who has
no library, opens the same page without signing in, for what is in the room and links.

**The start sheet (C1, S1 + P1, 2026-10-14).** Your face, *Listen together* and one line
(*Friends add songs from their phones. Invite them once it starts.*), **Starts with**, and
**Start**. Nothing on it looks pressable that is not: the empty seats are gone. Where it plays
is not asked: a room starts on the host's own device. Under Start is *Have a code? Join*,
which turns into the code field in place. Return reads Join; a code that cannot be one says so
under the field. A link to `/join/<code>` whose code cannot be one is a centred dead end like a
gone link's (AK1, 2026-10-25): *That isn't a room code*, how a code looks, the six boxes filled
with what came in (a letter no code uses in red) and Join once it is a code. A press on the sheet away from the field, or a pull, puts the keyboard away,
as on every sheet. Pressing Start keeps the sheet up, and it grows into
the room's sheet (M1): your face springs into its seat, the code rolls in a letter at a time,
and the rest rises in after it. A friend who joins later springs into the row with a ring of
their colour, the phone taps lightly, and a toast says *Mia joined* (M2).

**The room's sheet, and ending it (E1 + C1 + C3, 2026-10-13; D1, 2026-10-14).** In a room,
the pill, the player bar's faces and the ⋯ on Up next's room head all open one sheet:

- the code with its QR and **Share**;
- who is here, as faces with names, ending in an **Invite** seat. Someone away is faded, and
  the host taps a friend's face to remove them;
- **Plays on** for the host (P1): *This phone* and *Everyone's phones*, two rows drawn as
  Devices draws a device, the one it plays on marked, switchable while the room is open;
- **Friends can**, as chips for the host: Add, Skip, Pause, Links;
- **Keep as a playlist** and **End the room** at the foot (**Leave the room** for a friend).

The sheet has no explaining lines. Ending asks first only when it reaches someone else, naming
them (*End the room for Mia and Kai?*). Leaving, or ending a room you are alone in, just goes.
Either way a toast says so, with **See what played** once a song has played, which opens the
room in Recently played.

| Who | How they join | What they can add |
|---|---|---|
| **Host** | Opens the room | Their own songs. Everything else too |
| **Friend** | Signed in to self.mp3, opens the code | Their own songs, from their own bucket. What's in the room. Links |
| **Guest** | A browser and a name | What's in the room. Links |

**Faces.** Each person is a round face in their own colour, which also marks the songs they
added. Someone signed in shows their Google profile picture, inside a thin ring of their
colour; a guest, or anyone without a picture, shows their initial. The doorman takes the
picture from the session, never from what a device sends, and a shared playlist's people
show theirs the same way. A shared playlist kept before faces had pictures was migrated to
none the first time it was read, and each of its people gets theirs the next time they open it.

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

A room starts on the host's own device. The host switches it under **Plays on** in the room's
sheet:

- **On this phone**: one speaker. The host's device plays. Everyone else's is a remote that
  adds, skips if allowed, and shows the song with its words. Each song is read from its
  owner's bucket once, by the host.
- **On everyone's phone**: each member's device plays it in step. Each device streams every
  song, so each play counts against the owner's daily Backblaze downloads. A friend whose
  bucket has hit its cap has their songs skipped, and the room says so once.

**Keeping in step.** The host's player is the clock. It reports what it is on and where.
The room keeps the song and when it started, on the doorman's clock. Each device works the
position out with its own clock's offset from the doorman's, measured by a ping on the
socket. A device more than a third of a second out seeks. On everyone's phones the host tells
the room when its own song is more than half a second off the room's clock (a song that
started late, loading after a skip); on one speaker only a jump of two seconds, a seek. A host
whose app opens again, or whose page reloads, takes the room's song up where the room says it
is.

**A friend's own buttons.** On everyone's phones a friend's Previous, play/pause and Next,
wherever they are pressed (the player bar, the lock screen, a key), are the room's: Next skips
the room's song and play/pause pauses it, when **Friends can** allows; otherwise they say only
the host can. A room only goes forward, so Previous says so.

**One room at a time.** Joining or starting a room while in another leaves the one you were in,
once the new one has let you in: an invite to a room that has ended changes nothing. When the
host ends the room, or takes you out of it, you are told so (*Xiao's room ended*, with **See
what played**).

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

**Autoplay** (`keepGoing`, on by default; *Keep it going* until 2026-10-14): with two songs
left, the room adds songs that sound like the last ones, taking turns between the people whose
songs were played. Its switch says *When the list runs low, plays more of what people brought*.

- **Where the songs come from:** shelves, and songs that played, leaving out the last dozen.
  A young room with nothing of its own to bring back yet takes songs from the host's library
  that it does not have, nearest in sound where the host's vectors say.
- **How a song is picked:** each person's turn is the song of theirs whose sound is nearest
  to the songs playing and just played.
- **Where the sound comes from:** every member who brings songs reads their own bucket's sound
  pack (the listening model's vectors, `snapshot.sound`) and tells the room how their own songs
  sound. Each vector is packed to a byte per dimension, about a kilobyte
  (`packages/shared/src/soundVectors.ts`).
- **Where the room keeps them:** beside its state, never in it, so no socket carries them.
  Nobody can describe someone else's songs.
- **Without vectors:** where the room has none for what played, it picks by turns alone.
- **Alone:** Keep going picks the same way from your own library when Up next runs out
  (lists.md, "Keep going"); the ordering is one function, `nearestFirst` in
  `packages/shared/src/soundVectors.ts`.

## What friends see of you (S1)

Only the songs you add. A friend can also put up a **shelf**: one tag or playlist of theirs,
which everyone can add from in Search while adding to the room. A shelf is lent only while they are in the
room.

## After (A3, G1)

When the room ends it becomes a Recently played tile, **With Mia, Ken, Ana**: the covers of
what played, four in a square, with the others' faces big in the middle (yours, when you were
alone). Its page is a list's page like a tag's, a playlist's or an Ask answer's (Xiao,
2026-10-13: A1 B1 C1 D1):

- **The head**, lit by its covers: that same cover, *Together · Tuesday, Oct 13*, the name, how
  many songs and how long, then **Play** and **Shuffle**, and **Shared playlist** when the host
  kept the room as one (below). Played, Up next is the room by its name (a `room` list source,
  docs/features/lists.md), linking back here, with Up next's own Save.
- **The ⋯**: Play next and Add to Up next, then **Save as playlist** (your songs, as an Ask
  answer saves), **Get N songs from friends**, and **Forget this room**.
- **The rows**: every song that played, in the order it played, with the face of whoever
  brought it on its cover's corner and nothing more said. Yours play, from that row on. A
  friend's song you don't have is faded, since the room that lent it has gone, and has **Get
  it** in Import's own words: the download Home opens Import with, then the import's ring on
  the row, filling as it goes (red with a retry if it failed). Your server imports it from the
  link it came from, into your own bucket, and finds its words again; once it lands the row is
  yours. A song with no link, such as a file Mia dropped in, is only faded.

The room lent its covers only while it was open, so a song you have draws your own copy's
cover, a link the picture its page showed, and a friend's the copy this device kept of it as it
played (held from the library's sweep of pictures while the room is remembered; a browser tab
keeps none, and draws the letter).

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
  even when the owner is not in the room, and named for them, for as long as they are in the
  playlist: the doorman asks the playlist on every read, so a song taken out, or an owner who
  leaves, stops playing in the room at once.
- **Add songs** adds from your library; songs already in it are marked *Already in*.
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
| Rows, tracks, the host's plan, Autoplay, what Recently played keeps | `apps/app/src/features/room/room.model.ts` |
| The host's player playing the room; everyone's phones following it | `apps/app/src/features/room/RoomProvider.tsx` |
| The room in Up next (phone sheet, computer rail, the room's page) | `apps/app/src/features/room/RoomList.tsx` |
| Together and the room's sheet (invite, people, where it plays, ending it) | `apps/app/src/features/room/RoomSheets.tsx` |
| Songs going in from Search (yours, friends' shelves, a link) | `apps/app/src/features/room/RoomPicks.tsx`, `features/search/SearchScreen.tsx` |
| The way in: the player's button, Home's button, the room's pill, Home's card | `apps/app/src/features/room/Together.tsx` |
| What a room opened from here starts with | `apps/app/src/features/room/roomSheets.store.ts` (`RoomStart`) |
| A room arriving, a friend's face coming in, the room button's live ring | `apps/app/src/features/room/roomMotion.tsx` |
| A list's ⋯ Listen together | `apps/app/src/ui/components/useListActions.tsx` |
| Ask's answer for a room | `apps/app/src/features/room/TogetherAnswer.tsx` |
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
and nothing of your own is playing, or at once when the room was opened from a list or Home
(`takeOver`). It keeps everything after the playing song the room's
list (`withUpcoming` in `packages/shared/src/queue.ts`). When it ran out and a song arrives,
it goes on. It reports what it is on whenever that differs from what the room says. It
acts once on each skip or pause a friend asks for (`want`). Opened from the player,
the room keeps the song that was playing: it goes in as the host's, and the room starts at the
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
GET | HEAD /v1/rooms/<code>/files/<entry>/<part>?t=<token>   audio | cover | lyrics
GET | POST /v1/rooms/<code>/vectors?t=<token>    how the room's songs sound
PUT  /v1/rooms/<code>/link-server?t=<token>      the host's server, for links
POST /v1/rooms/<code>/keep?t=<token>             kept as a shared playlist   signed in
POST /v1/rooms/<code>/from-shared?t=<token>      a shared playlist's songs   signed in

GET | POST /v1/shared                            yours; make one             signed in
GET  /v1/shared/<id>   POST …/join   POST …/act                            signed in
GET | HEAD /v1/shared/<id>/files/<entry>/<part>?t=<listen token>
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
*your* doorman, so their address must be on its list (the admin page's People tab). Anyone
not on it can still join a room as a guest.

## Tried on

Chromium, the iPhone simulator (iPhone 17) and the desktop app (Electron), all against the
real doorman code (see "Testing it without Google or Backblaze"). On the iPhone:

- the room opened from what was playing without a gap;
- a friend's song streamed from her bucket;
- a shared playlist's page drew its lent covers.

The desktop app copies the invite where it has no share sheet. Not yet tried on a real iPhone
or Android.

# Tags, playlists, Up next

Three words, one job each. Agreed with Xiao on 2026-10-03 from the lettered proposal
(<https://claude.ai/artifact/R6NgAaCUjvEWkhqjLaXWuU>, picks A1 B1 C1 D1 E1 F1 G1 H1).

| Word | What it is | Lasts | You |
|---|---|---|---|
| **Tag** | A word you put on songs. Its page is always that one tag. | Forever; fills itself as you tag | Tag songs. "Adding a song" on a tag's page is tagging it |
| **Playlist** | A list you saved: songs you chose, or one that **fills from tags** | Until you delete it | Save something you played, or New playlist |
| **Up next** | What you are listening to now, named after what you played | Until the next Play; then Recently played remembers it | Reorder, remove, add, and **Save** it if you liked it |

The middle ground — tags played together, an answer to Ask, songs found by a search, a room
listened in together — is not a thing you have to keep before you can hear it. It is played,
Up next wears its name, and Save turns it into a playlist once you know you want it again.
Home's Recently played remembers what you played, so nothing unsaved is lost by playing
something else.

The verbs: **Play** (replaces Up next, from anywhere), **Add to Up next**, **Save**,
**Tag**.

| What | Where |
|---|---|
| Where a list came from, what Up next calls it, what Save makes, Recently played's rules | `apps/app/src/features/lists/lists.model.ts` |
| Save | `apps/app/src/features/lists/useSaveUpNext.ts`, `followRules.ts` |
| After a song played alone, Clear the rest, the rail's guide | `apps/app/src/features/queue/OnlySongEnd.tsx`, `useQueueEdits.ts`, `UpNextParts.tsx`, `apps/app/src/features/guide/` |
| Recently played, kept on this device | `apps/app/src/features/lists/recentLists.store.ts`, `apps/app/src/features/room/pastRooms.store.ts` |
| The line over Up next's songs | `apps/app/src/features/queue/UpNextSource.tsx` |
| New playlist | `apps/app/src/features/playlists/NewPlaylist.tsx` |
| Liked: its page, its tile, its rail row, Library's chip | `apps/app/src/features/liked/LikedScreen.tsx` (`/playlists/liked`), `PlaylistsScreen.tsx`, `apps/app/src/shell/Sidebar.tsx`, `LibraryScreen.tsx` |
| A tag's page, and tags together on top of it | `apps/app/src/features/tag/PlacePage.tsx`, `CombinedScreen.tsx` (`/combined`) |
| Tag songs… | `apps/app/src/features/tag/TagScreen.tsx`, `apps/app/src/features/playlistDetail/AddSongsSheet.tsx` |
| Ask's song answer: the card and the page | `apps/app/src/features/smart/SongsAnswerCard.tsx`, `AnswerScreen.tsx` (`/answer`) |
| A room that ended, as a list page | `apps/app/src/features/room/RoomScreens.tsx` (`/past-room/[code]`) |
| Covers flying into the Up next button | `apps/app/src/ui/coverFlight.ts`, `apps/app/src/ui/components/CoverFlight.tsx`, `apps/app/src/features/queue/useFlyToUpNext.ts` |

## A song picked from Library

A tap (or a click, or the row's ▶) on a song in Library plays **that song alone**: Up next
becomes just it, and whatever it held before is gone (Xiao, 2026-10-03). The search palette on
a computer does the same with its song rows and lyric hits: it searches the whole library, so
there is no list around the song (`playAlone` in `lists.model.ts`). The Search page is
different: its rows are what was searched for, so a row plays the results from there, and Up
next is named "Search". The whole library plays from **Shuffle** — the head on a computer,
next to Sort on a phone — or **Play these tags** with tags on. A tag's, an artist's or a
playlist's page plays its list from the row. One song is not a list: Up next wears no name for
it and offers no Save, and Recently played shows it as that song — until you add songs to it
(see Save).

When that song ends, nothing else plays, but the silence is explained (A1, 2026-10-08). The
song stays loaded, paused at its end, so the mini player or the player bar stays too; a toast
says **That was the only song** with **Up next** to open it (unless Up next is open already),
and Up next shows the same line under the song, now marked *Played*, with two buttons:
**Songs like this** (the song menu's Play similar songs) and **Shuffle library** (Library's
Shuffle with no tags on). Playing, seeking or Previous on the song puts both away. A list that
runs out — a tag, a playlist — keeps its plain end: it was asked for whole
(`onlySongEnded` in `features/queue/queue.model.ts`, `OnlySongEnd.tsx`).

## Taking songs out of Up next

The phone's sheet and the computer's rail draw the same list (`UpNextParts.tsx`). A phone
swipes a row left; a computer drags it out of the rail, or right-clicks it for **Remove from
Up next**, or presses Delete or Backspace on it. Each comes with **Undo** for five seconds,
which puts the song back beside the songs it was between. The first time the rail is open with
a song after the playing one, a guide lights that song and drags it out once: "Drag a song out
to remove it", "Right-click it for more". It never comes back on that device (see
[guides.md](guides.md)).

**Clear the rest**, in both, takes out every song but the one playing — the ones to come and
the ones played — and the music carries on (C1). It is an outlined pill, not a second Shuffle,
and is greyed when there is nothing to clear. The toast says "Cleared 30 songs" with Undo,
which puts them all back in their places while the same song is playing; songs added since
stay after them.

## Liked

The heart saves a like; **Liked** lists them (A1, 2026-10-25). It is a list that keeps
itself, newest like first (`likedSongs`), not a stored playlist: nothing to rename or delete,
no ⋯ on its tile. It is the first tile on the Playlists page — with no song liked yet it is
still there, and its page says "No liked songs yet" — and, once a song is liked, the first row
of the sidebar's Playlists, where songs dropped onto it are liked. Its page (`/playlists/liked`)
is a tag's page with a heart for the dot: Play, Shuffle and the ⋯ every list has. It plays
with the `liked` source, so Up next is named "Liked", its line opens the page, Save never
shows, and Recently played keeps it as a tile ("Keeps itself") that plays the likes as they
are now.

When a song was liked is the stamp on its love (docs/SYNC.md): the server reads it from
`sync_stamps`, a device from the snapshot's `stamps.loved`, both as the song's `lovedAt`. A song
liked before there were stamps has none and follows the timed ones, newest added first.

Library's tag strip has a **Liked** chip right after All, once a song is liked. It narrows
whatever else is on, as On this phone does: alone it plays as Liked, with tags it is the liked
songs among them ("Liked · calm", which Save keeps as songs). With it on, Library's head has
**Play liked** and Shuffle, as it has Play these tags with tags on.

## Where a list came from

Every Play says what it is playing: `player.playFrom(ids, index, { source })` and
`player.playShuffled(ids, source)` (`ListSource` in `lists.model.ts`). A tag, an artist, a
playlist, Liked, tags combined, an answer to Ask, a room that ended (`room`), songs (similar to a
song, songs you picked, forgotten gems, found by a search, songs that need a tag, Home's
Recently played songs), or the whole library. Left out, Up next is nameless: a song played
alone, or a handoff from another device. The source rides in the playback session
(`player/session.model.ts`), so a reopened app comes back by the same name.

The line is drawn from the source **as the library has it now**: a renamed tag shows its new
name; a tag or playlist deleted while it plays reads "Late drive (deleted)", and Save comes
back for it. Tapping the line opens what it names.

## Save

Shown only where saving would make something new (`savePlan`): never for a tag, an artist,
a playlist, Liked or the whole library, which are places of their own, and never for one song.
Nor for songs that need a tag, a chore rather than a list, or Home's Recently played songs,
which Home already keeps.

- **Tags combined** make a playlist that fills from them (`followRules`), so new songs join,
  needing any or all of them as the combination did.
- **Anything else** makes a playlist of the songs in Up next as they are, in the list's own
  order rather than the shuffle (`songsToSave`). A song swiped out of an answer stays out.
- **Songs added to one song, or to the whole library, make it yours** (B1, 2026-10-25). Play
  Next, Add to Up next or a drop into the rail turn a nameless Up next, or Library's Shuffle,
  into "Lined up" (`sourceAfterAdding`; the rail's line reads "Lined up · 5 songs · 19 min",
  with no "From"), and Save appears in Up next's head. It saves the songs in Up next's own
  order, shuffle and all, as "Songs you lined up" (made unique). A song put back with Undo is
  not one added. Recently played shows its songs, not a tile for it: it grows as it plays.
- **Edits to Up next while a tag or a playlist plays change nothing lasting** (G1): there is
  no "changed" state and no question at save time. Lasting edits to a playlist happen on
  its page; to keep a song out of a tag, untag it.

It asks nothing. Up next then wears the playlist's name, the button turns into **Saved**
where it stood, and the toast offers Open and Undo. Recently played's tile becomes that
playlist (`noteListSaved`), so playing it again does not offer Save again.

There is no Save on a tag's page, an artist's page or Library's head. An Ask answer you
already trust has **Save as playlist** in its ⋯, and so does a room that ended (its page,
`/past-room/[code]`, plays with the `room` source, which names Up next after the room; see
[listen-together.md](listen-together.md)). New playlist makes a playlist directly; it is the
one place whose whole job is that.

## New playlist

One sheet (`NewPlaylist.tsx`), whichever door opened it: the sidebar's ＋, the Playlists
page's New (＋ on a phone) and the grid's New tile. It asks what kind first (L2, 2026-10-08),
as three plain choices, then a name:

- **Pick songs**: a name (New playlist, made unique), then picking songs (`AddSongsSheet`).
  It is made with the first songs confirmed, so cancelling leaves nothing.
- **Fills from tags**: the tags, with what they hold now, then a name that starts as theirs.
  With two or more, **Any of them / All of them** says whether a song needs one or every one
  (C1); the name joins them with "or" or "&". It follows them (`followRules`, whose `match`
  the server's rules and the replica's evaluation both read); **Stop filling** on its page
  keeps every song as it is. Its tile and its Fills from row say "&" / "all of" when it needs
  all.
- **Describe it**, only while Ask is on: what you want to hear, then a name that starts as
  those words, then Ask's picks to keep ([ai.md](ai.md), "L2").

Back steps back inside the sheet; Cancel or a dismiss makes nothing.

## Tags together

A tag's page is always that one tag (B1). **Combine with…** on its head (H1) opens the
picker; what is picked opens as a page of its own, `/combined?tags=…&artists=…`, pushed on
the tag page's own stack — Back comes back to the tag, and the Library tab's own filter is
never touched (it is shared app-wide). Its chips are its address: one taken off or added
rewrites it in place, and down to one it becomes that tag's or artist's own page.

A combination **widens** (any of them) unless its head's one **Any / All** switch says All
(C1, 2026-10-25): then it is the songs that carry every one of them (`placeSongs`, the
address's `match=all`, the source's `match`). The chips keep their two shapes; there is no
third chip state and no "leave out". An All combination is named with "&" ("night & calm"),
an Any with "or", and Combine with…'s count follows the switch. Its ⋯ has **Keep as
playlist**, which makes a playlist that fills from those tags with the same Any / All, without
playing them first (`useKeepPlaces`); with an artist among them it keeps the songs on show,
as rules only follow tags. Up next's Save keeps the match too, and so does Recently played,
where Any and All of the same tags are two lists.

Library's tag strip combines too, as a filter of the library: with tags on, Up next is named
after them the same way.

## Ask's song answer

In Search the answer is one card (C1): **▶** plays it at once, and the card opens it as a
page. The page is a list of songs like any other: the head a tag's page has (covers, "✦
Picked for you" over the list's own name, what it understood as chips), **Play**, **Shuffle**,
**Different songs** and **⋯** (Select songs, Play next, Add to Up next, Save as playlist), and
under it the same rows a playlist draws (`ui/components/OrderedSongList.tsx`, shared with the
playlist page): hold one to move it, Select songs to tick several, a row's ⋯ for the song.
The order you put it in is the order it plays and saves in while the app is open. Different
songs sends the picks it showed as `avoid` (`DescribeRequest`), and the server picks around
them while anything else fits; a chip taken away first changes what it picks from. Answers
are kept in memory (`smart/answers.store.ts`); an address to one from before a reload says so
and offers Search.

## Putting a list in order

A playlist you made and an Ask answer are in the order you set (`OrderedSongList`). On a
phone a row is held until it lifts, then moved (`HoldToReorder.tsx`). With a mouse a plain
drag moves it, no hold first: it is the same browser drag that carries a song to a playlist in
the sidebar, read by the list while it is over the list — the row follows the pointer and the
rows around it make room, and a drop there is the new order. Carried out of the list, the row
goes back to its place and a drop on a sidebar playlist adds the song (`useDragToReorder` in
`apps/app/src/ports/songDrag.web.ts`). Several ticked songs dragged together only go to a
playlist or Up next.

A playlist that fills from tags is in its rule's order: nothing lifts and no order is sent,
and holding a row selects it as it does in Library.

## Recently played

Home's row shows what you listened to (A1): a list when you played a list, a song when you
played a song. Lists are kept on this device (`lists.recent` in prefs, twelve of them); the
songs come from each song's last play, which every device reads, so they reach every device.
A song heard as part of a list shows as the list's tile, not a tile of its own. Rooms this
device was in come first, once they ended (`room.past`, the newest eight), and open their
page.

A tile opens its list's page on a tap, as any list's tile does, and playing it is that page's
Play (Xiao, 2026-10-04): a tag's, an artist's, a playlist's, tags combined, an Ask answer's.
An answer is kept with its own answer, so its page opens again after a reload. Songs with no
page of their own (similar ones, ones you picked) play.

The row's **See all** opens Library sorted by Recently played (G1, 2026-10-25):
`/library?sort=lastPlayedAt`, an order for that visit only (`linkedSort`). The order Library
keeps for itself is untouched, so Library opened any other way is as it was; choosing an
order there takes the shown one over and keeps it.

## Motion

When something plays from a page that cannot show Up next, its first covers lift and land on
the Up next button — the mini player's on a phone, the player bar's on a computer — and the
button swells once (`MOVE_MS.flight`, `flightStagger`, `landing`). It replaces the
"N songs up next" toasts and any idea of Up next opening by itself. Nothing flies while Up
next is open: its rows arriving say it. Only position, size and opacity move; under Reduce
Motion nothing flies and the button does not swell.

# Tags, playlists, Up next

Three words, one job each. Agreed with Xiao on 2026-10-03 from the lettered proposal
(<https://claude.ai/artifact/R6NgAaCUjvEWkhqjLaXWuU>, picks A1 B1 C1 D1 E1 F1 G1 H1) after
three reviews of it, one for clarity, one for fewer controls, one for motion.

| Word | What it is | Lasts | You |
|---|---|---|---|
| **Tag** | A word you put on songs. Its page is always that one tag. | Forever; fills itself as you tag | Tag songs. "Adding a song" on a tag's page is tagging it |
| **Playlist** | A list you saved: songs you chose, or one that **fills from tags** | Until you delete it | Save something you played, or New playlist |
| **Up next** | What you are listening to now, named after what you played | Until the next Play; then Recently played remembers it | Reorder, remove, add, and **Save** it if you liked it |

The middle ground — tags played together, an answer to Ask, songs found by a search — is
not a thing you have to keep before you can hear it. It is played, Up next wears its name,
and Save turns it into a playlist once you know you want it again. Home's Recently played
remembers what you played, so nothing unsaved is lost by playing something else.

The verbs: **Play** (replaces Up next, from anywhere), **Add to Up next**, **Save**,
**Tag**.

| What | Where |
|---|---|
| Where a list came from, what Up next calls it, what Save makes, Recently played's rules | `apps/app/src/features/lists/lists.model.ts` |
| Save | `apps/app/src/features/lists/useSaveUpNext.ts` |
| After a song played alone, Clear the rest, the rail's hint | `apps/app/src/features/queue/OnlySongEnd.tsx`, `useQueueEdits.ts`, `useRailHint.ts` |
| Recently played, kept on this device | `apps/app/src/features/lists/recentLists.store.ts` |
| The line over Up next's songs | `apps/app/src/features/queue/UpNextSource.tsx` |
| A tag's page, and tags together on top of it | `apps/app/src/features/tag/PlacePage.tsx`, `CombinedScreen.tsx` (`/combined`) |
| Tag songs… | `apps/app/src/features/tag/TagScreen.tsx`, `apps/app/src/features/playlistDetail/AddSongsSheet.tsx` |
| Ask's song answer: the card and the page | `apps/app/src/features/smart/SongsAnswerCard.tsx`, `AnswerScreen.tsx` (`/answer`) |
| Covers flying into the Up next button | `apps/app/src/ui/coverFlight.ts`, `apps/app/src/ui/components/CoverFlight.tsx`, `apps/app/src/features/queue/useFlyToUpNext.ts` |

## A song picked from Library

A tap (or a click, or the row's ▶) on a song in Library plays **that song alone**: Up next
becomes just it, and whatever it held before is gone (Xiao, 2026-10-03). The palette's song
rows and lyric hits do the same: it searches the whole library, so there is no list around
the song (`playAlone` in `lists.model.ts`). It used to be the
whole library from that row, which put every row above it in Up next as already played and
every row below it as next. The whole list plays from **Shuffle** — the head on a computer,
next to Sort on a phone — or **Play these tags** with tags on. A tag's, an artist's or a
playlist's page still plays its list from the row. One song is not a list: Up next wears no
name for it and offers no Save, and Recently played shows it as that song.

When that song ends, nothing else plays, but the silence is explained (A1, 2026-10-08). The
song stays loaded, paused at its end, so the mini player or the player bar stays too; a toast
says **That was the only song** with **Up next** to open it (unless Up next is open already),
and Up next shows the same line under the song (marked *Played* in the phone's sheet), with
two buttons: **Songs like this** (the song menu's Play similar songs) and **Shuffle library**
(Library's Shuffle with no tags on). Playing, seeking or Previous on the song puts both away. A list that
runs out — a tag, a playlist — keeps its plain end: it was asked for whole
(`onlySongEnded` in `features/queue/queue.model.ts`, `OnlySongEnd.tsx`).

## Taking songs out of Up next

A phone swipes a row left; a computer drags it out of the rail, or right-clicks it or presses
Delete. Each comes with **Undo** for five seconds, which puts the song back beside the songs
it was between. The first time the rail is open with a song after the playing one, a small
hint under it says "Drag a song out to remove it, or right-click for more." — until anything
is done in the rail or for six seconds, and never again on that device (N2; `useRailHint.ts`).

The phone sheet's **Clear the rest** takes out every song but the one playing — the ones to
come and the ones played — and the music, the sheet and the mini player carry on (C1). It is
an outlined pill, not a second Shuffle, and is greyed when there is nothing to clear. The
toast says "Cleared 30 songs" with Undo, which puts them all back in their places while the
same song is playing; songs added since stay after them.

## Where a list came from

Every Play says what it is playing: `player.playFrom(ids, index, { source })` and
`player.playShuffled(ids, source)` (`ListSource` in `lists.model.ts`). A tag, an artist, a
playlist, tags combined, an answer to Ask, songs (similar to a song, songs you picked,
forgotten gems, found by a search, songs that need a tag, Home's Recently played songs), or
the whole library. Left out, Up next is nameless — a handoff from another device, the car.
The source rides in the playback session (`player/session.model.ts`), so a reopened app
comes back by the same name.

The line is drawn from the source **as the library has it now**: a renamed tag shows its new
name; a tag or playlist deleted while it plays reads "Late drive (deleted)", and Save comes
back for it. Tapping the line opens what it names.

## Save

Shown only where saving would make something new (`savePlan`): never for a tag, an artist,
a playlist or the whole library, which are places of their own, and never for one song.
Nor for songs that need a tag, a chore rather than a list, or Home's Recently played songs,
which Home already keeps (and which Recently played does not remember as a list of its own).

- **Tags combined** make a playlist that fills from them (`followRules`), so new songs join.
- **Anything else** makes a playlist of the songs in Up next as they are, in the list's own
  order rather than the shuffle (`songsToSave`). A song swiped out of an answer stays out.
- **Edits to Up next while a tag or a playlist plays change nothing lasting** (G1): there is
  no "changed" state and no question at save time. Lasting edits to a playlist happen on
  its page; to keep a song out of a tag, untag it.

It asks nothing. Up next then wears the playlist's name, the button turns into **✓ Saved**
where it stood, and the toast offers Open and Undo. Recently played's tile becomes that
playlist (`noteListSaved`), so playing it again does not offer Save again.

There is no Save on a tag's page, an artist's page or Library's head any more. An Ask answer
you already trust has **Save as playlist** in its ⋯. New playlist (N1) still makes a
playlist directly; it is the one place whose whole job is that.

## Tags together

A tag's page is always that one tag (B1). **Combine with…** on its head (H1) opens the
picker; what is picked opens as a page of its own, `/combined?tags=…&artists=…`, pushed on
the tag page's own stack — Back comes back to the tag, and the Library tab's own filter is
never touched (it is shared app-wide). Its chips are its address: one taken off or added
rewrites it in place, and down to one it becomes that tag's or artist's own page. A
combination always **widens** (any of them); narrowing is still the open question from the
Sep 18 combining canvas.

Library's tag strip still combines too, as a filter of the library: with tags on, Up next
is named after them the same way.

## Ask's song answer

In Search the answer is one card (C1): **▶** plays it at once, and the card opens it as a
page. The page is a list of songs like any other: the head a tag's page has (covers, "✦
Picked for you" over the list's own name, what it understood as chips), **Play**, **Shuffle**,
**Different songs** and **⋯** (Add to Up next, Save as playlist), and under it the same
rows a playlist draws (`ui/components/OrderedSongList.tsx`, shared with the playlist
page): select them, hold one to move it, the ⋯ for the song. The order you put it in is
the order it plays and saves in while the app is open. Different songs sends the picks it
showed as `avoid` (`DescribeRequest`), and the server picks around them while anything else
fits. Answers are kept in memory (`smart/answers.store.ts`); an address to one from before a
reload says so.

## Recently played

Home's row shows what you listened to (A1): a list when you played a list, a song when you
played a song. Lists are kept on this device (`lists.recent` in prefs, twelve of them); the
songs still come from the server's plays, so they reach every device. A song heard as part
of a list shows as the list's tile, not a tile of its own. A tile opens its list's page on a tap,
as any list's tile does, and playing it is that page's Play (Xiao, 2026-10-04): a tag's,
an artist's, a playlist's, tags combined, an Ask answer's. An answer is kept with its own
answer, so its page opens again after a reload. Songs with no page of their own (similar
ones, ones you picked) play.

## Motion

When something plays from a page that cannot show Up next, its first covers lift and land on
the Up next button — the mini player's on a phone, the player bar's on a computer — and the
button swells once (`MOVE_MS.flight`, `flightStagger`, `landing`). It replaces the
"N songs up next" toasts and any idea of Up next opening by itself. Nothing flies while Up
next is open: its rows arriving say it. Only position, size and opacity move; under Reduce
Motion nothing flies and the button does not swell.

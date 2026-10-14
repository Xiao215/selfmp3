# Multi-select and batch actions

Selecting several songs and doing one thing to all of them — playing them, adding them to Up
next or a playlist, tagging them, sharing them, keeping them on the device, or deleting them
from the library. Library, Search, a tag's, an artist's or a combination's page, a playlist
and an Ask answer all select the same way.

| What | Where |
|---|---|
| The selection's rules | `packages/client/src/selection/selection.ts` |
| The hook a list uses | `apps/app/src/selection/useSelection.ts` |
| A row's press, hold, tick and drag | `apps/app/src/ui/components/useSongRows.tsx`, `SongRow.tsx`, `Checkbox.tsx` |
| A list's keys: arrows, Space, ⌘A | `apps/app/src/selection/useListKeys.web.ts`, `apps/app/src/shell/keyOwner.ts` |
| The bar, and where a page puts it | `apps/app/src/ui/components/SelectionBar.tsx`, `useListSelectionBar.tsx` |
| What More offers (the song menu's items, for many) | `apps/app/src/ui/songActions.model.ts`, `apps/app/src/ui/components/SongActionItems.tsx` |
| Select songs in a list's ⋯ | `apps/app/src/ui/components/useListActions.tsx` |
| The delete confirmation | `apps/app/src/ui/components/ConfirmRemoveSongs.tsx` |
| Removing from a playlist, with Undo | `apps/app/src/features/playlists/usePlaylistRemoval.ts` |
| Result messages | `apps/app/src/ui/toast.ts`, `apps/app/src/ui/components/ToastHost.tsx` |
| Bulk routes | `apps/server/src/routes/songs.ts`, `routes/playlists.ts`, `routes/tags.ts` |
| Removing a song, everything hanging off it | `apps/server/src/services/songRemoval.ts` |
| Bulk SQL | `apps/server/src/repositories/songs.ts`, `repositories/playlists.ts` |
| Wire schemas | `packages/shared/src/schemas/song.ts`, `schemas/playlist.ts` |
| Tests | `apps/server/src/repositories/bulk.test.ts`, `apps/server/src/services/songRemoval.test.ts`, `apps/app/src/selection/useListKeys.test.tsx`, `verify/flows/selection.spec.ts` |

## Getting into it

Three ways in, because a computer and a phone are not the same machine:

- **The circle in the row.** With a mouse it waits in every row and shows when the pointer
  arrives, like the row's ▶ and ⋯; once anything is selected it is out in every row, because
  the list has to show which rows are ticked. A finger gets no circle waiting: it holds a row,
  and the circles come then.
- **Holding a row**, wherever holding does not move the row: Library, a tag's, an artist's
  or a combination's page, Search, and a playlist that fills from tags. Library shows a
  finger doing it once, on the second visit ([guides.md](guides.md)). The bar's **Done** is
  how you leave.
- **Select songs, in the list's own ⋯** — every list page has it, and it is the only way in on
  a playlist you made and on an Ask answer, where holding a row moves it.

Shift-click and Cmd/Ctrl-click work too, as accelerators, and so does a computer's keyboard
(below).

## What a press means

| Gesture | Not selecting | Selecting |
|---|---|---|
| Click / tap a row | Puts any selection down, and plays (what playing means is the list's) | Toggles that row |
| Cmd/Ctrl-click | Toggles that row | Toggles that row |
| Shift-click | Selects the range from the last row clicked | Same |
| Click the circle | Toggles, and shows every row's circle | Toggles |
| Hold a row | Starts selecting with it | Toggles that row |
| ↑ / ↓ on a row | Moves to the row above or below | Same |
| Space on the row the keyboard is on | Ticks it, as its circle does | Same |
| Enter on a row | A plain click: puts any selection down, and plays | Toggles that row |
| ⌘A or Ctrl+A | Selects every song in the list | Same |
| Escape | — | Clears the selection and stops selecting |

**The keyboard, on a computer** (browser and the installed app; a phone has none). Every
list that selects answers it: Library, Search, a tag's, an artist's or a combination's page, a
playlist and an Ask answer (`useListKeys`, wired once in `useSongRows`). Tab reaches a row, or
a click leaves focus on one; the arrows then move from row to row, skipping an artist page's
album heads, and scroll the row out from under a bar pinned at the top. The row the keyboard is
on wears the focus ring round its whole width and shows its circle, ▶, + and ⋯ as the pointer
would.

Space is the row's only while that ring shows — Tab or an arrow brought focus there. After a
click there is no ring, and Space is still play and pause: clicking a song and pressing Space
to pause it must not tick it. The page's play and pause stands aside for a ringed row
(`rowOwnsKey` in `shell/keyOwner.ts`), and the list listens before the row's own button,
which would otherwise take Space as a press and play the song. A held Space ticks once.

⌘A takes either ⌘ or Ctrl, since neither means anything else on a page. It stands aside in a
text field, where it selects the words (the palette's box, Library's search), in a menu,
dialog or list box, and while a sheet, popover or dialog is open over the page
(`shell/layers.ts`), so the songs under an open More are not changed beneath it. Only the
page in front listens: a page pushed over Library leaves Library mounted, and its ⌘A must not
select Library's songs. Settings › Keyboard shortcuts lists these keys after the menu's.

**What a hold means: two things, one rule** (Xiao chose D1, 2026-10-08). In a list whose order
you set — a playlist you made, an Ask answer, Up next — holding a row lifts it to be moved: the
order is yours there, and reordering has nowhere else to live on a touch screen
(`apps/app/src/ui/components/HoldToReorder.tsx`). Everywhere else holding selects, Search
included. A playlist that fills from tags has no order to change, so holding selects there
too. Holding never opens the song menu; the ⋯ and a right-click do. The Tags and Playlists pages'
tiles are not song rows: holding one opens its menu (a playlist's is its page's ⋯, without
Select songs).

"Selecting" is the explicit mode the hold, the circle and Select songs turn on. It exists
because a phone has no modifiers: in it a tap selects instead of playing, and the circles stay
out. Cmd- and Shift-click do **not** turn it on, so a plain click after them still puts the
selection down and plays.

## The rules that make a selection trustworthy

**The selection is always a subset of what you can see.** The hook is given the *filtered,
sorted* list on screen. A song that leaves that list — because a search was typed, or a tag
filter changed, or it was deleted — leaves the selection with it. Clearing the filter does not
bring it back: it was dropped, not hidden. "Delete 40 songs" must mean the forty you are
looking at; keeping hidden songs selected and quietly acting on them is how a search box
deletes music you never saw.

**Select all means what the list shows, and says so.** The bar's tri-state checkbox selects
every row currently in the list, and the line beside the count says what that is: "every song
in this view" while Library's search or a tag filter is on, "everything in your library" when
it is not, and "in this tag", "in this playlist", "in these results" or "in this answer"
elsewhere.

**Re-sorting is not a change of contents.** Changing the sort order or the direction keeps the
selection exactly as it was. A Shift-click range is resolved against the order on screen at the
moment of the click.

**Leaving the page ends the selection.** The selection belongs to the route it was made on;
anywhere else it reads as empty. Coming back to a list still holding a selection made against
a view you have left is the sort of leftover state that gets songs deleted by accident.

**Emptying the selection stops selecting** — the bar's own checkbox, or unticking the last row
— so the bar goes with the ticks (Xiao, 2026-09-25).

## The bar

On a computer the bar never floats over the list: the row it would land on is the one just
ticked. Library and Search give it a lane of its own above the list, so the list is that much
shorter. A tag's, an artist's, a playlist's and an answer's page draw it in the list at the foot
of the page head, and it stays at the top once the head has scrolled away. The lane opens
rather than appearing, and the bar comes down into it. Left to right: the tri-state checkbox,
the count and what "all" means, then Play, Add to Up next and, in a playlist you made,
Remove from this playlist, then More, then Done.

On a phone it floats at the bottom, above the mini player or the tabs, where a thumb is, and
the toast row (`apps/app/src/shell/Shell.tsx`) steps up above it: the count, then Play, Add to
Up next, More and Done as icons on one line, with Select all and a playlist's Remove moved into
More.

- **Play** and **Add to Up next** are in the bar: frequent and harmless. Play names Up next
  "Songs you picked", so Save can keep them ([lists.md](lists.md)).
- **Remove from this playlist** happens at once, with **Undo** for five seconds that puts the
  songs back in their places (`usePlaylistRemoval`); a song's menu removes one song the same
  way. A playlist that fills from tags has no membership to edit, so it offers none.
- **More** is the song menu's own items for every song ticked (`songActions`): Like all /
  Unlike, **Tags…**, Add to playlist, Add to Up next, Share (with a bucket to lend from; see
  [share-links.md](share-links.md)), Download / remove downloads on an installed app (with
  Undo, which downloads them again), and last, set apart and in red, **Delete N songs from
  library…**. It is a popover on a computer and a sheet on a phone. Tags… opens the same picker
  a single song has: search, tick, make a tag on the spot. A tag on every chosen song is
  ticked; one on some of them is a mixed tick, and ticking it puts it on the rest; unticking a
  ticked tag takes it off all of them.

**Dragging carries the selection.** With a mouse, dragging one of the ticked rows onto a
playlist in the sidebar, or onto Up next, carries every ticked song, in the list's order, and
the pill under the pointer says how many. Dragging a row that is not ticked carries that song
alone (`carried` in `useSelection`).

The count is announced to assistive technology through a polite live region, so a
screen-reader user hears "3 selected" without hunting for it.

Every batch action that changed something says so in a toast — "Deleted 3 songs", "Removed 2
songs from Late drive". Toasts live in a module-level queue (`ui/toast.ts`) rather than in a
component, because almost every message is raised by a bar that the action has just emptied
and unmounted. The message has to outlive its sender.

## Deleting from the library

Deleting is one thing, everywhere: the songs leave the library on every device, with their
tags and plays, whatever this device downloaded of them goes, and the bucket lets their files
go once nothing names them ([SYNC.md](../SYNC.md)). There is no "keep the file": the server
keeps no copy of the library to keep, and a copy left on a disk somewhere is exactly how a
removed song comes back.

So the confirmation has one face. It asks *"Delete 4 songs from your library?"*, says they
leave every device with their tags and plays, and that **this can't be undone**. The first
three songs are listed by name, with "and N more", so there is a chance to notice it is the
wrong selection; the button names the count. A failure is shown inside the dialog, which stays
open so trying again is one press. On yes the player lets go of the songs at once — the one
playing stops — rather than after the server answers. The selection bar's Delete and a song's
⋯ are the same dialog (`RemoveSongs`).

## The server

```
POST /api/songs/bulk/delete   { songIds: number[] }
  -> { removed, failed: [{ songId, reason, removed }] }

POST /api/songs/bulk/loved    { songIds: number[], loved: boolean } -> { affected }

POST /api/playlists/:id/songs/remove  { songIds: number[] } -> { removed, playlist }
```

`POST /api/tags/bulk` and `POST /api/playlists/:id/songs` take id lists for tagging and adding.
A batch is at most 2000 ids. The bulk song routes are registered **before** `/songs/:id/…`, or
`/songs/bulk/loved` would be matched by `/songs/:id/loved` with an id of `"bulk"` and 400
instead of reaching the handler. Removing from a playlist refuses a playlist that fills from
tags.

`bulk/delete` goes through `SongRemovalService`, the one list of everything that hangs off a
song: its cover, lyrics, motion curve, lyrics-index rows, any copy of its audio still on the
server's disk, and its files in the bucket, which are put in the cloud trash and deleted once
the snapshot without the song is up and no other song names them. A tag the removed songs were
the last songs of goes too.

- The rows go in **one transaction** (`SongRepository.deleteMany`) and the library version is
  bumped **once**, so a client settles in a single refetch instead of flickering N times.
- The database is strict and the file system forgiving: a file that will not go is reported,
  never a reason to abandon the other thirty-nine. `failed[].removed` says which happened:
  `false` means nothing happened to that song (a stale id), `true` means the row went but a
  file did not.

`deleteMany`, `byIds`, `setLovedMany` and `PlaylistRepository.removeMany` are covered in
`bulk.test.ts` against an in-memory SQLite built from the real migrations, including stale
ids, repeated ids, empty batches and the rollback; `songRemoval.test.ts` covers what goes with
each song.

## Things deliberately left out

- **No undo for Delete from library.** It would need every device to put the song back, and
  the bucket to keep its files; the confirmation carries the weight instead. Removing from a
  playlist and removing downloads can be put back, so they have Undo and no question.
- **No batch "Fix song info".** It is per-song by nature — a choice between candidates, not a
  value to stamp across a selection. Many songs' names are fixed through Ask's tidy instead
  ([ai.md](ai.md)).
- **No selection in Up next or on the Stats pages.** Up next has its own remove and Clear the
  rest ([lists.md](lists.md)).

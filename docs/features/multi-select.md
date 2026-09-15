# Multi-select and batch actions

Selecting several songs and doing one thing to all of them — tagging them, queueing them,
adding them to a playlist, taking them offline, or removing them from the library.

Multi-select existed before this: Cmd-click and Shift-click in the library, and a bar with
Play, Add to queue and Add tag. Nothing said so. There was no checkbox, no button, no hint —
so on a Mac you found it by accident, and on a phone you could not find it at all, because a
touch screen has no Cmd key. The bar could not delete, which was the one thing most often
wanted from it.

Files:

| What | Where |
|---|---|
| The selection itself | `packages/client/src/selection/selection.ts`, `apps/app/src/selection/useSelection.ts` |
| The bar and its actions | `apps/app/src/ui/components/SelectionBar.tsx` |
| The destructive confirmation | `apps/app/src/ui/components/ConfirmRemoveSongs.tsx` |
| Result messages | `apps/app/src/ui/toast.ts`, `apps/app/src/ui/components/ToastHost.tsx` |
| Row checkbox | `apps/app/src/ui/components/SongRow.tsx`, `Checkbox.tsx` |
| Bulk routes | `apps/server/src/routes/songs.ts`, `routes/playlists.ts` |
| Bulk SQL | `apps/server/src/repositories/songs.ts`, `repositories/playlists.ts` |
| Wire schemas | `packages/shared/src/schemas/song.ts`, `schemas/playlist.ts` |
| Tests | `apps/server/src/repositories/bulk.test.ts` |

## Getting into it

Three ways in, because a Mac and a phone are not the same machine:

- **The checkbox in the row.** Invisible until the pointer or the keyboard arrives, like the
  play overlay and the ⋯ already are, and then out and staying out for as long as anything is
  selected. Once one row is ticked every row has to show whether it is ticked too, or the list
  is lying about its own state.
- **The Select button in the header**, next to Play. Always visible, on both sizes. It turns
  into **Done**, which is how you leave.
- **Select, in the song's ⋯ sheet.** This is the phone's way in: the sheet is already what a
  held row opens, and it is where "do this to several of these" has to live when there are no
  modifier keys.

Cmd/Ctrl-click and Shift-click still work for people who know them. They are accelerators now
rather than the only door.

## What a click means

| Gesture | Outside selection mode | In selection mode |
|---|---|---|
| Click / tap a row | Puts the selection down; plays on a phone | Toggles that row |
| Double-click a row | Plays | Plays |
| Cmd/Ctrl-click | Toggles that row | Toggles that row |
| Shift-click | Selects the range from the last row clicked | Same |
| Click the checkbox | Toggles, and enters selection mode | Toggles |
| Space on the focused row | Toggles | Toggles |
| Enter on the focused row | Plays | Toggles |
| Cmd/Ctrl+A inside the list | Selects every row in the list | Same |
| Escape | — | Clears the selection and leaves the mode |

"Selection mode" is the explicit state the Select button and the checkbox turn on. It exists
because a phone has no modifiers: in it a tap selects instead of playing, and the checkboxes
are permanently out. Modifier-driven selection on a desktop does **not** turn it on, so a plain
click there still puts the selection down the way it always did.

Space is claimed by the row when the list is selectable, and stops there — otherwise the same
keystroke would also hit the app-wide play/pause shortcut. Cmd/Ctrl+A is handled on the list
element, so it selects the songs rather than the whole page.

## The rules that make a selection trustworthy

**The selection is always a subset of what you can see.** The hook is given the *filtered,
sorted* list on screen. A song that leaves that list — because a search was typed, or a tag
filter changed, or it was deleted — leaves the selection with it. Clearing the filter does not
bring it back: it was dropped, not hidden.

This is the answer to the only genuinely dangerous question here. "Remove 40 songs" must mean
the forty you are looking at. The alternative — keeping hidden songs selected and quietly
acting on them — is how a search box deletes music you never saw.

**Select all means the filtered set, and says so.** The bar's tri-state checkbox selects every
row currently in the list, and the line under the count reads *"every song in this view"* while
a search or tag filter is on, against *"everything in your library"* when it is not. The word
"all" is never left to mean two things.

**Re-sorting is not a change of contents.** Changing the sort order or the direction keeps the
selection exactly as it was. A Shift-click range is resolved against the order on screen at the
moment of the click, so a range is always the rows between the two you clicked.

**Leaving the page ends the selection.** Coming back to a list still holding a selection made
against a view you have navigated away from is exactly the sort of leftover state that gets
songs deleted by accident.

## The bar

On a computer it is a sticky row at the head of the list, not a floating overlay — it pushes
the songs down rather than sitting on them, and it is nowhere near the player bar, so the two
can never be in each other's way. On a phone it sits at the bottom, within reach of a thumb,
and the toast row (`apps/app/src/shell/Shell.tsx`) lifts above it.

Left to right: the tri-state checkbox (select all / select none), the count, the scope, then
the actions, then Done.

- **Play** and **Add to queue** are in the bar: frequent and harmless.
- **Add tag…** is a dropdown in the bar at desktop width. On a phone it is only in the ⋯ sheet,
  so the bar stays two lines rather than three.
- **Remove from playlist** appears in the bar in a manual playlist. It is not in the ⋯ sheet
  and never wears a bare ✕ — a second ✕ next to the bar's own would be two different exits in
  the same glyph.
- **⋯ More** holds everything that edits the library: love / unlove, add to playlist, add and
  remove tag, download for offline / remove downloads, and last, separated and in red,
  **Remove … from library**. It is a bottom sheet at phone width.

The count is also announced to assistive technology through a polite `aria-live` region, so a
screen-reader user hears "3 songs selected" without hunting for it.

Every batch action that changed something says so in a toast — "Removed 3 songs", "Tagged 2
songs “evening”". Toasts live in a module-level queue (`ui/toast.ts`) rather than in a component,
because almost every message is raised by a bar that the action has just emptied and unmounted.
The message has to outlive its sender.

## Removing, and deleting

The single-song menu has always treated **remove from the library** and **delete the file**
as two different intentions, deliberately not one mis-tap apart. At forty songs that stops
being a nicety, so the batch confirmation is a modal dialog with two faces:

- Untouched, it is a normal dialog: *"Remove 4 songs from your library?"* It explains that the
  songs and their tags, play counts and playlist places go, and that **the audio files stay
  where they are, so a rescan finds them again**.
- Ticking **Also delete the 4 audio files from disk** — its own bordered block, not one more
  line of the paragraph — turns the dialog red, and rewrites the heading to *"Delete 4 files
  from disk?"*, the body to *"This cannot be undone"*, and the button to *"Delete 4 files"*.

Both faces name the count. The first three songs are listed by name, with "and N more", so
there is a chance to notice it is the wrong selection. Focus lands on **Cancel**, never on the
destructive button: a stray Enter arriving from whatever opened the dialog must not delete
anything.

Note that removing while keeping the files is genuinely reversible and genuinely temporary:
if the watched-folder scanner is on, the songs come back on the next scan, which is exactly
what the dialog promises. Only the file-deleting path is permanent.

## The server

```
POST /api/songs/bulk/delete   { songIds: number[], deleteFile?: boolean }
  -> { removed, filesDeleted, failed: [{ songId, reason, removed }] }

POST /api/songs/bulk/loved    { songIds: number[], loved: boolean } -> { affected }

POST /api/playlists/:id/songs/remove  { songIds: number[] } -> { removed, playlist }
```

`POST /api/tags/bulk` and `POST /api/playlists/:id/songs` already took id lists and are reused
as they are.

The bulk routes are registered **before** `/songs/:id/…`, or `/songs/bulk/loved` would be
matched by `/songs/:id/loved` with an id of `"bulk"` and 400 instead of reaching the handler.

Inside `bulk/delete`:

- Rows go in **one transaction** (`SongRepository.deleteMany`) and the library version is
  bumped **once**, so the client settles in a single refetch instead of flickering N times.
- The file system is treated as unreliable and the database as authoritative. A file that is
  already gone from disk is reported and skipped, never a reason to abandon the other
  thirty-nine. `failed[].removed` says which happened: `false` means nothing happened to that
  song (a stale id), `true` means the row went but the file did not.
- `deleteFile` defaults to `false` in the schema, the same way it does in the single-song
  route's query string. The dangerous value is never the default.

`deleteMany`, `byIds`, `setLovedMany` and `PlaylistRepository.removeMany` are the only new SQL,
and they are covered in `apps/server/src/repositories/bulk.test.ts` against an in-memory SQLite
built from the real migrations — including the partial-failure paths (stale ids, repeated ids,
empty batches) and the rollback.

## Things deliberately left out

- **No undo.** A toast with an Undo button would need the server to hold removed rows for a
  while, which is a bigger change than this one; the confirmation carries the weight instead.
- **No batch metadata edit.** "Fix metadata" is per-song by nature — it is a choice between
  candidates, not a value to stamp across a selection.
- **No selection in the queue panel or on the Stats pages.** The library and a playlist are
  where batch editing is actually wanted.

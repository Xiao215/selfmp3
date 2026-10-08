# Tagging

Tags are the only way this library is browsed, so they have to be easy to put on, easy to
change, easy to pick from wherever you are, and unmistakable once picked.

Before this, a tag's name and colour were fixed the day it was made (the API could change both;
nothing in the app did), delete was the only change on offer, tags could only be combined with
AND, and there was nowhere to see which songs had none — every import quietly added songs you
would only ever find by searching.

Files:

| What | Where |
|---|---|
| Picking tags to listen to | `apps/app/src/ui/components/ListenTags.tsx`, `apps/app/src/features/library/LibraryScreen.tsx` |
| Tags on a song's row | `apps/app/src/ui/components/SongRow.tsx`, `rowTags.ts`, `useRowTagPicker.tsx` |
| The chip, and its two states | `apps/app/src/ui/components/Chip.tsx`, `tagColors` in `packages/client/src/theme/tokens.ts` |
| Rename, recolour, delete, make | `apps/app/src/ui/components/TagEditor.tsx`, `apps/app/src/features/tags/TagsScreen.tsx` |
| Sidebar rows and ⋯ | `apps/app/src/shell/Sidebar.tsx` |
| The filter itself | `packages/client/src/library/filter.ts`, `apps/app/src/features/library/libraryFilter.tsx` |
| Tagging what is playing | `apps/app/src/shell/PlayerBar.tsx`, `apps/app/src/features/nowPlaying/NowPlayingStage.tsx`, `apps/app/src/ui/components/TagPicker.tsx` |
| Songs with no tag, tagged while they play | `apps/app/src/features/tag/usePlayAndTag.ts`, `apps/app/src/features/tags/TagsScreen.tsx` |
| A tag named like an artist | `apps/app/src/features/tag/ArtistNudge.tsx`, `apps/app/src/features/tag/useArtistNudge.tsx` |

## Picking tags, in the library, at both widths

**Pick tags** beside the title opens the picker — in the page, not over it, so the
head grows and the songs move down. Every tag you turn on adds its songs, the chips you
picked become the title, and the list under the panel is what you have built. Once a tag is
on, the head carries **Play** and shuffle. Saving them as a playlist is Up next's Save,
once they have been heard (docs/features/lists.md).

A phone gets all of that, which it did not before. It had the picker but not the three
buttons — they were drawn only above the breakpoint — so a phone could assemble a list and
had nowhere to start it, and its own Tags page offered instead a bar along the foot with a
count you tapped to be taken to the songs somewhere else. That bar is gone. On a phone the
buttons take a row of their own under the title, Play first and widest; the lane labels in
the picker sit above their chips rather than beside them, the chips are finger-sized, and
the count and **Done** take the panel's foot.

## Picked, and not picked

A chip has two states and they are two *shapes*, not two brightnesses:

- **Not picked** — hollow: no fill, an edge in the tag's colour, the name in it.
- **Picked** — the hue filled in, ringed a shade brighter, with ink that reads on it, and a
  ✓ where several chips are on offer and only some are on (`choice`, which the picker sets;
  a chip that reads a choice back carries an × instead).

They used to be the same pill one step of brightness apart, which among nine tags in nine
hues told you nothing — brighter than what? The colours are `tagColors` in
`packages/client/src/theme/tokens.ts`, so the library's picker, the Tags page, the chips in
the title and the New-playlist "follows" row all say it the same way, on a phone and on a
computer.

There is no third state, and no "everything but": every tag you turn on *adds* its songs, so
"hide these" has nothing left to mean. The **NOT live** chip and the sidebar's **−** went
with the exclusion they carried ("Make tags the thing you play").

Everything here works on every kind of library, a cloud one included: which songs have no
tag is a pass over the library this device already holds, and putting a tag on one is an
ordinary edit, recorded and uploaded like any other. It was hidden from a cloud library for
a while alongside the pages that genuinely do need the server, which was simply a mistake.

## Tags on a song's row

Library, Search and Up next show each row's tags as small chips (`S3`): as many as fit, and a
count for the rest — "fit what fits, count the rest" (settled 2026-09-17; the fitting is
`apps/app/src/ui/components/rowTags.ts`). Rows inside a place — a tag, an artist, a playlist —
leave them off. Since E1 (2026-10-08):

- **On a phone the chips are on the second line**, after "artist · length", so the title has
  the whole row; titles here are long and often in two languages. Same chips, same rule, in a
  lane of their own (`underBudget`). A computer's rows keep their tag column.
- **A chip opens its tag's page**, everywhere. In Library it used to filter the list instead;
  filtering is the tag strip's job, at the top of the page.
- **The count opens the song's tag window** (`useRowTagPicker`), in Search and Up next as well
  as Library, where it used to do nothing.
- **No chip repeats the list.** The tags Library is filtered by, and the tag or tags Up next is
  playing from, are not drawn on its rows.

## Editing a tag

The **⋯** on a sidebar row — or holding a tag's row on **All tags** — opens one editor:
rename, colour, delete. A tag made before the palette existed keeps its own colour as the
first swatch. Delete says how many songs carry the tag and that they stay in the library.

## All tags

Every tag as a place to go, most played first (`P07`): a mosaic of its covers, its dot and
name, its songs and time, and a round **Play**. A row opens the tag's own page
(`/tag/<name>`); holding it opens the editor, which is all the housekeeping the page used to
be. The header's **+** opens the new-tag card — a labelled field and a **Create** beside it,
which stays open after each one because tags arrive in handfuls — and its search button opens
Search on its Tags scope (the palette, on a computer). The sidebar's tag rows and a tag found
in the palette open the same page; the library's own tag strip is the one place a tag is
still a filter.

A tag whose name is an artist's asks first (`P11`): **Open the artist**, or **Make the tag
anyway**. Closing the question any other way makes nothing. It runs wherever a tag is made by
name — the new-tag card, the sidebar's **+** and the picker's **Create…**.

## Tagging what is playing

How a song feels is clearest while it is playing. The tag button beside the heart in the player
bar opens the tag picker for the current song. On a phone, Now Playing shows
the song's tags under its title with **Add tags** / **Edit tags**.

## Songs with no tag

While any song has no tag, **All tags** leads with one card: "N songs have no tag yet". Tapping
it plays them as a queue, newest first, and opens Now Playing with its tag editor raised;
saving a song's tags moves on to the next. The palette's **Tag untagged songs** does the same.
It works on every kind of library: which songs have no tag is a pass over the library this
device already holds.

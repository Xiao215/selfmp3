# Tagging

Tags are the only way this library is browsed, so they have to be easy to put on, easy to
change, easy to pick from wherever you are, and unmistakable once picked.

Files:

| What | Where |
|---|---|
| Picking tags to listen to | `apps/app/src/ui/components/ListenTags.tsx`, `apps/app/src/features/library/LibraryScreen.tsx` |
| Tags on a song's row | `apps/app/src/ui/components/SongRow.tsx`, `rowTags.ts`, `useRowTagPicker.tsx` |
| The chip, and its two states | `apps/app/src/ui/components/Chip.tsx`, `tagColors` in `packages/client/src/theme/tokens.ts` |
| Rename, recolour, delete, make | `apps/app/src/ui/components/TagEditor.tsx`, `apps/app/src/features/tags/TagsScreen.tsx`, `useNewTagForm.tsx` |
| A tag's page, and combining | `apps/app/src/features/tag/TagScreen.tsx`, `PlacePage.tsx`, `AddSheet.tsx`, `CombinedScreen.tsx` |
| Sidebar rows and ⋯ | `apps/app/src/shell/Sidebar.tsx` |
| The filter itself | `packages/client/src/library/filter.ts`, `apps/app/src/features/library/libraryFilter.tsx` |
| Tagging what is playing | `apps/app/src/shell/PlayerBar.tsx`, `apps/app/src/features/nowPlaying/SongTagsLine.tsx`, `useTagging.ts`, `apps/app/src/ui/components/TagPicker.tsx` |
| Songs with no tag, tagged while they play | `apps/app/src/features/tag/usePlayAndTag.ts`, `apps/app/src/features/tags/TagsScreen.tsx` |
| A tag named like an artist | `apps/app/src/features/tag/ArtistNudge.tsx`, `apps/app/src/features/tag/useArtistNudge.tsx` |

## Picking tags, in the library

Under the Library's head runs the tag strip: **All**, **On this phone** on a phone that
keeps songs, the tags used lately, and **More tags**, which opens the picker
(`ListenTags.tsx`) — in the page, not over it, so the head grows and the songs move down.
With nothing typed it offers the tags used most and the few made lately; with something
typed, only the matches. Every tag you turn on *adds* its songs (`filter.ts`: a song
carrying any of them is shown), the chips you picked become the title, and the list under
the panel is what you have built. Once a tag is on, the head carries **Play these tags**
and Shuffle; with none on there is Shuffle alone, since a tap on a row plays that song
alone. Saving what you built as a playlist is Up next's Save, once it has been heard
(docs/features/lists.md).

On a phone the picker's lane labels sit above their chips rather than beside them, the
chips are finger-sized, and the count and **Done** take the panel's foot.

## Picked, and not picked

A chip has two states and they are two *shapes*, not two brightnesses:

- **Not picked** — hollow: no fill, an edge in the tag's colour, the name in it.
- **Picked** — the hue filled in, ringed a shade brighter, with ink that reads on it, and a
  ✓ where several chips are on offer and only some are on (`choice`, which the picker sets;
  a chip that reads a choice back carries an × instead).

Two brightnesses of one pill, among nine tags in nine hues, would tell you nothing —
brighter than what? The colours are `tagColors` in
`packages/client/src/theme/tokens.ts`, so the library's picker, the Tags page, the chips in
the title and a Live playlist's "follows" row all say it the same way, on a phone and on a
computer.

There is no third state, and no "everything but": every tag you turn on *adds* its songs, so
"hide these" has nothing left to mean.

Everything here works on every kind of library, a cloud one included: which songs have no
tag is a pass over the library this device already holds, and putting a tag on one is an
ordinary edit, recorded and uploaded like any other.

## Tags on a song's row

Library, Search and Up next show each row's tags as small chips (`S3`): as many as fit, and a
count for the rest — "fit what fits, count the rest" (settled 2026-09-17; the fitting is
`apps/app/src/ui/components/rowTags.ts`). Rows inside a place — a tag, an artist, a playlist —
leave them off.

- **On a phone the chips are on the second line**, after "artist · length", so the title has
  the whole row; titles here are long and often in two languages. Same chips, same rule, in a
  lane of their own (`underBudget`). A computer's rows keep their tag column.
- **A chip opens its tag's page**, everywhere. Filtering is the tag strip's job, at the top
  of the Library.
- **The count opens the song's tag window** (`useRowTagPicker`), in Search and Up next as well
  as Library.
- **No chip repeats the list.** The tags Library is filtered by, and the tag or tags Up next is
  playing from, are not drawn on its rows.

## Editing a tag

One editor (`TagEditor.tsx`) renames, recolours and deletes. It opens from the ⋯ on a
sidebar tag row, the ⋯ or a right-click on a tile on **All tags** (holding the tile on a
phone), and the ⋯ on the tag's own page. A tag made before the palette existed keeps its own
colour as the first swatch. Delete says how many songs carry the tag and that they stay in
the library. Renamed, the tag's page follows the new name.

## All tags

Every tag as a place to go, most played first (`P07`), laid out as records rather than the
square covers Playlists uses: a tile is the tag's covers, its name, its songs and time. A
tile opens the tag's own page (`/tag/<name>`). With a pointer, the record slides out and
**Play** waits on its label; on a phone a tap opens and holding edits. A tag all of whose
songs another tag carries hangs off that tag's tile as a small chip ("Inside: ● late night
drives… 3"), which opens it, and tags with only a song or two wait at the end, so the page opens on the ones in use. The header's **+** opens the new-tag card —
a name field, the colours and **Create**, which stays open after each one because tags
arrive in handfuls. A new tag left uncoloured — there, in Import, or from Ask's tag review —
takes the palette's hue farthest from every tag's (`newTagHue`, `TAG_HUES` in
`packages/shared/src/editRules.ts`; the server and a cloud library pick alike), the name
choosing between hues as far; the first swatch shows it before Create. Its name alone once
chose, and "calm" came out the red "live" already was (X5, 2026-10-25). The sidebar shows the four tags used last; its TAGS header opens this
page.

Combining is not here: a tag's or an artist's page has **Combine with…** (`AddSheet.tsx`),
which puts tags and artists together on `/combined` (docs/features/lists.md). The library's
tag strip is the one place a tag is still a filter.

A tag whose name is an artist's asks first (`P11`): **Open the artist**, or **Make the tag
anyway**. Closing the question any other way makes nothing. It runs wherever a tag is made by
name — the new-tag card, the sidebar's **+** and the picker's **Create…**.

## Tagging what is playing

How a song feels is clearest while it is playing. **Edit tags** beside the heart in the
player bar opens the tag picker for the current song. Now Playing shows the song's tags
under its title on a phone and a computer alike (`SongTagsLine.tsx`): each chip opens its
tag, and the add chip (**Add tags** / **Edit tags**, a round dashed + on a phone) opens the
picker. A friend's song in a room is not yours to tag, so there the line says who brought
it instead.

## Songs with no tag

While any song has no tag, **All tags** leads with one card: "N songs have no tag yet", and
the artists with the most of them. On a computer each name opens that artist's page, where
Select all and Tag do a batch at once. The card's button plays the songs as a queue, newest
first, and opens Now Playing with its tag editor raised; saving a song's tags moves on to the
next (`usePlayAndTag.ts`). The palette's **Tag untagged songs** does the same. **Suggest
tags** beside it proposes a tag for each of those songs, and Ask can review and put right
the tags of the whole library; both are in [ai.md](ai.md), "Tags: your tags put right".

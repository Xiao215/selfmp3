# Tagging

Tags are the only way this library is browsed, so they have to be easy to put on, easy to
change, and able to say "everything but".

Before this, a tag's name and colour were fixed the day it was made (the API could change both;
nothing in the app did), delete was the only change on offer, tags could only be combined with
AND, and there was nowhere to see which songs had none — every import quietly added songs you
would only ever find by searching.

Files:

| What | Where |
|---|---|
| Rename, recolour, filter, delete | `apps/app/src/ui/components/TagEditor.tsx`, `apps/app/src/features/tags/TagsScreen.tsx` |
| Sidebar rows, hide button, ⋯ | `apps/app/src/shell/Sidebar.tsx` |
| Excluded filter | `packages/client/src/library/filter.ts`, `apps/app/src/features/library/libraryFilter.tsx` |
| Tagging what is playing | `apps/app/src/shell/PlayerBar.tsx`, `apps/app/src/features/nowPlaying/NowPlayingStage.tsx`, `apps/app/src/ui/components/TagPicker.tsx` |
| Untagged inbox and quick tagging | `apps/app/src/features/inbox/InboxScreen.tsx` |

## Hiding a tag

A tag filters one of two ways: **only songs with it**, or **none of them**. Combined, that is
"chill, but not live".

- In the sidebar, click a tag as before to show only it. The **−** that appears on hover hides
  it instead; ⌥-click does the same.
- Under the title, a hidden tag's chip reads **NOT live**. Clicking a chip flips it
  between the two; × takes it off.
- The title follows: "chill · not live", or "Library · not live".

## Editing a tag

The **⋯** on a sidebar row — or, on a phone, a tag on the **Tags** page — opens one
editor: show only / hide, rename, colour, delete. A tag made before the palette existed keeps
its own colour as the first swatch. Delete says how many songs carry the tag and that they
stay in the library.

## Tagging what is playing

How a song feels is clearest while it is playing. The tag button beside the heart in the player
bar opens the tag picker for the current song. On a phone, Now Playing shows
the song's tags under its title with **Add tags** / **Edit tags**.

## Untagged

The sidebar (and, on a phone, the **You** tab) shows **Untagged** with a count
whenever any song has no tag. The page lists them newest first.

**Not reachable today.** The inbox is one of the server-only screens, hidden when the
library is the bucket's, and every surface's now is ([SYNC.md](../SYNC.md), "What this gives
up"). Putting tags on songs is unaffected — that is an edit, and every device can make one.

**Start tagging** goes through them one at a time:

- the song plays (switch off **Play along** to tag in silence);
- **1–9** toggle your tags, numbered most-used first and in the same order for the whole
  session, so "chill" is the same key on the fortieth song as on the first;
- **→** or Enter moves on, **←** goes back, **N** creates a new tag and puts it on this song,
  **Esc** stops;
- when a song ends by itself and the next one starts, the card follows.

The list is fixed when you start, so a song you tag does not vanish from under you, and one you
skip stays in Untagged for next time. The keys are taken in the capture phase, ahead of
anything else listening — in the desktop app the ⌘-arrows are the menu's, and Space is play
and pause wherever you are.

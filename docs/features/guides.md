# One-time guides

How self.mp3 teaches a gesture that nothing on screen shows. Decided 2026-10-13 (UI review
"Fewer words on screen, and a guide the first time", picks A1, B1 + B3, C1–C8, D1).

## What a guide is

It works the way 网易云音乐's guides do. The whole screen goes dark, a spotlight with a dashed
ring is cut around the real thing the gesture works on, and a touch acts the gesture out over
it: a finger's circle, as iOS draws one in a screen recording, leaving a fading streak where
it swipes (H1, 2026-10-13, in place of a drawn hand); with a mouse, the pointer. Where it can,
the lit thing moves with the touch: the row lifts and goes one place down, the cover rises,
the row slides off its red Remove (Import's opens its real swipe, `useOpenWith`). One line says the gesture, with
at most one short line under it. **A tap anywhere closes it** and does nothing else, so the song
under the spotlight does not start. Escape closes it on a computer. A guide with two gestures
has two steps; the first tap moves on.

- Shown **once per device** and remembered the moment it appears (B1), through `prefs` under
  `guides`: the names seen, comma-separated, or `*` for all of them.
- Settings › About › Tips › **Show tips again** forgets them all (B3).
- Only when the gesture would work right now, about 0.7 s after the page settles, and one at a
  time. Under Reduce Motion the touch stands still.
- Per device on purpose: a phone teaches holding and swiping, a computer dragging.

Code: `apps/app/src/features/guide/` (`guide.model.ts` the pure half, `guideMemory.ts` what is
remembered, `useGuide.ts` when one shows and what it lights, `Guide.tsx` the layer, the touch
and the helpers a screen moves its lit thing with). A guide on a page that is a native modal
(Now Playing, the Up next sheet over it) is drawn `inline`, since the root layer sits under the
modal.

## The guides

| Name            | Where                                       | Gesture                                     | Replaces                    |
| --------------- | ------------------------------------------- | ------------------------------------------- | --------------------------- |
| `playlist-move` | A list you order, 2+ songs (phone, computer) | Hold (drag with a mouse) to move            | nothing said it             |
| `library-select`| Library, second visit (finger)              | Hold to select several                       | nothing said it             |
| `lyrics`        | Now Playing, a song with lyrics (phone)     | Swipe up on the cover, or tap it             | nothing said it             |
| `sidebar-drop`  | Sidebar playlists, after ⋯ › Add to playlist (computer) | Drag songs onto a playlist       | nothing said it             |
| `up-next`       | Up next sheet, 2+ to come (phone)           | Swipe left to remove, then hold to move      | the line under the list     |
| `up-next-rail`  | Up next rail (computer)                     | Drag a song out to remove it                 | the rail's hint bubble (N2) |
| `import-rows`   | Import list, 2+ rows that swipe (phone)     | Swipe left for Next and Remove               | nothing said it             |
| `tag-hold`      | Tags (finger)                               | Hold a tag to rename, recolour or delete it  | the footer line             |
| `import-review` | Import review (phone)                       | Tap a song to hear it; untick to leave it out| the line over the list      |
| `import-box`    | Import, first visit                         | Search for a song, or paste a link           | the paragraph over the box  |

Left without a guide, because they are standard or show themselves: pull to refresh, pulling a
sheet down, the seek bar, Shift-click and ⌘-click, the song list scrollbar.

## Tests

Automated runs start with every guide seen: `verify/playwright.config.ts` seeds
`selfmp3.guides = *`, the desktop smoke writes the same, and the Maestro flows close a guide if
one is up (`apps/app/.maestro/close-guide.yaml`). `verify/flows/queue.spec.ts` clears it to check
the rail's guide shows once.

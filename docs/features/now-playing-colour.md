# Now playing, in the song's colour

The song that is playing is marked in the colour of its own cover, not the app's violet: the
list row, the player bar, and the phone's mini player. Options were mocked first and chosen:
the wash on the row comes in from the right, and the progress wash lives on the player bar.

Files:

| What | Where |
|---|---|
| Picking the colour from pixels (tested) | `apps/web/src/lib/coverColor.ts` |
| Reading a cover, caching the result | `apps/web/src/lib/useCoverColor.ts` |
| The row | `apps/web/src/components/SongRow.tsx`, `styles/parts/songs.css` |
| The player bar and mini player | `apps/web/src/components/PlayerBar.tsx`, `styles/parts/player.css`, `mobile.css` |

## What you see

- **The playing row** takes a wash of the cover's colour from the right edge, gone by the
  middle — the cover already fills the left. Its title and the equaliser bars in the number
  column take a light version of the colour. On a phone, with no number column, the bars sit
  on the cover. Paused, the bars hold still instead of disappearing.
- **The player bar** fills with the colour from the left up to where the song has got to, with
  a soft leading edge and a thin glowing line along its top. The scrubber stays for seeking
  and takes the colour too. The phone's mini player fills the same way, with the line along
  its foot.

## How the colour is picked

Only for the song that is playing. Its cover — already on screen, so already cached — is drawn
into a 24×24 canvas and read back. In OKLCH, pixels are grouped by hue and weighted by how
colourful they are; near-black and near-white are skipped, so the dark skyline on the THE
BOOK covers does not win over the sky. The heaviest hue becomes two colours: one at mid
lightness for washes and lines, one light for text, so a dark cover never makes a dark title.
Pale covers are pushed up in saturation, or the row would wash in grey.

A cover with no real colour in it falls back to the accent, and a song with no cover uses its
generated placeholder's hue. Results are kept for the session per song and cover revision; a
read that fails is retried twice and then left for the next time the song plays.

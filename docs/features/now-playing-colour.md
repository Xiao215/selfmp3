# Now playing, in the song's colour

The song that is playing is marked in the colour of its own cover, not the app's violet: the
list row, the player bar, and the phone's mini player. Options were mocked first and chosen:
the wash on the row comes in from the right, and the progress wash lives on the player bar.

Files:

| What | Where |
|---|---|
| Picking the colour from pixels (tested) | `packages/shared/src/coverTone.ts` |
| Picking it once per cover, on the server | `apps/server/src/services/coverTones.ts` |
| Turning a colour into wash and text colours | `packages/client/src/art/coverColor.ts` |
| The colour for the playing song | `apps/app/src/ui/useSongColor.ts`, `apps/app/src/ports/coverPixels.ts` (+ `.web.ts`) |
| The row | `apps/app/src/ui/components/SongRow.tsx`, `Equalizer.tsx` |
| The player bar and mini player | `apps/app/src/shell/PlayerBar.tsx`, `apps/app/src/ui/components/MiniPlayer.tsx`, `ProgressWash.tsx` |

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

The server picks each cover's colour once (`coverTones.ts`): ffmpeg draws the cover at
24×24, and the result travels with the song as `coverTone`, in the API and in the
snapshot, so a phone never decodes a cover itself. It works through the covers in the
background at start and again whenever one is saved. A song the server has not read yet is
read on the device where the platform can (a canvas in a browser), and the accent stands
in until then.

The picking (`pickCoverTone`) works in OKLCH: pixels are grouped by hue and weighted by how
colourful they are; near-black and near-white are skipped, so the dark skyline on the THE
BOOK covers does not win over the sky. The heaviest hue becomes two colours
(`songColors`): one at mid lightness for washes and lines, one light for text, so a dark
cover never makes a dark title. Pale covers are pushed up in saturation, or the row would
wash in grey.

A cover with no real colour in it (black and white) washes the row in its own grey and
keeps the accent for the text, so it still reads as playing, not selected. A song with no
cover uses its letter tile's hue. Only the playing song is ever asked for its colour,
never a whole list.

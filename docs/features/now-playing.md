# Now playing

A page for the song that is playing: its artwork, what the app knows about it, and its
lyrics — or, for a song with no words, something to look at instead.

## Opening it

| From | Does |
|---|---|
| The artwork, title and artist in the player bar | Opens **Stage**; again closes it |
| The mic button in the bar | Opens straight into **Focus**; again closes it |
| ⤢ on the lyrics' top-right corner, ⤡ in Focus | Switches between the two |
| The ⌄ in the corner | Steps back one level: Focus → Stage → closed |
| The ⓘ, or the title | Opens the song's own page, `/song/<id>` |

The page covers the library, not the player bar, so play and pause never move under your
hand. The view underneath stays mounted — its scroll position, search and filters are
where you left them when you close the page. The practice panel opens beside it.

## Stage and Focus

One page, two modes. **Stage** has the artwork, title, tempo, energy, key and tags on the
left, and on the right two tabs: **Lyrics** (or **Visual**) and **About** (the same facts as
the end of the song's own page). Up next is not a tab: it is the rail beside the page on a
computer and a sheet on a phone (`features/queue`, docs/ui-mock `C11`, `P25`), opened from the
player bar, the mini player or the page's foot. **Focus** is the same page when only
the words matter: the cover glides into the header, the title follows it, and the lyrics
widen and grow around the line being sung. In Focus:

- the line being sung fills in from left to right as it is sung. `.lrc` files are timed
  per line, not per word, so the fill is spread evenly between one line's timestamp and
  the next;
- lines further from it blur slightly;
- after three seconds without the mouse or a key, the header and the player bar fade out
  and the words take the whole window. Any movement brings them back.

Switching moves every piece between its Stage position and its Focus position
(`StageMove`, `stageMove.model.ts`), so nothing remounts and the line you are reading never
leaves the screen. The page fits a wide window, a narrow one, and a page sharing the window
with the practice panel. With Reduce Motion on, the switch is instant.

The page takes its glow from the cover's own colours: a 24-pixel thumbnail of the art is
sampled in the browser (`paletteFromPixels` in `packages/client/src/art/palette.ts`, read by
`ports/coverPalette.web.ts`). A song with no art uses
the same hue as its placeholder cover.

## Lyrics on the page

- The line being sung stays at the same height; the list moves under it. Scroll by hand to
  read ahead and the auto-centring holds off for four seconds.
- Click a line to jump there. **Right-click a line to loop it** — the Practice A–B loop,
  set from that line's timestamp to the next one's.
- **Romaji** / **Pinyin** shows the romanization under each line (Chinese and Japanese
  only; see [lyrics-plus.md](lyrics-plus.md)).
- While the page is closed, the current line of a song with timed lyrics rides under the
  artist in the player bar. It only uses lyrics the app already has — it never causes a
  lookup.
- In the last fifteen seconds of a song, a card says what is next; clicking it skips there.

## Songs with no words

A song never opens onto an empty page. When there are no lyrics, the words area shows a
visual drawn from the song itself. "No lyrics" is one state — a saved answer that the song
has no words and a lookup that found nothing look the same (see
[lyrics-plus.md](lyrics-plus.md#songs-with-no-words) for the flag the server keeps).
**Style ▾** chooses another visual, or looks for lyrics again.

Two visuals (docs/ui-mock `P23`, `P24`, `C10`), drawn on a canvas each frame in a browser
(`SongVisual.web.tsx`) and with views on a phone (`SongVisual.tsx`), from the same rules in
`visuals.model.ts` and `visualMotion.model.ts`:

| Visual | What it draws |
|---|---|
| Horizon | A sun over three lines of hills. Each line is the loudness heard so far, rolling in from the right at its own pace; the sun swells on each hit and glows with the level |
| Ripples | A disc in the cover's colours sending out a ring on each hit, its size and fade set by the hit's strength |

Which one a song gets is picked from how it sounds (`autoVisual`): from 0.5 energy
**Ripples**, below it or not analysed yet **Horizon**. The look picker chooses the other for
that song, and the choice is kept on this device; a choice saved for one of the four older
visuals goes back to Auto.

The page is laid out the same way whether a song has words or not: the visual takes the
column the lyrics would have run in, rounded like a card, and the cover, the title and the
tabs keep the places they have on a song with words. Expanding gives the visual the whole
window, as it gives the words the whole page; it fades into its new place rather than
gliding, because a canvas cannot be stretched between the two. On a phone the visual sits
in the words' own area on the second view, with the header and the transport on the page's
usual ground.

**What moves them** (`motionSource.ts`), in this order. Where the browser can listen
(`ports/liveAudio`: Chrome, Edge, Firefox, the desktop app) the engine's Web Audio analyser
(`analyser()` in `ports/engine.web.ts`) is the sound itself. Everywhere else — a phone,
Safari, a touch browser, a cloud library, offline — the song's motion curve, worked out by
the server when it analysed the song, is played back against the playhead. A song with
neither falls back to a stand-in drawn from its tempo and energy. A quiet line in the
**Style ▾** menu says which: *Following the sound*, *Following the song* or *Following the tempo*.

## On the phone

No tabs at the top (docs/ui-mock `P21`): the ⌄, the words "Now playing", and ⓘ, which opens
the song's own page. The cover breathes — a little smaller while paused, full size while
playing — with the title, the artists (each a link), the tags, the scrubber and the round
Play under it. The foot is **Lyrics** (or **Visual**), **Sleep**, **Up next** and a ⋯ with
Devices, Practice and Download. Swiping up, the Lyrics pill or a tap on the cover opens the
lyrics on their own (`/now-playing?view=lyrics`, `P22`); swiping down comes back.

## Files

| What | Where |
|---|---|
| Page | `apps/app/src/features/nowPlaying/NowPlayingScreen.tsx` (route `apps/app/app/now-playing.tsx`), `NowPlayingStage.tsx` |
| Lyrics, visual, status line | `nowPlaying/StageLyrics.tsx`, `SongVisual.tsx` (+ `.web.tsx`), `VisualStyleMenu.tsx` |
| Lyrics state, cover colours, Stage ↔ Focus | `nowPlaying/useSongWords.ts`, `useCoverPalette.ts`, `stageMove.model.ts` |
| Up next | `apps/app/src/features/queue/` (`QueueSheet.tsx`, `QueueRail.tsx`, `queue.model.ts`) |
| Visual choice, motion, palettes | `apps/app/src/features/nowPlaying/visuals.model.ts`, `visualChoice.ts`, `motionSource.ts` (+ tests) |
| Playhead and analyser | `apps/app/src/ports/engine.web.ts`, exposed by `apps/app/src/player/PlayerProvider.tsx` |
| Shell, keys, the bar | `apps/app/src/shell/Shell.tsx`, `useHotkeys.web.ts`, `PlayerBar.tsx` |

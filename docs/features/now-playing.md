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
| The queue button, with the page open | Shows the page's **Up next** tab |

The page covers the library, not the player bar, so play and pause never move under your
hand. The view underneath stays mounted — its scroll position, search and filters are
where you left them when you close the page. The practice panel opens beside it.

## Stage and Focus

One page, two modes. **Stage** has the artwork, title, tempo, energy, key and tags on the
left, and on the right one of three tabs: **Lyrics** (or **Visual**), **Up next** (the
queue) and **About** (the same facts as Song details). **Focus** is the same page when only
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
visual drawn from the song itself, with one line under it: *No lyrics · 140 BPM · A minor*,
leaving out what is not known (`visualCaption`). "No lyrics" is one state — a saved answer
that the song has no words and a lookup that found nothing look the same (see
[lyrics-plus.md](lyrics-plus.md#songs-with-no-words) for the flag the server keeps).
**Style ▾** chooses another visual, or looks for lyrics again.

Four visuals, drawn on a canvas each frame in a browser (`SongVisual.web.tsx`) and with
views on a phone (`SongVisual.tsx`), from the same rules in `visuals.model.ts`:

| Visual | What it draws |
|---|---|
| Aurora | Slow bands in the cover's colours |
| Pulse | The cover breathing on each beat, sending out a ring |
| Spectrum | Frequency bars standing on a faint reflection |
| Drift | Specks orbiting the centre, faster the louder it is, thrown outward on a hit |

Which one a song gets is picked from how it sounds (`autoVisual`): below 0.35 energy, or
not analysed yet, **Aurora**; from 0.7, **Spectrum**; in between, **Pulse** when the beat
is steady (danceability 0.6 and up) and **Drift** when it is not. The name under the visual
is a menu: choose another for that song and the choice is kept on this device.

**What moves them** (`motionSource.ts`), in this order. Where the browser can listen
(`ports/liveAudio`: Chrome, Edge, Firefox, the desktop app) the engine's Web Audio analyser
(`analyser()` in `ports/engine.web.ts`) is the sound itself. Everywhere else — a phone,
Safari, a touch browser, a cloud library, offline — the song's motion curve, worked out by
the server when it analysed the song, is played back against the playhead. A song with
neither falls back to a stand-in drawn from its tempo and energy. The line under the caption
says which: *Following the sound*, *Following the song* or *Following the tempo*.

## On the phone

The full-screen player keeps its layout. Tap the artwork — or **Lyrics** in the footer — and
the lyrics (or the song's visual) take the artwork's place, so the title, scrubber and
buttons never move and you can read along and still skip. The small cover in the corner
brings the artwork back.

## Files

| What | Where |
|---|---|
| Page | `apps/app/src/features/nowPlaying/NowPlayingScreen.tsx` (route `apps/app/app/now-playing.tsx`), `NowPlayingStage.tsx` |
| Lyrics, visual, status line | `nowPlaying/StageLyrics.tsx`, `SongVisual.tsx` (+ `.web.tsx`), `VisualStyleMenu.tsx` |
| Lyrics state, cover colours, Stage ↔ Focus | `nowPlaying/useSongWords.ts`, `useCoverPalette.ts`, `stageMove.model.ts` |
| Up next | `nowPlaying/StageQueue.tsx` |
| Visual choice, motion, palettes | `apps/app/src/features/nowPlaying/visuals.model.ts`, `visualChoice.ts`, `motionSource.ts` (+ tests) |
| Playhead and analyser | `apps/app/src/ports/engine.web.ts`, exposed by `apps/app/src/player/PlayerProvider.tsx` |
| Shell, keys, the bar | `apps/app/src/shell/Shell.tsx`, `useHotkeys.web.ts`, `PlayerBar.tsx` |

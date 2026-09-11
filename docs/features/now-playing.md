# Now playing

A page for the song that is playing: its artwork, what the app knows about it, and its
lyrics — or, for a song with no words, something to look at instead.

## Opening it

| From | Does |
|---|---|
| The artwork, title and artist in the player bar | Opens **Stage**; again closes it |
| `L`, or the mic button in the bar | Opens straight into **Focus**; again closes it |
| `F`, the **Focus** / **Stage** button, or double-clicking the lyrics or the visual | Switches between the two |
| `Esc` or the ⌄ in the corner | Steps back one level: Focus → Stage → closed |
| `Q` or the queue button, with the page open | Shows the page's **Up next** tab |

The page covers the library, not the player bar, so play and pause never move under your
hand. The view underneath stays mounted — its scroll position, search and filters are
where you left them when you close the page. The practice panel (`P`) opens beside it.

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

Switching is one class on the page — every piece has a Stage position and a Focus position
in `feat-now-playing.css` and moves between them, so nothing remounts and the line you are
reading never leaves the screen. Sizes come from container units, so the page fits a wide
window, a narrow one, and a page sharing the window with the practice panel. With Reduce
Motion on, the switch is instant.

The page takes its glow from the cover's own colours: a 24-pixel thumbnail of the art is
sampled in the browser (`paletteFromPixels` in `lib/visuals.ts`). A song with no art uses
the same hue as its placeholder cover.

## Lyrics on the page

- The line being sung stays at the same height; the list moves under it. Scroll by hand to
  read ahead and the auto-centring holds off for four seconds.
- Click a line to jump there. **Right-click a line to loop it** — the Practice A–B loop,
  set from that line's timestamp to the next one's.
- **Romaji** / **Pinyin** shows the romanization under each line (Chinese and Japanese
  only; see [lyrics-plus.md](lyrics-plus.md)). **Sync** opens the timing editor in place,
  and **Look again** asks lrclib afresh.
- While the page is closed, the current line of a song with timed lyrics rides under the
  artist in the player bar. It only uses lyrics the app already has — it never causes a
  lookup.
- In the last fifteen seconds of a song, a card says what is next; clicking it skips there.

## Songs with no words

A song never opens onto an empty page. When there are no lyrics, the words area shows a
visual drawn from the song itself, with one line under it saying why:

- **Instrumental** — the song is known to have no words (lrclib said so, it has a tag
  called "instrumental", or you chose **Mark as instrumental** from its ⋯ menu). No nudge to
  add lyrics. See [lyrics-plus.md](lyrics-plus.md#instrumental-songs) for how the flag is
  kept.
- **No lyrics found** — offers **Look again**, **Write them**, and **It's instrumental**.

Four visuals, all drawn on a canvas each frame (`components/nowplaying/visualDraw.ts`):

| Visual | What it draws | Moved by |
|---|---|---|
| Pulse | The cover breathing on each beat, sending out a ring | Tempo; energy sets how far the rings travel |
| Aurora | Slow ribbons in the cover's colours | Energy sets the drift, danceability the ripple |
| Spectrum ring | Frequency bars around a slowly turning cover | The live sound |
| Ridgelines | A short history of the spectrum stacked into ridges | The live sound |

Which one a song gets is picked from its analysed energy (`autoVisual`): below 0.35, or
not analysed yet, **Aurora**; from 0.35, **Pulse**; from 0.7, where the music can be
heard, **Spectrum ring**. Ridgelines only plays when chosen. The name under the visual is
a menu: choose another for that song and the choice is kept on this device.

**Where the live visuals run.** The spectrum visuals read the sound through a Web Audio
analyser (`AudioEngine.analyser()`), which routes both audio elements through an
`AudioContext` for the rest of the session. That only happens in desktop Chrome, Edge and
Firefox. On a phone or tablet a locked screen suspends Web Audio and would stop the music
with it; Safari has a history of ignoring an element's volume once it is routed, and the
crossfade is made of volume. Those get Pulse instead, and the live visuals are not offered.

## On the phone

The full-screen player keeps its layout. Tap the artwork — or **Lyrics** in the footer — and
the lyrics (or the song's visual) take the artwork's place, so the title, scrubber and
buttons never move and you can read along and still skip. The small cover in the corner
brings the artwork back.

## Files

| What | Where |
|---|---|
| Page | `apps/web/src/components/nowplaying/NowPlayingPage.tsx` |
| Lyrics, visual, status line | `nowplaying/SongWords.tsx`, `LyricsView.tsx`, `SongVisual.tsx`, `visualDraw.ts` |
| Lyrics state, cover colours, clock | `nowplaying/useSongLyrics.ts`, `useCoverArt.ts`, `clock.ts` |
| Up next card | `nowplaying/UpNextCard.tsx` |
| Visual choice, palettes | `apps/web/src/lib/visuals.ts` (+ tests) |
| Playhead and analyser | `apps/web/src/player/engine.ts`, exposed by `PlayerProvider.tsx` |
| Shell, keys, the bar | `apps/web/src/App.tsx`, `components/PlayerBar.tsx`, phone: `components/NowPlaying.tsx` |
| Styles | `apps/web/src/styles/parts/feat-now-playing.css` |

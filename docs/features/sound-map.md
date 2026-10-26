# Sound map

The whole library drawn as a field of covers placed by how they sound: songs the listening
model hears as alike sit together, and the tags tint the places they gather. Press a spot
and the songs there play. Drag a path from one place to another and Up next drifts between
them. Picked by Xiao on 2026-10-25 from the feature review
(<https://claude.ai/artifact/WEAZGxA7vxd7SiSYWynxSa>, card N9, option N9a: its own page).

**Where:** the phone, the computer and the web. On a computer it is a row in the sidebar and
an item in Library's ⋯; on a phone it is a row on Profile. A cloud library draws it offline
from a file in the bucket.

## The page

`/sound-map` (`apps/app/src/features/soundMap/SoundMapScreen.tsx`). Under the title, how
many songs are on the map and, quietly, how many are not heard yet ("64 songs · 45 not heard
yet"). A song the listening model has not heard, or could not hear, has no place and is left
off.

**The field** (`SoundField.tsx`) draws every placed song as a small square of its cover's
colour (the dominant swatch of `coverTone`; a song with no cover gets its letter tile's
colour). Zoomed in, the squares grow, more slowly than the songs spread apart so gaps open
(`tileSide`), and once a square is 18 points wide (`COVER_FROM`) the ones on screen show
their covers. Only those ask for a picture: the whole library at once would be 1,500 covers
fetched to be drawn eight points wide, and in a browser tab each is a read from the bucket.

**Tags tint where they gather** (`tagRegions`, packages/client): for each tag, the cell of a
24 × 24 grid holding most of its songs, provided they are at least 35 % of the songs around
it; around it, a soft round in the tag's colour (`tagColors(hue).dot`), as wide as those
songs spread, with the tag's name over it. One region a tag, the eight strongest, and none
too close to a stronger one, so names never pile up.

**Press** (tap on a phone) plays the 25 songs nearest the spot, nearest first
(`nearestSongs`), and Up next names the place after the nearest song: "Near 晴る". A light
ring marks where you pressed, and a ring follows the song playing.

**Drag** draws a path. Every song within about a finger's width of the line (28 points on
screen, whatever the zoom: `pathReach`) is taken, in the order the line passes it, at most
40 spread evenly along the line (`songsAlongPath`). The songs are then put in auto-mix order
([audio-intelligence.md](audio-intelligence.md), `orderPath`) five at a time, each five
starting from the song before: each step is as gentle as tempo, key and energy allow, and the
whole still drifts from where the path starts to where it ends (a plain auto-mix of all of
them would hop back and forth across the map). Rings mark the songs taken, and the foot says
what it made — the path's name, and under it "14 songs, 52 min", so a long name never hides
the count — with Play and a way to clear the line ("night → calm · 14 songs, 52 min ▶ Play"
in the review's mock). The toasts rise above that line (`setPageFoot`), so a "Continue
from…" never covers Play.

A path's name is the tag most of the eight songs at each end share, when at least half of
them do, or else the nearest song's title (`pathName`). Up next is named the same.

**Fitting.** The map opens with every song in view and as large as the field allows. A map
wider than it is tall, on a field taller than it is wide (a phone held upright), is drawn a
quarter turn clockwise so it fills the screen (`MapView.turned`); which songs sit beside
which is the same either way.

### Moving and zooming

A drag already draws, so moving the map is something else:

| | Phone | Computer |
|---|---|---|
| Move | two fingers | scroll (a trackpad's two fingers, a mouse's wheel) |
| Zoom | pinch | trackpad pinch, or ⌘ / Ctrl + scroll |
| Either | the +, − and fit buttons in the corner | the same |

This is how design tools that draw with a drag work (Figma, for one), and it was chosen over
the alternatives: a mode switch between drawing and moving is a state to forget; holding
Space to move would take Space from play and pause, which it is everywhere in the app; and
a mouse wheel that zooms, as on a street map, leaves a drag to move the map, which is the
path. A mouse with no trackpad zooms with the buttons or ⌘-scroll.

The tiles are drawn once into a layer the size of the map, which a gesture moves and scales
whole; tile sizes and covers are worked out again only when the map holds still
(`FieldControl`, `fieldInput.web.ts` for the wheel), so 1,500 songs are not drawn again on
every frame.

## How the map is made

**The fold** (`apps/server/src/sound/map.ts`). Each song is 768 numbers
([audio-intelligence.md](audio-intelligence.md#how-songs-sound)); the map needs two. The
server folds them with UMAP's method (McInnes, Healy & Melville, 2018), written out in plain
TypeScript rather than taken as a package:

1. each song's 15 nearest neighbours by how they sound (one pass over every pair, the dot
   product of unit vectors);
2. UMAP's fuzzy neighbourhoods: each song's links fall off from its nearest neighbour at a
   rate that makes them add up to log₂ 15, so a sparse corner of the library reaches as far
   as a dense one; a link either side makes is kept;
3. a first layout from the two directions the songs differ along most (principal
   components, by power iteration from fixed starting vectors);
4. 400 steps that pull linked songs together and push each from five random others, gentler
   each step (UMAP's curve for a minimum distance of 0.1);
5. the middle 99 % of songs fitted to the unit square, its shape kept; a far outlier is held
   at the edge rather than shrinking everything else into a corner.

**Why UMAP, not PCA or t-SNE.** Two principal components alone keep only the two broadest
differences in 768 and lay everything else over each other. t-SNE draws tight clusters but costs every pair of songs on every
step (about 2.25 million pairs times a thousand steps for 1,500 songs) and does not keep how
clusters sit to each other, so "drift from here to there" would cross arbitrary space. UMAP
keeps neighbourhoods and their arrangement, and after the one pass over pairs its steps cost
only the links, about 20,000. The `umap-js` package would do the same, but brings matrix
and optimisation libraries for a few hundred lines that are easy to read and test here.

**Cost.** On an M1, 1,500 songs take about 3.6 s from nothing and 1.9 s from the last map;
a Pi 4 is perhaps five times slower. The fold waits a turn (`setImmediate`) every few steps,
so the server is never held for more than about 50 ms on an M1 and keeps answering its
health probe throughout (a server that stops answering it reads to every device as gone).

**Holding still.** The same songs always make the same map: songs are taken in key order and
every random draw comes from a fixed seed. A map made after songs were heard starts from
where every song sat before, places each new song among its neighbours there, and settles
gently (100 steps, a third of the pull); it is then turned, flipped if need be, scaled and
moved to lie over the last one (two-dimensional Procrustes), so a song heard since never
spins the map. When more than a quarter of the songs are new, a map from nothing is made
instead, then turned the same way. Tests hold this (`map.test.ts`): the same input in any
order gives the same map; adding one in fifteen songs moves the rest by a median of under
5 % of the map, less than a map made from nothing would; a new song lands beside the songs
it sounds like.

**When.** The server keeps the map (`sound_map`, migration 51: the file and the vectors it
was folded from, as `SoundService.packSignature` puts it) and folds again only when that
changes: a song heard, heard again, given up on or removed. While a backlog is being heard,
at most once an hour (`FOLD_EVERY_MS`), as the vectors themselves go up. A fold starts from
any song heard, from each bucket pass, and from a device asking for the map.

**Into the bucket** (docs/SYNC.md, "Sound map"). One small file beside the vectors,
`lyrics/<sha256>.map`, JSON: `{"places": [["audio/<sha256>.m4a", x, y], …]}`, songs named by
their audio's key as the vectors are, x and y whole numbers 0–10 000, keys sorted so the same
map is the same file (`encodeSoundMap`, packages/shared `soundMap.ts`). About 120 KB for
1,500 songs. The snapshot's `soundMap` names it; the one it replaces goes in the trash. A
changed map is enrichment, held with the motion curves and cover colours rather than
published at once. In the doorman's `lyrics/` folder, so no doorman needed redeploying. A
server starting again from the bucket with no map of its own reads the bucket's back once
and starts its next fold from it, so the map every device was drawing holds still.

**On a device.** `GET /api/sound-map` answers `{ places: [{ id, x, y }], unheard }` from the
server, and in a cloud library from the replica (`cloudSoundMap`, packages/replica), which
reads the file once per change and keeps it on the device by its hash like a song's words
(`textCache`), so it is drawn offline and costs one read from the bucket each time the map
changes, never one a visit.

## Where the code is

- `apps/server/src/sound/map.ts` — the fold (tested: `map.test.ts`)
- `apps/server/src/sound/soundMap.ts`, `repositories/soundMap.ts`, `routes/soundMap.ts` —
  keeping it, when to fold, `/api/sound-map`
- `apps/server/src/services/cloudSync.ts` (`#uploadSoundMap`, `#readBucketSoundMap`) — the
  bucket's copy (tested in `cloudSync.test.ts`, "the sound map")
- `packages/shared/src/soundMap.ts` — the file; `cloud.ts` `soundMapKey`;
  `schemas/cloud.ts` `CloudSoundMapSchema`; `schemas/library.ts` `SoundMapSchema`
- `packages/replica/src/library.ts` (`cloudSoundMap`) and `routes.ts` — a cloud library's
  answer (tested in `routes.test.ts`)
- `packages/client/src/soundMap/soundMap.ts` — nearest songs, songs along a path, tag
  regions, names (tested)
- `apps/app/src/features/soundMap/` — the page, the field, gestures, the view's arithmetic

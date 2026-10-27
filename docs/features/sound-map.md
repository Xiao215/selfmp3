# Sound map

The whole library drawn as a night sky, placed by how it sounds: songs the listening model
hears as alike sit together, each a star in its cover's colour, and the tags glow where they
gather. Tap a spot and the songs there play. Hold, then draw a line from one place to
another and Up next drifts between them, or draw a loop round a place and take what is
inside, then play it or keep it as a playlist. Picked by Xiao on 2026-10-25 from the feature
review (<https://claude.ai/artifact/WEAZGxA7vxd7SiSYWynxSa>, card N9, option N9a: its own
page) and redrawn on 2026-10-26 (<https://claude.ai/artifact/TKmRe32T6Y9YxLsmJQP4fm>: A1 B1
C2 D1 E1–E5, E6 as "no count at all", P1 with the app's own mini player, K1 with the player
bar).

**Where:** the phone, the computer, the web and the desktop app, at `/sound-map`. Ways in:

- a **card on Home** under Your tags, a small still sky of the library with the song playing
  lit (`MapCard.tsx`), shown once there are songs on the map;
- a **sidebar row** on a computer, under Library;
- **Draw it on the map** in New playlist, which opens the map with the pen ready
  (`?draw=1`);
- **Show on the map** in a song's ⋯, Now Playing's included, which opens the map on that
  song (`?song=<id>`).

A cloud library draws it offline from a file in the bucket.

## The page

`SoundMapScreen.tsx`. The map is the page. On a phone the tab bar goes and the mini player
stays, at the foot where the tab bar was (`pageHidesTabs`, `shell/pageChrome.ts`); on a
computer the sidebar and the player bar stay. Over the sky, top left, the page's head as
every page has it (`PageHeader`: the way back on a phone, and the name, with no count
under it, since how many songs are on the map is nothing to act on); under it the tags as chips (the lens); bottom right the buttons (the song playing,
the pen, and on a computer +, − and show all); once something is taken, the tray: on a phone
at the foot, on a computer a panel down the right. The buttons hold their place: on a phone
they stand over the folded tray and the opened tray lies over them as a sheet does; on a
computer they stand to its left. The page is dark in either theme, since the
sky is the point (`ScopedTheme name="dark"`). A song not heard yet has no place and is left
off; nothing counts them.

### The sky

`sky.model.ts` works out what is drawn; `SkyLayer.web.tsx` draws it in a browser and
`SkyLayer.tsx` on a phone or an iPad.

- **Stars.** Each song a small sharp dot over a faint wider glow in its cover's main colour,
  so the sky reads as points of light rather than soft blobs, lifted so a
  black cover is a pale star (`starTones`), rounded to steps of hue, tone and strength so a
  few dozen glows serve every star. **Brighter and larger the more it has been played**,
  against the library's 95th percentile of plays on a log scale (`brightness`, `playTop`), so
  one favourite does not leave the rest dim. Stars grow as you zoom in, more slowly than the
  songs spread, so they part (`starRadius`). A glow reaches five times its star's size where
  it has the room and is held to most of the way to its three nearest neighbours where it has
  not (`room`, `glowReach`), and glows are laid over each other as paint, never added up as
  light: added, a place of a few hundred songs was one white blur (2026-10-26).
- **Flares.** The 3 % most played songs (by plays; only songs played at all) wear a thin
  four-pointed flare, brightest at the star and fading out, about six times its size and
  never more than twice the room its neighbours leave (`flare`, `flareReach`).
- **Tag glows.** Each tag's region (`tagRegions`, packages/client: for each tag the cell of a
  24 × 24 grid holding most of its songs, provided they are at least 35 % of the songs
  around; one region a tag, the eight strongest, none too close to a stronger one) is a soft
  cloud in the tag's colour, without its name: a tag's songs are not all where it gathers,
  and a name over one place said they were (Xiao, 2026-10-26). The lens says where a tag's
  songs are.
- **Close in,** once a star would be 18 points wide (`COVER_FROM`), the stars on screen show
  their covers, and from 30 points their titles. Only those on screen ask for a picture.
- **The song playing** is the one star wearing its cover, ringed.
- **What the tray holds** is drawn over the sky, each stroke in its own colour: a line's songs
  joined as a constellation in the order the line passes them (`chainAlong`), a loop as its
  dashed outline.
- **On a computer,** the song under the pointer is named before it is pressed. Close in,
  where the stars are covers, its cover lifts into a dark card with its title and artist
  beside it, on whichever side has room short of the tray's panel, and its own small title
  under the cover gives way (H2, 2026-10-26: a round ring over a square cover with the title
  twice read as clutter). Further out, the star is ringed and named in a small card beside
  it. The same card shows for the song the pointer is on in the tray's list, and on a phone
  for the row last pressed there.

**Why a canvas in a browser.** The first page drew 1,500 views and moved each one as the map
moved; react-native-unistyles turns every distinct style into a CSS rule, so every place a
tile was moved to became a new rule, and a few minutes of zooming filled Chrome's memory
until the tab died (Xiao, 2026-10-26). The browser now draws the sky into one `<canvas>`, at
most once a frame while it moves and not at all while it holds still; nothing a song is drawn
with is a style. It keeps a glow picture per colour and at most 240 covers (the oldest let
go). Measured in Chrome on the test library: zooming and moving for a minute left the CSS
rules, the DOM and the heap where they started (556 → 572 rules, the tray's; 355 → 389
nodes; 31 → 34 MB).

**On a phone** the stars are one SVG, a circle a star filled with its colour's gradient,
drawn (a glow and a dot each) for the view the map last held still at and moved and scaled as a whole while a finger
moves it; their sizes and covers are worked out again when it settles. The stroke and the song
playing are drawn over it at screen size each frame.

### Gestures

| | Phone | Computer |
|---|---|---|
| Move | one finger (or two) | drag, or scroll (a trackpad's two fingers, a mouse's wheel) |
| Zoom | pinch; double tap zooms in | trackpad pinch, ⌘ / Ctrl + scroll, double click; +, − |
| Play what's there | tap | click |
| Draw | hold still a moment, then drag; or the pen, for one stroke | the same, or Shift-drag |

A map is moved with one finger everywhere else, so it is here (B1). Drawing waits for a
hold: a ring fills under the still finger (from 90 ms, so a tap or a move never flickers
one) and at 320 ms (`HOLD_MS`) the phone gives a light tap and the drag draws. The pen
button arms the next stroke without the hold, and moving then takes two fingers; it goes
back to moving after the stroke. On a computer, Shift held does what the pen does
(`useShiftHeld`), and the pointer is a hand, or a crosshair while drawing is armed.

The first visit acts it out once (`MapHint.tsx`, guide `sound-map-draw`): a finger's circle
holds and draws a line between two places, then holds and goes round a loop, each with its
line of words; a tap or the first stroke drawn closes it. Settings › About brings it back
with the other guides.

### What a stroke takes

**Tap** plays the 25 songs nearest the spot, nearest first (`nearestSongs`), and Up next is
named after the nearest song: "Near 晴る". A light ring marks where you pressed. A tap on
empty sky, more than a reach and a half from every song, plays nothing and lets go of
whatever the tray holds, as a tap beside a selection does anywhere; on a computer Escape
does the same.

**A line** takes every song within about a finger's width of it (28 points on screen,
whatever the zoom: `pathReach`), in the order the line passes it, at most 40 spread evenly
along it (`songsAlongPath`), then put in auto-mix order ([audio-intelligence.md](audio-intelligence.md),
`orderPath`) five at a time, each five starting from the song before: each step is as gentle
as tempo, key and energy allow, and the whole still drifts from where the line starts to
where it ends. Its name is the tag most of the eight songs at each end share, when at least
half of them do, or else the nearest song's title (`pathName`): "night → calm".

**A loop** is a stroke that goes round something (`isLoop`): at least 1.6 times as long as
it is across (a circle is about 2.2, a line 1), with its ends back within two and a half
reaches of each other or a third of its own size, whichever is more, since a big circle is
rarely closed exactly; a U, its ends as far apart as it is tall, is still a line. It takes
**every** song inside, however many: a loop round a whole island is the whole island
(2026-10-26: a cap of 100 and a stricter close left most of a big circle out). Inside is
counted by winding, not the even–odd rule, so where a finger went on past its start the
overlap is inside too. They play in auto-mix order from the one nearest the middle
(`songsInside`). Its name is the tag at least half the songs inside share, or the
title of the song nearest its middle (`loopName`).

A stroke that takes nothing goes without a word (Xiao, 2026-10-26: the message was noise).

### The tray

`MapTray.tsx`, redrawn 2026-10-26 from Xiao's picks on
<https://claude.ai/artifact/VDscppdVDPXCeQ3M5MCnw2> (A1 B1 C1 P1): the old tray was a phone's
sheet even on a computer, opened over the middle of the map and so over the loop just drawn,
its head's × cleared everything though it read as "close", every row wore a ×, and the
strokes ran together as one list.

Each stroke adds to it; it holds every stroke since it was last cleared, each song once.

- **Sections** (`traySections`, `tray.model.ts`): one a stroke, in the order drawn, headed by
  its mark (a dashed ring for a loop, a curve for a line) in **its colour**, the same colour
  its outline or constellation is drawn in on the map (`takeTone`: the first of five colours
  no stroke in the tray wears), then its name, kind and count, and a × that drops that stroke
  alone, with Undo. A song two strokes took sits in the first one's section. The songs are
  numbered across sections in the order they will play, with their lengths; a section shows
  eight until "N more"; songs left out are counted under it with **Bring back**.
- **A row** pressed flies the map to its star and rings it (`lit`). Leaving a song out is a ×
  where the length was, shown on hover or focus, where there is a pointer (the web), and a
  swipe left to **Leave out** where there is not; a screen reader has it as the row's action.
- **The head**: the name (the strokes' names joined with " · "), with a pencil to type one of
  its own, used by Save and Play; a dot in each stroke's colour, how many songs and how long;
  and a chevron that folds the list or opens it, nothing more.
- **The buttons** (C1): **Play**, **Save**, and **⋯** with Add to Up next, Shuffle and Clear
  what's drawn (with Undo).
- **Folded**, on a phone: the first three covers, the name, how many and how long, Save and
  Play. On a computer: the head alone, with Play beside the chevron (K4).

**On a computer** it is a panel 376 points wide down the right of the map, from the top to
the player bar, opened with the first stroke; the map is fitted and centred in what is left
(`FieldInsets.right`), the head's tag chips stop short of it, + and − zoom about the middle
of what is left, and the buttons stand to its left. The pointer on a row rings and names its
star on the map as the pointer on a star does. Folded (K4, 2026-10-26: a line at the foot
that appeared and vanished with no motion read as broken), the card keeps its head where it
was and the list folds up under it, its height and its fade sliding together (`Fold`); it
unfolds the same way. The map glides with the room the panel gives back or takes: refitted
if no hand has moved it, else moved by half the panel's width so what was in the middle
stays there (`FieldControl.setInsets`).

**On a phone** it stays folded at the foot until pulled up or pressed, and opens as a sheet
half the screen high, its buttons under its head; the map's clear part shrinks to above it.

Whenever the panel or the sheet opens, or a stroke is drawn where the tray lies, the map
slides at the same scale until the strokes are clear of it (`keepClear`, `keptClear`). Save
makes a playlist of exactly the songs held, with Undo and Open, and empties the tray. Play
plays them as "Map" under the tray's name. The toasts rise above the tray and the buttons over
it (`setPageFoot`), and on a computer, beside the panel, above the buttons only.

### The lens

The tags with songs on the map, as chips, most songs first (`lensTags`). Choosing one lights
its songs and dims the rest to an eighth, leaves only its glow, and flies the map to fit its
songs (`flyToPlaces`). Choosing it again shows every tag and flies back to the whole map.

### Moving the map

`fieldControl.ts` holds where the map is, outside React, so a pinch reads the view the last
frame left. The map opens with every song in view, fitted to what the page leaves clear of
its head and the tray (`fitView`'s `insets`), and stays as it is once a hand has moved it.
A map wider than it is tall, on a field taller than it is wide (a phone held upright), is
drawn a quarter turn clockwise so it fills the screen (`MapView.turned`); a flight to a tag
keeps it turned. Flights (the lens, the song playing, a song opened from its ⋯, show all,
+ and −) take 420 ms, the scale eased on its logarithm and the middle moving in a straight
line (`between`); a finger stops one where it is.

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

**When.** The server keeps the map (`sound_map`, migration 53: the file and the vectors it
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

**On a device.** `GET /api/sound-map` answers `{ places: [{ id, x, y }] }` from the
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
- `packages/client/src/soundMap/soundMap.ts` — nearest songs, songs along a line and inside a
  loop, tag regions, names (tested)
- `apps/app/src/features/soundMap/` — the page (`SoundMapScreen`), the field and its gestures
  (`SoundField`, `fieldControl`, `fieldInput`), the sky (`sky.model`, `SkyLayer` and
  `SkyLayer.web`), the tray, the hint, Home's card, the view's arithmetic
  (`soundMapView.model`); the pure parts tested

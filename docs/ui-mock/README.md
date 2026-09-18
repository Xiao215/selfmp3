# The UI mock

The interface agreed in September 2026, as 73 screens you can open in a browser: phone,
computer and web, the browser extension, motion, and a page of ideas that are not scheduled.
It is the target of [`docs/UI-MIGRATION.md`](../UI-MIGRATION.md).

Open [`index.html`](index.html). Nothing to install or build; fonts come from Google Fonts,
so the serif and the display face need a connection the first time.

## What is here

| What | Where |
|---|---|
| Every screen, in rows by flow, each row with its written spec | `index.html` |
| One file per screen, at its real size (390 × 844 phone, 1280 × 800 computer) | `boards/` |
| The twelve covers the screens use, 240 px, from the development library | `covers/` |
| Where each screen sat on the design canvas, its title, and every row's spec text | `canvas.json` |

Screens are numbered so a ticket or a commit can point at one: `P01`–`P38` phone, `C01`–`C17`
computer and web, `E1`–`E5` extension, `M1`–`M3` motion, `S1`–`S3` the three "start here"
pages, `L1`–`L7` later. The number is the start of the file name
(`boards/P21-now-playing.html`).

Read `S1`, `S2` and `S3` first. `S2` is the visual system: colour, type, radii, spacing and
the parts as drawn. `S3` is the behaviour a picture cannot show: what a row carries where,
how Up next behaves, how search scopes, what import never offers.

## Reading a screen

- Links work. The mini player opens Now Playing, a tag tile opens the tag, the queue button
  opens Up next. A link with nowhere to go does nothing.
- Anything drawn mid-gesture, a row half swiped or a row lifted, is showing the gesture and
  not a resting state.
- The green on the playing row and the mini player is one song's cover colour. The playing
  colour always comes from the cover (`docs/features/now-playing-colour.md`).
- Boards titled "Why · …" are the reasoning behind a decision, kept beside the screens it
  produced. The Later page is ideas only.

## Where it came from

The screens were designed on a canvas, reviewed one round at a time, and exported from it
once the design was agreed:
<https://claude.ai/artifact/RneWGXzpAkxLovnY6Q1RfJ>. `canvas.json`'s `files` maps each
canvas board to its file here. The export inlines each board as plain HTML, points the
covers at `covers/`, and rewrites the links between boards; nothing else is changed.

This folder is a record, not a source of truth that the app reads. When the design changes,
change the canvas and export again, or edit the board's HTML directly and say so in the
commit. Prettier skips this folder (`.prettierignore`).

# Moving the app to the new interface

**Status: built through Phase 11, 2026-09-19, on branches not yet merged. The widget waits
on a signed build.** Written 2026-09-18, against the app as it stands on
`main` that day. The target is the mock in [`docs/ui-mock/`](ui-mock/README.md); screen
numbers like `P04` and `C11` in this document are files in `docs/ui-mock/boards/`.

Read `S1`, `S2` and `S3` of the mock before this. They say what the design is. This document
says how to get the app there without a week in which it does not work.

## Why

Four things were wrong, in Xiao's words, after living with the phone app:

1. It looks default. Rectangles with hairlines, saturated tag fills, system type only.
2. It lands on Library: every song, flat, with no point of entry.
3. Buttons look odd and almost nothing moves.
4. Tags are the reason the app exists and they are a filter strip and a page under You.

The answer that was agreed is not a reskin. It changes where things live:

- **Home** is the landing page: a greeting, one search field, four tag tiles, recently played.
- The phone's tabs go from Library · Playlists · Import · You to **Home · Library · Playlists**
  and a separate search circle. You is behind the avatar on Home. Import is the + on Home and
  a row under You.
- **A tag, an artist and a playlist are the same kind of page.** Tags open from Home. Artists
  become places with their own chip, and are never tags.
- **One search page**, opened from anywhere; the door only sets the scope it starts on.
- **Up next** is one editable list that belongs to nothing, a sheet on a phone and a rail on
  a computer.
- A calmer look: tone on tone with no hairlines, pills, a serif for greetings and big
  numbers, a display face for titles, and one spring for anything that moves.

## Where things stand

What the app has today, and what each piece becomes. Paths are under `apps/app/` unless they
start with `packages/`.

| Today | Where | Becomes |
|---|---|---|
| Landing route `/` is Library | `app/index.tsx` → `features/library/LibraryScreen` | `/` is Home (`P04`); Library moves to `/library` |
| Four tabs, hand-rolled, testIDs `tab-library\|playlists\|import\|you` | `src/ui/components/BottomNav.tsx:25`, `bottomNav.model.ts` | Three tabs in a floating capsule plus a search circle (`P04`) |
| Mini player, a strip above the nav, 56 high | `src/ui/components/MiniPlayer.tsx`, `ProgressWash.tsx` | A floating card, 60 high, radius 16, with a queue button |
| Sidebar: Library, Import, Stats, Settings, search row, Playlists with pins, tag list | `src/shell/Sidebar.tsx:77` | Search, Home, Library, Import, Playlists section, Tags section, name, Settings last (`C03`) |
| No search screen. An inline box in Library; a palette in the installed desktop app only | `features/library/`, `features/commandPalette/` | One Search page at `/search` on every platform (`P18`, `P19`, `C05`) |
| Tags are a housekeeping page under You; a tag "opens" as a Library filter | `features/tags/TagsScreen.tsx`, `features/library/libraryFilter.tsx` | All tags page opened from Home (`P07`); a tag is a page at `/tag/[name]` (`P08`, `C06`) |
| Untagged songs have their own page | `app/inbox.tsx`, `features/inbox/` | A card at the top of All tags. The page and route are deleted |
| No artist anywhere except as text on a row | — | Artist page `/artist/[name]` (`P10`), artist chip, artists in the Add sheet (`P09`) |
| Tag chips are filled with the tag's colour | `src/ui/components/Chip.tsx`, `tagColors()` in `packages/client/src/theme/tokens.ts:87` | Neutral pill with a hue dot; selected is white (`S2`) |
| Playlists: pins, empty playlists listed, a download button on the page | `features/playlists/playlists.model.ts` (`pinnedPlaylists`), `features/playlistDetail/PlaylistDetailScreen.tsx:408,427,510` | Sorted by last played; no pins; empties never listed; no download button (`P16`, `P17`) |
| Song menu has Play next, Add to queue, Select, Song details… (a dialog) | `src/ui/components/SongMenu.tsx:223-296` | No Play next, no Select. The title opens the song's own page `/song/[id]` (`P14`, `P15`) |
| The queue is already editable: grip to reorder, ✕ to remove, a bin to clear | `features/nowPlaying/StageQueue.tsx`, rules in `packages/shared/src/queue.ts` | Same rules. New surfaces: a sheet on the phone (`P25`), a rail on a computer (`C11`, `C12`); hold to move, swipe left or drag out to remove |
| `playFrom()` already replaces the queue | `packages/shared/src/queue.ts:58` | Unchanged. This is the agreed model; nothing to migrate |
| Now Playing (phone) has a tab selector at the top; the stage (computer) has Lyrics/Visual, Up next, About | `features/nowPlaying/NowPlayingScreen.tsx`, `NowPlayingStage.tsx` | Phone: no selector, ⓘ opens the song page, foot is Lyrics · Sleep · queue (`P21`, `P22`). Computer: Up next leaves the stage, the rail has it (`C09`) |
| Four visuals for a song without lyrics: aurora, pulse, spectrum, drift | `features/nowPlaying/visuals.model.ts:21`, `SongVisual.tsx`, `SongVisual.web.tsx` | Two: Horizon and Ripples (`P23`, `P24`, `C10`). See Open questions |
| The playing colour comes from the cover | `packages/client/src/art/`, `src/ui/useSongColor.ts`; the phone takes the server's `coverTone` | Unchanged, and carried to the new mini player and queue |
| Import is a tab; its review list has checkboxes and a listen button | `features/import/ImportScreen.tsx`, `ImportListen.tsx`, `listen.model.ts` | Not a tab on a phone. Review with no checkmarks, editable title and artist, a bar to drag (`P29`, `P30`, `C13`, `C14`) |
| You lists Stats, Inbox, Tags, Settings | `features/you/you.model.ts:13` | The person, this month as a card, then Import, Report, Settings (`P31`) |
| Stats has Overview and Report tabs | `features/stats/`, `features/wrapped/ReportTab.tsx` | Stats is a page of cards (`P32`, `C15`); Report is "the month as a page" with five looks (`P33`–`P37`), a front page on a computer (`C16`) |
| A sign-in screen; onboarding is dev-only | `features/signIn/`, `features/onboarding/` | Welcome with one button (`P01`, `P02`, `C01`), then First sync (`P03`, `C02`). No sign-in screen |
| System fonts only; no `expo-font` | — | Instrument Serif and Bricolage Grotesque, bundled |
| `radius = { sm: 6, md: 10, lg: 16 }`; type tops out at 22; fades of 100/140/220 ms; RN `Animated` almost everywhere | `packages/client/src/theme/tokens.ts:209-236` | The scale in `S2`; one spring token beside the fades |
| The extension re-declares the tokens in its own CSS, hue fixed at 268 | `apps/extension/src/ui/theme.css` | Same look as the app (`E1`–`E5`), tokens generated from one place |
| No iOS widget, no share extension target | `app.config.js` plugins | A home-screen widget (`P28`), last, and only if the native target is accepted |

## What this is, and is not

It is a change to `apps/app/src/shell`, `src/ui`, most of `src/features`, the route files in
`app/`, the theme tokens in `packages/client`, and the extension's popup.

It is not a change to the server, the sync protocol, the database, `packages/shared` schemas,
the ports, the player engine, offline storage, or the desktop bridge. If a phase seems to need
one of those, stop: either the design asked for something the data cannot answer (write it
under Open questions) or the phase has wandered.

Web and the desktop app are the same build as today. Nothing here adds a platform switch.
The 820 breakpoint stays the only thing that chooses between the phone and computer shells.

Nothing is kept for compatibility. Old routes, the inbox, pins, the four old visuals if that
is the answer, the sign-in screen: deleted in the phase that replaces them, with their tests.

## Stack

Three additions, each needing a native rebuild of the dev client, so they land together in
Phase 1:

| Package | For | Notes |
|---|---|---|
| `expo-font` | Loading the two faces on native; on web the same files through `@font-face` | Use the config plugin so the fonts are embedded at build time and there is no flash of system type |
| `@expo-google-fonts/instrument-serif` | Greetings, names on pages, big numbers | Regular and Italic only |
| `@expo-google-fonts/bricolage-grotesque` | Page titles, section titles, tile names | 600 only. If the variable file is what ships, pin the weight in the token, not at call sites |

One addition that can be refused:

| Package | For | If refused |
|---|---|---|
| `expo-blur` | The glass on the bar, the search circle and controls over artwork (`S2`, "Glass") | A translucent fill with no blur. The mock's `rgba(31,34,44,.92)` already reads well without it; on the web `backdrop-filter` needs no package |

One that waits for Phase 11 and a yes from Xiao: a widget needs a native target
(`@bacons/apple-targets` or a hand-written one). Not before.

Not needed: `react-native-reanimated` for the five moves. `Animated.spring` takes stiffness
and damping, the app already uses `Animated` nearly everywhere, and Reanimated stays where it
is, inside `SongVisual.tsx`. Gestures use `react-native-gesture-handler`, which is already
the root view.

## Routes after

| Route | Screen | Mock |
|---|---|---|
| `/` | Home | `P04`, `C03` |
| `/library` | Library | `P12`, `C04` |
| `/search?scope=` | Search | `P18`, `P19`, `C05` |
| `/tags` | All tags | `P07` |
| `/tag/[name]` | A tag | `P08`, `C06` |
| `/artist/[name]` | An artist | `P10` |
| `/song/[id]` | A song's own page | `P15` |
| `/playlists`, `/playlists/[id]` | Playlists, a playlist | `P16`, `P17`, `C07`, `C08` |
| `/now-playing`, `/now-playing?view=lyrics` | Now Playing, Lyrics only | `P21`, `P22`, `C09`, `C10` |
| `/import`, `/import/review`, `/import/migrate` | Import, reviewing a link | `P29`, `P30`, `C13`, `C14` |
| `/you`, `/stats`, `/stats/report`, `/settings` | You, Stats, the month as a page, Settings | `P31`–`P38`, `C15`–`C17` |
| `/welcome`, `/first-sync` | Getting in | `P01`–`P03`, `C01`, `C02` |

Deleted: `/inbox`, `/sign-in`, `/onboarding`. Up next is a sheet and a rail, not a route.

`bottomNav.model.ts` changes with this. `activeTab()` answers Home for `/`, `/tags`,
`/tag/*`, `/artist/*`, `/you`, `/stats`, `/settings` and `/import`; Library for `/library`
and `/song/*` reached from it; Playlists for `/playlists/*`. `/search` is no tab's page: the
tab it was opened from stays lit and the circle is not (the mock's `P18`, `P19`, which win
over what this line first said). `YOU_PAGES` goes.

## Phases

Each phase ends with an app that works and could ship. The order is chosen so the look
arrives first and cheaply, the navigation change happens once, and the pieces that depend on
new pages come after those pages exist.

### Phase 0: record the decisions

- This document and `docs/ui-mock/` merged to `main`.
- `docs/features/design-system.md` gains a line at the top pointing at `S2` as the visual
  reference, so nobody designs against the old tokens while the work is under way.
- Answer the Open questions at the end of this document, in this document.

Done when: the questions have answers written next to them.

### Phase 1: the look, with nothing moved (`S2`)

The same app and the same navigation, drawn the new way. This is the cheapest visible win
and it makes every later phase a matter of layout.

- **Tokens** in `packages/client/src/theme/tokens.ts` and its twin `tokens.reference.css`:
  - Surfaces to the `S2` dark values (ground `#0b0d13`, card `#151821`, control `#1a1d25`,
    raised `#1f2330`, selected segment `#2c3140`). Keep them derived through `oklchToHex`
    if they already are; match the hexes.
  - The light theme becomes Paper (`#f6f2ea` ground, white cards, `#ebe5d9` controls, ink
    `#1b1a17`). `lightPalette()` is tinted by the hue today; Paper is warm and is not. Cards
    take a soft shadow in light, because white on cream has no tone to separate it.
  - `radius` grows to the named scale: `pill 999, sheet 26, cardLg 22, card 18, mini 16,
    cover 10, coverSm 8`. Keep `sm/md/lg` until the last caller is gone, then delete them.
  - `type` gains `display 46`, `page 30`, `section 18`, `tile 22`, `row 15`, `rowSub 13`.
    `label` becomes 11 with 0.9 tracking, uppercase.
  - `motion` gains `spring: { stiffness: 220, damping: 24 }`. The fades stay.
  - `border` and `borderStrong` stay in the palette but nothing new uses them. Removing the
    hairlines is a sweep over `src/ui` and `src/features` for `borderWidth` and
    `borderBottomWidth`; separation becomes a surface one step lighter.
  - `tagColors()` returns three things: tile fill `oklch(0.32 0.07 h)`, tile ink
    `oklch(0.85 0.10 h)`, dot `oklch(0.80 0.12 h)`, and their Paper counterparts (pale tint,
    dark ink of the same hue, `P05`). Its tests change with it.
- **Fonts**: add the three packages, embed through the config plugin, expose `fonts.serif`
  and `fonts.display` beside the tokens. Rebuild the dev client once.
- **Parts** in `src/ui/components`:
  - `Button`: four shapes and no others. Round white Play (56), tonal pill (44), text
    action, accent "commit" pill. Every page has at most one white Play.
  - `IconButton`: a 40 round on the control surface.
  - `Chip`: the quiet dot chip, the white selected state, the artist chip with a figure, the
    `+3` overflow chip and the dashed add chip. `rowTags` shows two then a count.
  - `Segmented`, `Select`, `Toggle`, `Sheet` (radius 26), `Popover`: re-skinned, same API.
  - `SongRow`: cover 10 radius, title 15/600 over 13, the on-device mark beside the artist
    (green check here, grey cloud not; nothing on the web), time, ⋯. One row everywhere
    already (`2a1fe44`); this keeps it so.
- **Two of the five moves**, because they live in the parts: everything pressable sinks to
  0.96 on the spring, and play ⇄ pause turns and scales through the swap in 180 ms with a
  light haptic. Both are instant under `useReducedMotion`.

Tests: token and `tagColors` unit tests; the jest component tests for `Chip`, `Button`,
`SongRow`; `LibraryScreen.perf.test.tsx` must not get slower, the row gained nothing.

Done when: every existing screen is drawn with the new tokens and parts, nothing is where it
was not before, and both themes have been looked at on a phone and at 1280.

### Phase 2: the shell and Home (`P04`–`P06`, `C03`)

The one phase in which navigation changes. Do it in one branch and merge it whole.

- **Routes**: `app/index.tsx` renders the new `features/home/HomeScreen`;
  `app/library.tsx` renders `LibraryScreen`. Update every `router.push('/')` that meant
  Library.
- **Phone bar** (`BottomNav.tsx`, `bottomNav.model.ts`): a floating capsule, 60 high, 16
  from the left edge, holding Home · Library · Playlists, the active one a white pill; a
  separate 60 circle on the right opens `/search`. testIDs `tab-home`, `tab-library`,
  `tab-playlists`, `tab-search`. `NAV_HEIGHT` and the safe-area maths in `Shell.tsx` change
  because the bar now floats over content; lists get bottom padding of bar + mini player.
- **Mini player**: a floating card above the bar. Cover 44, title and artist, a queue
  button, play, next, the wash and the 2 px line in the cover's colour. `MINI_PLAYER_HEIGHT`
  becomes 60. The queue button does nothing useful until Phase 6; until then it opens Now
  Playing on the Up next tab, which exists today.
- **Home** (`features/home/`, with `home.model.ts`):
  - The greeting by the hour in the serif, and one quiet line under it. The line is the
    streak when there is one ("3 days in a row."), else nothing. No invented cheer.
  - The search field. Tapping it opens `/search?scope=all`. Until Phase 3 it opens the
    palette on a computer and Library's search on a phone.
  - Four tag tiles, two by two, the most played tags, each with a tilted cover from the tag.
    Then "All N tags". With fewer than four tags show what exists; with none, one tile that
    says how to make the first tag.
  - Recently played: covers, from `song.lastPlayedAt`, newest first, no repeats, and a
    "Library" link.
  - Header: the date line, + (Import), the avatar (You).
- **Sidebar** (`Sidebar.tsx`): Search, Home, Library, Import, Stats; a Playlists section
  whose header opens `/playlists` ("All 4") and lists the most recently played few; a Tags
  section the same way ("All 8") with counts; then the name row with sync state; Settings
  last. Stats stays a top-level row on the computer (Open question 7); on a phone it is
  under You. Pins go in Phase 5 with the rest
  of the playlist changes, so the section shows recents from the start.
- **Computer Home** (`C03`): the same content, a large search field at the top.
- You is reachable only from the avatar on a phone. `YouScreen` is not redesigned yet.

Tests: `bottomNav.model.test.ts` rewritten; `verify/flows/navigation.spec.ts` rewritten;
every flow that starts with "open Library" now navigates there; Maestro `smoke.yaml` and
`downloads.yaml` (`tab-you` → the avatar, testID `home-you`). New `home.model.test.ts`: tile
choice, the greeting by hour, recents without repeats, the empty library.

Done when: a fresh launch lands on Home, every old destination is reachable in at most one
more tap than before, and all flows are green on both Playwright projects.

### Phase 3: one search (`P18`–`P20`, `C05`)

- `features/search/SearchScreen.tsx` and `search.model.ts`. The model is
  `commandPalette.model.ts`'s `paletteResults()` with the commands taken out and an Artists
  group added; move the shared part rather than copying it.
- Scopes All · Songs · Tags · Artists · Lyrics as a segmented row with counts once there is
  a query. `?scope=` sets the first one: `all` from Home and the circle, `songs` from
  Library, `tags` from All tags.
- Before typing: your tags as chips, then recently played. No search history is stored
  anywhere; delete any that exists.
- Results order in All: artists and tags, then songs, then lyric lines.
- Library's inline box becomes a field that opens `/search?scope=songs`. The tag strip in
  Library stays; it is a filter, not a search.
- Computer: the sidebar's Search row, Home's field and a list header's field all open the
  same thing, drawn as a palette over the page (`C05`). ⌘K keeps working in the installed
  app only, as today (`Shell.tsx:262`). Commands stay in the palette.

Tests: `search.model.test.ts` (scoping, ordering, the empty state, a query that matches an
artist and a tag of the same name); `verify/flows/palette.spec.ts` extended; a new
`search.spec.ts` on the phone project.

Done when: every search entry point opens the same page, and Library has no second search
implementation.

### Phase 4: tags and artists as places (`P07`–`P11`, `C06`)

- **All tags** (`features/tags/TagsScreen.tsx`, reworked): most played first, each row with
  song count and total time. Hold a tag to rename, recolour or delete; the housekeeping that
  is the whole page today becomes that menu. At the top, when any song has no tag, one card:
  "N songs have no tag yet". See Open questions for what tapping it does.
- **A tag page** (`features/tag/TagScreen.tsx`, `/tag/[name]`): lit by its covers, the name
  in the serif, Play, Shuffle, Add, then rows without tag chips. `libraryFilter` stops being
  how a tag opens; it remains Library's own filter.
- **Add** (`P09`): the sheet that combines. A search field; what is chosen on one row that
  scrolls sideways; a Tags / Artists segmented list; the count of songs only on the button
  ("Show 31 songs"). Every tag or artist turned on **adds** its songs (a union). Built for a
  library with hundreds of tags: the lists are virtualised and the search filters both.
- **Artists**: `packages/client/src/artists/artists.ts`, pure and tested. An artist is the
  song's artist string, compared case-insensitively and trimmed. Nothing is split on "feat."
  or "&" in this plan (see Open questions). `/artist/[name]` is the tag page with a figure
  where the dot would be; its ⋯ has "Make a tag from this artist", which runs once and says
  what it did. An artist cannot be renamed or deleted, and never appears in the Tags list,
  on Home's tiles, or under the word "tag".
- The artist's name is tappable wherever it is shown on a row's second line only where that
  does not fight the row's own tap: on the song page, Now Playing, and search results. Not
  inside list rows.
- **The nudge**: making a tag whose name equals an artist's shows "already an artist here,
  open it?" with Open the artist and Make the tag anyway (`P11`).
- Delete `app/inbox.tsx`, `features/inbox/`, its You row, `verify/flows/inbox.spec.ts`.

Tests: `artists.test.ts` (grouping, case, the same-name check); `tag.model.test.ts` (the
union, counts); `verify/flows/tags.spec.ts` rewritten around pages instead of filters.

Done when: a tag tile on Home opens a page, an artist has a page, and nothing in the app
opens a tag by filtering Library.

### Phase 5: Library, a song, playlists (`P12`–`P17`, `C04`, `C07`, `C08`)

- **Rows**: tags on rows in Library, Search and Up next only. Inside a tag, an artist or a
  playlist they are left off. `rowTags` already caps; make the cap two and a count.
- **Selecting** (`P13`): long-press starts it on a phone, as today. On a computer, with
  Select gone from the menu, it starts with a checkbox that appears on hover in the number
  column and with shift- and ⌘-click, which `useSelection` already understands. The bar
  stays at the bottom on a phone and the top on a computer.
- **Song menu** (`P14`): remove Play next and Select. Add to queue stays. "Song details"
  opens the song's own page instead of a dialog (`P14` keeps the words "Song details", and the
  mock wins over this line, which first said "Go to song"). Play next moves to the song page
  (`P15`).
- **A song's own page** (`features/song/SongScreen.tsx`, `/song/[id]`, `P15`): cover, tags,
  Play, Lyrics; then plays, first heard, a small history strip; then songs that sound like
  it (`SimilarShelf` exists). `SongDetails` the dialog is folded into it and deleted. Tapping
  a title anywhere a title is not the row's own tap target opens it; ⓘ in Now Playing does.
- **Playlists**: sort by last played (the newest `lastPlayedAt` among a playlist's songs;
  never-played last, by creation). Delete `pinnedPlaylists`, the pin button
  (`PlaylistDetailScreen.tsx:427`), the sidebar's pin handling and drop target for pins. An
  empty playlist is never listed; creating one goes straight into adding songs and the
  playlist exists once it has one. Remove the download button and its two testIDs; keeping
  songs on the device is Settings › On this phone.

This supersedes two earlier decisions that were agreed and never built: pinned playlists in
the sidebar, and an "empties" section in the playlists grid.

Tests: `playlists.model.test.ts` (the sort, no empties); `verify/flows/playlist.spec.ts`,
`selection.spec.ts`, `songMenu.spec.ts`; Maestro `smoke.yaml` loses `Play next`,
`playlist-download` and `playlist-downloaded`.

Done when: the song menu is shorter, a song has a page, and a playlist cannot be pinned,
empty, or downloaded from its own page.

### Phase 6: playing (`P21`–`P27`, `C09`–`C12`)

- **Now Playing, phone** (`NowPlayingScreen.tsx`): no selector at the top. ⓘ in the corner
  opens the song page. Under the artist, the song's tags wrap quietly. The foot is Lyrics ·
  Sleep · queue. Swiping up or the Lyrics pill opens Lyrics only (`P22`), a view of the same
  route. The cover breathes: 0.84 while paused, back on play, 400 ms.
- **No lyrics** (`P23`, `P24`, `C10`): Horizon and Ripples in `visuals.model.ts`,
  `SongVisual.tsx` and `SongVisual.web.tsx`, coloured from the cover through the existing
  `visualColors()`. On a computer the visual fills the window behind the cover and title and
  the look picker sits beside Visual and About.
- **Up next, phone** (`features/queue/QueueSheet.tsx`, `P25`): a sheet that covers the mini
  player and the bar, opened by the queue button on the mini player and the same button at
  Now Playing's foot, or pulled up from the foot. The playing song on top with the
  equaliser; then what is next; then what has played, greyed and tappable. Hold to lift a
  row and move it (`HoldToReorder` exists); swipe **left** to remove, with the `#5a2a2e`
  ground behind the row. No grips, no ✕, no bin.
- **Up next, computer** (`features/queue/QueueRail.tsx`, `C11`, `C12`): a rail 288 wide
  beside the list, toggled from the player bar and staying open across pages. Drag to
  reorder. Drag a row out past the rail's edge and it shrinks, greys and says "Let go to
  remove"; letting go removes it with an Undo for five seconds. Delete on a focused row and
  "Remove from queue" in the right-click menu do the same and draw nothing.
- `StageQueue.tsx` and the Up next tab on the stage are deleted; `nowPlaying.model.ts`'s tab
  parsing loses the value. The rules in `packages/shared/src/queue.ts` do not change: one
  new pure helper, `queueSections(state)`, returns playing, next and played for display.
- The player bar (`shell/PlayerBar.tsx`): cover and title, transport, speed, volume, Up
  next, devices. Absent while nothing is loaded, as today.
- **Lock screen** (`P27`): what the system draws from `setup.ts`'s capabilities. Check that
  no Like or custom action is registered; the mock has none.

Tests: `queue.test.ts` gains `queueSections`; `verify/flows/nowPlaying.spec.ts` and
`playback.spec.ts`; a new `queue.spec.ts` for drag-out and Undo on the desktop project and
swipe on the phone project; Maestro `smoke.yaml`'s mini-player steps.

Done when: the queue can be opened in one tap from anywhere a song is loaded, on both
shells, and the stage no longer has an Up next tab.

### Phase 7: import (`P29`, `P30`, `C13`, `C14`)

- Import is not a tab on a phone. It is the + on Home and a row under You. On a computer it
  stays in the sidebar.
- **Review** (`/import/review`): every song is coming in unless it is left out. No
  checkboxes. A song already in the library says "Yours already" and is skipped.
  - Phone: tap a song and its row opens in place with Title and Artist fields and a bar to
    drag; tap again to close. Swipe left to leave it out; it stays in the list, dimmed and
    struck through, and swiping again brings it back.
  - Computer: one grid for every row (`40px minmax(0,1.2fr) minmax(0,1fr) 90px`). Under the
    pointer a row shows play over its cover and "Leave out" at its end. The playing row
    turns its title and artist into fields, and the bar opens **under that row**, spanning
    the title and artist columns. Rows never shift sideways.
  - There is no album field. Importing can add tags ("Tag them"); it never offers a
    playlist.
- `ImportListen.tsx` and `listen.model.ts` already preview a track; the change is where the
  bar is drawn. The bar in the mock looks like a waveform. Peaks for a song that has not
  been imported do not exist, so it is a seek bar drawn as bars of a fixed pattern, filled to
  the position. Do not fetch or decode audio to draw it.

Tests: `listen.model.test.ts`; `importDraft` tests for leave-out and rename;
`verify/flows/import.spec.ts`.

Done when: a playlist link can be reviewed, renamed, thinned and imported without a
checkbox, on both shells.

### Phase 8: getting in, You, Stats, Settings (`P01`–`P03`, `P31`–`P38`, `C01`, `C02`, `C15`–`C17`)

- **Welcome** (`features/welcome/`, `/welcome`): one button, Continue with Google, which
  does what `SignInScreen`'s button does today. A first launch shows tag tiles with invented
  everyday names; a device that has signed in before shows the last covers it kept
  (`offline/covers.ts` keeps them; if the cache is empty, show the tiles). Sign out returns
  here. Delete `features/signIn/`'s screen (keep `signIn.model.ts` if Welcome uses it) and
  `features/onboarding/`.
- **First sync** (`/first-sync`): shown once after the first sign-in on a device, while the
  library arrives. "Keep every song on this phone" is off by default on a phone and on by
  default on a computer; it writes the same preference as `OfflinePanel`.
- **You** (`P31`): the person and sync state; this month as one card (listened, plays,
  streak, on repeat) that opens Stats; then Import, Report, Settings rows. `you.model.ts`'s
  rows become `import | report | settings`.
- **Stats** (`P32`, `C15`): cards for Listened, Peak hour and Streak, then one ranked module
  that switches between Songs, Artists and Tags. The Overview/Report tabs go; Report is its
  own page.
- **The month as a page** (`P33`–`P37`, `C16`): one image of the period with a look picker:
  Paper, Receipt, Wall, Calendar, Words. `wrapped.model.ts` already has the facts and
  `shareFileName`. On a computer the default look is a newspaper front page. Each look is a
  pure function from `Wrapped` to a view, so a sixth is cheap.
- **Settings** (`P38`, `C17`): accent swatches and the hue slider exist in
  `AppearancePanel`; storage moves under "On this phone". Re-skin, regroup, no new settings.

Tests: `you.model.test.ts`, `stats.model.test.ts`; `verify/flows/stats.spec.ts`,
`restore.spec.ts`; Maestro `downloads.yaml` (the path to the setting changes).

Done when: a signed-out device shows Welcome, and nothing in the app says "sign in" as a
page title.

### Phase 9: motion (`M1`–`M3`)

Two of the five moves shipped in Phase 1. The rest, and the transitions:

- The mini player rises from under the bar with a small overshoot on the first song of a
  session, 320 ms; later songs only crossfade the words.
- Home's tiles fade up 60 ms apart on the first paint only, never on a tab switch.
- Phone transitions as drawn in `M2`: the mini player opening into Now Playing, a tile
  becoming its page, a sheet rising, changing tabs, a row starting to play, moving a song in
  the queue. Computer transitions as drawn in `M3`.
- Every one is a duration of 0 under `useReducedMotion`, tested once in a helper
  (`src/ui/motion.ts`) that every caller goes through, so no screen can forget.

Not in this plan: the cover travelling from a row into Now Playing.

Done when: `grep -r "Animated.timing\|Animated.spring" apps/app/src` finds them only inside
`src/ui/motion.ts` and the files that predate this work and were not touched.

### Phase 10: the extension (`E1`–`E5`)

- `apps/extension/src/ui/theme.css` is generated from `packages/client`'s tokens at build
  time instead of being a copy. The hue stays fixed at the default; the extension has no
  accent setting and gets none.
- Popup on a song (`SongForm`): title and artist editable before saving; tags can be added;
  never a playlist. `PlaylistSelect` is deleted.
- Popup on a playlist (`ListReview`): click any name and title and artist become fields.
  Every song is coming in unless the far end of its row is clicked, which dims it and says
  "Left out". No checkboxes.
- The other states, the pill on YouTube pages and the options page take the same surfaces,
  pills and type. 360 wide stays.

Tests: `popup.model.test.ts`; `apps/extension/verify/` popup and pill specs.

### Phase 11: outside the app (`P06`, `P28`)

- **The Sunday card** (`P06`): on Sunday only, one card under Home's greeting, "Your week is
  ready", opening the month page on the week range. It needs nothing new:
  `WRAPPED_RANGES` has `week`. No notification.
- **The widget** (`P28`): four tag tiles that play on tap, and what is playing. It needs a
  native target, shared storage between the app and the widget, and a build that Xiao signs.
  Stop and ask before starting. iOS first; Android only if asked.

### Later, written down so it is not re-derived

The Later page of the mock (`L1`–`L7`): six places AI could help under three rules (your own
library only, it proposes and you approve, never a chat window), and ten ideas about the
library as a treasure place. None is scheduled and none should be started from this plan.

## Verification

Per phase, in this order, and a phase is not done until all are green:

1. `npm run check` from the root. All of it; a green `check:app` alone says nothing about
   `packages/`.
2. `npm run verify:flows`, both the `desktop` (1280) and `phone` (375) projects.
3. Maestro `smoke.yaml` on the iPhone 17 simulator, not the one Xiao tests on by hand.
   `downloads.yaml` and `offline.yaml` when the phase touched their paths.
4. **By eye against the mock**, both themes, the phone and 1280: open the board and the
   screen side by side for every board the phase lists. The mock is 390 × 844 and
   1280 × 800; compare at those sizes. Differences that are deliberate get a line in the
   phase's commit message.
5. With Reduce Motion on, nothing moves.
6. On a real phone for Phase 2 (safe areas under a floating bar), Phase 6 (the sheet's pull
   and the swipe) and Phase 8 (first launch).

testIDs: keep every testID whose thing still exists. New ones follow the old shape
(`tab-home`, `home-tile-0`, `home-you`, `queue-row-0`, `search-scope-songs`). A flow is
rewritten in the phase that breaks it, never skipped.

## Risks, and what retires them

| Risk | What retires it |
|---|---|
| A floating bar and a floating mini player over scrolling lists: content hidden under them, safe areas wrong on small phones and on Android's gesture bar | Phase 2 sets one `useBottomInset()` that every list uses; checked on a real phone before merge |
| Fonts flash or fail to load on native | Embedded by the config plugin, not loaded at runtime. One dev-client rebuild in Phase 1 |
| Removing hairlines leaves dense screens (Settings, Stats) with no structure | Phase 1 looks at those two first. If tone alone is not enough, spacing is the second tool; a border is not one |
| Flow churn: nearly every Playwright spec and two Maestro flows start from Library | Phase 2 adds one helper, `openLibrary()`, and uses it everywhere, so the change happens once |
| `LibraryScreen.perf.test.tsx` regresses as the row changes | The row gains no children in Phase 1; chips on rows stay capped at two and a count |
| Swipe-left to remove fights the list's scroll or the system back gesture | Left, not right, was chosen for this; the swipe needs a horizontal start within the row and a 30 % threshold. Tried on a real phone in Phase 6 |
| Drag out of the rail is undiscoverable | Delete and the right-click menu do the same; the Undo makes a wrong drag harmless |
| Artists as raw strings: "ヨルシカ" and "Yorushika" are two artists | Accepted for now and visible in the mock's own data. `FixMetadata` is where it gets fixed. See Open questions |
| Paper (light) was mocked for Home only | Phase 1 derives the rest from the Paper tokens; every later phase checks both themes |
| The design is phone-first; some computer screens have no board (an artist, a song page, All tags) | They are the phone page at computer width inside the shell, the way `C06` is `P08`. Say so in the PR; do not invent a layout |
| A long-lived branch drifts from `main` | One phase per branch, merged when green. No phase depends on an unmerged one |

## Sizing

Relative, not days. S is a sitting, M is two or three, L is most of a week of sittings.

| Phase | Size | Why |
|---|---|---|
| 1 The look | L | Every part and every screen is touched, though shallowly |
| 2 Shell and Home | L | Navigation, both shells, and nearly every flow |
| 3 Search | M | The model exists; the page and the doors are new |
| 4 Tags and artists | L | Three new pages, the Add sheet, a new pure module |
| 5 Library, song, playlists | M | Mostly removal, one new page |
| 6 Playing | L | Two new surfaces with gestures, two visuals |
| 7 Import | M | The listen code exists; the review list is redrawn twice |
| 8 Getting in, You, Stats, Settings | L | Many screens, five looks |
| 9 Motion | M | One helper, then call sites |
| 10 Extension | S | Small surface, shared tokens |
| 11 Outside the app | S for the card; L and uncertain for the widget | Native target |

## Runbook for an unattended agent

### Ground rules

The rules every unattended run in this repository has kept: one phase per branch
(`ui/phase-N`), commit at every green gate and never on red, no new dependency without a
Stack line above, ports before screens, and the foundations in
[ARCHITECTURE.md](ARCHITECTURE.md). Added for this work:

- **The mock is the spec.** If the mock and this document disagree, the mock's `S3` board
  wins over the mock's pictures, and both win over this document. Fix this document in the
  same commit.
- **Models before screens.** Every new page gets its `*.model.ts` and test first:
  `home.model`, `search.model`, `tag.model`, `artists`, `queueSections`. A screen with logic
  in it is not done.
- **Delete what a phase replaces, in that phase.** No redirects from old routes, no
  compatibility props, no dead screens left "for now".
- **No hairlines, no new colours.** A colour that is not in `S2` or derived from a tag's or
  a cover's hue is a bug.
- **Never touch** the server, `packages/shared` schemas, the sync protocol, the ports'
  contracts, or production data. Run against a scratch data directory with
  `SELFMP3_LIBRARY_DIR` set, never the dev profile on port 4600.
- **Stop and ask** at: an Open question below that has no answer; a gate failing twice on
  the same cause; a design need the data cannot meet; anything needing a signed build, a
  Google sign-in, or the widget's native target; a visible difference from the mock that is
  not a platform limit.

### Gates

```bash
npm run check
```

```bash
npm run verify:flows
```

```bash
maestro test apps/app/.maestro/smoke.yaml
```

A phase's branch merges when all three exit 0 and its boards have been compared by eye.

### Order of work inside a phase

1. Read the phase's boards and the matching part of `S3`.
2. Write or change the models and their tests. Green.
3. Build the screens against the models.
4. Delete what was replaced, and its tests.
5. Rewrite the flows the phase broke. Green.
6. Compare with the boards, both themes. Update `docs/features/*.md` for what changed:
   `design-system.md` in Phase 1, `tagging.md` in Phase 4, `now-playing.md` in Phase 6,
   `wrapped-and-gems.md` in Phase 8, `browser-extension.md` in Phase 10.

### What an unattended run cannot do

Judge whether it looks right. Feel a swipe on a real phone. Rebuild and sign the dev client
after Phase 1's fonts. Approve the widget's native target. Each of these is a stop.

## Open questions

Answered by Xiao on 2026-09-18.

1. **The untagged card (Phase 4).** Tapping it plays the untagged songs as a queue and opens
   Now Playing with the tag editor raised; each time tags are saved the next song starts.
   **Answer: yes, as proposed.**
2. **The four old visuals (Phase 6).** **Answer: Horizon and Ripples replace aurora, pulse,
   spectrum and drift outright**, and `autoVisual()` picks between the two by energy.
3. **Artists with two spellings, and "feat." (Phase 4).** **Answer: split collaborations.**
   An artist string is split on "feat.", "ft.", "&", "×", "x" between names and ","; each
   part, trimmed and compared case-insensitively, is an artist, and a song belongs to every
   artist it names. Merging two spellings of one artist stays a `FixMetadata` job.
4. **Selecting on a computer without Select in the menu (Phase 5).** **Answer: yes**, a
   checkbox on hover in the number column, plus shift- and ⌘-click.
5. **Downloading one playlist (Phase 5).** **Answer: "Download" moves into the playlist's ⋯
   menu.** The button on the page goes; keeping one playlist on the phone stays possible.
6. **Blur (Stack).** **Answer: no `expo-blur`.** A translucent fill on native;
   `backdrop-filter` on the web.
7. **Stats on the computer's rail (Phase 2).** **Answer: on a phone Stats is under You (the
   name page); on the computer and the web it stays a top-level sidebar row**, under Import.

## Progress

**Phases 1 to 11** on `ui/phase-1` … `ui/phase-11`, each on top of the last (the order is
1–8, 10, 9, 11), 2026-09-18 and 19. The widget (Phase 11's second half, `ui/widget`) is built
and its target compiles for the simulator; it waits on a team id, the App Group and a signed
build (docs/features/widget.md); on the simulator it shows the tags and Now playing faces and
a tile opens its tag. Leftovers are on `ui/finish`. Not merged to `main`. Gates: `npm run
check` green; `verify:flows` green (select-all counts only songs whose files are there);
Maestro `connect`, `smoke`, `downloads` and `offline` green on the iPhone 17 with a dev client
rebuilt from this branch; `connect` and `tablet` green on the iPad Pro 11-inch in portrait.
`devices.yaml` needs a second device and was not run. Not yet looked at: the packaged desktop
app, and Android.

Deliberate differences, kept in the commit messages too:

- Computer Home shows six tiles, three by two, as `C03` draws, not four.
- Computer Home's second card is "Import a link" rather than the import queue: the queue
  lives on the server and Home does not ask for it yet.
- The artists module (`packages/client/src/artists`) that Phase 4 lists was written in
  Phase 3, because Search needed its Artists scope.
- Search keeps the tab it was opened from lit and leaves the circle plain, as `P18` and `P19`
  draw it, not "the circle and no tab" as this document first said.
- Phase 4: a tag page's subline is "12 songs · 46 min"; "played most at 11 pm" needs listening
  history by hour, which only the server has, and is left out. The artist page leaves out "also
  written ヨルシカ": spellings are not merged (Open question 3). A tag page opened with more
  places added is titled with all their names ("night drive + Yorushika"). The nudge is the
  existing confirm dialog, so "Open the artist" is the accent button rather than white.
- Phase 5: the heart left every row (the menu's head and the song page have it), and so did a
  wide row's tempo and energy marks (the song page has them). Library keeps its tag filter as
  a strip ("All", the tags, "More tags"); picking tags no longer retitles it, and a phone still
  offers Play, Shuffle and Save for the picked set. The phone's Library has no sort or select
  buttons in its head (`P12` draws two): there is no sort on a phone yet, and holding a row
  selects. The Playlists page keeps the New tile and Forgotten gems, which `P16` does not draw
  but earlier decisions kept. On a phone nothing starts selecting inside a playlist (holding a
  row moves it). A new playlist you fill yourself is made when its first songs are picked.
- Phase 6: Now Playing's phone foot has a ⋯ as well (Devices, Practice, Download), which `P21`
  has no other place for; the player bar keeps Like, Tags and Sleep beside what this plan
  lists. The swipe in Up next is decided by distance, and removes on a timer, because a
  browser does not always report the end of a gesture-driven slide.
- Phase 7: review is a route, `/import/review`; "N of M in" counts only what is coming in.
- Phase 8: a development build connects by address from Welcome (the onboarding page is
  gone); Google returns to `/welcome`. The stats are rolling windows, so pages say "Last 30
  days" and leave out comparisons with the last period, which the API does not give. Saving
  the month as an image still draws the share port's own card, in the chosen look's colours.
- Phase 9: no shared elements; Popover, ToastHost, the equaliser and the stage's Stage/Focus
  move still use Animated directly (reasons in the files), with their durations passed
  through `motionMs` so Reduce Motion stills them.
- Phase 10: the extension's theme is generated from the tokens and git-ignored.
- Play-and-tag on a phone raises the tag picker as a sheet whose search field takes focus, so
  the keyboard comes up for every song; on the computer, Stop while the picker is open closes
  the picker first, which counts as a close. Both are small and noted for Phase 6.
- The mini player's queue button opens Now Playing with Up next raised (Phase 6 makes it a
  sheet). Devices left the mini player; it is on Now Playing and in Settings.
- The sidebar's name row reads the connection line, not a name: the app does not know the
  account's name on every kind of library.
- No haptic on play and pause: `expo-haptics` is not in the Stack.

## What to do first

Answer the Open questions. Then Phase 1, on `ui/phase-1`, starting with the tokens and the
fonts, because the dev client has to be rebuilt once and everything after can then be seen
as it is meant to look.

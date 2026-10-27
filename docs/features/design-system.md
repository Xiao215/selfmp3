# Design system

**The visual reference is `S2` of the UI mock** ([`docs/ui-mock/boards/S2-the-visual-system.html`](../ui-mock/boards/S2-the-visual-system.html)),
with the behaviour in `S3` and the moves in `M1`–`M3`. Design against those, not against older
screenshots.

The shared UI primitives: the dropdown, the floating-layer shell every menu sits in, the
tokens, and the rules for stacking and focus. Anything built on top of these should not
need to reinvent portalling, dismissing, focus handling or z-index numbers.

Files:

| What | Where |
|---|---|
| Dropdown | `apps/app/src/ui/components/Select.tsx` |
| The song row | `apps/app/src/ui/components/SongRow.tsx` |
| The song menu | `apps/app/src/ui/components/SongMenu.tsx`, what it offers in `apps/app/src/ui/songActions.model.ts` |
| The shared parts | `apps/app/src/ui/components/SearchField.tsx`, `EmptyState.tsx`, `Skeleton.tsx`, `SectionHead.tsx`, `SongLine.tsx`, `Chip.tsx`, `Button.tsx`, `Press.tsx` |
| Floating-layer shell | `apps/app/src/ui/components/Popover.tsx`, `Sheet.tsx`, `apps/app/src/shell/Overlay.tsx` |
| Hover captions | `apps/app/src/ui/tip.ts`, `apps/app/src/shell/TooltipHost.web.tsx` |
| Tokens | `packages/client/src/theme/tokens.ts`; shared shapes in `apps/app/src/ui/surfaces.ts`; themes in `apps/app/src/ui/theme/unistyles.ts` |
| Motion | `apps/app/src/ui/motion.ts`, `motion.model.ts` |
| Focus | `apps/app/src/shell/FocusStyle.web.tsx` |

## `<Select>` — the dropdown

A native `<select>` renders its list with the operating system: on a Mac that is a white
sheet with a blue system highlight dropped on top of a dark app. The app has none; `Select`
is a button showing the current value plus a list of our own.

```tsx
<Select<SongSortField>
  value={sort}
  onChange={setSort}
  options={SORT_OPTIONS}         // [{ value, label, hint?, disabled? }]
  label="Sort by"                 // what is being chosen, read out before the value
/>
```

| Prop | Meaning |
|---|---|
| `value` / `onChange` | Controlled, generic over the value type — call sites keep their unions (`Select<SongSortField>`), and values may be strings or numbers |
| `options` | `{ value, label, hint?, disabled? }[]`; `hint` is a quieter note beside the label |
| `label` | What is being chosen. Required |
| `size` | `normal` \| `small` \| `inline` — the ordinary control, one in a row of them, and text-sized for use inside a sentence |
| `testID` | For the end-to-end flows |

Behaviour worth knowing:

- **A `Popover` underneath.** The trigger is a button showing the current value; the list is
  a `Popover`, so it is drawn by the shell's overlay host (nothing can clip it), sits under
  the trigger, and flips above near the bottom of the window.
- **Phone.** Below 820 points (`BREAKPOINT`) the list becomes a bottom sheet, titled with the
  `label` — decided by the primitive, not by the caller.
- The selected option is marked with a check; long values truncate with an ellipsis in the
  trigger rather than stretching the row. The chevron turns over the same length the panel
  takes to open.

## `<SongRow>` — the one song row

**There is one song row in the app, and every list of songs draws it** — Library, a playlist,
a tag, an artist, Search's Songs, the phone's Up next. A new list of songs uses this; it does
not start a row of its own. At phone width a tap plays, the ⋯ is always there and holding the
row selects it; at desktop width it is a table row with the checkbox, the position (or the
equaliser for the loaded song), the album once there is room, the tags, the length and ⋯.

What a page adds, it adds as props rather than as a second row:

| Prop | For |
|---|---|
| `tags` / `hideTagIds` | The song's tag chips, two and a count. Only Library, Search and Up next pass them; inside a place they are left off, and tags the list is already about are hidden |
| `index` | The position number at desktop width, which becomes a play button on hover |
| `lifted` | This row is being moved, so it rides above its neighbours |
| `onLongPress` | What holding it does: selecting. Left out in a list whose order is yours, where the hold belongs to the list's mover |
| `unavailable` | Nothing could play it right now; drawn faded |

A list whose order is yours (a playlist, an Ask answer) is `OrderedSongList`: the same rows,
held to lift (`HoldToReorder`), with the rows around opening a gap where it will land. There
is no grip column.

Anything a page wants to *do* to a song goes in the ⋯ menu (`SongMenu`, docs/ui-mock `P14`).
It is one menu, the same items in the same order wherever a song is, and the selection bar's
More asks the same list (`songActions`). It is headed by the song (cover, title, artist, tags,
heart), then **Tags…**, Add to playlist, Add to Up next, Play similar songs, **Share link**
when signed in with storage, **Download** or **Remove from this phone** (computer) in an
installed app, and **Song details**, which opens the song's own page (`/song/<id>`, `P15`).
Opened from a playlist you made it adds **Remove from this playlist**, so a playlist needs no
button of its own in the row. **Delete from library…** is last. On Now Playing the menu leaves
out what the page already shows (the heart, the tags, Tags…, Song details) and Add to Up
next, and the phone's adds a "This player" group with the sleep timer and Devices. A friend's
song in a room gets none of the library's actions. Play next and Fix song info… live on the
song's page, not in the menu; selecting starts from a held row or the checkbox.

In a browser and the desktop app a right-click on a song row, a Home tile, a shelf's card, a
tile on Tags or Playlists or a sidebar tag opens that thing's menu at the pointer (`ui/rightClick.ts`: a point stands in
for the ⋯ as the popover's anchor), and the browser's own menu stays away.

Up next has three icons for its three actions: `UpNext`, a list with a play
mark, on every control that opens it (the mini player, the player bar, Now Playing's foot);
`QueueAdd`, a list with a plus, only for Add to Up next; and `Next`, the skip mark, for Play
next.

The row is memoised, and the list it is in is long, so nothing handed to it may be new on
every render: hand it the page's own stable handlers (each takes the song, so one function
serves every row), and look tags up through `songTagLookup` (`ui/songTags.ts`), which keeps
one array per song. Whether a row is the loaded song it asks the player itself.

## One look per part

The same part looks the same wherever it is. A screen uses these; it does not draw its own.

| Part | What it is | Where |
|---|---|---|
| `SearchField` | The one search field: a pill one step up from what it sits on, a magnifier, a × once there are words. Its edge and magnifier turn the accent with the focus. 48 high with a finger, 40 with a mouse. `raised` on a card, a sheet or a panel. Given `onPress` and no `value` it is a **door** to the real search (Home, Library); `trailing` takes the ×'s place (Ask's Stop, the palette's count) | Search, Home and Library (as doors), the palette, Import's search, a tag's Add, the song picker, the tag picker, the listen-tags panel |
| `EmptyState` | What stands where a list would be: an optional icon on a round mark one step up, a title, one short line, and the button that fixes it (children). `compact` in a sheet, a panel or the palette | Library, a playlist, Home, Stats, the Report, Search, the palette, the add sheets, Now Playing, Links you shared, a room when you are in none |
| `SectionHead` | A section's heading: its name in the display face at 18, and a link to the rest at the other end ("All 9", "See all"). `aside` for quiet words beside it, `collapsible`, `end` for buttons, `look="label"` for a quiet group inside a sheet or list | Home, Search, Settings, Stats, Import, Up next's rail, a song's similar shelf, a room's sheets |
| `Skeleton` | What a list or a grid is while it is on its way: its shapes (`Bone`) in `surface1`, drawn only after 300 ms (`MOVE_MS.skeletonWait`) so a quick answer never flashes them, with one slow light across them that stands still under Reduce Motion. `SongRowsSkeleton` is a song list's | Home's tiles and Recently played, Library, a playlist, Stats, Tags, the sidebar's lists |
| `SongLine` | The compact song line: a 36 cover (`coverSize.line`), the title, a line under it, and what the place needs at the end. Pressable with `onPress`, or the face alone for a row whose press a screen owns | Up next's rail, the palette, the song picker, Profile, a room, Ask's answers, Tidy up's review |

`SongLine` is not `SongRow`. A list of songs — Library, a playlist, a tag, Search's Songs, the
phone's Up next — draws `SongRow`; `SongLine` names a song somewhere else. The quiet label
(`label()`, sentence case: "Playlists", "On this page", "Last 30 days") is not a section
heading either: it names a group. Small spaced capitals are kept for one thing, a figure's
name on a stat card (`figureLabel()`: LISTENED, PEAK HOUR, STREAK).

**Chips** come in two kinds: the filter pill (`Chip`: a tag strip, Search's tags before
typing, Settings' sections on a phone) and the row label (`SongRow`'s tag chips, `rowTags`).

**"On"** is said one of two ways. A pill, a chip, a segment or a section index that is chosen
is **white** with dark ink (`textPrimary` behind `onPrimary`; on Paper that is ink behind
cream) — `Chip`'s `selected`, `Button`'s `active`, `Segmented`, Settings' index, Up next's
Shuffle. A **transport toggle** — shuffle and repeat in the player bar and Now Playing — says it
in colour instead: its icon in the song's or the accent's colour. Nothing is "on" in a lighter
grey: that read as hovered.

Not on these yet, on purpose: Stats' ranked lines (a rank, a picture of three kinds and a share
bar, not a song line), the import rows waiting above Library (they stand in for `SongRow`s in
the list below them), Forgotten gems' cards (a shelf of posters), and the sidebar's search
row (a row of the rail, which opens the palette). Up next on a phone keeps its own panel
rather than `Sheet` (`features/queue/QueueSheet.tsx`): it is drawn by the shell under the
overlay host so a song's menu and the Undo toast for a swiped-away row land above it, and it
stays mounted while shut so that Undo still reaches the queue; its rise, pull and thresholds
are `Sheet`'s own (`MOVE_MS.sheetUp`/`sheetDown`, `PULL`).

## `<Popover>` — the floating-layer shell

`ui/components/Popover.tsx` holds the parts every menu, popover and dropdown needs: anchored
positioning with flipping, a backdrop that dismisses, Escape, and the phone bottom sheet.
What a popover *contains* is entirely the caller's business — this is a shell, not a menu
framework. `SongMenu`, `TagPicker`, `Select`, `MoreMenu`, the selection bar's More, the sleep
menu and the devices list all use it. Without an `anchorRef`, or below the breakpoint, it is a
`Sheet`.

```tsx
const buttonRef = useRef<View>(null)

<View ref={buttonRef} collapsable={false}>
  <IconButton onPress={() => setOpen(true)} … />
</View>

<Popover open={open} anchorRef={buttonRef} onClose={close} title="Song actions">
  <SheetItem label="Add to queue" onPress={…} />
</Popover>
```

| Prop | Meaning |
|---|---|
| `open` / `onClose` | Controlled; `onClose` is called on Escape and on a press outside |
| `anchorRef` | The control this belongs to, or a right-click's point. Measured with `measureInWindow` when it opens |
| `title` / `titleTone` / `subtitle` | Shown when it falls back to a sheet, where a panel has room for a heading |
| `panelTitle` | A quiet line at the top of the panel, where the sheet would have its title |
| `placement` | `auto` (below when it fits, else above), `below` or `above` |
| `align` | `end` (default) or `start`: which edge of the control the panel lines up with |
| `width` | The panel's width above the breakpoint (240 by default) |

Notes for anyone extending it:

- React Native has no `position: fixed`, so above the breakpoint the panel is drawn by the
  shell's overlay host (`shell/Overlay.tsx`) at the anchor's measured coordinates, and kept
  on screen. Below it, the same children go into a `Sheet`.
- Open overlays paint in the order they opened, which is the order `useEscape` closes them
  in, so a dropdown opened from a sheet or a dialog sits above it.
- A screen's keys (`useHotkeys`) and Escape stand aside for a focused `combobox`, `listbox`,
  `menu` or `dialog`, as they do for a text field (`shell/keyOwner.ts`). If you build a
  control with its own keyboard language, give it one of those roles. A song list's `grid` is
  the exception: Space after clicking a song is still play and pause, so the page stands aside
  only for a row the keyboard is on (`rowOwnsKey`). Open layers are listed
  in `shell/layers.ts`, for keys that must also stand aside while one is open (a list's ⌘A).
- On an iPad or an iPhone with a hardware keyboard the same hooks register key commands
  (`shell/keyRegistry.ts`, [MOBILE.md](../MOBILE.md), "A hardware keyboard"), and the same
  layer stack decides which open layer Escape closes. A text field there is the only thing
  that keeps keys: the module withdraws the ones it must have while it is being typed in.

## `data-tip` — hover captions

A native `title` is drawn by the operating system, like a native `<select>`: on a Mac it
waits about a second and a half and then drops a pale system label onto a dark app. So
nothing uses `title`; a control that wants a caption spreads `tip()` from `ui/tip.ts`, which
React Native for web turns into a `data-tip` attribute (a phone ignores it):

```tsx
<Press accessibilityLabel="Add to Up next" {...tip('Add to Up next')}>…</Press>
```

`TooltipHost` (`shell/TooltipHost.web.tsx`), mounted once in the shell, listens on the document and draws the caption
above the control (below near the top of the window, clamped at the sides). A trailing
`(key)` of up to five characters, as in "Done (Esc)", is drawn as a key cap.

- **Timing.** 300 ms of rest with a mouse (`MOVE_MS.tooltipDelay`); none when moving
  straight on from another caption, so running along the transport reads every button; none
  on keyboard focus. Never on touch.
- **Dismissal.** Pressing the control, any key, a scroll that moves it, and leaving the
  window all close it. A pressed control stays quiet until the pointer leaves it.
- **Live.** If the control's `data-tip` changes while its caption is up, the caption follows;
  if the control leaves the DOM, the caption goes with it.
- A caption is not an accessible name. Icon-only controls still need `aria-label`; the host
  links the caption with `aria-describedby` while it is showing.
- Text that only repeats what is already fully visible is skipped, so `data-tip` on a
  truncating title shows only once the title is actually cut off.

## Words

One way to say each thing, everywhere: labels, menus, toasts, accessibility labels, empty
states, and the flows that assert them. Sentence case, plain words.

| Thing | Say | Not |
| --- | --- | --- |
| Favourite | **Like** / **Unlike**; "Like all", "Unlike all", "Liked", "Not liked" | Love, Loved, hearts |
| What plays next | **Up next**; "Add to Up next", "Remove from Up next" | Queue |
| Taking a song out of a place | **Remove from …**, naming the place: "Remove from this playlist", "Remove from Up next", "Remove from imports" | Take off, Take out of |
| Taking it out of the library | **Delete from library…** — it deletes the files on every device | Remove from library |
| A whole playlist or tag | **Delete** | Remove |
| A device in Settings | **Remove** | Forget |
| Kept on this device | **On this phone** / **On this computer** (`onThisDevice`, `devicePlace`); the action stays **Download**, its undo is **Remove from this phone** | Downloaded, Offline, saved offline, kept |
| A playlist that fills itself | **Live** by its loop mark; its row "Keeps itself filled with songs tagged …"; "Stop adding" | Fills from, Stop filling, Follow tags, a broadcast mark |
| Putting another tag or artist with this one | **Mix in…** | Combine with… |
| A tag whose songs all sit in another | **Includes** [tag] (n), under the one it is in | Inside: |
| The stale sign-ins a browser leaves in Devices | **N old sign-ins** · Clear | older sessions, Remove all |
| A song's page | **Song details** (Now Playing's tab on a computer: **Details**) | About this song, About |
| The weekly page | **Report**; "Open the report" ("Your week" may head a card) | Wrapped, View Report |
| Where songs are stored | **your storage** (Backblaze only in its setup steps) | bucket, cloud, cloud library |
| The server, where a cloud library needs it | **your library's computer** | server |
| Correcting a song's names | **Fix song info…** (Tidy up stays its own feature) | Fix metadata |
| Lyrics with times | **Timed** | Synced |

Everyday screens never say server, bucket, cloud, sync, cache, token, snapshot, publishing,
doorman, replica, rescan, sweep, metadata or "the model". Those words stay where the reader
is setting the thing up — Settings › Advanced, the storage (Backblaze) setup and the server's
own admin page — and even there a plain word wins when it costs nothing ("Disconnect your
storage", not "Forget the bucket").

Status is said only when it needs you. A computer's sidebar foot is the person and a dot;
hovering it says "All saved · 109 songs · 12 on this computer", and a card above it appears
only when something stops working — offline, the library out of reach, the storage's
allowance used up — saying what still works and what to do (`footNotice`). An error toast
says what did not happen and, when it helps, why in plain words (`failureText`): "your
library isn't reachable right now", or a refusal the server worded for people; never a
request line or a status code, which go to the console.

## Tokens

The app reads its tokens from `packages/client/src/theme/tokens.ts` (`colors`, `radius`,
`space`, `type`, `leading`, `textStyle()`, `tracking`, `iconSize`, `coverSize`, `fonts`,
`motion`, `HIT_TARGET`, `BREAKPOINT`, and `buildAccent`, `tagColors`, `roomFace` for colours
worked out from a hue). Unistyles holds the dark and light themes built from them at this
device's accent hue, and restyles every `StyleSheet.create(theme => …)` when the theme or the
accent changes, without a reload. The extension's stylesheet is written from the same tokens
on every build (`apps/extension/scripts/theme.mjs`).

**Nine type sizes and no others**, each with the line height to use when its words wrap
(`textStyle(step)` gives both). A line that never wraps leaves `lineHeight` off.

| Token | Size | `leading` | For |
|---|---|---|---|
| `type.tiny` | 11 | 15 | counts, times, a stat card's figure name |
| `type.small` | 12 | 17 | captions and hints |
| `type.sub` | 13 | 19 | the line under a title, a chip, secondary words |
| `type.body` | 15 | 21 | body text, a song row's title, a button, a field |
| `type.title` | 17 | 23 | a sheet's or a dialog's title |
| `type.section` | 18 | 22 | a section's heading (display face) |
| `type.large` | 22 | 26 | a tile's name, a big title |
| `type.page` | 30 | 34 | a page's title (display face) |
| `type.display` | 46 | 50 | a greeting, a name at the top of a page, a big number |

What is left outside the scale: the Report's shareable looks (`features/wrapped/looks`), which
are posters with their own typography; Now Playing's stage title and lyrics, which grow with
the window; and a letter tile's initial, which is a share of its cover.

**Room** is `space`, on a two-point grid: `xs` 4, `tight` 6, `sm` 8, `snug` 10, `md` 12,
`roomy` 14, `lg` 16, `card` 18 (a card's own padding), `xl` 24, and the two page gutters,
`gutter` 20 on a phone and `gutterWide` 40 on a computer. `pageFrame(wide)` in `surfaces.ts`
gives a page its top and sides.

The rules from `S2`, as the code keeps them:

- **No hairlines.** Separation is tone on tone: the ground (`surface0`), a card one step up
  (`surface1`), a control (`surface2`), a raised control (`surface3`), and the empty part of a
  track (`surfaceSelected`: a switch that is off, a bar not yet played). An edge is drawn
  only where the edge is the mark itself: a checkbox's ring, a dashed "add", a focus ring.
- **Paper**, the light theme, is warm; only its accent follows the hue. White cards on
  cream have no tone to separate them, so a card casts a soft shadow there (`card()` in
  `apps/app/src/ui/surfaces.ts`); in the dark it casts none. Only floating things (sheets,
  menus, the bars, a lifted row) cast a shadow in both (`floating()`).
  A cover on Paper has a shade a point inside its own edge and a drop as soft, so a
  white cover still has a shape on cream (`CoverEdge` in `Cover.tsx`, once round a
  mosaic); in the dark it has neither.
- **Shapes** are named: `radius.pill` for buttons, search fields, chips and segments; `field`
  12 for a text field that is not a search; `item` 12 for a menu's line or a caption; `card`
  18 and `cardLg` 22; `sheet` 26; `mini` 16; `row` 14; covers `cover` 10 and `coverSm` 8.
- **Type**: the system font for rows and body; `fonts.display` (Bricolage Grotesque 600) for
  page titles at `type.page` and sections at `type.section` — Profile's name, an artist's and
  "Where it lives." included; `fonts.serif` (Instrument Serif) for greetings and big numbers
  only. Neither face takes a `fontWeight`: the weight is in the file.
  `surfaces.ts` has `pageTitle()`, `sectionTitle()`, `heroTitle()`, `label()`, `figureLabel()`
  and `serif()`,
  and `card()`, `floating()`, `dialogPanel()` and `menuItem` for the shapes around them.
- **Buttons** come in four shapes (`Button.tsx`): the round white `PlayButton`, at most one
  per page; the tonal pill; the text action; the accent pill, kept for the one button that
  commits. **Chips** are neutral pills with a dot of the tag's hue; chosen is white (see
  "On", above).
- **Tags' colours** come from `tagColors(hue)`: a tile fill and its ink, a dot, and the name in
  its hue. A person's face in a listening room comes from `roomFace(colour)`.

**Stacking.** Sheets, popovers and dialogs are not native modals: they are drawn by one
overlay host at the root of the shell (`shell/Overlay.tsx`), in the order they opened, so the
one opened last is on top. The few layers that stand over a page from inside it — a list's
pinned head, its scrollbar and the playing song's mark on it, and the hover caption over
everything — take their numbers from `Z` in `surfaces.ts`; a component's own stacking stays
its own.

**Motion.** Every move goes through `apps/app/src/ui/motion.ts` (`spring`, `timing`,
`useEntrance`, `useArrival`, `useFade`, `usePresence`, and the curves in `ease`), which
answers Reduce Motion once: under it each move lands where it was going with no time in
between. The navigator's own moves are outside it, so `shell/pageStep.ts` answers for them
(`stackAnimation`, `nowPlayingAnimation`: none under Reduce Motion). The fades are 100–220 ms
(`motion` in `tokens.ts`) and ease out; anything that moves in space takes the one spring
(`motion.spring`, stiffness 220, damping 24) or a length the boards give. Every length has a name in `MOVE_MS`
(`ui/motion.model.ts`, which also holds the overshoot curve, the stagger, the press depths,
the pull thresholds and what a session remembers); a duration written as a number in a screen
is a mistake. The rules, and what moves (docs/ui-mock `M1`–`M3`):

- **Everything that arrives leaves.** A thing that came in over a move goes out over a
  shorter one on `ease.in`, and stays drawn until it has gone: `usePresence` keeps it mounted
  for the way out. The mini player sinks back under the bar, the player bar slides back
  down, a row's wash draws back to the right, the held queue row settles, the stage's chrome
  fades. Nothing that moved in is cut away.
- **A list never jumps under a pointer.** Where rows come and go because of a press — the
  import queue's Retry, Pause, × — each row is a Reanimated `Animated.View` carrying
  `useRowMotion` (`ui/rowMotion.ts`): it fades in over `MOVE_MS.rowIn`, out over `rowOut`,
  and the rows around it glide to their new places over `rowMove`. Headers and "Show more"
  are siblings of the rows, never a box around them, since a browser animates a box whose
  height changed by stretching it. What changed is drawn before the server answers
  (`changeQueue`), so the row moves under the finger, not a poll later.
- **One press.** `ui/components/Press` is the Pressable, and answers a press one of three
  ways (`feedback`): `sink`, the default, on the spring and back on release, a control to
  0.96 and a row to 0.985 (`PRESS`) — anything with a shape of its own; `wash`, the ink's
  veil over a bare row (the palette's `veilPressed`); `dim`, bare ink fading to
  `OPACITY.pressed`. A
  `pressed` style may add a tint; it never scales. What cannot be pressed now is drawn at
  `OPACITY.disabled`, and what is there but not live (a song that cannot play here) at
  `OPACITY.dim`. A small target reaches the 44-point minimum by `hitSlopFor(size)`. Screens
  never draw React Native's `Pressable`, `TextInput` or `ActivityIndicator` themselves: the
  app's lint refuses them in `features/` and `shell/`, pointing at `Press`, `TextField` or
  `SearchField`, and `PageLoading`, a busy `Button` or `Spinner`. A ground that only closes
  what is open is `TapAway`.
- **What changes together moves together.** A colour that goes with a position rides the
  same value, as an overlay whose opacity follows it on the native driver: the toggle's
  track, a tab's ink, a checkbox's fill. In a browser a row warms under the pointer through a
  CSS transition on the same two clocks as its controls (`MOVE_MS.hoverIn`/`hoverOut`).
- **An interrupted move continues from where it is.** The tab pill, the sidebar's highlight
  and a segmented control's pill are springs, so a second tap turns them rather than
  restarting; a stage exit or a page's own close plays once, however many times it is asked
  (`shell/stageExit.ts`).
- The Up next button wears how many songs wait after the one playing, a small count in the
  accent on its shoulder, which ticks up (and swells once) as flying covers land on it rather
  than the moment the songs are queued (`UpNextTarget`, `flightsUnderway`).
- Liking a song pops its heart — in to 0.82, out past its size to 1.22, home, over
  `MOVE_MS.likePop` — and one ring in the song's colour goes out from it (`likeRing`);
  unliking just turns it back (`LikeButton`).
- Play and pause turn through each other, out on `ease.in` and in on `ease.out`, with a light
  tap on a phone (`ports/haptics.ts`); a spinner that
  replaces the glyph crossfades in and stays at least `MOVE_MS.busyHold`.
- The mini player rises from under the tab bar with a few points of overshoot, 320 ms, on
  the first song of a session (again only after the queue has emptied); a later song's words
  step out one way and the next's step in from the other, up for the next song and down for
  the one before. Tapping the card sinks it as a row. Home's tiles fade up 60 ms apart on
  their first paint of a session, closing up so a long grid's last tile starts within 300 ms
  (`STAGGER_TOTAL_MS`), and never on a tab switch.
- Sheets (`Sheet`, Up next) come up from the foot with a four-point overshoot in 300 ms and
  go down in 220; the dim fades with them; a pull past `PULL.close` or a flick faster than
  `PULL.flick` sends any of them away. A computer's dialog, the confirm dialog included,
  fades and settles from ten points below.
- A phone's tab pill springs to the new tab while its ink turns, and the page steps in 8
  points from that side, 200 ms; a computer's sidebar highlight springs and the page settles
  from 6 points below, 180 ms (`shell/pageStep.ts`, `ui/components/SlidingHighlight.tsx`).
  The phone's stack pushes pages with iOS's own slide, the one the swipe back drags. A tag
  opened from its Home tile crossfades over 340 ms instead while its head grows out of the
  tile (`ui/coverHandoff.ts`), and Back shrinks the head into the tile as the page fades.
  The grow starts with the navigator's `transitionStart`; a page going
  away is told nothing, so the shrink starts with the press.
- Now Playing rises from the foot on the spring on a phone and in a browser, its cover
  travelling from where the mini player's or the bar's was (`ui/coverHandoff.ts`), and sinks
  back before the route changes; an iPad's stack slides it, 380 ms. The cover shrinks to
  0.84 on pause over 400 ms and grows back on the spring. The desktop stage's chrome fades
  out over 400 ms when the mouse is still and back in 100 ms when it moves.
- A row that starts playing washes in its colour from the right, 260 ms, and its equaliser
  wakes behind it; both draw back as the song moves on. The equaliser's bars keep their
  phase across a pause. With a mouse a row's controls fade in over 100 ms and out over 140,
  and the row's fill warms and cools on the same clocks.
- Moving a song in Up next, a playlist or the rail: the row swells a little while the hold
  is counted (`MOVE_MS.hold`, one length everywhere), lifts to 1.04 in 120 ms, the rows it
  passes step aside, 180 ms each, and letting go settles it on the spring with a tap. On a
  computer Up next slides in from the right on the spring.
- The selection bar rises on a phone as a sheet does and sinks away. On a computer its lane
  opens above the songs and the bar settles down into it: at the foot of the head on a tag,
  an artist or a playlist, whose head scrolls with the songs, and it stays at the top of the
  list once the head has scrolled away.

Still not built: true shared elements. The cover and the tile travel from a measured frame
instead, which is the same picture on every device the app runs on. Looping indicators — the
spinner, the equaliser — are left alone under Reduce Motion, because they are saying that
something is still happening.

## Text size

The system's text size (iOS Dynamic Type, Android's font scale) is followed, by these rules
(`ui/textScale.ts`, AM1). A browser zooms the whole page instead, so a tab never sees them.

- Song titles, page titles and reading text scale fully.
- Controls stop at about 1.3× (`CONTROL_SCALE`, as `maxFontSizeMultiplier`): tab bar labels,
  chips, segmented choices, small badges and key caps, and the mini player, whose icons and
  height do not grow with its words.
- A big number shrinks to fit its card (`FIT_FIGURE`) and is never cut to "18h…": Stats' cards,
  This week, You's month. It grows no more than about 1.75×, as iOS's own large titles do. At
  the Accessibility sizes each Stats card takes the full width, and This week's and You's three
  figures stand one under another (`StatFigures`).
- A one-line page title is set smaller rather than cut (`PageHeader`), and at the
  Accessibility sizes a Settings row puts its control under its words.
- A head's title that would need more than two lines beside its cover puts the cover above it
  (`useStackedTitle` on a song's page; a place's name tells `ListHead` the same).
- The Report's looks are pictures: their print keeps the board's size, and the page around
  them grows.

## Focus and interaction

- In a browser, `shell/FocusStyle.web.tsx` turns the browser's own ring off once and draws
  ours: one line in the accent, only while someone is moving focus with Tab. `:focus-visible`
  alone counts any key as keyboard use, so Tab turns the ring on and a pointer press turns it
  off: a Tab still shows where you are, and Space to pause after a click draws nothing. The
  colour follows the accent picker. Whether the keyboard is moving focus is one attribute on
  `<html>` (`shell/tabbing.ts`), which a song list's arrows turn on as Tab does.
- A song row wears the ring round its whole width, just inside its edge, rather than round its
  press target, which lies under the cover and title only; with the ring on, it shows its
  controls as the pointer would. Space on such a row is its tick, not play and pause
  ([multi-select.md](multi-select.md)).
- In a list that clips what it holds (the sidebar, a shelf, Library's tag strip) every ring is
  drawn just inside its edge, as a song row's is: spread `FOCUS_INSIDE` (`shell/tabbing.ts`) on
  such a list. On a computer the first Tab stop is "Skip to the page" (`shell/SkipToPage.web.tsx`),
  out of sight until focused, which moves the focus past the sidebar to the page's first control.
- A song list is one Tab stop (a roving tabindex, as WAI-ARIA's grid): its rows' controls are
  out of Tab's way, ↑ ↓ move between rows and ← → along a row's controls, and Tab from anywhere
  in a row goes on past the list (`selection/useListKeys.web.ts`). Anything else that draws a
  long run of controls should do the same rather than make Tab walk through every one.
- A text field with a border of its own takes the accent as its border colour instead; a
  field without one sits in a box that shows focus itself (`SearchField` turns its edge and
  magnifier to the accent).
- Sliders and checkboxes keep what they draw. In a browser the slider is a real
  `input[type='range']` with its own rules (`ui/components/Slider.web.tsx`), keyboard and all.

## The toast row

Toasts are one layer of the app shell (`Toasts` in `shell/Shell.tsx`): centred near the foot of
the content, with the resume offer (on a phone; a computer's waits at the foot of the sidebar,
`ResumeCard`) and every message raised with `showToast` (`ui/toast.ts`), drawn by `ToastHost`. The layer takes no touches itself, and on a phone it lifts above the
floating selection bar rather than covering its buttons; each toast is dismissible. Put new
transient messages in that row rather than positioning them by hand.

Undo comes two ways. `showUndoToast` is for what can be put back: it is done at once and
Undo does the opposite. `showPendingToast` is for what cannot be (folding an extra copy of a
song, [ai.md](ai.md), "Copies"): the message says it is done, but it is sent only when the
toast's five seconds are up or the app is leaving (`sendPending`), and Undo cancels it before
anything was written.

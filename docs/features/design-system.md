# Design system

The shared UI primitives: the dropdown, the floating-layer shell every menu sits in, the
tokens, and the rules for stacking and focus. Anything built on top of these should not
need to reinvent portalling, dismissing, focus handling or z-index numbers.

Files:

| What | Where |
|---|---|
| Dropdown | `apps/app/src/ui/components/Select.tsx` |
| The song row | `apps/app/src/ui/components/SongRow.tsx` |
| Floating-layer shell | `apps/app/src/ui/components/Popover.tsx`, `Sheet.tsx`, `apps/app/src/shell/Overlay.tsx` |
| Hover captions | `apps/app/src/ui/tip.ts`, `apps/app/src/shell/TooltipHost.web.tsx` |
| Tokens | `packages/client/src/theme/tokens.ts`, `tokens.reference.css`; themes in `apps/app/src/ui/theme/unistyles.ts` |
| Focus | `apps/app/src/shell/FocusStyle.web.tsx` |

## `<Select>` — the dropdown

A native `<select>` renders its list with the operating system: on a Mac that is a white
sheet with a blue system highlight dropped on top of a dark app. There were 21 of them;
there are now none. `Select` is the replacement — a button trigger plus a listbox of our
own, following the ARIA select-only combobox pattern.

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
| `options` / `groups` | Either `{ value, label, hint?, disabled? }[]`, or labelled groups: `{ label, options }[]` |
| `label` | What is being chosen. Required |
| `size` | `normal` \| `small` \| `inline` — the ordinary control, one in a row of them, and text-sized for use inside a sentence |
| `testID` | For the end-to-end flows |

Behaviour worth knowing:

- **A `Popover` underneath.** The trigger is a button showing the current value; the list is
  a `Popover`, so it is drawn by the shell's overlay host (nothing can clip it), sits under
  the trigger, and flips above near the bottom of the window.
- **Phone.** Below 820px (`BREAKPOINT`) the list becomes a bottom sheet, titled with the
  `label` — decided by the primitive, not by the caller.
- The selected option is marked with a check; long values truncate with an ellipsis in the
  trigger rather than stretching the row.

## `<SongRow>` — the one song row

**There is one song row in the app, and every list of songs draws it.** The library and a
playlist are the two, and for a while they were two components: the playlist's had no heart,
no tag chips, no dashed ＋, no equaliser on the cover and none of the colour the playing
song's cover gives its row — so the same song looked like a different kind of thing
depending on which page you found it on. A new list of songs uses this; it does not start a
row of its own.

What a page adds, it adds as props rather than as a second row:

| Prop | For |
|---|---|
| `leading` | A node at the very start of the row, before the checkbox. A playlist's drag grip is the only one |
| `lifted` | This row is being moved: it wears a raised surface and a shadow |
| `dropTarget` | A move would land here: a line in the accent along the row's top edge |
| `index` | The position number at desktop width, which becomes a play button on hover |
| `onLongPress` | What holding it on a phone does. Left out, the ⋯ menu opens; `null` when something outside the row owns the hold, as a playlist's move does |

Anything a page wants to *do* to a song goes in the ⋯ menu (`SongMenu`), which already takes
a `playlist` and offers **Remove from this playlist** there — so a playlist needs no button
of its own in the row.

The row is memoised, and the list it is in is long, so nothing handed to it may be new on
every render: hand it the page's own stable handlers (each takes the song, so one function
serves every row), memoise `leading`, and look tags up through `songTagLookup`
(`features/library/library.model.ts`), which keeps one array per song.

## `<Popover>` — the floating-layer shell

`ui/components/Popover.tsx` holds the parts every menu, popover and dropdown needs: anchored
positioning with flipping, a backdrop that dismisses, Escape, and the phone bottom sheet.
What a popover *contains* is entirely the caller's business — this is a shell, not a menu
framework. `SongMenu`, `TagPicker`, `Select`, the sleep menu and the devices list all use it.

```tsx
const buttonRef = useRef<View>(null)

<View ref={buttonRef} collapsable={false}>
  <IconButton onPress={() => setOpen(true)} … />
</View>

<Popover open={open} anchorRef={buttonRef} onClose={close} title="Song actions">
  <SheetItem label="Play next" onPress={…} />
</Popover>
```

| Prop | Meaning |
|---|---|
| `open` / `onClose` | Controlled; `onClose` is called on Escape and on a press outside |
| `anchorRef` | The control this belongs to. Measured with `measureInWindow` when it opens |
| `title` / `titleTone` | Shown when it falls back to a sheet, where a panel has room for a heading |
| `placement` | `auto` (below when it fits, else above), `below` or `above` |
| `align` | `end` (default) or `start`: which edge of the control the panel lines up with |
| `width` | The panel's width above the breakpoint (240 by default) |

Notes for anyone extending it:

- React Native has no `position: fixed`, so above the breakpoint the panel is drawn by the
  shell's overlay host (`shell/Overlay.tsx`) at the anchor's measured coordinates, and kept
  on screen. Below it, the same children go into a `Sheet`.
- Global hotkeys (`useHotkeys`) ignore keystrokes aimed at a `combobox`, `listbox`, `menu`
  or `dialog`, exactly as they already ignored a focused `<select>` or text field. If you
  build a control with its own keyboard language, give it one of those roles.

## `data-tip` — hover captions

A native `title` is drawn by the operating system, like a native `<select>`: on a Mac it
waits about a second and a half and then drops a pale system label onto a dark app. So
nothing uses `title`; a control that wants a caption spreads `tip()` from `ui/tip.ts`, which
React Native for web turns into a `data-tip` attribute (a phone ignores it):

```tsx
<Pressable accessibilityLabel="Queue" {...tip('Up next')}>…</Pressable>
```

`TooltipHost` (`shell/TooltipHost.web.tsx`), mounted once in the shell, listens on the document and draws the caption
above the control (below near the top of the window, clamped at the sides). A trailing
`(key)` of up to five characters, as in "Done (Esc)", is drawn as a key cap.

- **Timing.** 300ms of rest with a mouse; none when moving straight on from another
  caption, so running along the transport reads every button; none on keyboard focus.
  Never on touch.
- **Dismissal.** Pressing the control, any key, a scroll that moves it, and leaving the
  window all close it. A pressed control stays quiet until the pointer leaves it.
- **Live.** If the control's `data-tip` changes while its caption is up, the caption follows;
  if the control leaves the DOM, the caption goes with it.
- A caption is not an accessible name. Icon-only controls still need `aria-label`; the host
  links the caption with `aria-describedby` while it is showing.
- Text that only repeats what is already fully visible is skipped, so `data-tip` on a
  truncating title shows only once the title is actually cut off.
- Captions are for controls. The one native `title` left is on synced lyric lines: a caption
  there would cover the next lines and hop between them as they scroll under the pointer.

## Tokens

The app reads its tokens from `packages/client/src/theme/tokens.ts` (`colors`, `radius`,
`space`, `type`, `motion`, `HIT_TARGET`, `BREAKPOINT`), and Unistyles holds the light and dark
themes built from them. The stylesheet's custom properties they came from are kept for
reference in `tokens.reference.css`, including:

```css
--radius-pill: 999px;                  /* chips, toasts, the toggle track   */
--shadow-1 / --shadow-2                /* small lift / floating element     */
--shadow-panel                         /* full panels and popovers (existing) */

--dur-fast: 100ms; --dur: 140ms; --dur-slow: 220ms;
--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);

--focus-ring-width / --focus-ring-color / --focus-ring-offset
--hit-target: 44px;                    /* smallest comfortable touch target */
```

**Stacking.** Everything that leaves the flow picks a layer from the scale instead of
inventing a number:

| Token | Value | For |
|---|---|---|
| `--z-raised` | 2 | stacking inside one component (the mini player's layers) |
| `--z-sticky` | 10 | sticky headers, the selection bar |
| `--z-panel` | 20 | side panels |
| `--z-toast` | 60 | the toast row |
| `--z-modal` | 100 | full-screen overlays: command palette, now playing, dialogs |
| `--z-popover` | 200 | menus and dropdowns |
| `--z-tooltip` | 300 | hover captions |

Popovers are the top of the scale on purpose: a dropdown opened *from* a dialog has to sit
above it.

**Motion.** Transitions are 100–220ms (`motion` in `tokens.ts`) and ease out. With Reduce
Motion on (`ui/useReducedMotion.ts`) the one-shot movements are instant. Looping
indicators — the spinner, the equalizer — are left alone, because they are saying that
something is still happening.

## Focus and interaction

- In a browser, `shell/FocusStyle.web.tsx` turns the browser's own ring off once and draws
  ours: one line in the accent, only for keyboard focus (`:focus-visible`), so a Tab still
  shows where you are and a click shows nothing. The colour follows the accent picker.
- A text field with a border of its own takes the accent as its border colour instead; a
  field without one sits in a box that shows focus itself (the library's search turns its
  border to the accent while its input has focus).
- Sliders and checkboxes keep what they draw. In a browser the slider is a real
  `input[type='range']` with its own rules (`ui/components/Slider.web.tsx`), keyboard and all.

## The toast row

Toasts are one layer of the app shell (`Toasts` in `shell/Shell.tsx`): centred near the foot of
the content, with the resume offer and every message raised with `showToast` (`ui/toast.ts`),
drawn by `ToastHost`. The layer takes no touches itself, and on a phone it lifts above the
floating selection bar rather than covering its buttons; each toast is dismissible. Put new
transient messages in that row rather than positioning them by hand.

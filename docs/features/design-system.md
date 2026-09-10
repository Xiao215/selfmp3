# Design system

The shared UI primitives: the dropdown, the floating-layer shell every menu sits in, the
tokens, and the rules for stacking and focus. Anything built on top of these should not
need to reinvent portalling, dismissing, focus handling or z-index numbers.

Files:

| What | Where |
|---|---|
| Dropdown | `apps/web/src/components/Select.tsx`, `styles/parts/select.css` |
| Floating-layer shell | `apps/web/src/components/Menu.tsx`, `styles/parts/popovers.css` |
| Tokens | `apps/web/src/styles/parts/tokens.css` |
| Control styling | `apps/web/src/styles/parts/controls.css`, `parts/base.css` |

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
  label="Sort by"                 // the accessible name; use labelledBy instead if a
  align="end"                     // visible <label> already names it
/>
```

| Prop | Meaning |
|---|---|
| `value` / `onChange` | Controlled, generic over the value type — call sites keep their unions (`Select<SongSortField>`), and values need not be strings (`number`, `number \| null`, …) |
| `options` | Either `{ value, label, hint?, disabled? }[]` or groups: `{ label, options }[]` |
| `label` / `labelledBy` | Accessible name. One of them is required in practice |
| `placeholder` | Shown when `value` matches no option. A dropdown used as a command ("Add tag…") holds a value that never matches, so it always shows the placeholder |
| `size` | `default` \| `small` \| `inline` — matching `.button`, `.button-small`, and text-sized for use inside a sentence |
| `align` | `start` (default) or `end`: which edge lines up with the trigger's |
| `placement` | `auto` (prefer below) or `above`. Both flip when the preferred side has no room |
| `className`, `disabled`, `title`, `id` | As you would expect; `className` is for layout (`input-grow`, `migrate-pick`), not for restyling the trigger |

Behaviour worth knowing:

- **Keyboard.** Enter, Space, ↓, ↑, Home, End open the list. While open, ↑/↓/Home/End move
  the cursor, letters jump by type-ahead (repeat a letter to cycle matches), Enter or Space
  picks, Escape closes, Tab closes and moves on. Focus stays on the trigger the whole time —
  the list is driven by `aria-activedescendant` — so focus is never lost on close.
- **Pointer.** Hovering moves the same cursor the arrow keys move, so the mouse and the
  keyboard can never disagree about what Enter will pick. Clicking the trigger again closes.
- **Portalled.** The list renders at the end of `<body>`, so an `overflow: hidden` ancestor
  (the rule builder, the queue panel, a table cell) cannot clip it. It is positioned under
  the trigger, flips above near the bottom of the window, is clamped inside the viewport
  horizontally, and gets a `max-height` for whatever room is left.
- **Phone.** Below 820px the list becomes a full-width bottom sheet with ≥44px rows,
  safe-area padding and a scrim, titled with the `label`.
- The selected option is marked with a check; long values truncate with an ellipsis in the
  trigger rather than stretching the row.

## `<Popover>` — the floating-layer shell

`components/Menu.tsx` holds the parts every menu, popover and dropdown needs: a portal,
anchored positioning with flipping, a backdrop that dismisses, Escape, focus into the layer
and back to the trigger, optional arrow-key roving, and the phone bottom sheet. What a
popover *contains* is entirely the caller's business — this is a shell, not a menu
framework. `SongMenu`, `TagPicker`, the speed and sleep menus and the devices popover all
use it.

```tsx
const buttonRef = useRef<HTMLButtonElement>(null)

<button ref={buttonRef} aria-haspopup="menu" aria-expanded={open} onClick={…}>…</button>

{open && (
  <Popover anchorRef={buttonRef} onClose={close} label="Song actions" sheet roving>
    <button type="button" role="menuitem" className="popover-item">Play next</button>
  </Popover>
)}
```

| Prop | Meaning |
|---|---|
| `anchorRef` | The trigger. Used for positioning and for handing focus back |
| `onClose` | Called on Escape, on a click outside, and on Tab (unless trapping) |
| `role` | `menu` (default) for action lists, `dialog` for anything with its own controls, `listbox` for `Select` |
| `label` / `labelledBy` / `id` | Accessible name and id of the layer |
| `placement` / `align` / `matchAnchorWidth` | Positioning, as for `Select` |
| `focus` | `first` (default) moves focus into the layer, `trap` also keeps Tab inside it, `none` leaves focus on the trigger (what a combobox wants) |
| `roving` | ↑/↓/Home/End move focus between the items — menu behaviour |
| `sheet` | Present as a bottom sheet at phone width |

Notes for anyone extending it:

- The backdrop is a real element, not a document listener. It swallows the dismissing click,
  so closing a menu never also activates whatever was underneath, and a second click on the
  trigger closes rather than close-then-reopen.
- A `role="menu"` layer must contain `role="menuitem"` (or `menuitemradio`) children.
- A layer is hidden for its first frame with `opacity`, not `visibility`, because a
  `visibility: hidden` element cannot take focus — that silently broke "focus the first item".
- `useAnchoredLayer(anchorRef, layerRef, options)` is exported if you need the positioning
  without the rest.
- Global hotkeys (`useHotkeys`) ignore keystrokes aimed at a `combobox`, `listbox`, `menu`
  or `dialog`, exactly as they already ignored a focused `<select>` or text field. If you
  build a control with its own keyboard language, give it one of those roles.

## Tokens

New ones added alongside the existing colours, radii and sizes:

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

Popovers are the top of the scale on purpose: a dropdown opened *from* a dialog has to sit
above it.

**Motion.** Transitions are 100–220ms and ease out. `prefers-reduced-motion: reduce`
collapses every transition (in `base.css`) and turns off the one-shot entrances where they
are defined. Looping indicators — the spinner, the equalizer — are left alone, because they
are saying that something is still happening.

## Focus and interaction

- One `:focus-visible` rule in `base.css` gives every focusable element the accent ring;
  rows and controls inside clipping containers draw it inset (`outline-offset: -2px`) so it
  is not cropped. Text inputs get the ring back explicitly, because their
  `:focus { outline: none }` would otherwise eat it.
- The search box shows the ring on `:focus-within`: the input inside it has no border.
- Hover, active and disabled states are defined together in `controls.css` for `.button`,
  `.icon-button`, `.link-button`, `.play-button`, `.segmented-item` and `.toggle`. Disabled
  controls read at 45% and are never focusable.
- Range inputs keep the hover-reveal thumb on a mouse, but under
  `@media (hover: none), (pointer: coarse)` the thumb is always visible, 18px, in a 26px hit
  area — a hover-only affordance is no affordance at all on a phone.

## The toast row

Toasts are not an overlay. `.toast-layer` is a row of the app shell between the content and
the player bar (see `App.tsx`), so a toast can never cover a song row, the transport, or the
tab bar. The layer takes no pointer events itself and hides when empty; each toast is
dismissible. Put new transient messages in that row rather than positioning them by hand.

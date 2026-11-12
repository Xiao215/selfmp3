---
name: cleanup-interactions
description: Clean up how self.mp3's UI answers people, covering press handlers, pressed feedback, double taps, pending and failed states, Undo versus confirm, gestures, hover, keyboard shortcuts, focus, text input and accessibility, across finger, pointer and keyboard. Use when a cleanup touches anything a person presses, swipes, hovers, types into or tabs through in apps/app.
argument-hint: "[feature | component path]"
---

# Interactions

Every press gets an answer at once, does one thing, and can be taken back or is
asked about first. It also works with whichever input the person has. Foundation 6
is the rule: interaction follows the input, not the device.

## Handlers

- Handlers are `onX`. A handler body is short: it calls the model or a command
  and lets go. The decision of what a press means lives in the feature's
  `.model.ts`, so a phone row and a computer row cannot disagree about a gesture.
- A control does exactly one thing, the same thing everywhere. For example, Next
  and Previous never flip play and pause, and tapping a library row plays that
  one song. Read the feature note in `docs/features/` before changing what a
  control does. Those are product decisions, not cleanups.
- Ignore a second press while the first is in flight, or make the action
  idempotent. A double tap on Undo once put songs back twice (`ToastHost.tsx`).

## Feedback

- Everything pressable is `Press` (`ui/components/Press.tsx`) with one of its
  three feedbacks: `sink` for a shaped control, `wash` for a bare row, `dim` for
  bare ink. Lint refuses a raw `Pressable` in `features/` and `shell/`. An
  exception needs a `-- reason` on its disable, as the existing one has.
- The look changes in the same commit as what the press changed. Never leave
  a row lit or a box unticked while the work runs.
- Work that takes longer than a moment shows it is pending (`Spinner`, a progress
  wash). If it fails, the screen says so in plain words. Silence is not an
  answer (`cleanup-errors`).

## Undo or confirm

- A reversible action happens at once and offers Undo in a toast.
- An action that cannot be taken back (deleting files, ending something for
  other people) asks first, with `ConfirmDialog` / `ConfirmRemoveSongs`. Name
  exactly what will happen.
- Never both, and never a confirm for something Undo could cover.

## By input

- **Finger:** long-press and swipe. Keep a row's swipe actions on one side.
  On the web and Android, the hidden side's empty container sits on top and
  swallows presses. Hit testing does not exist in jest, so check swipes in a
  real browser.
- **Pointer:** hover reveals and right-click menus, wherever `ports/pointer.ts`
  reports a fine pointer (`finePointer` from `useLayout`). A hover-only control
  needs another way in for touch and keyboard.
- **Keyboard:** shortcuts go through the shell's registry (`useHotkeys`,
  `keyCommands`, `menuKeys`), not a `keydown` listener on `window`. Escape is
  `useEscape`. React Native web's `TextInput` swallows keydown, so a field
  answers Escape in its own `onKeyPress`.
- An iPad with a keyboard gets both sets. Decide by what is present, never by
  `Platform.OS`.

## Focus and text

- Opening a layer moves focus into it, and closing gives focus back
  (`shell/layerFocus.web.ts`). Give focus back in the effect's own run, not in
  a cleanup: React restores focus after the commit and overrides a cleanup's call.
- Text inside sheets and overlays must survive an IME (pinyin, kana). Anything
  that writes an input's value or moves its host does so in a layout effect, not
  a passive one. On the web, set `blurOnSubmit={false}` when Enter should not blur.
- Use `TextField`, not `TextInput` (lint).

## Accessibility

- Every icon-only control has a label. A switch, a checkbox, a tab and a
  selected row say their state. On the web, `Press` turns `accessibilityState`
  into `aria-*`; elsewhere write `aria-*` directly.
- Tab order follows reading order. A backdrop or a catcher is not a tab stop.
- Motion respects Reduce Motion (`motionMs`), and haptics go through the
  `haptics` port.

## Check

jest-expo tests for what a press does (`npm run test:app`). Then check it in the
real app, because some of these bugs only show where there is real hit testing,
focus and IME: Playwright via `verify:flows` at phone and computer width, and a
simulator for gestures. Finish with `npm run check`.

---
name: cleanup-react
description: Clean up React and React Native code in apps/app, covering logic that belongs in a model file, effects that should be derived values or handlers, fetching outside React Query, wide subscriptions that re-render rows, platform checks outside ports, phone and computer trees that should be one, and styles that leak on the web. Use when a cleanup touches a screen, component, hook or provider in the universal app.
argument-hint: "[feature | component path]"
---

# React components

The app is one Expo tree for the phone, the browser and the desktop shell.
`docs/ARCHITECTURE.md` "Foundations" holds the rules, and lint enforces most of
them. This skill covers what lint cannot judge.

## Logic goes in the model

A feature's state and decisions live in `<name>.model.ts`, which imports only
`packages/*` and React. Vitest runs it with no simulator. The screen renders
it (Foundation 3).

Move out of a `.tsx` and into the model:
- any computation with a branch in it (which rows show, what a gesture means,
  what a label says);
- anything you would want a test for.

Keep in the `.tsx`: layout, styles, wiring props to the model's values and
callbacks.

## Effects

`useEffect` is for keeping in step with something outside React: a subscription,
a timer, a native module, the document. The app has hundreds of effects. Check
each one you touch:

- **A derived value** (state set from other state or props in an effect)
  becomes a value computed during render. Use `useMemo` only if it is measurably
  costly.
- **A response to an event** (state changed, so an effect does the follow-up)
  moves into the event handler that changed it.
- **Data from the server** goes through a React Query hook in
  `packages/client/src/queries`, not an effect that fetches.
- **Every effect that starts something cleans it up**, and ignores a late
  result after its inputs have changed (`cleanup-async`).
- **Dependencies are honest.** An `eslint-disable` on `exhaustive-deps` needs a
  reason after `--`. Usually a ref or a moved function removes the need.
- **`useLayoutEffect`** when the work must land before paint, or before React
  restores focus or an input's value. A passive effect there broke pinyin input
  in every sheet once (`shell/Overlay.tsx`).

Patterns that look like effect smells but are accepted here:
- **The latest-value ref**: a `useRef` that an effect with no dependency list
  keeps equal to a prop or callback, so a long-lived handler reads the current
  one. Leave it alone.
- **Mounted until the exit finishes**: keeping a closing sheet or popover
  mounted while it animates out. `usePresence` (`ui/motion.ts`) is the
  primitive. A hand-written copy of it should use it, unless its comment says
  why it cannot.
- **A module-level `let`** for something there is one of in the whole app (one
  toast already raised, one socket). Fine when the comment says it is app-wide.
  It is a bug when two instances of the component could each expect their own.

## Re-renders

Subscribe narrowly in rows and other many-instance components, and in anything
always mounted: the shell's frame, providers, the player bar. A hook that reads
all of `usePlayer()` there re-renders it on every play, pause and queue edit.
Use the narrow hook instead:

| Need | Use |
| --- | --- |
| one value of the layout | `useLayoutValue(select)`, not `useLayout()` |
| to start songs | `usePlayerCommands()` |
| whether a song is loaded | `useSongLoaded()` |
| whether it is playing | `usePlayerPlaying()` |
| which song is playing | `usePlayingSongId()` |

These live in `player/PlayerProvider.tsx` and `shell/useLayout.ts`. Check
there for a newer one before reading the whole player.
- Keys are stable ids, never the array index, for any list that reorders or
  removes items.
- `useCallback` and `memo` where a child is memoised or a list row depends on it.
  Elsewhere they are noise. Do not add them by reflex.

## One tree, two placements

- No `Platform.OS` or `Platform.select` for behaviour outside `src/ports/` and
  `src/shell/` (lint). Read a port's declared capability instead.
- A phone version and a desktop version of the same component become one
  component with breakpoint variants, deciding at the 820-point breakpoint
  (Foundations 5 and 6). Where the two really are different objects (a popover
  versus a sheet), the component decides and the caller does not know. Two thin
  containers over shared parts and one model (the Up next sheet and rail) are an
  accepted end state too. Do not merge them.
- Use the shared pieces in `src/ui/components` (`Press`, `Scroll`, `TextField`,
  `Dialog`, `Sheet`, `Popover`, `SongRow`, `SongList`). Lint refuses the raw ones
  in `features/` and `shell/`.

## Props

- Several booleans that pick a look become one variant prop (`Press`'s
  `feedback`).
- A prop every caller passes with the same value is a constant inside the
  component (`cleanup-dead-code`).
- Do not thread a prop through more than two components that do not read it.
  Use the provider that already holds it, or move the component.

## Styles and motion

- Unistyles sheets built from the theme tokens. Colours and durations always
  come from tokens. A spacing number repeated for the same reason gets a name.
  A one-off layout number stays literal (`cleanup-shared-code`).
- On the web, every distinct inline style becomes a CSS rule. Many elements with
  per-frame `left`, `top` or `width` (a map, a chart, particles) belong in a canvas
  in a `.web.tsx` twin, or in SVG props, never in a `style` object.
- Animations: keep the resting position in React props, and the motion in
  Reanimated shared values or native-driven transforms. A JS-driven animation
  of layout props, or a native-driven style swapped for `null` mid-motion, can
  get stuck when the JS thread is busy. Durations go through `motionMs` so
  Reduce Motion stills them.

## Check

`npm run check:app` (typecheck, lint, jest-expo tests), then `npm run check`.
A change you can see should also be checked in the running app, at phone and
computer width. Use the `run` skill, or `verify:flows` for a flow.

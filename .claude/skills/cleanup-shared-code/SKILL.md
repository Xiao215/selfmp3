---
name: cleanup-shared-code
description: Remove duplication and hardcoded values in self.mp3 by putting each piece of knowledge in one place, in the right package or primitive. Use when the same logic, rule, UI piece, string or number appears in more than one place, when a screen builds its own version of a shared component, or when deciding where shared code should live.
argument-hint: "[path | area]"
---

# One copy of each thing

The rule the earlier passes worked to: one primitive per job. When a shared
piece exists, use it instead of building another beside it.

## Merge knowledge, not coincidence

Two pieces of code are duplicates when they must change together for the same
reason: the same rule, the same wire shape, the same look. Two pieces that only
look alike today, and would change for different reasons, are not duplicates.
Merging them couples things that should move apart.

Warning signs of a wrong merge:
- the shared function grows a boolean or a mode parameter so each caller can
  get its old behaviour back;
- one caller needs a change the others must not see;
- the shared code ends up in a package that now has to know about a platform.

## Where shared code lives

| What it is | Where it goes |
| --- | --- |
| Wire shapes, and pure rules every side runs (server, replica, app, doorman) | `packages/shared`: zod schemas in `src/schemas/`, rules like `smartRules.ts`, `queue.ts`, `editRules.ts`. No platform; the DOM library only for `URL`. |
| What the app shares across phone, browser and desktop: API client, React Query hooks, theme tokens, port interfaces | `packages/client` |
| A device's copy of the bucket | `packages/replica` |
| The desktop shell's contract with the page | `packages/desktop-bridge` |
| UI building blocks | `apps/app/src/ui/components/`: `Press`, `Button`, `IconButton`, `TextField`, `Scroll`, `Select`, `Popover`, `Dialog`, `Sheet`, `Spinner`, `SongRow`, `SongList` and the rest. |
| A behaviour that differs by platform | a port: `apps/app/src/ports/name.ts` + `name.web.ts` (Foundation 2) |
| A feature's decisions | its `<name>.model.ts`, which the phone and the computer layout both read |
| Server-only helpers | `apps/server/src/http/`, `apps/server/src/util/` |

There is no `utils` or `helpers` dumping ground. A shared module is named for
what it holds (`dates.ts`, `fuzzy.ts`, `throttle.ts`, `math.ts`).

Lint already refuses the raw pieces most often rebuilt: `Pressable`,
`TextInput`, `ActivityIndicator`, React Native's lists, and `Platform.OS` outside
ports and the shell (`apps/app/eslint.config.js`). When the same raw piece keeps
coming back, propose a rule like these.

## Patterns of duplication in this repo

- **A phone surface and a computer surface built as two trees.** They should be
  one tree with two placements that read one model (Foundation 5). When the two
  really are different objects, the accepted shape is two thin containers over
  shared parts and one model. Up next does this: a swiped sheet and a dragged
  rail, both built from `UpNextParts.tsx` and `queue.model.ts`. Do not merge
  such containers. Look for logic duplicated between them instead.
- **A server and the replica answering the same API with separate logic.** The
  rule belongs in `packages/shared`. `packages/client/src/api/contract.test.ts`
  and the parity tests in `cloudIngest.test.ts` hold both to it.
- **Platform twins that copied more than the difference.** `x.ts` and `x.web.ts`
  should differ only where the platform does. Move the common part into a shared
  core, as `packages/client/src/ports/engineCore.ts` does for the engines.
- **A screen-local formatter or helper** that exists in `packages/shared`
  (`format.ts`, `dates.ts`, `plural`, `clamp`, `messageOf`). Search there first.
- **An error code, a route path or a key spelled as a literal** in more than
  one place. It belongs in one exported constant (`API_ERROR` and its siblings).

## Hardcoded values

- Colours, spacing, radii, type sizes, motion durations and the 820-point
  breakpoint come from `packages/client/src/theme/tokens.ts`. Animation lengths
  go through `motionMs` (`apps/app/src/ui/motion.ts`) so Reduce Motion works.
- Ports and origins: `DEFAULT_SERVER_PORT` and its neighbours in
  `packages/shared/src/origins.ts`. They are literal only where nothing can
  import them (see CODE_TODO's kept list).
- Times: `DAY_MS` (`packages/shared/src/math.ts`) and a named `*_MS` constant
  near its use, not `86400000` or `3000` inline.
- A number that must stay equal to another number gets one name. Examples are a
  pull distance written in two places, a gutter repeated four times in one
  sheet, or the same "played row" opacity in two files. Put the name next to
  the code, and move it to a shared file only when another file needs the same
  value for the same reason.
- A one-off layout number in a style (a 14-point gap that appears once) stays
  literal. Renaming every literal is churn, not cleanup. `0`, `1`, `-1` and
  self-evident sizes stay literal too.

## How to find duplicates

- Grep for a distinctive line, literal or regex from one copy.
- Diff the platform twins against each other, and the server service against
  the replica route that answers the same request.
- Look in `packages/shared/src/index.ts` and `packages/client/src/index.ts` for
  something that already does it, before writing it.

## Moving code

- Move it, update every caller, delete the old copy. No re-export from the old
  path, and no alias (the project is unreleased).
- Export it from the package's entry. The service worker reads the narrower
  `@selfmp3/shared/wire` entry, so add it there too when `sw/sw.ts` needs it.
- Bring its tests with it. If it had none, add them now. Shared code is tested
  where it lives.
- Run `npm run check`. `check:exports` catches a barrel nobody reads, and
  `typecheck:app` catches an app import of the old path.

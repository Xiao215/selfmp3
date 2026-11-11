---
name: cleanup-modules
description: Clean up how self.mp3's code is split into files, folders and packages, covering oversized files, mixed concerns in one module, imports that point the wrong way between layers or packages, circular imports, SQL outside repositories, barrels, and where a new file belongs. Use when a file is very large, when moving or splitting code, or when an import crosses a layer or package boundary.
argument-hint: "[path | area]"
---

# Files, modules and boundaries

A module should hold one concern that you can name in a few words, and its
imports should point one way. Size alone is not the problem. A long file with
one concern and clear sections is fine. A short file that mixes three is not.

## The boundaries that are rules

These come from `docs/ARCHITECTURE.md`. Where a tool enforces one, never
weaken the tool to make an import compile.

- **Packages never import apps.** `packages/*` is reached by the apps, never the
  other way. The only exception is tests reaching the doorman's fakes.
- **No platform in packages** (Foundation 1). `replica`, `client` and
  `desktop-bridge` compile without the DOM. A package that needs the platform
  declares an interface, and the app supplies it (`packages/replica/src/platform.ts`).
- **Server layers: routes → services → repositories → database.** No SQL
  outside `repositories/` (plus `db/` for the schema and migrations). This one is
  not enforced by a tool, and a few services and routes break it today. Grep for
  `.prepare(` outside `repositories/` and `db/`. A route validates input and
  returns a value. It may call a repository directly for a plain read or write.
  Do not wrap each repository call in a one-caller service. Behaviour with rules
  in it belongs in a service, and so does anything two callers need. Nothing
  constructs its own dependencies: `container.ts` does, once.
- **A rule the server's route and the cloud replay both apply** (a play, an
  edit, a merge arriving from another device through `services/cloudIngest.ts`)
  lives once, in a service or in `packages/shared`. Those two paths are where
  copies of a rule have kept appearing.
- **Model files import no UI** (Foundation 3). This is enforced by
  `no-restricted-imports` on `**/*.model.ts`.
- **Platform differences live in ports** (Foundation 2). No `Platform.OS` or
  `Platform.select` outside `src/ports/` and `src/shell/` (lint).
- **The desktop page reaches the shell only through `packages/desktop-bridge`**
  and the preload. Nothing else crosses that line.

## Softer direction in the app

`ui/`, `shell/`, `player/` and `ports/` are below `features/`. Some files
import upward today (a few `ui/` components read a feature's model). Do not
add new upward imports. When you meet one:
- if the imported piece is used by several features, move it down (to `ui/`, to
  the player, or to `packages/client`);
- if the component that imports it is really part of that feature, move the
  component into the feature;
- if neither fits, leave it, and do not report it again.

## Large files

The biggest files are where this pays off. At the time of writing they are
`services/cloudSync.ts`, `player/PlayerProvider.tsx`, `packages/replica/src/library.ts`,
`packages/client/src/queries/queries.ts`, and the import screen's files. Before
splitting one:

1. **List its concerns.** Read the file's header comment and its `// ---`
   sections. They often name the seams already.
2. **Split along a concern, not a line count.** A good piece has its own name,
   its own tests and few imports back into the old file. If the two halves would
   import each other, it is one concern. Leave it.
3. **Pure logic first.** Pulling decisions out into a `.model.ts` or into
   `packages/shared` makes them testable. That is the split most worth doing.
4. **Keep the public entry where callers expect it.** Move private helpers out,
   and keep the module's API in place, or update every caller in the same
   commit. No re-export shims from the old path.
5. **Platform twins move together.** Splitting `x.ts` means splitting
   `x.web.ts` the same way.

Do not split a file that is long because it is a list (a migration array, a
schema, an icon set, a table of cases). `db/migrate.ts` is long on purpose.

## Circular imports

Nothing in the toolchain reports cycles, and no cycle tool is installed. Do not
add one. Symptoms: a value is `undefined` at import time, or a test fails only
when files load in a different order. Find the cycle by reading the imports of
the two modules. Break it by moving the shared piece to a third module both can
import, or by passing a dependency in instead of importing it.

## Barrels and entries

- A package's `index.ts` exports its public API. Inside a package, import the
  file directly, not the package's own barrel.
- `@selfmp3/shared/wire` is a narrower entry for the service worker. When the
  worker needs a new export, add it there too.
- `check:exports` reports a barrel re-export nothing passes through. Delete it.

## Where a new file goes

| It is | It goes |
| --- | --- |
| one screen's or tool's code | `apps/app/src/features/<name>/` |
| a building block several features use | `apps/app/src/ui/components/` |
| the frame around pages (tab bar, sidebar, layers, keys) | `apps/app/src/shell/` |
| a platform difference | `apps/app/src/ports/` |
| a rule both the server and a device run | `packages/shared` |
| SQL | `apps/server/src/repositories/` |
| behaviour on the server | `apps/server/src/services/` |

Name it for what it holds. Never `utils.ts`, `helpers.ts` or `misc.ts`.

## Check

`npm run check`. `check:exports` catches orphaned exports after a split,
`check:comments` catches comments that point at the old file, and
`typecheck:app` catches app imports of moved code that the root typecheck does
not see.

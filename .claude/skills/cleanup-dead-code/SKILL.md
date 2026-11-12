---
name: cleanup-dead-code
description: Find and delete dead code in self.mp3, including unused exports, files, props, styles, branches, settings, routes, IPC channels, env vars, dependencies and backward-compat shims, without deleting what is reached by convention. Use when cleaning up unused or leftover code, after a feature is removed or replaced, or when check:exports reports something.
argument-hint: "[path | area]"
---

# Dead code

Code nothing reaches costs every reader time and keeps old ideas alive. Delete
it. Git keeps the history. First ask whether it should exist at all, then how
to improve it.

## Find

Start with the tools, then search by hand for what they cannot see.

1. `npm run check:exports`. It reads the real import graph across packages and
   platform twins, and counts a test's read only for test support. Its `ALLOWED`
   list in `scripts/unused-exports.mjs` is judgement already made. Read it before
   arguing with it.
2. Lint's `no-unused-vars` (via `npm run lint` and `npm run lint:app`).
3. By hand, for each kind below: `grep -rnw <name>` across the whole repo,
   including `.mjs`, `.json`, `.yml`, `.html`, `apps/server/admin/`, `verify/`
   and `apps/app/.maestro/`.

## Kinds the tools miss

- **Props** a component accepts but no caller passes, or that every caller passes
  with the same value.
- **Style keys** in a Unistyles sheet that no element uses, and variants no
  caller picks.
- **Branches the types rule out**: a check for `undefined` on a value typed as
  always present, or a `default` on an already exhaustive switch (keep
  `assertNever`).
- **Settings and flags** that only ever have one value, and the code for the
  other value.
- **Compat shims.** A fallback for an older server, an older stored shape, an
  old name kept as an alias, or a re-export left after a move. The project is
  unreleased: delete the shim and migrate the data (a SQL migration, a
  device-store or bucket upgrade). Do not leave it "for older clients".
- **Server and doorman routes** no client calls. Check every client: the app,
  the extension, the desktop shell, the admin page and the doorman itself.
- **Desktop-bridge channels** (`packages/desktop-bridge`) no page code invokes.
- **Env vars** in `apps/server/src/config.ts` or `.env.example` that nothing
  reads, or that are read but missing from `.env.example`.
- **Dependencies** in a workspace's `package.json` that nothing imports. Check
  config files too (babel, metro, `app.config`, Expo config plugins, `@types/*`)
  before removing.
- **Tooling leftovers.** `package.json` scripts nothing runs (not CI, not a
  doc, not another script). `overrides` whose reason has gone. A GitHub
  workflow step that no longer guards anything. A config option for a tool that
  is no longer used. Check `.github/workflows/` and the docs before removing a
  script.
- **Parameters** ignored by every implementation, including `_name` ones that
  could just go.
- **Test-only code paths**: an export or an option that exists only so a test
  can reach it, when the test could go through the real entry.
- **Docs** describing removed behaviour: `docs/features/*`, `ARCHITECTURE.md`,
  README files.

## Alive though nothing imports it

Do not delete these on a "no references" result:

- expo-router files in `apps/app/app/`. Each is a URL.
- Platform twins (`x.web.ts`, `x.desktop.ts`), which Metro picks by extension.
- Entry points: the doorman's `export default`, `sw/sw.ts`, the desktop main and
  preload, the extension's background and content scripts, CLI commands.
- Wire schemas in `packages/shared/src/schemas/`, which are written out in full
  on purpose (see `scripts/unused-exports.mjs`).
- Entries in `MIGRATIONS` (`apps/server/src/db/migrate.ts`). The array index is
  the version. Never delete or renumber.
- The iOS widget target, Maestro flows, Playwright specs.
- Anything in `docs/CODE_TODO.md`'s "Looked at and kept on purpose".

## Delete

1. Remove the thing.
2. Follow the compile and lint errors, and delete what is now orphaned: helpers,
   types, styles, tests, fixtures, imports. Repeat until nothing new appears.
3. Delete or rewrite every comment and doc that mentioned it.
   `npm run check:comments` finds paths and `#members`.
4. If it was stored or sent (a column, a key, a field), the deletion includes the
   migration that clears it.
5. Run `npm run check`. Delete in commits small enough to revert one at a time.

## Report

How much was removed (files, lines, exports), and anything you kept on purpose,
added to CODE_TODO's kept list with its reason.

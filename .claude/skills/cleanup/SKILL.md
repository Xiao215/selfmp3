---
name: cleanup
description: Run a cleanup or refactor pass over self.mp3 code without changing behaviour. Use when asked to clean up, tidy, refactor, audit for code smells, or make a "pass" over a file, an area, a branch or the whole repo. It picks the scope, takes a baseline, routes each kind of problem to the focused cleanup-* skill, and verifies with the full check.
argument-hint: "[path | area | diff | branch | repo] [report]"
---

# Cleanup pass

The process around every cleanup in this repo. The focused skills hold the
rules for each kind of problem. This one decides what to look at, in what order,
and how to prove nothing changed that should not have.

## 1. Pick the scope

Read the argument:

| Argument | What to look at |
| --- | --- |
| a path or glob | those files, plus their tests and platform twins (`x.ts`, `x.web.ts`, `x.desktop.ts`) |
| an area (`server`, `doorman`, `room`, `ui`, …) | that folder; `docs/ARCHITECTURE.md` "The shape" says where each area lives |
| `diff` | `git diff --name-only` plus `git diff --cached --name-only` |
| `branch`, or nothing | `git diff --name-only main...HEAD`, plus uncommitted changes |
| `repo` | everything, split by area (step 6) |

With `report` (or when asked for an audit or review only), edit nothing. Do
steps 1, 2 and 4, verify each finding by reading the code, and go straight to
the report in step 8.

Skip generated and vendored files: `dist/`, `apps/app/public/sw.js`, `apps/app/ios`,
`apps/app/android`, `docs/ui-mock`, `package-lock.json`, `*.tsbuildinfo`.

## 2. Read what was already decided

Before reporting anything, read:

- `docs/CODE_TODO.md`, the "Looked at and kept on purpose" section. Never report
  those items again. When you decide to keep something that looks like a leftover,
  add it there with the reason.
- `docs/ARCHITECTURE.md`, the "Foundations" section and "Layers, strictly". Code
  comments cite the foundations by number.
- The area's note in `docs/features/`, if there is one.
- The comment above the code. In this repo a long comment usually explains why
  something odd is there on purpose.

## 3. Take a baseline

Run `npm run check` (or `npm run check:app` for app-only work) before you edit.
Write down what is already red. A failure that was there before you started is
reported on its own and never mixed with your changes.

## 4. Work in this order

Each pass makes the next one smaller.

0. **Security and real bugs first** (`cleanup-security`). They are fixes, not
   tidying. Each goes in its own commit with a test, before the pass moves
   code around them.
1. **Delete.** Dead code, compat shims, stale or redundant comments, stray
   logging (`cleanup-dead-code`, `cleanup-comments`, `cleanup-logging`).
2. **One copy of each thing.** Duplicates and hardcoded values
   (`cleanup-shared-code`).
3. **Structure.** Split oversized files and fix imports that cross a boundary
   (`cleanup-modules`).
4. **Shape.** Types, functions, errors, async code (`cleanup-types`,
   `cleanup-functions`, `cleanup-errors`, `cleanup-async`).
5. **The app's components and interactions** (`cleanup-react`,
   `cleanup-interactions`).
6. **Performance**, where a number shows waste (`cleanup-perf`).
7. **Names** (`cleanup-naming`). A rename touches the most files, so do it
   once the code it names has settled.
8. **Docs last** (`cleanup-docs`), so they describe the code as the pass left it.

Throughout, keep the tests honest (`cleanup-tests`). The pass leans on them to
prove behaviour did not change.

Load a focused skill only for the problems you actually find.

| CODE_TODO label | Skill |
| --- | --- |
| `DEAD` | `cleanup-dead-code`, `cleanup-comments` |
| `HARDCODE`, `PROPER` | `cleanup-shared-code`, `cleanup-functions`, `cleanup-modules` |
| `TYPES` | `cleanup-types` |
| `ROBUST` | `cleanup-errors`, `cleanup-async`, `cleanup-tests` |
| `PERF` | `cleanup-perf` |
| `SECURITY` | `cleanup-security` |
| `HYGIENE` | `cleanup-docs`, `cleanup-logging`, `cleanup-tests`, tooling in `cleanup-dead-code` |

## 5. Keep behaviour

- A refactor commit changes no behaviour. If you find a real bug, fix it in its
  own commit with a test that fails without the fix (CODE_TODO label `ROBUST`).
- Code with no tests: write a test that pins today's behaviour before you
  reshape it, at the layer that can run it (Foundation 8).
- Do not edit a test's expectations in a refactor commit. A test that breaks
  either caught a behaviour change (undo it) or is tied to internals (rewrite
  it to test behaviour, in its own commit).
- Match the code around you: its idioms, its comment density, its words.
- If the result does not read better than the original, revert it. Following a
  rule for its own sake and making the code harder to read is a loss.
- The project is unreleased. Never keep or add a compat shim, an alias, a
  re-export of an old name or a fallback for an old data shape. Change every
  caller, and migrate stored data rather than accommodate it. SQLite migrations
  are append-only: never edit or delete an entry in `MIGRATIONS`.

### Red flags, stop and rethink

- The pass adds more lines than it removes.
- A new abstraction (helper, hook, class, file) with one caller.
- A new `utils.ts`, `helpers.ts` or `common.ts`.
- A design pattern (strategy, builder, a Result type) brought into a cleanup.
- A wire schema in `packages/shared` changed on one side only.
- A plan with more than about five phases for one area.

## 6. Scale

For `repo`, or more than about 30 files, split by area: `apps/server`,
`apps/doorman`, `apps/app/src/features`, `apps/app/src/ui` + `shell`,
`packages/*`, `apps/desktop` + `apps/extension`. Give each area to a subagent
with this skill's steps and the focused skills it needs. Run no more than four at
once: wider runs have crashed this 16 GB machine. Areas that touch the same files
go one after another, never side by side.

## 7. Verify

Run the whole `npm run check` before every commit, not a subset. Each part has at
some point been the only red one. Two blind spots to remember:

- The root `npm run typecheck` and `npm run lint` leave out `apps/app`. Only
  `npm run check:app` covers the app.
- `npm run check` stops at the first failure. After a red step, re-run the
  steps it never reached.

`check:exports` reads the import graph and `check:comments` checks every path and
`#member` a comment names. Both catch what a move or a rename left behind.

## 8. Commit and report

- One objective per commit: "dead exports in the server", not "cleanup". Write
  the subject the way the log does, as a plain sentence about what is now true.
- Report each finding with its CODE_TODO label (`HARDCODE`, `DEAD`, `PROPER`,
  `PERF`, `ROBUST`, `SECURITY`, `TYPES`, `HYGIENE`), its severity (H, M, L) and
  `file:line`.
- Count findings. Give numbers, not impressions.
- End with what was fixed, what was kept and why (added to CODE_TODO's kept
  list), and anything that needs the owner because it is a product or wording
  decision. Anything that only needs a data migration is not the owner's call:
  do it.

---
name: cleanup-docs
description: Bring self.mp3's docs back in line with the code, covering feature notes in docs/features that describe old behaviour, missing "Where" lines, ARCHITECTURE and INSTALL drift, finished plans still lying around, CODE_TODO and FEATURE_TODO hygiene, and READMEs. Use after a feature changes, during a cleanup pass, or when a doc and the code disagree.
argument-hint: "[doc path | area]"
---

# Docs

The docs hold only what is still in use: how the system is built, what each
feature does and why, how to install it, and what is left to do. Finished plans
are deleted, and whatever they left open moves to a TODO. Code comments are
covered by `cleanup-comments`. This skill covers the markdown.

## What lives where

| Doc | Holds |
| --- | --- |
| `README.md` | what self.mp3 is and its pieces, briefly |
| `docs/ARCHITECTURE.md` | the shape, decisions worth explaining, Foundations 1–8, the Stack table, testing, things deliberately not done |
| `docs/features/<name>.md` | one feature: what it does, the decisions behind it, a **Where:** line |
| `docs/INSTALL.md` | running the server on an always-on computer (Docker first, the Pi as the worked example) |
| `docs/SYNC.md`, `docs/MOBILE.md`, `docs/PREPROD.md` | their one subject |
| `docs/CODE_TODO.md` | open code items and "Looked at and kept on purpose" |
| `docs/FEATURE_TODO.md` | features and checks not built yet |
| `docs/UI-MIGRATION.md` | kept, marked done, because code comments cite its phases |
| a folder's `README.md` | how to run what is in that folder (`verify/`, `apps/doorman/`, `apps/app/.maestro/`) |

The server runs on a server (the Pi, or any always-on computer). The Mac is a
development machine and a client. Docs never describe the Mac as the server.

## Find drift

For each doc in scope:

0. **Start from what changed since the doc did.** Run
   `git log -1 --format=%h -- <doc>` to find the doc's last commit, then
   `git log <that>.. --oneline -- <the feature's folders>`. Each commit listed
   is a change the doc may not know about. This finds drift that no grep will,
   like a row of buttons rearranged without renaming anything.
1. **Check every concrete claim against the code.** That means route names,
   file paths, setting names, env vars, commands, numbers (caps, durations,
   sizes), and which platforms have the feature. Grep the names. For a claim
   about layout or order on a screen ("the head shows X, then Y"), read the
   JSX, the model or its tests. A grep cannot see order.
2. **Check every `npm run` script and CLI command it shows** against
   `package.json` and `apps/server/src/cli/`.
3. **Check every link**, both to other docs (with `#anchors`) and to code paths.
4. **Feature notes need a `**Where:**` line** near the top (Foundation 7): which
   platforms carry the feature and, when one does not, why. Most notes are
   missing it today.
5. **Look for what is gone.** Removed settings, deleted routes, an old flow
   still described step by step, "coming soon" for something that shipped, or
   a plan whose work is done.
6. **Look for what is missing.** A feature that shipped with no note, a new
   dependency with no Stack line, a new env var missing from `INSTALL.md` and
   `.env.example`.

## Fix

- Change the doc to match the code. If the code looks wrong instead, report it
  as a code finding. Do not document a bug as behaviour.
- Keep the doc's voice: plain sentences, the project's words (`cleanup-naming`),
  decisions with their reason, and the owner's picks with their date and
  proposal link where the note already records them.
- Describe what is true now. History goes only where it explains a decision
  ("tried X, it failed because Y").
- A finished plan is deleted. Its open items move to `FEATURE_TODO.md` or
  `CODE_TODO.md`.
- `CODE_TODO.md` keeps only open items and the kept-on-purpose list. A done item
  is removed: the commit message is its record. A new item gets a label and a
  severity.
- Do not create a doc for something a feature note or ARCHITECTURE already
  covers. Add a section there instead.
- `docs/ui-mock` is exported from the design canvas. Never edit it by hand.

## Check

`npm run check:comments` checks paths named in code comments, not in markdown.
So check the docs' own links and paths with a grep: every path a doc names
should exist (`git ls-files | grep`). Prettier skips `*.md`, so keep the tables
tidy by hand.

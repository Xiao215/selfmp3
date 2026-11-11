---
name: cleanup-comments
description: Remove redundant, stale or misleading comments in self.mp3 and keep the ones that explain why, matching the repo's comment voice. Use when a cleanup touches comments, when comments restate the code, narrate history, hold commented-out code or TODOs, or have drifted from the code they describe.
argument-hint: "[path]"
---

# Comments

Comments here carry a lot: why a line is there, what broke without it, which
mock board or feature note it follows. That is on purpose, so do not thin them
out to match a "less is more" rule. Remove the ones that say nothing the code
does not already say, and fix the ones that have stopped being true.

## The voice to match

- A `/** */` block above an exported declaration or interface field: what it is,
  in plain words, then why it is shaped this way. See `HttpError` in
  `apps/server/src/http/errors.ts` and `EventSink` in
  `apps/server/src/services/events.ts`.
- A `//` line above a statement whose reason is not visible.
- References a reader can follow: a file by path, a member as `#name`, a feature
  note (`docs/features/listen-together.md`), a mock board (`docs/ui-mock` `P25`), a
  Foundation by number.
- Plain sentences, no shorthand, no "NB", no emoji, no ALL-CAPS warnings.
- Some long files use `// --- section ----` dividers. Keep a file's existing
  dividers. Do not add them to a file that has none.

## Delete

- **Restating the code.** `// return the songs`, `// loop over rows`,
  `// set loading to true`.
- **JSDoc that repeats the signature.** `@param song the song`,
  `@returns the result`. Keep `@param` only when it says something the type
  cannot, like a unit or a range.
- **Commented-out code.** Git has it.
- **Change narration that no longer explains anything.** "Moved here from x.ts",
  "Previously this used a Map", "Added for T-212", "New:", "Refactored". The
  commit message is where that goes.
- **Comments about code that is gone.** A note on a parameter that was removed,
  or a workaround whose cause was deleted.
- **A TODO, FIXME or XXX with no plan.** Do it now, or move it to
  `docs/FEATURE_TODO.md` or `docs/CODE_TODO.md` with enough context to act on.
- **An `eslint-disable` with no reason.** Add a `-- reason` as the existing ones
  do, or remove the disable and fix the code.

## Keep

- Why a value is what it is (`KEEPALIVE_MS`: "so proxies do not close an idle
  stream").
- What breaks without a line ("Without this, one tab left open is enough to stop
  the process shutting down").
- A platform or library quirk the code works around, with where it lives.
- An invariant the types cannot hold, a unit, an order that matters.
- Why something that looks like a leftover is kept. These often pair with an
  entry in `docs/CODE_TODO.md`'s kept list.
- History that is still the reason. "An audit found forty of these" can stay in
  the header of the script that exists because of it. The test is: if the code
  were removed, would the problem come back? If so, the story is the reason.

## Fix rather than delete

- **A comment that has drifted.** It is correct in spirit but names an old
  value, file or behaviour. Rewrite it to match the code, and check the code is
  right too: drift can mean the code broke, not the comment.
- **A comment that explains a name.** `const t = 3000 // reconnect delay in ms`
  should become `RECONNECT_MS` and lose the comment (see `cleanup-naming`).
- **A comment that explains a tangle.** Untangle the code (see
  `cleanup-functions`). Then the comment shrinks to the why.
- **A long-winded comment** that is right: shorten it, and keep every reason.

## Check

`npm run check:comments` checks that every path, `#member` and mock board a
comment names still exists. Run it after any rename or move. It cannot tell
whether the sentence is still true, so read the comments around anything you
changed. Then run `npm run check`.
